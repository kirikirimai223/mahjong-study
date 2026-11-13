import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { errorText, supabase, type StudySession } from '../lib/supabase';
import { fmtDate } from './Sessions';

export function SessionDetail() {
  const { id } = useParams();
  const [s, setS] = useState<StudySession | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    supabase.from('study_sessions').select('*').eq('id', id!).maybeSingle().then(({ data, error }) => {
      if (error) setErr(errorText(error));
      else if (!data) setErr('この勉強会は見つかりませんでした');
      else setS(data as StudySession);
    });
  }, [id]);
  return (
    <main>
      <p><Link to="/">← 勉強会の一覧</Link></p>
      {err && <p className="bad">{err}</p>}
      {s && (
        <>
          <h2>{fmtDate(s.held_on)} {s.title}</h2>
          {s.participants.length > 0 && <p className="quiet">参加者：{s.participants.join('・')}</p>}
          <div className="card"><p className="quiet">半荘と局の一覧、牌譜の入力はこの画面に入ります（次の段階で作ります）。</p></div>
        </>
      )}
    </main>
  );
}
