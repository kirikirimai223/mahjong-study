import { BrowserRouter, Link, NavLink, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { supabase } from './lib/supabase';
import { Login, NotInvited } from './pages/Login';
import { Sessions } from './pages/Sessions';
import { SessionDetail } from './pages/SessionDetail';
import { Members } from './pages/Members';

function Shell() {
  const { state, refresh } = useAuth();
  if (state.status === 'loading') return <main className="narrow"><p className="quiet">読み込み中…</p></main>;
  if (state.status === 'signedOut') return <Login />;
  if (state.status === 'notInvited') return <NotInvited email={state.email} />;
  if (state.status === 'error') return <main className="narrow"><p className="bad">{state.message}</p><button onClick={refresh}>もう一度</button></main>;
  return (
    <>
      <header className="top">
        <Link to="/" className="brand">麻雀勉強会</Link>
        <nav>
          <NavLink to="/" end>勉強会</NavLink>
          <NavLink to="/members">メンバー</NavLink>
          <button className="link" onClick={() => supabase.auth.signOut()}>ログアウト</button>
        </nav>
      </header>
      <Routes>
        <Route path="/" element={<Sessions />} />
        <Route path="/sessions/:id" element={<SessionDetail />} />
        <Route path="/members" element={<Members />} />
        <Route path="*" element={<main><p>ページが見つかりません。<Link to="/">一覧へ</Link></p></main>} />
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Shell />
      </BrowserRouter>
    </AuthProvider>
  );
}
