// 既にある牌譜（天鳳牌譜エディタのURL・JSON、NAGAの解析レポート、天鳳の対局URL）を、勉強会の半荘として取り込む
import type { EditorData } from '../editor/main';
import { parseTenhou } from '../core/tenhou';
import { logToBoard } from '../core/board';
import { roundLabelOf } from './data';
import { extractNaga, fetchNagaReport, nagaReportId, type NagaSummary } from './naga';
import type { StoredNaga } from '../pages/Reviews';
import { extractGokujan, fetchGokujan, gokujanId, gokujanTenhou } from './gokujan';
import { extractMiai, fetchMiai, miaiId, miaiTenhou } from './miai';

type TenhouJson = { title?: unknown; name: string[]; rule: { disp: string; aka: number; aka51?: number; aka52?: number; aka53?: number }; log: unknown[][] };
/** 取り込む1つの対局（半荘）。naga があれば、各局にNAGAの結果も付ける */
export type ImportGame = { name: string; json: TenhouJson; naga?: NagaSummary; reportUrl?: string; engine?: 'naga' | 'mortal' | 'other' };

const TENHOU_LOG = /(?:log=)?(\d{10}gm-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{8})/;

/** 貼られた文字から、取り込む元を読み取る（1行に1つ。JSONはまとめて1つ） */
export function parseSources(text: string): ({ kind: 'json'; json: TenhouJson } | { kind: 'naga'; reportId: string; url: string } | { kind: 'gokujan'; id: string; url: string } | { kind: 'miai'; id: string; url: string } | { kind: 'tenhou'; logId: string })[] {
  const t = text.trim();
  if (!t) return [];
  if (t.startsWith('{')) return [{ kind: 'json', json: checkJson(JSON.parse(t)) }];
  const out: ReturnType<typeof parseSources> = [];
  for (const line of t.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)) {
    if (line.includes('#json=')) {
      const raw = decodeURIComponent(line.split('#json=')[1]).replace(/&ts=.*$/, '');
      out.push({ kind: 'json', json: checkJson(JSON.parse(raw)) });
    } else if (nagaReportId(line)) out.push({ kind: 'naga', reportId: nagaReportId(line)!, url: line });
    else if (gokujanId(line)) out.push({ kind: 'gokujan', id: gokujanId(line)!, url: line });
    else if (miaiId(line)) out.push({ kind: 'miai', id: miaiId(line)!, url: line });
    else if (TENHOU_LOG.test(line)) out.push({ kind: 'tenhou', logId: TENHOU_LOG.exec(line)![1] });
    else throw new Error(`読めない行があります：${line.slice(0, 60)}`);
  }
  return out;
}
function checkJson(j: unknown): TenhouJson {
  const d = j as TenhouJson;
  if (!d || !Array.isArray(d.log) || !Array.isArray(d.name)) throw new Error('天鳳牌譜エディタの形式（log と name のあるJSON）ではありません');
  return d;
}

