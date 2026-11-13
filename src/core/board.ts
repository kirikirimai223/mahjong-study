import {
  BoardSnapshot, DiscardEntry, Meld, RiverTile, RoundLog, Seat, SeatBoard, SeatLog, TakeEntry, Tile,
  SEATS, dealerOf, kindOf, shimochaOf, tileName,
} from './types';
import { timeline } from './tenhou';

const removeOne = (hand: Tile[], t: Tile) => {
  const i = hand.indexOf(t);
  if (i < 0) throw new Error(`手牌に${tileName(t)}がない`);
  hand.splice(i, 1);
};

export const sortTiles = (ts: Tile[]): Tile[] => [...ts].sort((a, z) => kindOf(a) - kindOf(z) || a - z);

/** 牌譜 → 終局図。手出し/ツモ切りも写す。実牌譜からテスト用の終局図を作るのにも使う */
export function logToBoard(log: RoundLog, opts: { haipai?: boolean; draws?: boolean } = {}): BoardSnapshot {
  const seats: SeatBoard[] = SEATS.map(() => ({ river: [], melds: [], hand: [] }));
  const hands = log.seats.map((p) => [...p.haipai]);
  const ownDiscards = [0, 0, 0, 0];
  let lastDiscard: { seat: Seat; riverIndex: number } | undefined;
  const lastDraw: (Tile | undefined)[] = [];

  for (const e of timeline(log)) {
    const hand = hands[e.seat];
    const b = seats[e.seat];
    if (e.type === 'take') {
      const t = e.entry;
      if (t.kind === 'draw') { hand.push(t.tile); lastDraw[e.seat] = t.tile; continue; }
      lastDraw[e.seat] = undefined;
      if (!lastDiscard || lastDiscard.seat !== t.from) throw new Error('鳴きの相手が直前の打牌と合わない');
      seats[t.from].river[lastDiscard.riverIndex].calledBy = e.seat;
      t.own.forEach((o) => removeOne(hand, o));
      b.melds.push({ kind: t.kind, from: t.from, riverIndex: lastDiscard.riverIndex, called: t.called, own: [...t.own] });
      continue;
    }
    const d = e.entry;
    if (d.kind === 'dummy') continue;
    if (d.kind === 'ankan') {
      d.tiles.forEach((o) => removeOne(hand, o));
      const m: Meld = { kind: 'ankan', tiles: [...d.tiles], afterOwnDiscard: ownDiscards[e.seat] };
      if (opts.draws && lastDraw[e.seat] !== undefined) m.draw = lastDraw[e.seat];
      lastDraw[e.seat] = undefined;
      b.melds.push(m);
      continue;
    }
    if (d.kind === 'kakan') {
      removeOne(hand, d.added);
      const ponIndex = b.melds.findIndex((m) => m.kind === 'pon' && kindOf(m.called) === kindOf(d.added));
      if (ponIndex < 0) throw new Error('加槓の元になるポンがない');
      const m: Meld = { kind: 'kakan', ponIndex, added: d.added, afterOwnDiscard: ownDiscards[e.seat] };
      if (opts.draws && lastDraw[e.seat] !== undefined) m.draw = lastDraw[e.seat];
      lastDraw[e.seat] = undefined;
      b.melds.push(m);
      continue;
    }
    const tile = e.tile!;
    removeOne(hand, tile);
    const rt: RiverTile = { tile, tsumogiri: d.tsumogiri };
    if (opts.draws && lastDraw[e.seat] !== undefined) rt.draw = lastDraw[e.seat];
    lastDraw[e.seat] = undefined;
    if (d.riichi) rt.riichi = true;
    b.river.push(rt);
    lastDiscard = { seat: e.seat, riverIndex: b.river.length - 1 };
    ownDiscards[e.seat]++;
  }

  let winTile: Tile | undefined;
  const r = log.result;
  if (r.kind === 'agari' && r.winner === r.from) {
    winTile = lastDraw[r.winner!];
    if (winTile === undefined) throw new Error('自摸の和了牌が見つからない');
    removeOne(hands[r.winner!], winTile);
  }
  seats.forEach((b, i) => {
    b.hand = sortTiles(hands[i]);
    if (opts.haipai) b.haipai = sortTiles(log.seats[i].haipai);
  });
  return { meta: log.meta, setup: log.setup, seats: seats as BoardSnapshot['seats'], result: log.result, winTile };
}

