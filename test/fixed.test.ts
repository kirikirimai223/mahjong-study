import { describe, expect, it } from 'vitest';
import { parseTenhou, toTenhouJson } from '../src/core/tenhou';
import { BoardError, logToBoard, reconstruct, seededRandom, sortTiles } from '../src/core/board';
import { BoardSnapshot } from '../src/core/types';
import { SAMPLE_URL, KAN_URL, RINSHAN_URL, CHANKAN_URL } from './fixtures';

const CASES = [['南三局', SAMPLE_URL], ['四槓子', KAN_URL], ['嶺上開花', RINSHAN_URL], ['槍槓', CHANKAN_URL]] as const;
const strip = (b: BoardSnapshot, keep: 'haipai' | 'hand' | 'both'): BoardSnapshot => {
  const c = structuredClone(b);
  c.seats.forEach((x) => { if (keep === 'haipai') x.hand = []; if (keep === 'hand') delete x.haipai; });
  return c;
};
// 組んだ牌譜から、入力に相当する部分（河・副露・手出し/ツモ切り）だけを取り出す
const visible = (b: BoardSnapshot) => b.seats.map((s) => ({ river: s.river, melds: s.melds }));

describe.each(CASES)('%s：入力済みの情報はそのまま使う', (_n, url) => {
  const log = parseTenhou(url);
  const full = logToBoard(log, { haipai: true });

  it('配牌と倒した手牌の両方：配牌も最終形も元のまま、ランダムなのはツモの順番だけ', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const rebuilt = reconstruct(full, { random: seededRandom(seed) });
      rebuilt.seats.forEach((p, s) => expect(p.haipai).toEqual(sortTiles(log.seats[s].haipai)));
      expect(logToBoard(rebuilt, { haipai: true })).toEqual(full);
    }
  });

  it('配牌だけ：配牌は元のまま、河・副露・手出し/ツモ切りも元のまま', () => {
    const input = strip(full, 'haipai');
    for (let seed = 1; seed <= 60; seed++) {
      const rebuilt = reconstruct(input, { random: seededRandom(seed) });
      rebuilt.seats.forEach((p, s) => expect(p.haipai).toEqual(sortTiles(log.seats[s].haipai)));
      const back = logToBoard(rebuilt, { haipai: true });
      expect(visible(back)).toEqual(visible(full));
      // 最終形の枚数は副露に応じた枚数
      back.seats.forEach((x) => expect(x.hand.length).toBe(13 - 3 * x.melds.filter((m) => m.kind !== 'kakan').length));
    }
  });

  it('配牌だけ：組んだ牌譜に、同じ牌が5枚・赤が2枚以上は出てこない', () => {
    const rebuilt = reconstruct(strip(full, 'haipai'), { random: seededRandom(9) });
    const j = toTenhouJson(rebuilt).log[0] as unknown[];
    const tiles: number[] = [];
    for (let s = 0; s < 4; s++) {
      tiles.push(...(j[4 + s * 3] as number[]));
      for (const v of j[5 + s * 3] as (number | string)[]) if (typeof v === 'number') tiles.push(v);
    }
    tiles.push(...(j[2] as number[]), ...(j[3] as number[]));
    const kind = (t: number) => (t > 50 ? (t - 50) * 10 + 5 : t);
    const count = new Map<number, number>();
    tiles.forEach((t) => count.set(kind(t), (count.get(kind(t)) ?? 0) + 1));
    for (const n of count.values()) expect(n).toBeLessThanOrEqual(4);
    for (const red of [51, 52, 53]) expect(tiles.filter((t) => t === red).length).toBeLessThanOrEqual(1);
  });

  it('倒した手牌だけ：これまでどおり組める', () => {
    const input = strip(full, 'hand');
    const back = logToBoard(reconstruct(input, { random: seededRandom(4) }));
    expect(back).toEqual(logToBoard(log));
  });
});

describe('家ごとに入力の仕方が違ってもよい', () => {
  it('Aさんは配牌だけ、私は倒した手牌だけ、Cさん・Dさんは両方', () => {
    const log = parseTenhou(SAMPLE_URL);
    const b = logToBoard(log, { haipai: true });
    b.seats[0].hand = [];
    delete b.seats[1].haipai;
    const rebuilt = reconstruct(b, { random: seededRandom(2) });
    expect(rebuilt.seats[0].haipai).toEqual(sortTiles(log.seats[0].haipai));
    expect(rebuilt.seats[2].haipai).toEqual(sortTiles(log.seats[2].haipai));
    expect(logToBoard(rebuilt).seats[1].hand).toEqual(b.seats[1].hand);
  });
});

describe('入力と矛盾するときは、家と河の位置を示す', () => {
  it('配牌にない牌を1打目で手出し：組めない', () => {
    const log = parseTenhou(SAMPLE_URL);
    const b = strip(logToBoard(log, { haipai: true }), 'haipai');
    const dealer = 2; // 南三局の親はCさん
    const first = b.seats[dealer].river[0];
    first.tsumogiri = false;
    b.seats[dealer].haipai = b.seats[dealer].haipai!.filter((t) => t !== first.tile);
    while (b.seats[dealer].haipai!.length < 13) b.seats[dealer].haipai!.push(41);
    try { reconstruct(b, { random: seededRandom(1) }, log.meta.names); expect.fail(); } catch (e) {
      expect(e).toBeInstanceOf(BoardError);
      expect((e as BoardError).seat).toBe(dealer);
      expect((e as BoardError & { riverIndex?: number }).riverIndex).toBe(0);
      expect((e as Error).message).toContain('Cさんの1打目');
    }
  });

  it('配牌も倒した手牌もない家：入れるように知らせる', () => {
    const log = parseTenhou(SAMPLE_URL);
    const b = logToBoard(log);
    b.seats[3].hand = [];
    expect(() => reconstruct(b, {}, log.meta.names)).toThrow('Dさんの手牌（開始時の13枚）を入れてください');
  });

  it('配牌が13枚でない', () => {
    const log = parseTenhou(SAMPLE_URL);
    const b = logToBoard(log, { haipai: true });
    b.seats[0].haipai!.pop();
    expect(() => reconstruct(b, {}, log.meta.names)).toThrow('Aさんの手牌（開始時）が12枚');
  });
});