/** 取り込む元を読み、半荘ごとの牌譜にまとめる。天鳳牌譜エディタの局は、同じ4人・同じルールなら1つの半荘にまとめる */
export async function loadSources(text: string): Promise<ImportGame[]> {
  const games: ImportGame[] = [];
  for (const src of parseSources(text)) {
    if (src.kind === 'json') {
      const last = games[games.length - 1];
      if (last && !last.naga && sameTable(last.json, src.json)) last.json.log.push(...src.json.log);
      else games.push({ name: titleOf(src.json) || '取り込んだ牌譜', json: { ...src.json, log: [...src.json.log] } });
    } else if (src.kind === 'naga') {
      const report = await fetchNagaReport(src.reportId) as unknown as { custom_haihu: string[]; player_info: { name: string[] }; haihu_id: string };
      // カスタム牌譜は custom_haihu に局ごとの牌譜、天鳳の対局は haihu_id から読み直す
      let json: TenhouJson;
      if (report.custom_haihu?.length) {
        const log = report.custom_haihu.flatMap((s) => JSON.parse(s) as unknown[][]);
        json = { title: ['NAGA解析', ''], name: report.player_info.name, rule: { disp: '般南喰赤', aka: 1 }, log };
      } else if (report.haihu_id) json = await fetchTenhouLog(report.haihu_id);
      else throw new Error('このレポートには牌譜が入っていません');
      games.push({ name: 'NAGAで解析した牌譜', json, naga: extractNaga(report as never, src.reportId), reportUrl: src.url });
    } else if (src.kind === 'miai') {
      const res = await fetchMiai(src.id);
      games.push({ name: 'Miaiで解析した牌譜', json: miaiTenhou(res.review), naga: extractMiai(res), reportUrl: src.url, engine: 'other' });
    } else if (src.kind === 'gokujan') {
      const res = await fetchGokujan(src.id);
      games.push({ name: '極雀で解析した牌譜', json: gokujanTenhou(res.data) as TenhouJson, naga: extractGokujan(res, src.id), reportUrl: src.url, engine: 'mortal' });
    } else {
      const json = await fetchTenhouLog(src.logId);
      games.push({ name: titleOf(json) || `天鳳 ${src.logId.slice(0, 10)}`, json });
    }
  }
  return games;
}
const sameTable = (a: TenhouJson, b: TenhouJson) => JSON.stringify(a.name) === JSON.stringify(b.name) && a.rule?.disp === b.rule?.disp;
const titleOf = (j: TenhouJson) => (Array.isArray(j.title) ? String(j.title[0] ?? '') : '').trim();