// ---- 終局図 → 牌譜（配牌とツモをランダムに組む） ----

export class BoardError extends Error {
  constructor(public seat: Seat | undefined, message: string) { super(message); }
}

type CallMeld = Meld & { kind: 'chi' | 'pon' | 'daiminkan' };
type KanMeld = Meld & { kind: 'ankan' | 'kakan' };
type Step =
  | { kind: 'draw'; seat: Seat }
  | { kind: 'call'; seat: Seat; meld: CallMeld }
  | { kind: 'discard'; seat: Seat; river: number }
  | { kind: 'kan'; seat: Seat; meld: KanMeld };

/** 手番を復元する（河の順番と鳴かれた印から、誰がいつツモ・打牌・鳴きをしたか） */
export function replayTurns(board: BoardSnapshot, strict = true): Step[] {
  const steps: Step[] = [];
  const ri = [0, 0, 0, 0];
  const kansDone = new Set<Meld>();
  let cur: Seat = dealerOf(board.setup);
  let needDraw = true;
  const r = board.result;

  const isTsumoWinner = (s: Seat) => r.kind === 'agari' && r.winner === s && r.from === s;
  const isChankanVictim = (s: Seat) => r.kind === 'agari' && r.from === s && r.winner !== s;
  const kansAt = (s: Seat) => board.seats[s].melds.filter(
    (m): m is KanMeld => (m.kind === 'ankan' || m.kind === 'kakan') && !kansDone.has(m) && m.afterOwnDiscard === ri[s],
  );

  for (let guard = 0; guard < 1000; guard++) {
    const b = board.seats[cur];
    const riverDone = ri[cur] >= b.river.length;
    if (needDraw) {
      // 河を使い切った家が引くのは、自摸和了か、最後にカンする（嶺上開花・槍槓）ときだけ
      if (riverDone && !isTsumoWinner(cur) && kansAt(cur).length === 0) break;
      steps.push({ kind: 'draw', seat: cur });
    }
    for (const m of kansAt(cur)) {
      kansDone.add(m);
      steps.push({ kind: 'kan', seat: cur, meld: m });
      // 槍槓：最後の加槓でロンされた家は嶺上牌を引かない
      const chankan = riverDone && m.kind === 'kakan' && isChankanVictim(cur);
      if (!chankan) steps.push({ kind: 'draw', seat: cur });
    }
    if (ri[cur] >= b.river.length) break; // 自摸和了（嶺上開花を含む）
    const idx = ri[cur]++;
    steps.push({ kind: 'discard', seat: cur, river: idx });

    const by = b.river[idx].calledBy;
    if (by === undefined) { cur = shimochaOf(cur); needDraw = true; continue; }
    const meld = board.seats[by].melds.find(
      (m) => m.kind !== 'ankan' && m.kind !== 'kakan' && m.from === cur && m.riverIndex === idx,
    ) as CallMeld | undefined;
    if (!meld) {
      if (!strict) return steps;
      throw new BoardError(by, `${idx + 1}枚目の牌を鳴いた副露が見つからない`);
    }
    steps.push({ kind: 'call', seat: by, meld });
    if (meld.kind === 'daiminkan') steps.push({ kind: 'draw', seat: by });
    cur = by;
    needDraw = false;
  }
  if (strict) {
    for (const s of SEATS) {
      if (ri[s] !== board.seats[s].river.length) throw new BoardError(s, '河の牌が手番に収まらない（鳴きの位置を確認）');
    }
  }
  return steps;
}
export type { Step };

