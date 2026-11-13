import type { EditorData } from '../editor/main';
import { supabase } from './supabase';

export type Game = {
  id: string; session_id: string | null; name: string; rule: { disp: string; aka: number };
  player_names: string[]; created_at: string;
};
export type RoundRow = {
  id: string; game_id: string | null; kyoku: number; honba: number; label: string; summary: string;
  editor: EditorData; tenhou_json: unknown | null; randomized_seats: number[]; updated_at: string; created_at: string;
};
/** 一覧に出す列（editor は重いので除く） */
export const ROUND_LIST_COLS = 'id, game_id, kyoku, honba, label, summary, tenhou_json, randomized_seats, updated_at, created_at';
export type RoundListRow = Omit<RoundRow, 'editor'>;

export const roundOrder = (a: RoundListRow, b: RoundListRow) =>
  a.kyoku - b.kyoku || a.honba - b.honba || a.created_at.localeCompare(b.created_at);

const KYOKU = ['東一局', '東二局', '東三局', '東四局', '南一局', '南二局', '南三局', '南四局'];
export const roundLabelOf = (kyoku: number, honba: number) => `${KYOKU[kyoku]}${honba ? ` ${honba}本場` : ''}`;

/** 半荘の最初の局（東一局・25000点持ち）のエディタデータ */
export function firstRoundData(names: string[], rule: Game['rule']): EditorData {
  const emptySeat = () => ({ haipai: [], river: [], melds: [], hand: [] });
  return {
    me: 0,
    names: [0, 1, 2, 3].map((i) => names[i] || ['東家', '南家', '西家', '北家'][i]),
    rule,
    setup: { kyoku: 0, honba: 0, kyotaku: 0, scores: [25000, 25000, 25000, 25000], doraIndicators: [], uraIndicators: [] },
    seats: [emptySeat(), emptySeat(), emptySeat(), emptySeat()],
    result: { kind: 'none', winner: 0, from: 1, winTile: null, deltas: [0, 0, 0, 0], points: '', yaku: '', reason: '流局' },
  };
}

export async function createRound(gameId: string, editor: EditorData) {
  const { kyoku, honba } = editor.setup;
  const { data, error } = await supabase.from('study_rounds')
    .insert({ game_id: gameId, kyoku, honba, label: roundLabelOf(kyoku, honba), summary: '結果未入力', editor })
    .select('id').single();
  if (error) throw error;
  return data.id as string;
}

/** 局を1つの天鳳牌譜にまとめる（tenhou_json がある局だけ。局の順に log をつなぐ） */
export function combineRounds(rounds: RoundListRow[], title: string) {
  const ok = [...rounds].sort(roundOrder).filter((r) => r.tenhou_json);
  if (!ok.length) return null;
  const jsons = ok.map((r) => r.tenhou_json as { title: string[]; name: string[]; rule: unknown; log: unknown[] });
  const json = { title: [title, ''], name: jsons[0].name, rule: jsons[0].rule, log: jsons.flatMap((j) => j.log) };
  return { json, url: tenhouUrl(json), count: ok.length, missing: rounds.filter((r) => !r.tenhou_json).map((r) => r.label) };
}
export const tenhouUrl = (json: unknown) => `https://tenhou.net/6/#json=${encodeURIComponent(JSON.stringify(json))}`;

export function downloadJson(filename: string, obj: unknown) {
  const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
