import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { parseTenhou } from '../core/tenhou';
import { replayFrames, type ReplayFrame, type ReplaySeat } from '../core/replay';
import { errorText, supabase, type Member } from '../lib/supabase';
import { useMember } from '../lib/auth';
import { roundLabelOf, type RoundRow } from '../lib/data';
import { Tile, useTileCss } from '../lib/tiles';
import { useConfirm } from '../lib/useConfirm';

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
      const m = await supabase.from('study_members').select('id, display_name');
      if (!cancelled && m.data) setMembers(Object.fromEntries((m.data as Member[]).map((x) => [x.id, x.display_name])));
      loadNotes();
    })();
    return () => { cancelled = true; };
  }, [id, loadNotes]);

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

  const names = round?.editor.names ?? ['', '', '', ''];
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
          <div className="card stack slider">
            <div className="row between">
              <b>{WIND[(cur.seat - replay.log!.setup.kyoku % 4 + 4) % 4]}家 {names[cur.seat]}・{cur.discardIndex + 1}打目</b>
              <small className="quiet">{cur.riichi ? '立直宣言' : cur.tsumogiri ? 'ツモ切り' : '手出し'}</small>
            </div>
            <input type="range" min={0} max={Math.max(0, shown.length - 1)} value={Math.max(0, shownPos)} onChange={(e) => go(shown[Number(e.target.value)].i)} />
            <div className="row between">
              <button onClick={() => step(-1)} disabled={shownPos <= 0}>◀ 前</button>
              <select value={String(seatFilter)} onChange={(e) => setSeatFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))} style={{ width: 'auto' }}>
                <option value="all">全員の打牌</option>
                {[0, 1, 2, 3].map((s) => <option key={s} value={s}>{names[s]}の打牌だけ</option>)}
              </select>
              <button onClick={() => step(1)} disabled={shownPos >= shown.length - 1}>次 ▶</button>
            </div>
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
          </div>
          <Board frame={cur} names={names} dealer={replay.log!.setup.kyoku % 4} dora={replay.log!.setup.doraIndicators} randomized={round!.randomized_seats} />
          <PositionNotes
            key={posKey(cur.seat, cur.discardIndex)}
            roundId={id!} seat={cur.seat} discardIndex={cur.discardIndex}
            position={positions.find((x) => x.seat === cur.seat && x.discard_index === cur.discardIndex)}
            comments={comments} members={members} meId={me.id} meName={me.display_name} onChanged={loadNotes}
            title={`${names[cur.seat]}の${cur.discardIndex + 1}打目`}
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

function Board({ frame, names, dealer, dora, randomized }: { frame: ReplayFrame; names: string[]; dealer: number; dora: number[]; randomized: number[] }) {
  return (
    <div className="board">
      <div className="dora"><small>ドラ表示</small>{dora.map((t, i) => <Tile key={i} t={t} cls="sm" />)}</div>
      {frame.seats.map((s, seat) => (
        <SeatView key={seat} s={s} seat={seat} active={seat === frame.seat} cutTile={seat === frame.seat ? frame.tile : undefined}
          title={`${WIND[(seat - dealer + 4) % 4]} ${names[seat]}`} guessed={randomized.includes(seat)} />
      ))}
      {randomized.length > 0 && <p className="quiet small">「仮」の家は、入力していない配牌・ツモをランダムで補っています。手牌の中身は実際と違う場合があります。</p>}
    </div>
  );
}

function SeatView({ s, seat, active, cutTile, title, guessed }: { s: ReplaySeat; seat: number; active: boolean; cutTile?: number; title: string; guessed: boolean }) {
  // 切った牌を1枚だけ強調する（ツモ切りならツモ牌、手出しなら手牌の同じ牌）
  const cutDrawn = active && s.drawn !== undefined && s.drawn === cutTile;
  const cutAt = active && !cutDrawn ? s.hand.indexOf(cutTile!) : -1;
  const rows: typeof s.river[] = [];
  for (let i = 0; i < s.river.length; i += 6) rows.push(s.river.slice(i, i + 6));
  return (
    <section className={`seat ${active ? 'active' : ''}`} data-seat={seat}>
      <div className="row between"><b>{title}</b>{guessed && <small className="tag">仮</small>}{s.riichi && <small className="tag riichi">立直</small>}</div>
      <div className="hand">
        {s.hand.map((t, i) => <Tile key={i} t={t} cls={i === cutAt ? 'cut' : ''} />)}
        {s.drawn !== undefined && <><span className="gap" /><Tile t={s.drawn} cls={cutDrawn ? 'cut' : ''} /></>}
        {s.melds.length > 0 && <span className="gap" />}
        {s.melds.map((m, i) => <span key={i} className="meld">{m.tiles.map((t, j) => <Tile key={j} t={t} cls={`sm ${m.kind === 'ankan' && (j === 0 || j === 3) ? 'back' : ''}`} />)}</span>)}
      </div>
      <div className="river">
        {rows.map((r, i) => <div key={i}>{r.map((x, j) => <Tile key={j} t={x.tile} cls={`sm ${x.riichi ? 'yoko' : ''} ${x.tsumogiri ? 'tg' : ''} ${x.called ? 'called' : ''}`} />)}</div>)}
      </div>
    </section>
  );
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