/** シード付き乱数（同じシードなら同じ牌譜になる） */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ReconstructOptions {
  random?: () => number; // 既定は Math.random
}

const hasTiles = (ts?: Tile[]) => !!ts && ts.length > 0;

/** 牌の種類ごとの数（赤五は赤五として別に数える） */
function multiset(ts: Tile[]): Map<Tile, number> {
  const m = new Map<Tile, number>();
  for (const t of ts) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}
const takeFrom = (m: Map<Tile, number>, t: Tile): boolean => {
  const n = m.get(t) ?? 0;
  if (n <= 0) return false;
  m.set(t, n - 1);
  return true;
};
const expand = (m: Map<Tile, number>): Tile[] => [...m].flatMap(([t, n]) => Array<Tile>(Math.max(0, n)).fill(t));

/** 卓の136枚（赤ありなら各色の五を1枚赤に） */
function fullSet(aka: boolean): Tile[] {
  const out: Tile[] = [];
  for (const suit of [10, 20, 30]) for (let n = 1; n <= 9; n++) for (let k = 0; k < 4; k++) {
    out.push(aka && n === 5 && k === 0 ? 51 + suit / 10 - 1 : suit + n);
  }
  for (let h = 41; h <= 47; h++) for (let k = 0; k < 4; k++) out.push(h);
  return out;
}

/**
 * 卓の上で所在が分かっている牌すべて（山に残っていない牌）。
 * 家ごとに「配牌」と「手から出した牌＋倒した手牌」の、牌の種類ごとに多い方を数える
 * （配牌の牌は、手から出したか最後まで手に残ったかのどちらかなので）。
 */
export function knownTiles(board: BoardSnapshot): Tile[] {
  const all: Tile[] = [...board.setup.doraIndicators, ...board.setup.uraIndicators];
  const r = board.result;
  board.seats.forEach((b, s) => {
    const out: Tile[] = [...b.river.map((x) => x.tile), ...b.hand];
    for (const m of b.melds) {
      if (m.kind === 'ankan') out.push(...m.tiles); else if (m.kind === 'kakan') out.push(m.added); else out.push(...m.own);
    }
    if (r.kind === 'agari' && r.winner === s && r.from === s && board.winTile !== undefined) out.push(board.winTile);
    const a = multiset(out);
    // 配牌＋入力済みのツモ も、その家が持った牌の下限になる
    const h = multiset([...(b.haipai ?? []), ...b.river.flatMap((x) => (x.draw !== undefined ? [x.draw] : [])),
      ...b.melds.flatMap((m) => ((m.kind === 'ankan' || m.kind === 'kakan') && m.draw !== undefined ? [m.draw] : []))]);
    for (const t of new Set([...a.keys(), ...h.keys()])) {
      for (let k = 0; k < Math.max(a.get(t) ?? 0, h.get(t) ?? 0); k++) all.push(t);
    }
  });
  return all;
}

interface Slot { tile?: Tile } // ツモ1回分。tile が未定なら後で決める

/** 手出し/ツモ切りの実質の値。未指定でもツモ牌が入力されていれば、捨て牌と同じかで決まる */
export const effectiveTsumogiri = (rt: RiverTile): boolean | undefined =>
  rt.tsumogiri ?? (rt.draw !== undefined ? rt.draw === rt.tile : undefined);

/** ある家のツモ（mine[i]）で引いた牌が入力されていれば返す */
function knownDraw(b: SeatBoard, mine: Step[], i: number): Tile | undefined {
  const next = mine[i + 1];
  if (next?.kind === 'discard') return b.river[next.river].draw;
  if (next?.kind === 'kan') return next.meld.draw;
  return undefined;
}
interface Plan {
  haipai: Tile[];
  draws: Slot[];
  tsumogiri: Map<number, boolean>; // 河の位置 → 出力するツモ切りフラグ
  open: Slot[]; // 最後まで決まらなかったツモ（見えていない牌から選ぶ）
}

