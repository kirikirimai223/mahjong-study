import { useState, type FormEvent } from 'react';
import { errorText, supabase } from '../lib/supabase';

export function Login() {
  // 招待の案内文のリンク（?signup=1&email=…）から来たら、登録の画面でアドレスを入れておく
  const params = new URLSearchParams(window.location.search);
  const [mode, setMode] = useState<'signin' | 'signup'>(params.get('signup') ? 'signup' : 'signin');
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'bad' | 'good'; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const creds = { email: email.trim().toLowerCase(), password };
    const { data, error } = mode === 'signin'
      ? await supabase.auth.signInWithPassword(creds)
      : await supabase.auth.signUp(creds);
    setBusy(false);
    if (error) return setMsg({ kind: 'bad', text: errorText(error) });
    if (mode === 'signup' && !data.session) setMsg({ kind: 'good', text: '確認メールを送りました。メールのリンクを開いてからログインしてください' });
  }

  return (
    <main className="narrow">
      <h1>麻雀勉強会</h1>
      <p className="quiet">招待されたメールアドレスで{mode === 'signin' ? 'ログイン' : '登録'}します。</p>
      <form className="card stack" onSubmit={submit}>
        <label>メールアドレス<input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label>パスワード<input type="password" required minLength={6} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <button className="primary" disabled={busy}>{busy ? '送信中…' : mode === 'signin' ? 'ログイン' : '登録する'}</button>
        {msg && <p className={msg.kind}>{msg.text}</p>}
      </form>
      <p className="center">
        {mode === 'signin'
          ? <>初めての方は <button className="link" onClick={() => { setMode('signup'); setMsg(null); }}>登録</button></>
          : <>登録済みの方は <button className="link" onClick={() => { setMode('signin'); setMsg(null); }}>ログイン</button></>}
      </p>
    </main>
  );
}

export function NotInvited({ email }: { email: string }) {
  return (
    <main className="narrow">
      <h1>麻雀勉強会</h1>
      <div className="card stack">
        <p>{email} はまだ招待されていません。管理者に招待を頼んでから、もう一度開いてください。</p>
        <button onClick={() => supabase.auth.signOut()}>ログアウト</button>
      </div>
    </main>
  );
}
