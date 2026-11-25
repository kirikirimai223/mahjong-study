// Miai（riichi.miai.moe）の解析結果を読む。
// 解析の画面 https://riichi.miai.moe/r/<id> の中身は /api/reviews/<id> にある（アプリからは /api/miai?id=… を通す）
//   review.events    … 対局全体の Mjai の出来事（牌譜はここから天鳳形式に直す）
//   review.decisions … 判断ごとの評価。at は判断した時点の出来事の番号、options は選択肢と評価、played は実際に選んだもの
//   review.results   … 局ごとの結果（天鳳形式のまま）
import type { NagaCall, NagaDecision, NagaKyoku, NagaSummary } from './naga';
import { mjaiTile } from './naga';
import { callName, plain, round3, type Action } from './gokujan';
import { formatDiscard, formatTake, type TenhouJson } from '../core/tenhou';
import type { DiscardEntry, Seat, TakeEntry, Tile } from '../core/types';

type Ev = Action & {
  bakaze?: string; kyoku?: number; honba?: number; kyotaku?: number; oya?: number; dora_marker?: string;
  scores?: number[]; tehais?: string[][]; names?: string[]; ura_markers?: string[]; deltas?: number[];
};
type Option = { event: Action; p: number };
type Decision = { at: number; played: number; matched?: boolean; bad?: boolean; options: Option[] };
export type MiaiReview = { names: string[]; seat: number; mode?: string; events: Ev[]; results: unknown[][]; decisions: Decision[] };
export type MiaiResult = { id: string; review: MiaiReview };

const MODE: Record<string, string> = { avoid_fourth: 'ラス回避', standard: '', normal: '' };

/** 解析のURLから id を取り出す */
export function miaiId(url: string): string | null {
  const m = /miai\.moe\/r\/([0-9a-z]{8,40})/i.exec(url);
  return m ? m[1] : null;
}

const num = (p: string): Tile => {
  const t = mjaiTile(p);
  if (t == null) throw new Error(`牌の名前が読めません: ${p}`);
  return t;
};