/**
 * 配牌が入力されている家：前から順に組む。
 * 手出しした牌が手の中にないときは、それより前の未定のツモで引いたことにする。
 * pool があれば（倒した手牌も入力済み）、ツモはその中からしか選ばない。
 */
export function forwardPlan(board: BoardSnapshot, s: Seat, steps: Step[], pool: Map<Tile, number> | undefined, random: () => number, names?: readonly string[]): Plan {
  const b = board.seats[s];
  const nm = names ? names[s] : `席${s}`;
  const r = board.result;
  const tsumoWinner = r.kind === 'agari' && r.winner === s && r.from === s;
  const mine = steps.filter((st) => st.seat === s);
  const lastDraw = mine.map((st) => st.kind).lastIndexOf('draw');
  type Item = { tile: Tile } | { slot: Slot };
  const hand: Item[] = (b.haipai ?? []).map((tile) => ({ tile }));
  const draws: Slot[] = [];
  const tsumogiri = new Map<number, boolean>();
  let thisTurn: Slot | undefined; // 直前のツモ（手出し判定用）

  const fixDraw = (t: Tile, what: string): Slot => {
    if (pool && !takeFrom(pool, t)) throw new BoardError(s, `${nm}：${what}の${tileName(t)}が、配牌と倒した手牌から計算したツモに含まれない`);
    return { tile: t };
  };
  const consume = (t: Tile, notSlot: Slot | undefined, where: string, riverIndex?: number) => {
    const i = hand.findIndex((h) => 'tile' in h && h.tile === t);
    if (i >= 0) { hand.splice(i, 1); return undefined; }
    const cands = hand.map((h, k) => [h, k] as const).filter(([h]) => 'slot' in h && h.slot.tile === undefined && h.slot !== notSlot);
    if (cands.length === 0 || (pool && (pool.get(t) ?? 0) <= 0)) {
      const err = new BoardError(s, `${nm}の${where}（${tileName(t)}）：手の中にこの牌がない（開始時の手牌になく、それまでのツモでも引けない）`);
      (err as BoardError & { riverIndex?: number }).riverIndex = riverIndex;
      throw err;
    }
    const [h, k] = cands[Math.floor(random() * cands.length)];
    const slot = (h as { slot: Slot }).slot;
    if (pool) takeFrom(pool, t);
    slot.tile = t;
    hand.splice(k, 1);
    return slot;
  };

  mine.forEach((st, i) => {
    if (st.kind === 'draw') {
      const next = mine[i + 1];
      const pairedRiver = next?.kind === 'discard' ? b.river[next.river] : undefined;
      let slot: Slot;
      const known = knownDraw(b, mine, i);
      if (tsumoWinner && i === lastDraw && board.winTile !== undefined) slot = fixDraw(board.winTile, '自摸の和了牌');
      else if (known !== undefined) slot = fixDraw(known, 'ツモ牌');
      else if (pairedRiver && effectiveTsumogiri(pairedRiver) === true) slot = fixDraw(pairedRiver.tile, `${next!.kind === 'discard' ? next.river + 1 : ''}打目のツモ切り`);
      else slot = {};
      draws.push(slot);
      hand.push(slot.tile !== undefined ? { tile: slot.tile } : { slot });
      thisTurn = slot;
      return;
    }
    if (st.kind === 'discard') {
      const rt = b.river[st.river];
      const where = `${st.river + 1}打目`;
      const eff = effectiveTsumogiri(rt);
      if (eff === true) {
        consume(rt.tile, undefined, where, st.river);
        tsumogiri.set(st.river, true);
      } else {
        // 手出しなら、この手番に引いた牌そのものは使えない
        const used = consume(rt.tile, eff === false ? thisTurn : undefined, where, st.river);
        tsumogiri.set(st.river, eff ?? (used !== undefined && used === thisTurn));
      }
      thisTurn = undefined;
      return;
    }
    const tiles = st.kind === 'call' ? st.meld.own : st.meld.kind === 'ankan' ? st.meld.tiles : [st.meld.added];
    for (const t of tiles) consume(t, undefined, st.kind === 'call' ? '鳴きに使った牌' : '槓に使った牌');
    thisTurn = undefined;
  });

  const open = hand.filter((h): h is { slot: Slot } => 'slot' in h && h.slot.tile === undefined).map((h) => h.slot);
  if (pool) {
    // 倒した手牌も入力済み：残りのツモは計算で決まる牌を順不同に割り当てる
    const rest = expand(pool);
    if (rest.length !== open.length) throw new BoardError(s, `${nm}：配牌・河・倒した手牌の枚数が合わない`);
    shuffle(rest, random).forEach((t, k) => { open[k].tile = t; });
    const final = sortTiles(hand.map((h) => ('tile' in h ? h.tile : h.slot.tile!)));
    const expected = sortTiles([...b.hand, ...(tsumoWinner && board.winTile !== undefined ? [board.winTile] : [])]);
    if (JSON.stringify(final) !== JSON.stringify(expected)) throw new BoardError(s, `${nm}：配牌から組むと、倒した手牌と一致しない`);
    return { haipai: sortTiles(b.haipai!), draws, tsumogiri, open: [] };
  }
  return { haipai: sortTiles(b.haipai!), draws, tsumogiri, open };
}

