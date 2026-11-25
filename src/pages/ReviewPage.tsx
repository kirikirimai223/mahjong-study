import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { parseTenhou } from '../core/tenhou';
import { replayFrames, type ReplayFrame } from '../core/replay';
import { errorText, supabase, type Member } from '../lib/supabase';
import { useMember } from '../lib/auth';
import { roundLabelOf, type RoundRow } from '../lib/data';
import { Tile, useTileCss } from '../lib/tiles';
import { useConfirm } from '../lib/useConfirm';
import { agrees, mjaiTile, type NagaDecision } from '../lib/naga';
import type { StoredNaga } from './Reviews';
import { NagaHand, ReviewTable } from './ReviewTable';
import { NagaImport } from './SessionDetail';

type Position = { id: string; seat: number; discard_index: number; conclusion: string; conclusion_by: string | null; updated_at: string };
type Comment = { id: string; position_id: string | null; author_id: string; speaker: string; body: string; tags: string[]; created_at: string };

const WIND = ['東', '南', '西', '北'];
const TAGS = ['押し引き', '手組み', '鳴き判断', '立直判断', '守備', '形式聴牌', '点数状況', 'その他'];
const posKey = (seat: number, idx: number) => `${seat}-${idx}`;

export function ReviewPage() {
  useTileCss();
  const { id } = useParams();
  const me = useMember();
  const [params, setParams] = useSearchParams();
  const [round, setRound] = useState<RoundRow | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [members, setMembers] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');
  const [seatFilter, setSeatFilter] = useState<number | 'all'>('all');
  const [naga, setNaga] = useState<StoredNaga | null>(null);
  const [nagaType, setNagaType] = useState(0);
  // 手前に置く家：null＝自家（入力した人の席）、'follow'＝打牌した家に合わせて毎回回す
  const [viewSeat, setViewSeat] = useState<number | 'follow' | null>(null);

  const [gameRounds, setGameRounds] = useState<{ id: string; kyoku: number; honba: number }[]>([]);
  const [nagaMsg, setNagaMsg] = useState('');
  // 取り込んだNAGAの結果（いちばん新しいもの）
  const loadNaga = useCallback(async () => {
    const ai = await supabase.from('study_ai_reviews').select('naga, created_at').eq('round_id', id!).not('naga', 'is', null).order('created_at', { ascending: false }).limit(1);
    setNaga(ai.data?.[0] ? (ai.data[0].naga as StoredNaga) : null);
  }, [id]);
  const loadNotes = useCallback(async () => {
    const [p, c] = await Promise.all([
      supabase.from('study_positions').select('id, seat, discard_index, conclusion, conclusion_by, updated_at').eq('round_id', id!),
      supabase.from('study_comments').select('id, position_id, author_id, speaker, body, tags, created_at').eq('round_id', id!).order('created_at'),
    ]);
    if (p.error || c.error) return setErr(errorText(p.error ?? c.error));
    setPositions(p.data as Position[]);
    setComments(c.data as Comment[]);
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await supabase.from('study_rounds').select('*').eq('id', id!).maybeSingle();
      if (cancelled) return;
      if (r.error) return setErr(errorText(r.error));
      if (!r.data) return setErr('この局は見つかりませんでした');
      setRound(r.data as RoundRow);
      if (r.data.game_id) {
        const g = await supabase.from('study_games').select('session_id').eq('id', r.data.game_id).maybeSingle();
        if (!cancelled) setSessionId(g.data?.session_id ?? null);
      }
      if (!cancelled) loadNaga();
      if (!cancelled && r.data.game_id) {
        const gr = await supabase.from('study_rounds').select('id, kyoku, honba').eq('game_id', r.data.game_id);
        if (!cancelled && gr.data) setGameRounds(gr.data as { id: string; kyoku: number; honba: number }[]);
      }
      const m = await supabase.from('study_members').select('id, display_name');
      if (!cancelled && m.data) setMembers(Object.fromEntries((m.data as Member[]).map((x) => [x.id, x.display_name])));
      loadNotes();
    })();
    return () => { cancelled = true; };
  }, [id, loadNotes, loadNaga]);

  // 他のメンバーのコメントもその場で反映する（Realtime が使えなければ、開き直したときに反映）
  useEffect(() => {
    const ch = supabase.channel(`review-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'study_comments', filter: `round_id=eq.${id}` }, () => loadNotes())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'study_positions', filter: `round_id=eq.${id}` }, () => loadNotes())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id, loadNotes]);

  const replay = useMemo(() => {
    if (!round?.tenhou_json) return null;
    try {
      const log = parseTenhou(JSON.stringify(round.tenhou_json));
      return { log, frames: replayFrames(log) };
    } catch (e) { return { error: (e as Error).message }; }
  }, [round]);

  const frames = replay && 'frames' in replay ? replay.frames! : [];
  const shown = frames.map((f, i) => ({ f, i })).filter(({ f }) => seatFilter === 'all' || f.seat === seatFilter);
  // 局面は URL の ?p=家-何打目 で持つ（その局面へのリンクを共有できる）
  const indexOf = (q: string | null) => {
    if (q) { const [s, d] = q.split('-').map(Number); const i = frames.findIndex((f) => f.seat === s && f.discardIndex === d); if (i >= 0) return i; }
    return 0;
  };
  const curIndex = indexOf(params.get('p'));
  const cur = frames[curIndex];
  const go = (i: number) => { const f = frames[i]; if (f) setParams({ p: posKey(f.seat, f.discardIndex) }, { replace: true }); };
  const shownPos = shown.findIndex(({ i }) => i === curIndex);
  // 続けて押しても1つずつ進むように、直前の URL から次を決める
  const step = (d: number) => setParams((prev) => {
    const at = indexOf(prev.get('p'));
    const pos = shown.findIndex(({ i }) => i === at);
    const next = shown[Math.max(0, Math.min(shown.length - 1, (pos >= 0 ? pos : 0) + d))];
    const f = next ? frames[next.i] : undefined;
    return f ? { p: posKey(f.seat, f.discardIndex) } : prev;
  }, { replace: true });

  const commentCount = useMemo(() => {
    const byPos = new Map<string, number>();
    for (const c of comments) {
      const ps = positions.find((x) => x.id === c.position_id);
      if (ps) byPos.set(posKey(ps.seat, ps.discard_index), (byPos.get(posKey(ps.seat, ps.discard_index)) ?? 0) + 1);
    }
    for (const ps of positions) if (ps.conclusion) byPos.set(posKey(ps.seat, ps.discard_index), byPos.get(posKey(ps.seat, ps.discard_index)) ?? 0);
    return byPos;
  }, [comments, positions]);

  const nagaOf = useMemo(() => {
    const map = new Map<string, NagaDecision>();
    for (const d of naga?.kyoku.decisions ?? []) map.set(posKey(d.seat, d.discardIndex), d);
    return map;
  }, [naga]);
  const names = round?.editor.names ?? ['', '', '', ''];
  // 手前に置く家：NAGAの結果があれば打牌した家（その手牌の下に評価の棒が出る）、なければ選んだ家か自家
  const viewMode: number | 'follow' = viewSeat ?? (seatFilter !== 'all' ? seatFilter : naga ? 'follow' : round?.editor.me ?? 0);
  const viewOf = (f: ReplayFrame) => (viewMode === 'follow' ? (f.end?.winner ?? f.seat) : viewMode);
  const label = round ? roundLabelOf(round.kyoku, round.honba) : '';
  const back = sessionId ? `/sessions/${sessionId}` : '/';

  return (
    <main className="review">
      <p className="row between"><Link to={back}>← 勉強会</Link><Link to={`/rounds/${id}`}>この局の入力へ</Link></p>
      {err && <p className="bad">{err}</p>}
      {round && <h2>{label}の振り返り <small className="quiet">{round.summary}</small></h2>}
      {round && !round.tenhou_json && (
        <div className="card"><p>この局はまだ天鳳形式になっていません。<Link to={`/rounds/${id}`}>入力画面</Link>で結果まで入れて「保存」すると振り返れます。</p></div>
      )}
      {replay && 'error' in replay && <p className="bad">牌譜を再生できませんでした：{replay.error}</p>}
      {cur && replay && 'log' in replay && (
        <>
          <div className="card slider rv-top">
            <div className="rv-step">
              <button onClick={() => step(-1)} disabled={shownPos <= 0} aria-label="前">◀</button>
              <div className="rv-title">
                <b>{cur.end ? endTitle(cur, names) : `${WIND[(cur.seat - replay.log!.setup.kyoku % 4 + 4) % 4]}家 ${names[cur.seat]}・${cur.discardIndex + 1}打目`}</b>
                <small className="quiet">{cur.end ? cur.end.points : cur.riichi ? '立直宣言' : cur.tsumogiri ? 'ツモ切り' : '手出し'}</small>
              </div>
              <button onClick={() => step(1)} disabled={shownPos >= shown.length - 1} aria-label="次">▶</button>
            </div>
            <input type="range" min={0} max={Math.max(0, shown.length - 1)} value={Math.max(0, shownPos)} onChange={(e) => go(shown[Number(e.target.value)].i)} />
            <div className="rv-opts">
              <select value={String(seatFilter)} onChange={(e) => setSeatFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
                <option value="all">全員の打牌</option>
                {[0, 1, 2, 3].map((s) => <option key={s} value={s}>{names[s]}の打牌だけ</option>)}
              </select>
              <select value={String(viewMode)} onChange={(e) => setViewSeat(e.target.value === 'follow' ? 'follow' : Number(e.target.value))} aria-label="手前に置く家">
                <option value="follow">手前：打牌した家</option>
                {[0, 1, 2, 3].map((s) => <option key={s} value={s}>手前：{names[s]}</option>)}
              </select>
            </div>
          </div>
          <ReviewTable frame={cur} names={names} setup={replay.log!.setup} randomized={round!.randomized_seats}
            view={viewOf(cur)} naga={nagaOf.get(posKey(cur.seat, cur.discardIndex))} nagaType={nagaType} />
          {!naga && (
            <details className="card naga-none" open={!!nagaMsg}>
              <summary><b>NAGAの評価</b> <small className="quiet">この局にはまだ取り込まれていません（開いてレポートのURLを貼る）</small></summary>
              <NagaImport rounds={gameRounds.length ? gameRounds : [{ id: id!, kyoku: round!.kyoku, honba: round!.honba }]} onDone={(m) => { setNagaMsg(m); loadNaga(); }} />
              {nagaMsg && <p className="small">{nagaMsg}</p>}
            </details>
          )}
          {naga && nagaMsg && <p className="small">{nagaMsg}</p>}
          {naga && (
            <NagaPanel naga={naga} frame={cur} decision={nagaOf.get(posKey(cur.seat, cur.discardIndex))} type={nagaType} setType={setNagaType}
              showHand={viewOf(cur) !== cur.seat}
              mismatches={frames.map((f, i) => ({ f, i })).filter(({ f }) => (seatFilter === 'all' || f.seat === seatFilter) && (() => { const d = nagaOf.get(posKey(f.seat, f.discardIndex)); return d && !agrees(d, nagaType); })())}
              names={names} curIndex={curIndex} go={go} />
          )}
          {commentCount.size > 0 && (
            <div className="chips">
              <small className="quiet">話した局面：</small>
              {frames.map((f, i) => ({ f, i })).filter(({ f }) => commentCount.has(posKey(f.seat, f.discardIndex))).map(({ f, i }) => (
                <button key={i} className={`chip ${i === curIndex ? 'on' : ''}`} onClick={() => go(i)}>
                  {names[f.seat]} {f.discardIndex + 1}打目{commentCount.get(posKey(f.seat, f.discardIndex)) ? `（${commentCount.get(posKey(f.seat, f.discardIndex))}）` : ''}
                </button>
              ))}
            </div>
          )}
          {cur.end && cur.end.yaku.length > 0 && <p className="small">{cur.end.yaku.join('・')}</p>}
          <PositionNotes
            key={posKey(cur.seat, cur.discardIndex)}
            roundId={id!} seat={cur.seat} discardIndex={cur.discardIndex}
            position={positions.find((x) => x.seat === cur.seat && x.discard_index === cur.discardIndex)}
            comments={comments} members={members} meId={me.id} meName={me.display_name} onChanged={loadNotes}
            title={cur.end ? endTitle(cur, names) : `${names[cur.seat]}の${cur.discardIndex + 1}打目`}
          />
        </>
      )}
      {round && (
        <PositionNotes roundId={id!} seat={null} discardIndex={null} position={undefined} comments={comments} members={members}
          meId={me.id} meName={me.display_name} onChanged={loadNotes} title="この局全体" />
      )}
    </main>
  );
}

const pct = (p: number | null | undefined) => (p == null ? '―' : `${Math.round(p * 100)}%`);
function MTile({ p, cls = 'sm' }: { p: string | null; cls?: string }) {
  const t = p ? mjaiTile(p) : null;
  return t ? <Tile t={t} cls={cls} /> : <span className="quiet">―</span>;
}

/** NAGAの推奨と実際の打牌を並べる（卓と一緒に1画面に収まるよう、タイプごとに1行）。違う打牌の局面へも飛べる */
function NagaPanel({ naga, frame, decision, type, setType, showHand, mismatches, names, curIndex, go }: {
  naga: StoredNaga; frame: ReplayFrame; decision: NagaDecision | undefined; type: number; setType: (n: number) => void; showHand: boolean;
  mismatches: { f: ReplayFrame; i: number }[]; names: string[]; curIndex: number; go: (i: number) => void;
}) {
  return (
    <div className="card naga compact">
      <div className="naga-head">
        <b>NAGA</b>
        {decision && <span className="real">実際 <MTile p={decision.real} /></span>}
        <select value={type} onChange={(e) => setType(Number(e.target.value))} aria-label="基準のタイプ">
          {naga.types.map((t, i) => <option key={i} value={i}>基準：{t}</option>)}
        </select>
      </div>
      {decision && !frame.end && showHand && <NagaHand s={frame.seats[frame.seat]} naga={decision} nagaType={type} cutTile={frame.tile} />}
      {decision ? (
        <div className="naga-rows">
          {naga.types.map((t, ti) => {
            const ok = agrees(decision, ti);
            return (
              <div key={ti} className={`naga-row ${ok ? 'ok' : 'ng'} ${ti === type ? 'base' : ''}`} onClick={() => setType(ti)}>
                <span className="nm">{t}</span>
                <span className={`mark ${ok ? 'ok' : 'ng'}`}>{ok ? '一致' : '違う'}</span>
                <span className="cands">
                  {decision.top[ti].map((c) => <span key={c.tile} className={`cand ${c.tile.replace(/r$/, '') === decision.real.replace(/r$/, '') ? 'is-real' : ''}`}><MTile p={c.tile} />{pct(c.p)}</span>)}
                  {decision.top[ti].length === 0 && <span className="quiet">―</span>}
                </span>
                <span className="rp">実際{pct(decision.realP[ti])}{decision.riichi[ti] != null ? `・立直${pct(decision.riichi[ti])}` : ''}</span>
              </div>
            );
          })}
        </div>
      ) : <p className="quiet small">{frame.end ? '局の終わりです' : 'この打牌にはNAGAの評価がありません（打牌が1つしか選べない局面など）'}</p>}
      {mismatches.length > 0 && (
        <div className="chips">
          <small className="quiet">{naga.types[type]}と違う打牌（{mismatches.length}）：</small>
          {mismatches.map(({ f, i }) => (
            <button key={i} className={`chip ${i === curIndex ? 'on' : ''}`} onClick={() => go(i)}>{names[f.seat]} {f.discardIndex + 1}打目</button>
          ))}
        </div>
      )}
    </div>
  );
}

function endTitle(f: ReplayFrame, names: string[]) {
  const e = f.end!;
  if (e.kind === 'ryukyoku') return `流局（${e.points}）`;
  return e.kind === 'tsumo' ? `${names[e.winner!]}のツモ和了` : `${names[e.winner!]}のロン和了（${names[e.from!]}から）`;
}

function PositionNotes({ roundId, seat, discardIndex, position, comments, members, meId, meName, onChanged, title }: {
  roundId: string; seat: number | null; discardIndex: number | null; position: Position | undefined; comments: Comment[];
  members: Record<string, string>; meId: string; meName: string; onChanged: () => void; title: string;
}) {
  const isRound = seat === null;
  const mine = comments.filter((c) => (isRound ? c.position_id === null : position && c.position_id === position.id));
  const [conclusion, setConclusion] = useState(position?.conclusion ?? '');
  const [body, setBody] = useState('');
  const [speaker, setSpeaker] = useState(meName);
  const [tags, setTags] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');
  const [msg, setMsg] = useState('');
  const { confirm, isArmed } = useConfirm();
  useEffect(() => { setConclusion(position?.conclusion ?? ''); }, [position?.conclusion]);

  /** 局面の行を用意する（なければ作る。同時に作られても1行にまとまる） */
  async function ensurePosition(): Promise<string | null> {
    if (isRound) return null;
    if (position) return position.id;
    const { data, error } = await supabase.from('study_positions')
      .upsert({ round_id: roundId, seat, discard_index: discardIndex }, { onConflict: 'round_id,seat,discard_index' })
      .select('id').single();
    if (error) throw error;
    return data.id as string;
  }
  async function saveConclusion() {
    try {
      const pid = await ensurePosition();
      const { error } = await supabase.from('study_positions').update({ conclusion: conclusion.trim(), conclusion_by: meId }).eq('id', pid!);
      if (error) throw error;
      setMsg('結論を保存しました'); onChanged();
    } catch (e) { setMsg(errorText(e)); }
  }
  async function add(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    try {
      const pid = await ensurePosition();
      const { error } = await supabase.from('study_comments').insert({ round_id: roundId, position_id: pid, speaker: speaker.trim(), body: body.trim(), tags });
      if (error) throw error;
      setBody(''); setTags([]); setMsg(''); onChanged();
    } catch (e2) { setMsg(errorText(e2)); }
  }
  async function saveEdit(c: Comment) {
    const { error } = await supabase.from('study_comments').update({ body: editBody.trim() }).eq('id', c.id);
    if (error) return setMsg(errorText(error));
    setEditing(null); onChanged();
  }
  async function remove(c: Comment) {
    if (!confirm(c.id)) return;
    const { error } = await supabase.from('study_comments').delete().eq('id', c.id);
    if (error) return setMsg(errorText(error));
    onChanged();
  }

  return (
    <section className="card stack notes">
      <h3>{title}</h3>
      {!isRound && (
        <div className="conclusion stack">
          <label>結論（この局面で何を切るべきだったか など）<textarea rows={2} value={conclusion} onChange={(e) => setConclusion(e.target.value)} /></label>
          <div className="row between">
            <small className="quiet">{position?.conclusion ? `${members[position.conclusion_by ?? ''] ?? '誰か'}が記入` : 'まだ結論はありません'}</small>
            <button onClick={saveConclusion} disabled={conclusion.trim() === (position?.conclusion ?? '')}>結論を保存</button>
          </div>
        </div>
      )}
      {mine.length > 0 && (
        <ul className="comments">
          {mine.map((c) => (
            <li key={c.id}>
              <div className="row between">
                <b>{c.speaker || members[c.author_id] || '名無し'}</b>
                <small className="quiet">{c.speaker && c.speaker !== members[c.author_id] ? `${members[c.author_id] ?? ''}が記録・` : ''}{new Date(c.created_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</small>
              </div>
              {editing === c.id
                ? <div className="stack"><textarea rows={2} value={editBody} onChange={(e) => setEditBody(e.target.value)} /><div className="row"><button onClick={() => saveEdit(c)}>保存</button><button onClick={() => setEditing(null)}>やめる</button></div></div>
                : <p>{c.body}</p>}
              <div className="row between">
                <span>{c.tags.map((t) => <span key={t} className="tag">{t}</span>)}</span>
                {c.author_id === meId && editing !== c.id && (
                  <span className="row">
                    <button className="link" onClick={() => { setEditing(c.id); setEditBody(c.body); }}>編集</button>
                    <button className="link danger" onClick={() => remove(c)}>{isArmed(c.id) ? '本当に削除' : '削除'}</button>
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <form className="stack" onSubmit={add}>
        <textarea rows={2} placeholder={isRound ? 'この局全体へのコメント' : 'この局面へのコメント'} value={body} onChange={(e) => setBody(e.target.value)} />
        <div className="chips">
          {TAGS.map((t) => (
            <button type="button" key={t} className={`chip ${tags.includes(t) ? 'on' : ''}`} onClick={() => setTags((x) => (x.includes(t) ? x.filter((y) => y !== t) : [...x, t]))}>{t}</button>
          ))}
        </div>
        <div className="row">
          <label className="grow">発言者<input value={speaker} onChange={(e) => setSpeaker(e.target.value)} /></label>
          <button className="primary" disabled={!body.trim()}>コメントする</button>
        </div>
      </form>
      {msg && <p className="small">{msg}</p>}
    </section>
  );
}
