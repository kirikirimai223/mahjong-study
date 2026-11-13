import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { errorText, supabase, type StudySession } from '../lib/supabase';
import {
  combineRounds, copyText, createRound, downloadJson, firstRoundData, ROUND_LIST_COLS, roundOrder, tenhouUrl,
  type Game, type RoundListRow,
} from '../lib/data';
import { useConfirm } from '../lib/useConfirm';
import { importProtoRecords } from '../lib/importProto';
import { fmtDate } from './Sessions';

export function SessionDetail() {
  const { id } = useParams();
  const [s, setS] = useState<StudySession | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [rounds, setRounds] = useState<RoundListRow[]>([]);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reviewed, setReviewed] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const ses = await supabase.from('study_sessions').select('*').eq('id', id!).maybeSingle();
    if (ses.error) return setErr(errorText(ses.error));
    if (!ses.data) return setErr('この勉強会は見つかりませんでした');
    setS(ses.data as StudySession);
    const g = await supabase.from('study_games').select('*').eq('session_id', id!).order('created_at');
    if (g.error) return setErr(errorText(g.error));
    setGames(g.data as Game[]);
    const ids = (g.data as Game[]).map((x) => x.id);
    if (!ids.length) return setRounds([]);
    const r = await supabase.from('study_rounds').select(ROUND_LIST_COLS).in('game_id', ids);
    if (r.error) return setErr(errorText(r.error));
    setRounds(r.data as RoundListRow[]);
    const rids = (r.data as RoundListRow[]).map((x) => x.id);
    if (!rids.length) return setReviewed(new Set());
    const rv = await supabase.from('study_ai_reviews').select('round_id').in('round_id', rids);
    if (!rv.error) setReviewed(new Set((rv.data as { round_id: string }[]).map((x) => x.round_id)));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 2600); };

  return (
    <main>
      <p><Link to="/">← 勉強会の一覧</Link></p>
      {err && <p className="bad">{err}</p>}
      {s && (
        <>
          <div className="row between">
            <h2>{fmtDate(s.held_on)} {s.title}</h2>
            <button onClick={() => setEditing((v) => !v)}>{editing ? '閉じる' : '編集'}</button>
          </div>
          {editing
            ? <EditSession session={s} gameIds={games.map((g) => g.id)} onSaved={() => { setEditing(false); load(); }} />
            : <>
              {s.participants.length > 0 && <p className="quiet">参加者：{s.participants.join('・')}</p>}
              {s.note && <p className="note">{s.note}</p>}
            </>}
          {games.length === 0 && <p className="quiet">まだ半荘がありません。「新しい半荘」から始めてください。</p>}
          {games.map((g, i) => (
            <GameCard key={g.id} game={g} index={i} rounds={rounds.filter((r) => r.game_id === g.id).sort(roundOrder)} reviewed={reviewed} onChanged={load} flash={flash} />
          ))}
          {adding
            ? <NewGame session={s} count={games.length} onCancel={() => setAdding(false)} />
            : <button className="primary wide" onClick={() => setAdding(true)}>新しい半荘</button>}
          <details className="import">
            <summary>試作の記録を取り込む</summary>
            <p className="quiet small">試作の牌譜エディタで「記録」→「記録をすべて書き出す」で保存したファイルを選ぶと、その半荘と局をこの勉強会に入れます。</p>
            <input type="file" accept="application/json,.json" onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f || !s) return;
              try {
                const n = await importProtoRecords(s.id, f);
                flash(`半荘${n.games}つ・${n.rounds}局を取り込みました`);
                load();
              } catch (e2) { flash(errorText(e2)); }
            }} />
          </details>
        </>
      )}
      {msg && <div className="toast">{msg}</div>}
    </main>
  );
}