/**
 * 倒した手牌だけが入力されている家：終局時の手から時間を逆にたどって組む。
 *   ツモ切り … 抜くのはその手番に捨てた牌 / 手出し … 捨てた牌以外からランダム / 不明 … 手の中からランダム
 * 最後に残った13枚が配牌になる。
 */
function backwardPlan(board: BoardSnapshot, s: Seat, steps: Step[], random: () => number): Plan {
  const b = board.seats[s];
  const r = board.result;
  const tsumoWinner = r.kind === 'agari' && r.winner === r.from && r.winner === s;
  const hand = [...b.hand];
  const mine = steps.filter((st) => st.seat === s);
  let pending: { river: number; rt: RiverTile } | undefined;
  let first = true;
  const drawnRev: Tile[] = [];
  const tsumogiri = new Map<number, boolean>();
  if (tsumoWinner) hand.push(board.winTile!);

  for (let i = mine.length - 1; i >= 0; i--) {
    const st = mine[i];
    if (st.kind === 'discard') {
      const rt = b.river[st.river];
      hand.push(rt.tile);
      pending = { river: st.river, rt };
    } else if (st.kind === 'call') {
      hand.push(...st.meld.own);
      if (pending) tsumogiri.set(pending.river, false);
      pending = undefined;
    } else if (st.kind === 'kan') {
      if (st.meld.kind === 'ankan') hand.push(...st.meld.tiles); else hand.push(st.meld.added);
    } else {
      let t: Tile;
      const known = knownDraw(b, mine, i);
      const eff = pending ? effectiveTsumogiri(pending.rt) : undefined;
      if (first && tsumoWinner) {
        t = board.winTile!;
      } else if (known !== undefined) {
        t = known;
      } else if (pending && eff === true) {
        t = pending.rt.tile;
      } else {
        const pool = [...hand];
        if (pending && eff === false) removeOne(pool, pending.rt.tile);
        if (pool.length === 0) throw new BoardError(s, '手出しにできる牌がない');
        t = pool[Math.floor(random() * pool.length)];
      }
      if (!hand.includes(t)) throw new BoardError(s, `牌の枚数が合わない（${tileName(t)}をツモった形にできない）`);
      removeOne(hand, t);
      drawnRev.push(t);
      if (pending) tsumogiri.set(pending.river, eff ?? t === pending.rt.tile);
      pending = undefined;
    }
    first = false;
  }
  if (hand.length !== 13) throw new BoardError(s, `牌の枚数が合わない（配牌が${hand.length}枚になる。13枚のはず）`);
  return { haipai: sortTiles(hand), draws: drawnRev.reverse().map((tile) => ({ tile })), tsumogiri, open: [] };
}

