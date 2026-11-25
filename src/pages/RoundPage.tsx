import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { mountEditor, type EditorApi, type EditorData } from '../editor/main';
import { errorText, supabase } from '../lib/supabase';
import { copyText, createRound, roundLabelOf, tenhouUrl, type RoundRow } from '../lib/data';
import { Reviews } from './Reviews';

type SaveState = 'saved' | 'dirty' | 'saving' | 'error';
const AUTOSAVE_MS = 2500;

export function RoundPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const loc = useLocation();
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<EditorApi | null>(null);
  const [round, setRound] = useState<RoundRow | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [save, setSave] = useState<SaveState>('saved');
  const [busy, setBusy] = useState(false);
  const [liveLabel, setLiveLabel] = useState('');
  const [showReviews, setShowReviews] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const writing = useRef<Promise<void> | null>(null);

  // 局を読み込む
  useEffect(() => {
    let cancelled = false;
    setRound(null); setErr(''); setLiveLabel('');
    supabase.from('study_rounds').select('*').eq('id', id!).maybeSingle().then(async ({ data, error }) => {
      if (cancelled) return;
      if (error) return setErr(errorText(error));
      if (!data) return setErr('この局は見つかりませんでした');
      setRound(data as RoundRow);
      if (data.game_id) {
        const g = await supabase.from('study_games').select('session_id').eq('id', data.game_id).maybeSingle();
        if (!cancelled) setSessionId(g.data?.session_id ?? null);
      }
    });
    return () => { cancelled = true; };
  }, [id]);

  /** 保存（withJson：天鳳形式も組んで保存する。自動保存では「出力」を押した結果だけ使う） */
  async function persist(withJson: boolean) {
    const ed = api.current;
    if (!ed || !id) return;
    window.clearTimeout(timer.current);
    if (writing.current) await writing.current; // 1つの局への書き込みは1つずつ
    const s = ed.summary();
    const built = withJson ? ed.buildJson() : ed.outputJson();
    const row = {
      editor: ed.getData(), kyoku: s.kyoku, honba: s.honba, label: s.label, summary: s.summary,
      tenhou_json: built && 'json' in built && built.json ? built.json : null,
      randomized_seats: built && 'json' in built && built.json ? built.randomizedSeats : [],
    };
    setSave('saving');
    const p = (async () => {
      const { error } = await supabase.from('study_rounds').update(row).eq('id', id);
      if (error) { setSave('error'); throw error; }
      setSave('saved');
    })();
    writing.current = p.catch(() => {});
    await p;
    return built;
  }

  // エディタを載せる（局が変わったら作り直す）
  useEffect(() => {
    if (!round || !host.current) return;
    const ed = mountEditor(host.current, {
      initial: round.editor,
      onChange: () => {
        setSave('dirty');
        setLiveLabel(api.current?.summary().label ?? '');
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => { persist(false).catch(() => {}); }, AUTOSAVE_MS);
      },
      onOutput: () => { persist(false).catch(() => {}); },
    });
    api.current = ed;
    const msg = (loc.state as { flash?: string } | null)?.flash;
    if (msg) ed.flash(msg);
    return () => { window.clearTimeout(timer.current); ed.destroy(); api.current = null; };
  }, [round]); // eslint-disable-line react-hooks/exhaustive-deps

  // 保存していない変更があるときは、閉じる前に知らせる
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (save === 'dirty' || save === 'saving') e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [save]);

  async function saveNow() {
    setBusy(true);
    try {
      const built = await persist(true);
      api.current?.flash(built && 'json' in built && built.json ? '保存しました（天鳳形式も更新）' : `保存しました。天鳳形式はまだです（${(built as { error?: string } | null)?.error ?? "未入力"}）`);
    } catch (e) { api.current?.flash(`保存できませんでした：${errorText(e)}`); }
    setBusy(false);
  }

  /** 天鳳形式に組んで保存し、そのURLをコピー。組めなければ理由を返す */
  async function copyNagaUrl(): Promise<string | null> {
    try {
      const built = await persist(true);
      if (!built || !('json' in built) || !built.json) return `まだ天鳳形式に組めません（${(built as { error?: string } | null)?.error ?? '未入力'}）`;
      return (await copyText(tenhouUrl(built.json))) ? null : 'コピーできませんでした';
    } catch (e) { return `保存できませんでした：${errorText(e)}`; }
  }

  async function goNext() {
    const ed = api.current;
    if (!ed || !round?.game_id) return;
    const nx = ed.nextData();
    if (nx.error || !nx.data) return ed.flash(nx.error ?? '次の局を作れませんでした');
    setBusy(true);
    try {
      await persist(true);
      if (nx.finished) { ed.flash('南四局が終わったので、半荘はここまでです'); setBusy(false); return; }
      const rid = await createRound(round.game_id, nx.data as EditorData);
      nav(`/rounds/${rid}`, { state: { flash: nx.ambiguous ? `${nx.label}を始めます（収支がすべて0なので親流れにしました。全員聴牌なら局を戻してください）` : `${nx.label}を始めます` } });
    } catch (e) { ed.flash(`次の局を作れませんでした：${errorText(e)}`); }
    setBusy(false);
  }

  const back = sessionId ? `/sessions/${sessionId}` : '/';
  const label = liveLabel || (round ? roundLabelOf(round.kyoku, round.honba) : '');
  const status = { saved: '保存済み', dirty: '未保存の変更あり', saving: '保存中…', error: '保存できませんでした' }[save];

  return (
    <div className="round-page">
      <div className="roundbar">
        <Link to={back} onClick={(e) => { if (save !== 'saved') { e.preventDefault(); persist(false).then(() => nav(back), () => nav(back)); } }}>← 戻る</Link>
        <span className={`status ${save}`}>{label}・{status}</span>
        <Link to={`/rounds/${id}/review`} className="btnlink" onClick={(e) => { if (save !== 'saved') { e.preventDefault(); persist(false).then(() => nav(`/rounds/${id}/review`), () => nav(`/rounds/${id}/review`)); } }}>振り返り</Link>
        <button onClick={() => setShowReviews((v) => !v)} className={showReviews ? 'on' : ''} disabled={!round}>解析</button>
        <button onClick={saveNow} disabled={busy || !round}>保存</button>
        <button className="primary" onClick={goNext} disabled={busy || !round?.game_id}>次の局へ</button>
      </div>
      {err && <main><p className="bad">{err}</p></main>}
      {showReviews && round && <div className="round-extra"><Reviews roundId={round.id} kyoku={round.kyoku} honba={round.honba} copyUrl={copyNagaUrl} /></div>}
      <div ref={host} />
    </div>
  );
}
