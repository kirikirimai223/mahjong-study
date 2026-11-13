import { describe, expect, it } from 'vitest';
// @ts-expect-error 画面側の JS モジュール
import { callOptions, chooseKind, kanOptions } from '../src/editor/calls.js';

describe('鳴き・槓の候補', () => {
  it('赤五を含むときは、赤を使う／使わないの両方を出す', () => {
    expect(chooseKind([15, 15, 51, 11], 15, 2)).toEqual([[15, 51], [15, 15]]);
  });
  it('チーは下家だけ。嵌張・両面・辺張の組み合わせを出す', () => {
    const hand = [12, 13, 14, 16, 17, 41];
    expect(callOptions(hand, 15, 1, 0).filter((o: { kind: string }) => o.kind === 'chi').map((o: { own: number[] }) => o.own))
      .toEqual([[13, 14], [14, 16], [16, 17]]);
    expect(callOptions(hand, 15, 2, 0).some((o: { kind: string }) => o.kind === 'chi')).toBe(false);
  });
  it('字牌はチーできない。ポン・明槓は枚数どおり', () => {
    const opts = callOptions([45, 45, 45, 11], 45, 1, 0);
    expect(opts.map((o: { kind: string }) => o.kind)).toEqual(['pon', 'daiminkan']);
  });
  it('暗槓は4枚、加槓はポンした牌の4枚目', () => {
    const melds = [{ kind: 'pon', called: 31, own: [31, 31], from: 0, riverIndex: 0 }];
    expect(kanOptions([21, 21, 21, 21, 31, 11], melds)).toEqual([
      { kind: 'ankan', tiles: [21, 21, 21, 21] },
      { kind: 'kakan', ponIndex: 0, added: 31 },
    ]);
  });
});