function shuffle<T>(a: T[], random: () => number): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 終局図から配牌とツモを組む。入力されている情報（配牌・倒した手牌・手出し/ツモ切り）は
 * そのまま使い、決まらない部分だけをランダムにする。家ごとに、
 *   配牌と倒した手牌の両方 … ツモの中身は計算で決まる。ランダムなのは引いた順番だけ
 *   配牌だけ             … 前から組む。使わなかったツモは見えていない牌からランダム
 *   倒した手牌だけ        … 後ろから戻して組む。配牌はその結果で決まる
 */
export function reconstruct(board: BoardSnapshot, opts: ReconstructOptions = {}, names?: readonly string[]): RoundLog {
  const random = opts.random ?? Math.random;
  checkTileCounts(board);
  const steps = replayTurns(board);
  const r = board.result;
  const tsumoWinner = r.kind === 'agari' && r.winner === r.from ? r.winner! : undefined;
  if (tsumoWinner !== undefined && board.winTile === undefined) {
    throw new BoardError(tsumoWinner, '自摸の和了牌が入力されていない');
  }
  checkRiichiAndCalls(board, steps);

  const plans: Plan[] = SEATS.map((s) => {
    const b = board.seats[s];
    const nm = names ? names[s] : `席${s}`;
    if (hasTiles(b.haipai)) {
      if (b.haipai!.length !== 13) throw new BoardError(s, `${nm}の手牌（開始時）が${b.haipai!.length}枚（13枚のはず）`);
      let pool: Map<Tile, number> | undefined;
      if (hasTiles(b.hand)) {
        // ツモの中身 = 倒した手牌 + 手から出した牌 − 配牌
        const out = [...b.hand, ...(s === tsumoWinner ? [board.winTile!] : [])];
        for (const st of steps) {
          if (st.seat !== s) continue;
          if (st.kind === 'discard') out.push(b.river[st.river].tile);
          else if (st.kind === 'call') out.push(...st.meld.own);
          else if (st.kind === 'kan') out.push(...(st.meld.kind === 'ankan' ? st.meld.tiles : [st.meld.added]));
        }
        pool = multiset(out);
        for (const t of b.haipai!) {
          if (!takeFrom(pool, t)) throw new BoardError(s, `${nm}：配牌の${tileName(t)}が、河にも副露にも倒した手牌にもない`);
        }
      }
      return forwardPlan(board, s, steps, pool, random, names);
    }
    if (hasTiles(b.hand) || (s === tsumoWinner && b.melds.length === 4)) return backwardPlan(board, s, steps, random);
    throw new BoardError(s, `${nm}の手牌（開始時の13枚）を入れてください`);
  });

  // 決まらなかったツモは、卓の上に見えていない牌からランダムに選ぶ
  const openSlots = plans.flatMap((p) => p.open);
  if (openSlots.length > 0) {
    const unseen = multiset(fullSet(board.meta.rule.aka !== 0));
    for (const t of knownTiles(board)) takeFrom(unseen, t);
    const rest = shuffle(expand(unseen), random);
    if (rest.length < openSlots.length) throw new BoardError(undefined, '山に残る牌が足りない（入力された牌が多すぎる）');
    openSlots.forEach((slot, k) => { slot.tile = rest[k]; });
  }

  const seats: SeatLog[] = SEATS.map((s) => ({ haipai: plans[s].haipai, take: [], discard: [] }));
  const nextDraw = [0, 0, 0, 0];
  for (const st of steps) {
    const p = seats[st.seat];
    const b = board.seats[st.seat];
    if (st.kind === 'draw') {
      p.take.push({ kind: 'draw', tile: plans[st.seat].draws[nextDraw[st.seat]++].tile! });
    } else if (st.kind === 'call') {
      const { kind, called, own, from } = st.meld;
      p.take.push({ kind, called, own: [...own], from } as TakeEntry);
      if (kind === 'daiminkan') p.discard.push({ kind: 'dummy' });
    } else if (st.kind === 'discard') {
      const rt = b.river[st.river];
      const tsumogiri = plans[st.seat].tsumogiri.get(st.river) ?? false;
      p.discard.push({ kind: 'discard', tile: rt.tile, tsumogiri, riichi: !!rt.riichi });
    } else {
      const m = st.meld;
      if (m.kind === 'ankan') {
        p.discard.push({ kind: 'ankan', tiles: [...m.tiles] });
      } else {
        const pon = b.melds[m.ponIndex];
        if (!pon || pon.kind !== 'pon') throw new BoardError(st.seat, '加槓の元になるポンがない');
        p.discard.push({ kind: 'kakan', added: m.added, called: pon.called, own: [...pon.own], from: pon.from } as DiscardEntry);
      }
    }
  }
  return { meta: board.meta, setup: board.setup, seats: seats as RoundLog['seats'], result: board.result };
}

