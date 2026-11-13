// 振り返り用：天鳳形式の1局を前から再生し、各打牌の直前の局面を作る
import { timeline } from './tenhou';
import { kindOf, type RoundLog, type Seat, type Tile } from './types';

export interface ReplayRiverTile { tile: Tile; tsumogiri: boolean; riichi: boolean; called: boolean }
export interface ReplayMeld { kind: 'chi' | 'pon' | 'daiminkan' | 'ankan' | 'kakan'; tiles: Tile[]; called?: Tile; from?: Seat }
export interface ReplaySeat {
  /** ツモった牌を除いた手牌（並べ替え済み） */
  hand: Tile[];
  /** この手番にツモった牌（鳴いた直後はなし） */
  drawn?: Tile;
  river: ReplayRiverTile[];
  melds: ReplayMeld[];
  riichi: boolean;
}

/** 打牌1回ぶんの局面。discardIndex は、その家の河の何枚目か（0始まり。槓は数えない） */
export interface ReplayFrame {
  seat: Seat;
  discardIndex: number;
  /** 実際に切った牌 */
  tile: Tile;
  tsumogiri: boolean;
  riichi: boolean;
  /** 打牌の直前の4家 */
  seats: [ReplaySeat, ReplaySeat, ReplaySeat, ReplaySeat];
}

const sortTiles = (a: Tile[]) => [...a].sort((x, y) => kindOf(x) - kindOf(y) || x - y);
function removeOne(hand: Tile[], t: Tile) {
  let i = hand.indexOf(t);
  if (i < 0) i = hand.findIndex((x) => kindOf(x) === kindOf(t)); // 赤と黒の区別が付いていない記録への保険
  if (i < 0) throw new Error(`手牌に ${t} がない`);
  hand.splice(i, 1);
}

/** 各打牌の直前の局面を、局の時系列どおりに並べて返す */
export function replayFrames(log: RoundLog): ReplayFrame[] {
  const hands = log.seats.map((s) => [...s.haipai]);
  const drawn: (Tile | undefined)[] = [undefined, undefined, undefined, undefined];
  const rivers: ReplayRiverTile[][] = [[], [], [], []];
  const melds: ReplayMeld[][] = [[], [], [], []];
  const riichi = [false, false, false, false];
  const frames: ReplayFrame[] = [];
  let lastDiscard: { seat: Seat; idx: number } | null = null;

  const snapshot = () => [0, 1, 2, 3].map((s) => ({
    hand: sortTiles(hands[s]),
    drawn: drawn[s],
    river: rivers[s].map((r) => ({ ...r })),
    melds: melds[s].map((m) => ({ ...m, tiles: [...m.tiles] })),
    riichi: riichi[s],
  })) as ReplayFrame['seats'];

  for (const ev of timeline(log)) {
    const s = ev.seat;
    if (ev.type === 'take') {
      const e = ev.entry;
      if (e.kind === 'draw') { drawn[s] = e.tile; continue; }
      // 鳴き：直前の捨て牌を鳴かれた印にし、自分の牌を副露へ
      if (lastDiscard) rivers[lastDiscard.seat][lastDiscard.idx].called = true;
      for (const t of e.own) removeOne(hands[s], t);
      melds[s].push({ kind: e.kind, tiles: [e.called, ...e.own], called: e.called, from: e.from });
      drawn[s] = undefined;
      continue;
    }
    const e = ev.entry;
    // ツモった牌を手に入れてから考える
    const takeIn = () => { if (drawn[s] !== undefined) { hands[s].push(drawn[s]!); drawn[s] = undefined; } };
    if (e.kind === 'dummy') continue;
    if (e.kind === 'ankan') {
      takeIn();
      for (const t of e.tiles) removeOne(hands[s], t);
      melds[s].push({ kind: 'ankan', tiles: [...e.tiles] });
      continue;
    }
    if (e.kind === 'kakan') {
      takeIn();
      removeOne(hands[s], e.added);
      const pon = melds[s].find((m) => m.kind === 'pon' && kindOf(m.called!) === kindOf(e.called));
      if (pon) { pon.kind = 'kakan'; pon.tiles.push(e.added); } else melds[s].push({ kind: 'kakan', tiles: [e.called, ...e.own, e.added] });
      continue;
    }
    const tile = ev.tile ?? e.tile;
    frames.push({ seat: s, discardIndex: rivers[s].length, tile, tsumogiri: e.tsumogiri, riichi: e.riichi, seats: snapshot() });
    takeIn();
    removeOne(hands[s], tile);
    rivers[s].push({ tile, tsumogiri: e.tsumogiri, riichi: e.riichi, called: false });
    if (e.riichi) riichi[s] = true;
    lastDiscard = { seat: s, idx: rivers[s].length - 1 };
  }
  return frames;
}