/** Mjai の出来事を、局ごとの天鳳形式の牌譜（半荘1つ）にする */
export function miaiTenhou(r: MiaiReview): TenhouJson {
  const log: unknown[][] = [];
  let ki = -1;
  let cur: {
    head: unknown[]; dora: Tile[]; ura: Tile[];
    seats: { haipai: Tile[]; take: TakeEntry[]; discard: DiscardEntry[] }[];
    reach: boolean[]; pons: Map<string, { called: Tile; own: Tile[]; from: Seat }>[];
  } | null = null;
  const flush = () => {
    if (!cur) return;
    const round: unknown[] = [...cur.head, cur.dora, cur.ura];
    cur.seats.forEach((s, i) => round.push(s.haipai, s.take.map((t) => formatTake(i as Seat, t)), s.discard.map((d) => formatDiscard(i as Seat, d))));
    round.push(r.results[ki] ?? ['流局', [0, 0, 0, 0]]);
    log.push(round);
    cur = null;
  };
  for (const e of r.events) {
    const a = (e.actor ?? 0) as Seat;
    if (e.type === 'start_kyoku') {
      flush(); ki++;
      const ba = ['E', 'S', 'W', 'N'].indexOf(e.bakaze ?? 'E');
      cur = {
        head: [[ba * 4 + (e.kyoku ?? 1) - 1, e.honba ?? 0, e.kyotaku ?? 0], e.scores ?? [25000, 25000, 25000, 25000]],
        dora: [num(e.dora_marker ?? '')], ura: [],
        seats: (e.tehais ?? []).map((h) => ({ haipai: h.map(num), take: [], discard: [] })),
        reach: [false, false, false, false], pons: [0, 1, 2, 3].map(() => new Map()),
      };
      continue;
    }
    if (!cur) continue;
    const c = cur as NonNullable<typeof cur>;
    const s = c.seats[a];
    switch (e.type) {
      case 'tsumo': s.take.push({ kind: 'draw', tile: num(e.pai ?? '') }); break;
      case 'chi': s.take.push({ kind: 'chi', called: num(e.pai ?? ''), own: (e.consumed ?? []).map(num), from: e.target as Seat }); break;
      case 'pon': {
        const t: TakeEntry = { kind: 'pon', called: num(e.pai ?? ''), own: (e.consumed ?? []).map(num), from: e.target as Seat };
        s.take.push(t); c.pons[a].set(plain(e.pai ?? ''), { called: t.called, own: t.own, from: t.from });
        break;
      }
      case 'daiminkan':
        s.take.push({ kind: 'daiminkan', called: num(e.pai ?? ''), own: (e.consumed ?? []).map(num), from: e.target as Seat });
        s.discard.push({ kind: 'dummy' });
        break;
      case 'ankan': s.discard.push({ kind: 'ankan', tiles: (e.consumed ?? []).map(num) }); break;
      case 'kakan': {
        const p = c.pons[a].get(plain(e.pai ?? ''));
        if (!p) throw new Error('加槓のもとのポンが見つかりません');
        s.discard.push({ kind: 'kakan', added: num(e.pai ?? ''), called: p.called, own: p.own, from: p.from });
        break;
      }
      case 'reach': c.reach[a] = true; break;
      case 'dahai': {
        const riichi = c.reach[a];
        c.reach[a] = false;
        s.discard.push({ kind: 'discard', tile: e.tsumogiri ? 60 : num(e.pai ?? ''), tsumogiri: !!e.tsumogiri, riichi });
        break;
      }
      case 'dora': c.dora.push(num(e.dora_marker ?? '')); break;
      case 'hora': if (e.ura_markers?.length) c.ura = e.ura_markers.map(num); break;
    }
  }
  flush();
  const aka = r.events[0]?.type === 'start_game' && (r.events[0] as { aka_flag?: boolean }).aka_flag === false ? 0 : 1;
  const south = r.events.some((e) => e.type === 'start_kyoku' && e.bakaze === 'S');
  // 天鳳の牌譜と同じ書き方にする（既にある牌譜と同じか比べるため）
  return { title: ['Miai解析', ''], name: r.names, rule: { disp: `般${south ? '南' : '東'}喰${aka ? '赤' : ''}`, aka: 0, aka51: aka, aka52: aka, aka53: aka } as TenhouJson['rule'], log };
}

/** 解析結果を、局ごとの判断にする（NAGAと同じ形。types は1つ） */
export function extractMiai(res: MiaiResult): NagaSummary {
  const r = res.review;
  const mode = MODE[r.mode ?? ''] ?? r.mode ?? '';
  const type = `Miai${mode ? `（${mode}）` : ''}`;
  const byAt = new Map(r.decisions.map((d) => [d.at, d]));
  const kyokus: NagaKyoku[] = [];
  let k: NagaKyoku | null = null;
  const count = [0, 0, 0, 0];
  let pending: Decision | null = null; // 自分の打牌の判断（打牌の出来事で決まる）
  let after: Decision | null = null; // 立直を宣言した後の打牌の判断
  let kanD: Decision | null = null;
  r.events.forEach((e, i) => {
    if (e.type === 'start_kyoku') {
      const ba = ['E', 'S', 'W', 'N'].indexOf(e.bakaze ?? 'E');
      k = { kyoku: ba * 4 + (e.kyoku ?? 1) - 1, honba: e.honba ?? 0, decisions: [], calls: [] };
      kyokus.push(k); count.fill(0); pending = after = kanD = null;
    }
    if (!k) return;
    const kk = k as NagaKyoku;
    const d = byAt.get(i);
    const a = e.actor ?? -1;
    const who = d?.options[0]?.event.actor ?? (d?.options.find((o) => o.event.actor != null)?.event.actor);
    if (e.type === 'tsumo' || e.type === 'chi' || e.type === 'pon') {
      if (d && who === a) { pending = d; after = null; }
    } else if (e.type === 'reach') {
      if (d) after = d;
    } else if (e.type === 'ankan' || e.type === 'kakan') {
      if (d && who !== a) { /* 搶槓の判断は使わない */ } else { kanD = pending; pending = d && who === a ? d : null; }
    } else if (e.type === 'dahai') {
      if (pending || after) kk.decisions.push(toDecision(a, count[a], e, pending ?? after!, pending ? after : null, kanD));
      pending = after = kanD = null;
      // ほかの家の打牌に対する、鳴き・ロンの判断
      if (d && who != null && who !== a) kk.calls!.push(toCall(who, a, count[a], e.pai ?? '', d));
      count[a]++;
    }
  });
  return { reportId: `miai:${res.id}`, types: [type], kyokus };
}