function NewGame({ session, count, onCancel }: { session: StudySession; count: number; onCancel: () => void }) {
  const nav = useNavigate();
  const [name, setName] = useState(`半荘${count + 1}`);
  const [players, setPlayers] = useState<string[]>(() => [0, 1, 2, 3].map((i) => session.participants[i] ?? ''));
  const [aka, setAka] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setErr('');
    const rule = aka ? { disp: '般南喰赤', aka: 1 } : { disp: '般南喰', aka: 0 };
    const names = players.map((p, i) => p.trim() || ['東家', '南家', '西家', '北家'][i]);
    const g = await supabase.from('study_games').insert({ session_id: session.id, name: name.trim() || `半荘${count + 1}`, rule, player_names: names }).select('id').single();
    if (g.error) { setBusy(false); return setErr(errorText(g.error)); }
    try {
      const rid = await createRound(g.data.id, firstRoundData(names, rule));
      nav(`/rounds/${rid}`);
    } catch (e2) { setBusy(false); setErr(errorText(e2)); }
  }
  return (
    <form className="card stack" onSubmit={submit}>
      <label>半荘の名前<input value={name} onChange={(e) => setName(e.target.value)} /></label>
      <div className="grid4">
        {['起家（東）', '南家', '西家', '北家'].map((lab, i) => (
          <label key={i}>{lab}<input value={players[i]} onChange={(e) => setPlayers((p) => p.map((x, j) => (j === i ? e.target.value : x)))} /></label>
        ))}
      </div>
      <label className="check"><input type="checkbox" checked={aka} onChange={(e) => setAka(e.target.checked)} />赤あり（各色の五に赤1枚）</label>
      <div className="row">
        <button className="primary" disabled={busy}>{busy ? '作成中…' : '作って東一局を入力'}</button>
        <button type="button" onClick={onCancel}>やめる</button>
      </div>
      {err && <p className="bad">{err}</p>}
    </form>
  );
}

