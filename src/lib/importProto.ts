import type { EditorData } from '../editor/main';
import { supabase } from './supabase';

type ProtoRound = { type: 'round'; id: string; gameId: string | null; kyoku: number; honba: number; label: string; summary: string; editor: EditorData; json: unknown | null; createdAt: number };
type ProtoGame = { type: 'game'; id: string; name: string; names?: string[]; createdAt: number };

/** 試作（牌譜エディタ）の「記録をすべて書き出す」ファイルを、この勉強会の半荘として取り込む */
export async function importProtoRecords(sessionId: string, file: File) {
  let parsed: { kind?: string; records?: unknown[] };
  try { parsed = JSON.parse(await file.text()); } catch { throw new Error('ファイルを読めませんでした（JSONではありません）'); }
  if (parsed.kind !== 'paifu-records' || !Array.isArray(parsed.records)) throw new Error('試作の「記録をすべて書き出す」で作ったファイルではありません');
  const recs = parsed.records as (ProtoRound | ProtoGame)[];
  const games = recs.filter((r): r is ProtoGame => r.type === 'game').sort((a, b) => a.createdAt - b.createdAt);
  const rounds = recs.filter((r): r is ProtoRound => r.type === 'round' && !!r.editor);
  const groups: { name: string; rounds: ProtoRound[] }[] = games.map((g) => ({ name: g.name, rounds: rounds.filter((r) => r.gameId === g.id) }));
  const loose = rounds.filter((r) => !r.gameId || !games.some((g) => g.id === r.gameId));
  if (loose.length) groups.push({ name: '試作の最近の局', rounds: loose });
  let nGames = 0; let nRounds = 0;
  for (const grp of groups) {
    if (!grp.rounds.length) continue;
    const first = grp.rounds[0].editor;
    const g = await supabase.from('study_games')
      .insert({ session_id: sessionId, name: grp.name, rule: first.rule, player_names: first.names })
      .select('id').single();
    if (g.error) throw g.error;
    nGames++;
    const rows = grp.rounds.map((r) => ({
      game_id: g.data.id, kyoku: r.kyoku, honba: r.honba, label: r.label, summary: r.summary, editor: r.editor, tenhou_json: r.json ?? null,
    }));
    const ins = await supabase.from('study_rounds').insert(rows);
    if (ins.error) throw ins.error;
    nRounds += rows.length;
  }
  return { games: nGames, rounds: nRounds };
}