function toCall(seat: number, from: number, discardIndex: number, tile: string, d: Decision): NagaCall {
  const o: Record<string, number> = {};
  for (const x of d.options) {
    const n = callName(x.event);
    if (n) o[n] = round3((o[n] ?? 0) + x.p);
  }
  return { seat, from, discardIndex, tile, opts: [o], real: callName(d.options[d.played]?.event ?? { type: 'none' }) ?? 'skip' };
}

function toDecision(seat: number, discardIndex: number, m: Ev, d: Decision, after: Decision | null, kanD: Decision | null): NagaDecision {
  const real = m.pai ?? '';
  const dist = new Map<string, number>();
  const add = (p: string, v: number) => dist.set(plain(p), (dist.get(plain(p)) ?? 0) + v);
  let reachP: number | null = null;
  for (const o of d.options) {
    if (o.event.type === 'dahai') add(o.event.pai ?? '', o.p);
    else if (o.event.type === 'reach') reachP = (reachP ?? 0) + o.p;
  }
  const playedType = d.options[d.played]?.event.type;
  if (reachP != null && after) {
    for (const o of after.options) if (o.event.type === 'dahai') add(o.event.pai ?? '', reachP * o.p);
  } else if (reachP != null && playedType === 'reach') add(real, reachP);
  const sorted = [...dist].sort((x, y) => y[1] - x[1]);
  const best = [...d.options].sort((x, y) => y.p - x.p)[0]?.event;
  let pred: string | null = best?.type === 'dahai' ? best.pai ?? null : null;
  if (best?.type === 'reach') {
    const ab = after ? [...after.options].sort((x, y) => y.p - x.p)[0]?.event : null;
    pred = ab?.pai ?? (playedType === 'reach' ? real : null);
  }
  const out: NagaDecision = {
    seat, discardIndex, real, pred: [pred],
    realP: [round3(dist.get(plain(real)) ?? 0)],
    top: [sorted.filter(([, p]) => p >= 0.05).slice(0, 3).map(([tile, p]) => ({ tile, p: round3(p) }))],
    riichi: [reachP != null ? round3(reachP) : null],
    dist: [Object.fromEntries(sorted.filter(([, p]) => p >= 0.005).map(([t, p]) => [t, round3(p)]))],
    realRiichi: playedType === 'reach',
  };
  const kanOf = (x: Decision) => {
    if (!x.options.some((o) => o.event.type === 'ankan' || o.event.type === 'kakan')) return null;
    const o: Record<string, number> = { skip: 0 };
    for (const y of x.options) {
      const n = y.event.type === 'ankan' || y.event.type === 'kakan' ? y.event.type : 'skip';
      o[n] = round3((o[n] ?? 0) + y.p);
    }
    return o;
  };
  const kd = kanD ?? d;
  const ko = kanOf(kd);
  if (ko) {
    const pt = kd.options[kd.played]?.event.type;
    out.kan = [ko]; out.realKan = pt === 'ankan' || pt === 'kakan' ? pt : 'skip';
  }
  return out;
}

/** アプリのサーバー経由で解析結果を読む */
export async function fetchMiai(id: string): Promise<MiaiResult> {
  const res = await fetch(`/api/miai?id=${encodeURIComponent(id)}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Miaiの解析結果を読めませんでした（${res.status}）`);
  return body as MiaiResult;
}