function GameCard({ game, index, rounds, reviewed, onChanged, flash }: {
  game: Game; index: number; rounds: RoundListRow[]; reviewed: Set<string>; onChanged: () => void; flash: (m: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const nav = useNavigate();
  const { confirm, isArmed } = useConfirm();
  const [showOut, setShowOut] = useState(false);
  const out = showOut ? combineRounds(rounds, game.name) : null;

  async function delRound(r: RoundListRow) {
    if (!confirm(`r:${r.id}`)) return;
    const { error } = await supabase.from('study_rounds').delete().eq('id', r.id);
    if (error) return flash(errorText(error));
    onChanged();
  }
  async function delGame() {
    if (!confirm('game')) return;
    const del = await supabase.from('study_rounds').delete().eq('game_id', game.id);
    if (del.error) return flash(errorText(del.error));
    const { error } = await supabase.from('study_games').delete().eq('id', game.id);
    if (error) return flash(errorText(error));
    onChanged();
  }
  async function addRound() {
    // 最後の局の続きはその局の「保存して次の局へ」から作る。ここは空の東一局を足す
    try {
      const rid = await createRound(game.id, firstRoundData(game.player_names, game.rule));
      nav(`/rounds/${rid}`);
    } catch (e) { flash(errorText(e)); }
  }

  return (
    <section className="card stack game">
      <div className="row between">
        <h3>{game.name || `半荘${index + 1}`}</h3>
        <button className="small-btn" onClick={() => setEditing((v) => !v)}>{editing ? '閉じる' : '編集'}</button>
      </div>
      {editing
        ? <EditGame game={game} onSaved={() => { setEditing(false); onChanged(); }} />
        : <small className="quiet">{game.player_names.join('・')}{game.rule.aka === 0 ? '・赤なし' : ''}</small>}
      {rounds.length === 0 && <p className="quiet small">局がありません</p>}
      <ol className="rounds">
        {rounds.map((r) => (
          <li key={r.id}>
            <Link to={`/rounds/${r.id}`} className="rt">
              <b>{r.label}</b>
              <small>{r.summary}{r.tenhou_json ? (r.randomized_seats.length ? '・一部ランダムで補完' : '') : '・未出力'}{reviewed.has(r.id) ? '・解析あり' : ''}</small>
            </Link>
            <div className="ra">
              {r.tenhou_json != null && <button onClick={async () => flash((await copyText(tenhouUrl(r.tenhou_json))) ? `${r.label}のURLをコピーしました` : 'コピーできませんでした')}>URL</button>}
              <button className="danger" onClick={() => delRound(r)}>{isArmed(`r:${r.id}`) ? '本当に削除' : '削除'}</button>
            </div>
          </li>
        ))}
      </ol>
      <div className="row wrap">
        <button onClick={() => setShowOut((v) => !v)} disabled={!rounds.some((r) => r.tenhou_json)}>半荘をまとめて出力</button>
        <button onClick={addRound}>空の局を足す</button>
        <button className="danger" onClick={delGame}>{isArmed('game') ? '局ごと本当に削除' : '半荘を削除'}</button>
      </div>
      {out && (
        <div className="out">
          <p>{out.count}局を1つの牌譜にまとめました。{out.missing.length > 0 && <small><br />天鳳形式になっていない局は入っていません：{out.missing.join('、')}</small>}</p>
          <div className="row wrap">
            <button onClick={async () => flash((await copyText(out.url)) ? '半荘のURLをコピーしました' : 'コピーできませんでした')}>URLをコピー</button>
            <button onClick={() => downloadJson(`${game.name || 'hanchan'}.json`, out.json)}>JSONを保存</button>
            <a href={out.url} target="_blank" rel="noopener">天鳳で開く</a>
          </div>
          <p className="quiet small">NAGAには1局ずつ貼るので、各局の「URL」を使ってください</p>
        </div>
      )}
    </section>
  );
}

function EditSession({ session, gameIds, onSaved }: { session: StudySession; gameIds: string[]; onSaved: () => void }) {
  const nav = useNavigate();
  const { confirm, isArmed } = useConfirm();
  const [heldOn, setHeldOn] = useState(session.held_on);
  const [title, setTitle] = useState(session.title);
  const [people, setPeople] = useState(session.participants.join('、'));
  const [note, setNote] = useState(session.note);
  const [err, setErr] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    const participants = people.split(/[、,\s]+/).map((x) => x.trim()).filter(Boolean);
    const { error } = await supabase.from('study_sessions').update({ held_on: heldOn, title: title.trim(), participants, note }).eq('id', session.id);
    if (error) return setErr(errorText(error));
    onSaved();
  }
  async function remove() {
    if (!confirm('del')) return;
    // 半荘を消すと局は宙に浮くので、局→半荘→勉強会の順に消す
    if (gameIds.length) {
      const r = await supabase.from('study_rounds').delete().in('game_id', gameIds);
      if (r.error) return setErr(errorText(r.error));
      const g = await supabase.from('study_games').delete().in('id', gameIds);
      if (g.error) return setErr(errorText(g.error));
    }
    const { error } = await supabase.from('study_sessions').delete().eq('id', session.id);
    if (error) return setErr(errorText(error));
    nav('/');
  }
  return (
    <form className="card stack" onSubmit={submit}>
      <label>開催日<input type="date" required value={heldOn} onChange={(e) => setHeldOn(e.target.value)} /></label>
      <label>テーマ<input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <label>参加者（「、」かスペースで区切る）<input value={people} onChange={(e) => setPeople(e.target.value)} /></label>
      <label>メモ<textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <div className="row between">
        <button className="primary">保存</button>
        <button type="button" className="danger" onClick={remove}>{isArmed('del') ? '半荘・局ごと本当に削除' : 'この勉強会を削除'}</button>
      </div>
      {err && <p className="bad">{err}</p>}
    </form>
  );
}

function EditGame({ game, onSaved }: { game: Game; onSaved: () => void }) {
  const [name, setName] = useState(game.name);
  const [players, setPlayers] = useState<string[]>(() => [0, 1, 2, 3].map((i) => game.player_names[i] ?? ''));
  const [err, setErr] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    const player_names = players.map((p, i) => p.trim() || ['東家', '南家', '西家', '北家'][i]);
    const { error } = await supabase.from('study_games').update({ name: name.trim(), player_names }).eq('id', game.id);
    if (error) return setErr(errorText(error));
    onSaved();
  }
  return (
    <form className="stack" onSubmit={submit}>
      <label>半荘の名前<input value={name} onChange={(e) => setName(e.target.value)} /></label>
      <div className="grid4">
        {['起家（東）', '南家', '西家', '北家'].map((lab, i) => (
          <label key={i}>{lab}<input value={players[i]} onChange={(e) => setPlayers((p) => p.map((x, j) => (j === i ? e.target.value : x)))} /></label>
        ))}
      </div>
      <p className="quiet small">名前の変更は、これから作る局に使われます。入力済みの局の名前は、その局の「局の設定」で変えてください。</p>
      <button className="primary">保存</button>
      {err && <p className="bad">{err}</p>}
    </form>
  );
}
