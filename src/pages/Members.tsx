import { useEffect, useState, type FormEvent } from 'react';
import { useAuth, useMember } from '../lib/auth';
import { errorText, supabase, type Member } from '../lib/supabase';

type Invite = { email: string; invited_at: string };

export function Members() {
  const me = useMember();
  const { setMember } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [name, setName] = useState(me.display_name);
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');

  async function load() {
    const m = await supabase.from('study_members').select('id, display_name, is_admin').order('created_at');
    if (m.data) setMembers(m.data as Member[]);
    if (me.is_admin) {
      const i = await supabase.from('study_invites').select('email, invited_at').order('invited_at', { ascending: false });
      if (i.data) setInvites(i.data as Invite[]);
    }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveName(e: FormEvent) {
    e.preventDefault();
    const v = name.trim();
    if (!v || v === me.display_name) return;
    const { data, error } = await supabase.from('study_members').update({ display_name: v }).eq('id', me.id).select('id, display_name, is_admin').single();
    if (error) return setMsg(errorText(error));
    setMember(data as Member); setMsg('表示名を変えました'); load();
  }
  async function invite(e: FormEvent) {
    e.preventDefault();
    const v = email.trim().toLowerCase();
    if (!v) return;
    const { error } = await supabase.from('study_invites').insert({ email: v, invited_by: me.id });
    if (error) return setMsg(/duplicate/.test(error.message) ? 'そのアドレスは招待済みです' : errorText(error));
    setEmail(''); setMsg(`${v} を招待しました。登録画面からこのアドレスで登録してもらってください`); load();
  }
  async function uninvite(v: string) {
    const { error } = await supabase.from('study_invites').delete().eq('email', v);
    if (error) return setMsg(errorText(error));
    load();
  }

  return (
    <main>
      <h2>メンバー</h2>
      <form className="card row" onSubmit={saveName}>
        <label className="grow">あなたの表示名<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <button>変更</button>
      </form>
      <ul className="list">
        {members.map((m) => <li key={m.id} className="card row between"><span>{m.display_name}</span>{m.is_admin && <small className="tag">管理者</small>}</li>)}
      </ul>
      {me.is_admin && (
        <>
          <h3>招待</h3>
          <form className="card row" onSubmit={invite}>
            <label className="grow">メールアドレス<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <button className="primary">招待</button>
          </form>
          <ul className="list">
            {invites.map((i) => <li key={i.email} className="card row between"><span>{i.email}</span><button className="danger" onClick={() => uninvite(i.email)}>取り消す</button></li>)}
          </ul>
          <p className="quiet small">招待を取り消しても、すでに登録した人はメンバーのままです。</p>
        </>
      )}
      {msg && <p className="flash-inline">{msg}</p>}
    </main>
  );
}
