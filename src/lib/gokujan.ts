// 極雀（gokujan.com）の解析結果を、NAGAと同じ形（局ごとの打牌・立直・槓・鳴きの判断）に直す。
// 解析結果の画面 https://gokujan.com/review/<id> の中身は /api/v2/tasks/<id>/result → jsonUrl（/data?token=…）にある。
// アプリからは /api/gokujan?id=… を通して読む（ブラウザから直接は読めないため）
// 中身：mjai_log（対局の Mjai の出来事）、split_logs（局ごとの天鳳形式の牌譜）、review.kyokus[].entries（解析した家の判断ごとの評価）
import type { NagaCall, NagaDecision, NagaKyoku, NagaSummary } from './naga';

type Action = { type: string; actor?: number; target?: number; pai?: string; consumed?: string[]; tsumogiri?: boolean };
type Entry = {
  last_actor: number; tile: string;
  at_self_chi_pon?: boolean; at_self_riichi?: boolean; at_opponent_kakan?: boolean;
  expected: Action; actual: Action; is_equal?: boolean; details: { action: Action; prob: number }[];
};
type Mjai = Action & { bakaze?: string; kyoku?: number; honba?: number };
export type GokujanData = {
  engine?: string;
  player_id: number;
  nplayer?: number;
  mjai_log: Mjai[];
  split_logs?: { log: unknown[][]; name: string[]; rule: { disp: string; aka: number; aka51?: number; aka52?: number; aka53?: number } }[];
  review: { kyokus: { kyoku: number; honba: number; entries: Entry[] }[] };
};
export type GokujanResult = { modelName?: string | null; data: GokujanData };

/** 解析結果のURLから id を取り出す */
export function gokujanId(url: string): string | null {
  const m = /gokujan\.com\/(?:review|tasks)\/([0-9a-f]{8,40})/i.exec(url);
  return m ? m[1] : null;
}

const plain = (p: string) => p.replace(/r$/, '');
const round3 = (p: number) => Math.round(p * 1000) / 1000;

/** チーの形：鳴いた牌が順子のいちばん下・真ん中・上のどれか */
function chiKind(pai: string, consumed: string[]) {
  const n = Number(pai[0]);
  const ns = consumed.map((c) => Number(c[0]));
  if (n < Math.min(...ns)) return 'chi_low';
  if (n > Math.max(...ns)) return 'chi_high';
  return 'chi_mid';
}
/** 鳴き・ロンの選択の名前（NAGAの名前に合わせる） */
function callName(a: Action): string | null {
  if (a.type === 'none') return 'skip';
  if (a.type === 'chi') return chiKind(a.pai ?? '', a.consumed ?? []);
  if (a.type === 'pon' || a.type === 'daiminkan') return a.type;
  if (a.type === 'hora') return 'hora';
  return null;
}

/** 解析結果を、局ごとの判断にする。types は1つ（極雀のモデル） */
export function extractGokujan(res: GokujanResult, id: string): NagaSummary {
  const { data } = res;
  const me = data.player_id;
  const type = `極雀${res.modelName ? ` ${res.modelName}` : ''}`;
  // Mjai の出来事を局ごとに分ける
  const games: Mjai[][] = [];
  for (const m of data.mjai_log) {
    if (m.type === 'start_kyoku') games.push([m]);
    else if (games.length) games[games.length - 1].push(m);
  }
  const kyokus: NagaKyoku[] = [];
  for (const [gi, evs] of games.entries()) {
    const start = evs[0];
    const ba = ['E', 'S', 'W', 'N'].indexOf(start.bakaze ?? 'E');
    const kNum = ba * 4 + ((start.kyoku ?? 1) - 1);
    const honba = start.honba ?? 0;
    const rk = data.review.kyokus.find((k) => k.kyoku === kNum && k.honba === honba) ?? data.review.kyokus[gi];
    const entries = rk?.entries ?? [];
    let ei = 0;
    const take = (ok: (e: Entry) => boolean) => (ei < entries.length && ok(entries[ei]) ? entries[ei++] : null);
    const kyoku: NagaKyoku = { kyoku: kNum, honba, decisions: [], calls: [] };
    const count = [0, 0, 0, 0];
    let pending: { e: Entry; kanOf?: Entry } | null = null; // 自分の打牌の判断（打牌の出来事で決まる）
    let carryKan: Entry | null = null; // 槓をした判断は、嶺上牌の後の打牌に付ける
    let riichiE: Entry | null = null; // 立直を宣言した後の、打牌の判断
    for (const m of evs.slice(1)) {
      const a = m.actor ?? -1;
      if ((m.type === 'tsumo' || m.type === 'chi' || m.type === 'pon') && a === me) {
        const pai = m.type === 'tsumo' ? m.pai ?? '' : m.pai ?? '';
        const e = take((x) => x.last_actor === me && (plain(x.tile) === plain(pai) || !!x.at_self_chi_pon));
        pending = e ? { e } : null;
        riichiE = null;
      } else if (m.type === 'reach' && a === me) {
        riichiE = take((x) => x.last_actor === me && !!x.at_self_riichi);
      } else if ((m.type === 'ankan' || m.type === 'kakan') && a === me) {
        carryKan = pending?.e ?? null;
        pending = null;
      } else if (m.type === 'kakan' && a !== me) {
        take((x) => !!x.at_opponent_kakan); // 搶槓の判断は使わない
      } else if (m.type === 'dahai') {
        if (a === me) {
          const p = pending?.e ?? null;
          if (p || riichiE) {
            const base = p ?? riichiE!;
            kyoku.decisions.push(toDecision(me, count[a], m.pai ?? '', base, p ? riichiE : null, carryKan, m));
          }
          pending = null; riichiE = null; carryKan = null;
        } else {
          // ほかの家の打牌に対する、自分の鳴き・ロンの判断
          const e = take((x) => x.last_actor === a && plain(x.tile) === plain(m.pai ?? '') && !x.at_self_chi_pon && !x.at_self_riichi);
          if (e) kyoku.calls!.push(toCall(me, a, count[a], m.pai ?? '', e));
        }
        count[a]++;
      }
    }
    kyokus.push(kyoku);
  }
  return { reportId: `gokujan:${id}`, types: [type], kyokus };
}

