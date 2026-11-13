import { describe, expect, it } from 'vitest';
import { parseTenhou, toTenhouJson } from '../src/core/tenhou';
import { logToBoard, reconstruct, seededRandom } from '../src/core/board';
import { SAMPLE_URL, KAN_URL, RINSHAN_URL, CHANKAN_URL } from './fixtures';

const decode = (u: string) => JSON.parse(decodeURIComponent(u.split('#json=')[1].replace(/&ts=.*$/, '')));
const CASES = [
  ['南三局（チー・立直・ロン）', SAMPLE_URL],
  ['四槓子（ポン・明槓・暗槓・加槓）', KAN_URL],
  ['嶺上開花（暗槓→自摸）', RINSHAN_URL],
  ['槍槓（加槓でロン）', CHANKAN_URL],
] as const;

describe.each(CASES)('%s', (_name, url) => {
  const log = parseTenhou(url);
  it('往復：読み込んで書き出すと元のJSONと完全一致する', () => {
    expect(toTenhouJson(log)).toEqual(decode(url));
  });
  it('ランダム組み立て：100通りのシードすべてで同じ終局図に戻る', () => {
    const board = logToBoard(log);
    for (let seed = 1; seed <= 100; seed++) {
      expect(logToBoard(reconstruct(board, { random: seededRandom(seed) }))).toEqual(board);
    }
  });
  it('組み直しても各家のツモ回数と打牌回数は元と同じ', () => {
    const rebuilt = reconstruct(logToBoard(log), { random: seededRandom(3) });
    rebuilt.seats.forEach((p, s) => {
      expect(p.take.length).toBe(log.seats[s].take.length);
      expect(p.discard.length).toBe(log.seats[s].discard.length);
    });
  });
});

describe('鳴きの向き', () => {
  it('ポンの p の位置、明槓の m の位置で相手が決まる', () => {
    const b = logToBoard(parseTenhou(KAN_URL));
    // Bさん（席1）: "47p4747"=対面（席3）, "4444p44"=下家（席2）
    expect(b.seats[1].melds.slice(0, 2).map((m) => m.kind !== 'ankan' && m.kind !== 'kakan' && m.from)).toEqual([3, 2]);
    // 私（席2）: "3737p37"=下家（席3）, "31p3131"=対面（席0）, "m39393939"=上家（席1）
    const mine = b.seats[2].melds;
    expect(mine.map((m) => m.kind)).toEqual(['pon', 'pon', 'daiminkan', 'kakan', 'ankan', 'kakan']);
    expect(mine.slice(0, 3).map((m) => (m as { from: number }).from)).toEqual([3, 0, 1]);
  });
});

describe('最後の手番のカン', () => {
  it('嶺上開花：暗槓のあとの嶺上牌が和了牌になる', () => {
    const b = logToBoard(parseTenhou(RINSHAN_URL));
    expect(b.winTile).toBe(26);
    expect(b.seats[3].melds).toEqual([{ kind: 'ankan', tiles: [16, 16, 16, 16], afterOwnDiscard: 8 }]);
  });
  it('槍槓：加槓した家は嶺上牌を引かずに終わる', () => {
    const log = parseTenhou(CHANKAN_URL);
    const b = logToBoard(log);
    expect(b.seats[3].melds.map((m) => m.kind)).toEqual(['pon', 'kakan']);
    const rebuilt = reconstruct(b, { random: seededRandom(5) });
    expect(rebuilt.seats[3].discard.at(-1)).toMatchObject({ kind: 'kakan', added: 36 });
    expect(toTenhouJson(rebuilt).log[0][15]).toContain('3636k3636');
  });
});