/** 立直後の手出し、鳴いた直後のツモ切りはありえないのでエラーにする */
function checkRiichiAndCalls(board: BoardSnapshot, steps: Step[]): void {
  for (const s of SEATS) {
    const river = board.seats[s].river;
    const ri = river.findIndex((t) => t.riichi);
    if (ri >= 0) {
      const bad = river.findIndex((t, i) => i > ri && t.tsumogiri === false);
      if (bad >= 0) throw new BoardError(s, `${bad + 1}枚目：立直後に手出しになっている`);
    }
  }
  let prev: Step | undefined;
  for (const st of steps) {
    if (st.kind === 'discard' && prev?.kind === 'call' && prev.seat === st.seat
      && effectiveTsumogiri(board.seats[st.seat].river[st.river]) === true) {
      throw new BoardError(st.seat, `${st.river + 1}枚目：鳴いた直後なのにツモ切りになっている`);
    }
    prev = st;
  }
}

/** 立直宣言牌より後の打牌で、未指定のものをツモ切りにする（入力の既定値） */
export function applyRiichiDefaults(river: RiverTile[]): RiverTile[] {
  const ri = river.findIndex((t) => t.riichi);
  return river.map((t, i) => (i > ri && ri >= 0 && t.tsumogiri === undefined ? { ...t, tsumogiri: true } : t));
}

/** 同じ牌が5枚以上、赤五が2枚以上あればエラー */
export function checkTileCounts(board: BoardSnapshot): void {
  const all: Tile[] = [...board.setup.doraIndicators, ...board.setup.uraIndicators];
  if (board.winTile !== undefined) all.push(board.winTile);
  for (const b of board.seats) {
    all.push(...b.hand, ...b.river.map((r) => r.tile));
    for (const m of b.melds) {
      if (m.kind === 'ankan') all.push(...m.tiles);
      else if (m.kind === 'kakan') all.push(m.added);
      else all.push(...m.own); // 鳴いた牌は相手の河に入っているので数えない
    }
  }
  const count = new Map<Tile, number>();
  for (const t of all) count.set(kindOf(t), (count.get(kindOf(t)) ?? 0) + 1);
  for (const [k, n] of count) if (n > 4) throw new BoardError(undefined, `${tileName(k)}が${n}枚ある`);
  const aka = board.meta.rule.aka !== 0;
  for (const red of [51, 52, 53]) {
    const reds = all.filter((t) => t === red).length;
    if (!aka && reds) throw new BoardError(undefined, `赤なしのルールなのに${tileName(red)}が入っている`);
    if (reds > 1) throw new BoardError(undefined, `${tileName(red)}が2枚以上ある`);
    if (aka && all.filter((t) => t === kindOf(red)).length > 3) throw new BoardError(undefined, `${tileName(kindOf(red))}（赤でない五）が4枚ある（赤ありなので3枚まで）`);
  }
}
