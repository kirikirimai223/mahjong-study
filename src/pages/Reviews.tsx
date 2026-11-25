import { useEffect, useState, type FormEvent } from 'react';
import { errorText, supabase } from '../lib/supabase';
import { useConfirm } from '../lib/useConfirm';
import { decisionMisses, type NagaKyoku, type NagaSummary } from '../lib/naga';
import { analysisOf, loadAnalysis } from '../lib/analysis';

type Review = { id: string; engine: 'naga' | 'mortal' | 'other'; report_url: string; note: string; created_at: string; naga: StoredNaga | null };
/** 取り込んだNAGAの結果（この局の分だけ） */
export type StoredNaga = { reportId: string; types: string[]; kyoku: NagaKyoku; fetchedAt: string };
const ENGINE = { naga: 'NAGA', mortal: 'Mortal・極雀', other: 'Miai・その他' } as const;
/** 結果を取り込めるレポートか（NAGA・極雀） */
const importable = (u: string) => !!analysisOf(u);
const NAGA_SITE = 'https://naga.dmv.nico/naga_report/order_form/';
const MORTAL_SITE = 'https://mjai.ekyu.moe/ja.html';
const GOKUJAN_SITE = 'https://gokujan.com/';

/** 局ごとの解析レポート（URLを残しておき、再解析せずに振り返る） */
export function Reviews({ roundId, kyoku, honba, copyUrl }: { roundId: string; kyoku: number; honba: number; copyUrl: () => Promise<string | null> }) {
  const [rows, setRows] = useState<Review[]>([]);
  const [engine, setEngine] = useState<Review['engine']>('naga');
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  const { confirm, isArmed } = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    const { data, error } = await supabase.from('study_ai_reviews').select('id, engine, report_url, note, created_at, naga').eq('round_id', roundId).order('created_at');
    if (error) return setMsg(errorText(error));
    setRows(data as Review[]);
  }
  useEffect(() => { load(); }, [roundId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function add(e: FormEvent) {
    e.preventDefault();
    const u = url.trim();
    if (!/^https?:\/\//.test(u)) return setMsg('レポートのURL（https://…）を貼ってください');
    const eng = analysisOf(u)?.engine ?? engine;
    const { data, error } = await supabase.from('study_ai_reviews').insert({ round_id: roundId, engine: eng, report_url: u, note: note.trim() }).select('id').single();
    if (error) return setMsg(errorText(error));
    setUrl(''); setNote(''); setMsg('');
    if (importable(u)) await importNaga(data.id as string, u);
    else load();
  }
  /** NAGAのレポート・極雀の解析結果を読み、この局の打牌ごとの推奨を取り込む */
  async function importNaga(id: string, reportUrl: string) {
    if (!analysisOf(reportUrl)) return setMsg('取り込めるのは、NAGAのレポート・極雀・Miaiの解析結果のURLです');
    setBusy(id); setMsg('解析結果を読み込んでいます…');
    try {
      const sum: NagaSummary = (await loadAnalysis(reportUrl)).summary;
      const rid = sum.reportId;
      const k = sum.kyokus.find((x) => x.kyoku === kyoku && x.honba === honba) ?? (sum.kyokus.length === 1 ? sum.kyokus[0] : undefined);
      if (!k) throw new Error(`このレポートに${kyokuLabel(kyoku, honba)}がありません（${sum.kyokus.map((x) => kyokuLabel(x.kyoku, x.honba)).join('・')}）`);
      const stored: StoredNaga = { reportId: rid, types: sum.types, kyoku: k, fetchedAt: new Date().toISOString() };
      const { error } = await supabase.from('study_ai_reviews').update({ naga: stored }).eq('id', id);
      if (error) throw error;
      const mismatch = k.decisions.filter((d) => decisionMisses(d, 0).length > 0).length;
      setMsg(`取り込みました。${k.decisions.length}打のうち、${sum.types[0]}と違う打牌は${mismatch}打です。振り返りの画面で並べて見られます`
        + (k.kyoku !== kyoku || k.honba !== honba ? `（レポートは${kyokuLabel(k.kyoku, k.honba)}として解析されています）` : ''));
    } catch (e) { setMsg(errorText(e)); }
    setBusy(null); load();
  }
  async function remove(id: string) {
    if (!confirm(id)) return;
    const { error } = await supabase.from('study_ai_reviews').delete().eq('id', id);
    if (error) return setMsg(errorText(error));
    load();
  }

  return (
    <div className="reviews card stack">
      <div className="steps">
        <span>① <button className="link" onClick={async () => setMsg((await copyUrl()) ?? 'URLをコピーしました。解析サイトに貼ってください')}>この局のURLをコピー</button></span>
        <span>② <a href={NAGA_SITE} target="_blank" rel="noopener">NAGA</a>の「カスタム牌譜解析」に貼って解析（<a href={MORTAL_SITE} target="_blank" rel="noopener">Mortal</a>・<a href={GOKUJAN_SITE} target="_blank" rel="noopener">極雀</a>・<a href="https://riichi.miai.moe/" target="_blank" rel="noopener">Miai</a>でも可）</span>
        <span>③ 解析一覧からレポートを開き、そのURLを下に貼る（NAGA・極雀・Miaiなら結果を取り込み、振り返りで推奨打牌と並べます）</span>
      </div>
      {rows.length > 0 && (
        <ul className="list">
          {rows.map((r) => (
            <li key={r.id} className="row between">
              <span className="grow">
                <a href={r.report_url} target="_blank" rel="noopener"><b>{ENGINE[r.engine]}</b>{r.note ? `：${r.note}` : ''}</a>
                {(r.engine === 'naga' || importable(r.report_url)) && (r.naga
                  ? <><small className="quiet"> 取り込み済み（{r.naga.types.join('・')}）</small> <button className="link small-btn" disabled={busy === r.id} onClick={() => importNaga(r.id, r.report_url)}>取り込み直す</button></>
                  : importable(r.report_url) && <button className="link small-btn" disabled={busy === r.id} onClick={() => importNaga(r.id, r.report_url)}>結果を取り込む</button>)}
              </span>
              <button className="danger small-btn" onClick={() => remove(r.id)}>{isArmed(r.id) ? '本当に削除' : '削除'}</button>
            </li>
          ))}
        </ul>
      )}
      <form className="stack" onSubmit={add}>
        <div className="row">
          <select value={engine} onChange={(e) => setEngine(e.target.value as Review['engine'])} style={{ width: 'auto' }}>
            <option value="naga">NAGA</option><option value="mortal">Mortal・極雀</option><option value="other">Miai・その他</option>
          </select>
          <input className="grow" type="url" placeholder="レポートのURL" value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>
        <div className="row">
          <input className="grow" placeholder="メモ（モデル名・誰の視点か など）" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="primary">追加</button>
        </div>
      </form>
      {msg && <p className="small">{msg}</p>}
    </div>
  );
}

const WIND = ['東', '南', '西', '北'];
const kyokuLabel = (k: number, h: number) => `${WIND[Math.floor(k / 4)]}${(k % 4) + 1}局${h}本場`;
