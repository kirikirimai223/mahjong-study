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
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 2600); };

  return (
    <main>
      <p><Link to="/">← 勉強会の一覧</Link></p>
      {err && <p className="bad">{err}</p>}
      {s && (
        <>
          <h2>{fmtDate(s.held_on)} {s.title}</h2>
          {s.participants.length > 0 && <p className="quiet">参加者：{s.participants.join('・')}</p>}
          {games.length === 0 && <p className="quiet">まだ半荘がありません。「新しい半荘」から始めてください。</p>}
          {games.map((g, i) => (
            <GameCard key={g.id} game={g} index={i} rounds={rounds.filter((r) => r.game_id === g.id).sort(roundOrder)} onChanged={load} flash={flash} />
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

function GameCard({ game, index, rounds, onChanged, flash }: {
  game: Game; index: number; rounds: RoundListRow[]; onChanged: () => void; flash: (m: string) => void;
}) {
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
        <small className="quiet">{game.player_names.join('・')}{game.rule.aka === 0 ? '・赤なし' : ''}</small>
      </div>
      {rounds.length === 0 && <p className="quiet small">局がありません</p>}
      <ol className="rounds">
        {rounds.map((r) => (
          <li key={r.id}>
            <Link to={`/rounds/${r.id}`} className="rt">
              <b>{r.label}</b>
              <small>{r.summary}{r.tenhou_json ? (r.randomized_seats.length ? '・一部ランダムで補完' : '') : '・未出力'}</small>
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
