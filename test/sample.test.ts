import { describe, expect, it } from 'vitest';
import { parseTenhou, toTenhouJson, toTenhouUrl, timeline } from '../src/core/tenhou';
import { BoardError, applyRiichiDefaults, logToBoard, reconstruct, seededRandom } from '../src/core/board';
import { BoardSnapshot } from '../src/core/types';
import { SAMPLE_URL } from './fixtures';

const original = () => JSON.parse(
  decodeURIComponent(SAMPLE_URL.split('#json=')[1].replace(/&ts=.*$/, '')),
);
const withoutFlags = (b: BoardSnapshot): BoardSnapshot => structuredClone({
  ...b,
  seats: b.seats.map((s) => ({ ...s, river: s.river.map(({ tsumogiri, ...rest }) => rest) })),
}) as BoardSnapshot;

describe('南3局2本場（チー2回・立直・ロン）', () => {
  const log = parseTenhou(SAMPLE_URL);

  it('往復：読み込んで書き出すと元のJSONと完全一致する', () => {
    expect(toTenhouJson(log)).toEqual(original());
  });

  it('手番の復元：親（席2）から始まり、各家の列を使い切る', () => {
    const ev = timeline(log);
    expect(ev[0]).toMatchObject({ type: 'take', seat: 2 });
    const takes = ev.filter((e) => e.type === 'take').length;
    expect(takes).toBe(log.seats.reduce((n, p) => n + p.take.length, 0));
  });

  it('終局図：鳴き・立直・手出し/ツモ切り・最終手牌が取れる', () => {
    const board = logToBoard(log);
    expect(board.seats[1].melds).toEqual([{ kind: 'chi', from: 0, riverIndex: 15, called: 27, own: [26, 28] }]);
    expect(board.seats[0].river[15]).toEqual({ tile: 27, tsumogiri: false, calledBy: 1 });
    expect(board.seats[2].melds[0]).toMatchObject({ kind: 'chi', from: 1, called: 24, own: [25, 26] });
    expect(board.seats[3].river[13]).toEqual({ tile: 42, tsumogiri: false, riichi: true });
    // ロン牌はDさんがツモ切りした赤五索
    expect(board.seats[3].river.at(-1)).toEqual({ tile: 53, tsumogiri: true });
    expect(board.seats.map((s) => s.hand.length)).toEqual([13, 10, 10, 13]);
  });

  it('ランダム組み立て：200通りのシードすべてで、同じ終局図（手出し/ツモ切り込み）に戻る', () => {
    const board = logToBoard(log);
    for (let seed = 1; seed <= 200; seed++) {
      const rebuilt = reconstruct(board, { random: seededRandom(seed) });
      expect(logToBoard(rebuilt)).toEqual(board);
    }
  });

  it('ツモ切りの手番は、ツモった牌がそのまま捨てた牌になる', () => {
    const rebuilt = reconstruct(logToBoard(log), { random: seededRandom(7) });
    const d = rebuilt.seats[3];
    // Dさんの最後のツモ = ツモ切りした赤五索
    expect(d.take.at(-1)).toEqual({ kind: 'draw', tile: 53 });
    expect(d.discard.at(-1)).toMatchObject({ tsumogiri: true });
  });

  it('シードが違えば配牌が変わり、同じシードなら同じになる', () => {
    const board = logToBoard(log);
    const a = reconstruct(board, { random: seededRandom(1) }).seats[0].haipai;
    const b = reconstruct(board, { random: seededRandom(1) }).seats[0].haipai;
    const c = reconstruct(board, { random: seededRandom(2) }).seats[0].haipai;
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('手出し/ツモ切りが不明でも組める（河・副露・手牌は元と同じ）', () => {
    const board = withoutFlags(logToBoard(log));
    for (let seed = 1; seed <= 50; seed++) {
      const back = withoutFlags(logToBoard(reconstruct(board, { random: seededRandom(seed) })));
      expect(back).toEqual(board);
    }
  });

  it('書き出したURLは天鳳の牌譜エディタ形式', () => {
    const url = toTenhouUrl(reconstruct(logToBoard(log), { random: seededRandom(1) }));
    expect(url).toMatch(/^https:\/\/tenhou\.net\/6\/#json=/);
    const back = parseTenhou(url);
    expect(back.result.raw).toEqual(original().log[0][16]);
  });

  it('立直後の手出しはエラー', () => {
    const board = logToBoard(log);
    board.seats[3].river[14].tsumogiri = false;
    expect(() => reconstruct(board)).toThrow('立直後に手出し');
  });

  it('鳴いた直後のツモ切りはエラー', () => {
    const board = logToBoard(log);
    const idx = board.seats[1].river.length - 1; // 私のチー直後の打牌
    board.seats[1].river[idx].tsumogiri = true;
    expect(() => reconstruct(board)).toThrow('鳴いた直後');
  });

  it('立直後の未指定はツモ切りが既定になる', () => {
    const river = applyRiichiDefaults([{ tile: 11 }, { tile: 42, riichi: true }, { tile: 12 }, { tile: 13, tsumogiri: false }]);
    expect(river.map((t) => t.tsumogiri)).toEqual([undefined, undefined, true, false]);
  });

  it('枚数が合わない終局図はその家のエラーになる', () => {
    const board = logToBoard(log);
    board.seats[0].hand.pop();
    try { reconstruct(board); expect.fail(); } catch (e) {
      expect(e).toBeInstanceOf(BoardError);
      expect((e as BoardError).seat).toBe(0);
    }
  });

  it('同じ牌が5枚ある終局図はエラーになる', () => {
    const board = logToBoard(log);
    board.seats[0].hand.push(13);
    expect(() => reconstruct(board)).toThrow('三萬が5枚ある');
  });

  it('鳴かれた印が抜けている終局図はエラーになる', () => {
    const board = logToBoard(log);
    delete board.seats[0].river[15].calledBy;
    expect(() => reconstruct(board)).toThrow(BoardError);
  });
});
