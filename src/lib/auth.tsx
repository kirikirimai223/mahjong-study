import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { errorText, supabase, type Member } from './supabase';

type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'notInvited'; email: string }
  | { status: 'error'; message: string }
  | { status: 'member'; session: Session; member: Member };

const Ctx = createContext<{ state: AuthState; refresh: () => void; setMember: (m: Member) => void }>({
  state: { status: 'loading' }, refresh: () => {}, setMember: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange(() => setTick((t) => t + 1));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;
      if (!session) return setState({ status: 'signedOut' });
      // 招待されていればメンバーに入る（2回目以降は自分の行が返るだけ）
      const { data, error } = await supabase.rpc('study_join');
      if (cancelled) return;
      if (error) {
        if (/not invited/.test(error.message)) setState({ status: 'notInvited', email: session.user.email ?? '' });
        else setState({ status: 'error', message: errorText(error) });
        return;
      }
      setState({ status: 'member', session, member: data as Member });
    })();
    return () => { cancelled = true; };
  }, [tick]);

  return (
    <Ctx.Provider value={{
      state,
      refresh: () => setTick((t) => t + 1),
      setMember: (m) => setState((s) => (s.status === 'member' ? { ...s, member: m } : s)),
    }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
export function useMember() {
  const { state } = useAuth();
  if (state.status !== 'member') throw new Error('メンバーとしてログインしていません');
  return state.member;
}
