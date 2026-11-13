import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { errorText, supabase, type StudySession } from '../lib/supabase';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  const w = '日月火水木金土'[new Date(y, m - 1, d).getDay()];
  return `${y}/${m}/${d}（${w}）`;
};

export function Sessions() {
  const [rows, setRows] = useState<StudySession[] | null>(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [counts, setCounts] = useState<Record<string, { games: number; rounds: number }>>({});

  async function load() {
    const { data, error } = await supabase.from('study_sessions').select('*').order('held_on', { ascending: false }).order('created_at', { ascending: false });
    if (error) return setErr(errorText(error));
    setRows(data as StudySession[]);
    // 半荘数・局数（勉強会グループは小さいので、まとめて取って数える）
    const g = await supabase.from('study_games').select('id, session_id');
    const r = await supabase.from('study_rounds').select('id, game_id');
    if (g.error || r.error) return;
    const c: Record<string, { games: number; rounds: number }> = {};
    const gameSession = new Map<string, string>();
    for (const x of g.data as { id: string; session_id: string | null }[]) {
      if (!x.session_id) continue;
      gameSession.set(x.id, x.session_id);
      (c[x.session_id] ??= { games: 0, rounds: 0 }).games++;
    }
    for (const x of r.data as { game_id: string | null }[]) {
      const sid = x.game_id ? gameSession.get(x.game_id) : undefined;
      if (sid) c[sid].rounds++;
    }
    setCounts(c);
  }
  const shown = rows?.filter((s) => {
    const t = q.trim();
    if (!t) return true;
    return t.split(/\s+/).every((w) => [s.title, s.note, s.held_on, fmtDate(s.held_on), ...s.participants].some((f) => f.includes(w)));
  });
  useEffect(() => { load(); }, []);

  return (
    <main>
      <div className="row between">
        <h2>勉強会</h2>
        <button className="primary" onClick={() => setOpen((o) => !o)}>{open ? '閉じる' : '新しい勉強会'}</button>
      </div>
      {open && <NewSession onDone={() => { setOpen(false); load(); }} />}
      {err && <p className="bad">{err}</p>}
      {rows === null && !err && <p className="quiet">読み込み中…</p>}
      {rows?.length === 0 && <p className="quiet">まだ勉強会がありません。「新しい勉強会」から作ってください。</p>}
      {(rows?.length ?? 0) > 0 && <input className="search" type="search" value={q} placeholder="テーマ・参加者・メモ・日付で絞り込む" onChange={(e) => setQ(e.target.value)} />}
      {q && shown?.length === 0 && <p className="quiet">当てはまる勉強会はありません。</p>}
      <ul className="list">
        {shown?.map((s) => (
          <li key={s.id}>
            <Link to={`/sessions/${s.id}`} className="card link-card">
              <b>{fmtDate(s.held_on)}</b>
              <span>{s.title || '（テーマなし）'}</span>
              {s.participants.length > 0 && <small className="quiet">{s.participants.join('・')}</small>}
              <small className="quiet">{counts[s.id] ? `半荘${counts[s.id].games}・${counts[s.id].rounds}局` : '半荘なし'}</small>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}

function NewSession({ onDone }: { onDone: () => void }) {
  const [heldOn, setHeldOn] = useState(today());
  const [title, setTitle] = useState('');
  const [people, setPeople] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setErr('');
    const participants = people.split(/[、,\s]+/).map((s) => s.trim()).filter(Boolean);
    const { error } = await supabase.from('study_sessions').insert({ held_on: heldOn, title: title.trim(), participants });
    setBusy(false);
    if (error) return setErr(errorText(error));
    onDone();
  }
  return (
    <form className="card stack" onSubmit={submit}>
      <label>開催日<input type="date" required value={heldOn} onChange={(e) => setHeldOn(e.target.value)} /></label>
      <label>テーマ<input value={title} placeholder="例：押し引き" onChange={(e) => setTitle(e.target.value)} /></label>
      <label>参加者（「、」かスペースで区切る）<input value={people} placeholder="例：いいだ、たなか" onChange={(e) => setPeople(e.target.value)} /></label>
      <button className="primary" disabled={busy}>{busy ? '作成中…' : '作成'}</button>
      {err && <p className="bad">{err}</p>}
    </form>
  );
}
