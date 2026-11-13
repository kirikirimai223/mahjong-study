import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
if (!url || !key) throw new Error('VITE_SUPABASE_URL と VITE_SUPABASE_PUBLISHABLE_KEY を .env.local に設定してください');

export const supabase = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } });

export type Member = { id: string; display_name: string; is_admin: boolean };
export type StudySession = {
  id: string; held_on: string; title: string; participants: string[]; note: string; created_at: string;
};

/** Supabase / PostgREST のエラーを画面に出す日本語に */
export function errorText(e: unknown): string {
  const m = (e as { message?: string })?.message ?? String(e);
  if (/not invited/.test(m)) return 'このメールアドレスは招待されていません。管理者に招待を頼んでください';
  if (/Invalid login credentials/i.test(m)) return 'メールアドレスかパスワードが違います';
  if (/User already registered/i.test(m)) return 'このメールアドレスは登録済みです。ログインしてください';
  if (/Password should be at least/i.test(m)) return 'パスワードは6文字以上にしてください';
  if (/Email not confirmed/i.test(m)) return 'メールアドレスの確認が済んでいません。届いたメールのリンクを開いてください';
  if (/Failed to fetch|NetworkError/i.test(m)) return '通信できませんでした。電波を確認してもう一度試してください';
  return m;
}