/** 天鳳の対局を、アプリのサーバー経由で読む */
async function fetchTenhouLog(logId: string): Promise<TenhouJson> {
  const res = await fetch(`/api/tenhou-log?log=${encodeURIComponent(logId)}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `天鳳の牌譜を読めませんでした（${res.status}）`);
  return checkJson(body);
}

/** 天鳳牌譜の i 局目を、牌譜エディタの入力内容にする（開始時の手牌・毎巡のツモ・河・副露・結果） */
export function editorFromTenhou(json: TenhouJson, i: number): EditorData {
  const one = { ...json, log: [json.log[i]] };
  const log = parseTenhou(JSON.stringify(one));
  const b = logToBoard(log, { haipai: true, draws: true });
  const raw = log.result.raw as unknown[];
  const aka = json.rule?.aka ?? json.rule?.aka51 ?? 1;
  const result = log.result.kind === 'agari'
    ? {
      kind: 'agari' as const, winner: (raw[2] as number[])[0], from: (raw[2] as number[])[1], winTile: b.winTile ?? null,
      deltas: raw[1], points: (raw[2] as unknown[])[3], yaku: (raw[2] as string[]).slice(4).join('\n'), reason: '流局',
    }
    : { kind: 'ryukyoku' as const, winner: 0, from: 1, winTile: null, deltas: raw[1] ?? [0, 0, 0, 0], points: '', yaku: '', reason: String(raw[0] ?? '流局') };
  return {
    me: 0,
    names: [...log.meta.names],
    rule: { disp: json.rule?.disp ?? '般南喰赤', aka: aka ? 1 : 0 },
    setup: structuredClone(b.setup),
    seats: structuredClone(b.seats).map((x) => ({ ...x, hand: [] })), // 倒した手牌は使わない（開始時の手牌と毎巡のツモで決まる）
    result,
  };
}

/** 1つの局を保存する行（局ごとの天鳳形式・要約）と、その局のNAGAの結果 */
export function roundRows(g: ImportGame) {
  return g.json.log.map((_, i) => {
    const editor = editorFromTenhou(g.json, i);
    const { kyoku, honba } = editor.setup;
    const r = editor.result as { kind: string; winner: number; from: number; points: unknown; reason: string };
    const summary = r.kind === 'agari'
      ? `${editor.names[r.winner]}の${r.winner === r.from ? 'ツモ' : `ロン（${editor.names[r.from]}）`}${r.points ? ` ${r.points}` : ''}`
      : r.reason || '流局';
    const nk = g.naga?.kyokus.filter((k) => k.kyoku === kyoku && k.honba === honba)[0] ?? g.naga?.kyokus[i];
    const naga: StoredNaga | null = g.naga && nk ? { reportId: g.naga.reportId, types: g.naga.types, kyoku: nk, fetchedAt: new Date().toISOString() } : null;
    return {
      row: { kyoku, honba, label: roundLabelOf(kyoku, honba), summary, editor, tenhou_json: { title: g.json.title ?? ['', ''], name: g.json.name, rule: g.json.rule, log: [g.json.log[i]] }, randomized_seats: [] as number[] },
      naga,
    };
  });
}

/** 取り込んだ牌譜を、この勉強会の半荘・局として保存する（NAGAの結果があれば、局ごとの解析レポートとして付ける） */
export async function saveImported(sessionId: string, games: ImportGame[]) {
  const { supabase } = await import('./supabase');
  let nGames = 0; let nRounds = 0; let nNaga = 0; let nReused = 0;
  // すでにこの勉強会にある局（同じ牌譜）を探す：NAGAのレポートを後から貼ったときは、新しい半荘を作らずにその局へ結果を付ける
  const gs = await supabase.from('study_games').select('id').eq('session_id', sessionId);
  if (gs.error) throw gs.error;
  const existing = gs.data?.length
    ? await supabase.from('study_rounds').select('id, tenhou_json').in('game_id', gs.data.map((x) => x.id))
    : { data: [] as { id: string; tenhou_json: unknown }[], error: null };
  if (existing.error) throw existing.error;
  const keyOf = (j: unknown) => JSON.stringify((j as { log?: unknown[] } | null)?.log?.[0] ?? null);
  const byLog = new Map((existing.data ?? []).filter((r) => r.tenhou_json).map((r) => [keyOf(r.tenhou_json), r.id as string]));
  for (const g of games) {
    const rows = roundRows(g);
    if (!rows.length) continue;
    const same = rows.map((r) => byLog.get(keyOf(r.row.tenhou_json)));
    if (same.every(Boolean)) {
      // 全部の局がもうある：牌譜は作らず、NAGAの結果だけ付ける（同じレポートは置き換え）
      nReused += rows.length;
      for (const [i, r] of rows.entries()) {
        if (!r.naga || !g.reportUrl) continue;
        const old = await supabase.from('study_ai_reviews').select('id, naga').eq('round_id', same[i]!).eq('engine', g.engine ?? 'naga');
        if (old.error) throw old.error;
        const hit = (old.data ?? []).find((x) => (x.naga as { reportId?: string } | null)?.reportId === r.naga!.reportId);
        const res = hit
          ? await supabase.from('study_ai_reviews').update({ naga: r.naga, report_url: g.reportUrl }).eq('id', hit.id)
          : await supabase.from('study_ai_reviews').insert({ round_id: same[i]!, engine: g.engine ?? 'naga', report_url: g.reportUrl, note: '', naga: r.naga });
        if (res.error) throw res.error;
        nNaga++;
      }
      continue;
    }
    const first = rows[0].row.editor;
    const gi = await supabase.from('study_games').insert({ session_id: sessionId, name: g.name, rule: first.rule, player_names: first.names }).select('id').single();
    if (gi.error) throw gi.error;
    nGames++;
    const ins = await supabase.from('study_rounds').insert(rows.map((r) => ({ ...r.row, game_id: gi.data.id }))).select('id');
    if (ins.error) throw ins.error;
    nRounds += rows.length;
    const reviews = rows.map((r, i) => (r.naga && g.reportUrl ? { round_id: (ins.data as { id: string }[])[i].id, engine: g.engine ?? 'naga', report_url: g.reportUrl, note: '牌譜と一緒に取り込み', naga: r.naga } : null)).filter((x): x is NonNullable<typeof x> => x !== null);
    if (reviews.length) {
      const rv = await supabase.from('study_ai_reviews').insert(reviews);
      if (rv.error) throw rv.error;
      nNaga += reviews.length;
    }
  }
  return { games: nGames, rounds: nRounds, naga: nNaga, reused: nReused };
}