function toCall(seat: number, from: number, discardIndex: number, tile: string, e: Entry): NagaCall {
  const o: Record<string, number> = {};
  for (const d of e.details) {
    const k = callName(d.action);
    if (k) o[k] = round3((o[k] ?? 0) + d.prob);
  }
  return { seat, from, discardIndex, tile, opts: [o], real: callName(e.actual) ?? 'skip' };
}

/**
 * 打牌の判断。e：ツモ（または鳴いた後）の判断、after：立直を宣言した後の打牌の判断、kanE：その前にした槓の判断
 * 立直の評価は、立直して切る牌の評価に分けて足す（NAGAの「立直しての打牌」と同じ見方）
 */
function toDecision(seat: number, discardIndex: number, real: string, e: Entry, after: Entry | null, kanE: Entry | null, m: Mjai): NagaDecision {
  const dist = new Map<string, number>();
  const add = (p: string, v: number) => dist.set(plain(p), (dist.get(plain(p)) ?? 0) + v);
  let reachP: number | null = null;
  for (const d of e.details) {
    if (d.action.type === 'dahai') add(d.action.pai ?? '', d.prob);
    else if (d.action.type === 'reach') reachP = (reachP ?? 0) + d.prob;
  }
  if (reachP != null && after) for (const d of after.details) if (d.action.type === 'dahai') add(d.action.pai ?? '', reachP * d.prob);
  // 立直した後の打牌は解析されないので、立直の評価は実際に切った牌に付ける
  else if (reachP != null && e.actual.type === 'reach') add(real, reachP);
  // 立直の後の打牌の判断しかない（ツモの判断が無い）とき
  if (!e.details.some((d) => d.action.type === 'dahai') && !after && e.at_self_riichi) for (const d of e.details) if (d.action.type === 'dahai') add(d.action.pai ?? '', d.prob);
  const sorted = [...dist].sort((x, y) => y[1] - x[1]);
  let pred: string | null = e.expected.type === 'dahai' ? e.expected.pai ?? null : null;
  if (e.expected.type === 'reach') pred = after?.expected.pai ?? (e.actual.type === 'reach' ? real : null);
  if (!pred && e.expected.type !== 'reach' && sorted.length) pred = sorted[0][0];
  const d: NagaDecision = {
    seat, discardIndex, real: m.pai ?? real, pred: [pred],
    realP: [round3(dist.get(plain(real)) ?? 0)],
    top: [sorted.filter(([, p]) => p >= 0.05).slice(0, 3).map(([tile, p]) => ({ tile, p: round3(p) }))],
    riichi: [reachP != null ? round3(reachP) : null],
    dist: [Object.fromEntries(sorted.filter(([, p]) => p >= 0.005).map(([t, p]) => [t, round3(p)]))],
    realRiichi: e.actual.type === 'reach' || !!after,
  };
  if (kanE) {
    const k: Record<string, number> = { skip: 0 };
    for (const x of kanE.details) {
      const n = x.action.type === 'ankan' || x.action.type === 'kakan' ? x.action.type : 'skip';
      k[n] = round3((k[n] ?? 0) + x.prob);
    }
    d.kan = [k]; d.realKan = kanE.actual.type === 'ankan' || kanE.actual.type === 'kakan' ? kanE.actual.type : 'skip';
  } else if (e.details.some((x) => x.action.type === 'ankan' || x.action.type === 'kakan')) {
    const k: Record<string, number> = { skip: 0 };
    for (const x of e.details) {
      const n = x.action.type === 'ankan' || x.action.type === 'kakan' ? x.action.type : 'skip';
      k[n] = round3((k[n] ?? 0) + x.prob);
    }
    d.kan = [k]; d.realKan = 'skip';
  }
  return d;
}

/** 牌譜（天鳳形式）：局ごとの split_logs を1つの半荘にまとめる */
export function gokujanTenhou(data: GokujanData) {
  const s = data.split_logs ?? [];
  if (!s.length) throw new Error('この解析結果には牌譜が入っていません');
  return { title: ['極雀解析', ''], name: s[0].name, rule: s[0].rule, log: s.flatMap((x) => x.log) };
}

/** アプリのサーバー経由で解析結果を読む */
export async function fetchGokujan(id: string): Promise<GokujanResult> {
  const res = await fetch(`/api/gokujan?id=${encodeURIComponent(id)}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `極雀の解析結果を読めませんでした（${res.status}）`);
  return body as GokujanResult;
}
