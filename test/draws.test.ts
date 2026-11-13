import { describe, expect, it } from 'vitest';
import { parseTenhou, toTenhouJson } from '../src/core/tenhou';
import { logToBoard, reconstruct, seededRandom, sortTiles } from '../src/core/board';
import { diagnose } from '../src/core/diagnose';
import { BoardSnapshot } from '../src/core/types';
import { SAMPLE_URL, KAN_URL, RINSHAN_URL, CHANKAN_URL } from './fixtures';

const CASES = [['南三局', SAMPLE_URL], ['四槓子', KAN_URL], ['嶺上開花', RINSHAN_URL], ['槍槓', CHANKAN_URL]] as const;
const decode = (u: string) => JSON.parse(decodeURIComponent(u.split('#json=')[1].replace(/&ts=.*$/, '')));
const sortHaipai = (j: { log: unknown[][] }) => {
  const r = structuredClone(j);
  for (let s = 0; s < 4; s++) r.log[0][4 + s * 3] = sortTiles(r.log[0][4 + s * 3] as number[]);
  return r;
};
const noFlags = (b: BoardSnapshot) => { b.seats.forEach((x) => x.river.forEach((r) => { delete r.tsumogiri; })); return b; };

describe.each(CASES)('%s：毎巡のツモ牌', (_n, url) => {
  const log = parseTenhou(url);
  const full = logToBoard(log, { haipai: true, draws: true });

  it('配牌・全ツモ・河を入れると、元の牌譜と完全に同じになる（何度組んでも）', () => {
    for (let seed = 1; seed <= 20; seed++) {
      expect(sortHaipai(toTenhouJson(reconstruct(full, { random: seededRandom(seed) })))).toEqual(sortHaipai(decode(url)));
    }
  });

  it('倒した手牌なし・手出し/ツモ切りなしでも、配牌と全ツモから元の牌譜になる', () => {
    const b = noFlags(structuredClone(full));
    b.seats.forEach((x) => { x.hand = []; });
    expect(sortHaipai(toTenhouJson(reconstruct(b, { random: seededRandom(1) })))).toEqual(sortHaipai(decode(url)));
  });

  it('配牌なし・倒した手牌と全ツモからも元の牌譜になる', () => {
    const b = structuredClone(full);
    b.seats.forEach((x) => { delete x.haipai; });
    expect(sortHaipai(toTenhouJson(reconstruct(b, { random: seededRandom(1) })))).toEqual(sortHaipai(decode(url)));
  });

  it('一部の巡だけツモを入れた場合：入れたツモはそのまま使い、ほかは組める', () => {
    const b = structuredClone(full);
    b.seats.forEach((x) => { x.hand = []; x.river.forEach((r, i) => { if (i % 2 === 1) delete r.draw; }); });
    for (let seed = 1; seed <= 30; seed++) {
      const back = logToBoard(reconstruct(b, { random: seededRandom(seed) }), { draws: true });
      back.seats.forEach((x, s) => x.river.forEach((r, i) => {
        if (b.seats[s].river[i].draw !== undefined) expect(r.draw).toBe(b.seats[s].river[i].draw);
      }));
    }
  });

  it('入力チェック：全部入っていれば何も出ない', () => {
    expect(diagnose(full, log.meta.names)).toEqual([]);
  });
});

describe('ツモ牌の入力ミス', () => {
  const l = parseTenhou(SAMPLE_URL);
  it('ツモ切りなのにツモ牌と捨て牌が違う', () => {
    const b = logToBoard(l, { haipai: true, draws: true });
    const i = b.seats[3].river.findIndex((r) => r.tsumogiri === true);
    b.seats[3].river[i].draw = b.seats[3].river[i].tile === 11 ? 12 : 11;
    expect(diagnose(b, l.meta.names)).toContainEqual(expect.objectContaining({ seat: 3, area: 'river', index: i }));
  });
  it('鳴いた直後の打牌にツモ牌が入っている', () => {
    const b = logToBoard(l, { haipai: true, draws: true });
    const last = b.seats[1].river.length - 1; // 私はチーの後に最後の打牌
    b.seats[1].river[last].draw = 47;
    expect(diagnose(b, l.meta.names).some((x) => x.seat === 1 && x.index === last && x.message.includes('鳴いた直後'))).toBe(true);
  });
});
