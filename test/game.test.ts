import { describe, expect, it } from 'vitest';
import { parseTenhou, toTenhouJson } from '../src/core/tenhou';
import { logToBoard } from '../src/core/board';
import { combineTenhou, nextRound, riichiSeats } from '../src/core/game';
import { SAMPLE_URL, KAN_URL, RINSHAN_URL, CHANKAN_URL } from './fixtures';

const winnersOf = (raw: unknown[]) => {
  const w: number[] = [];
  for (let i = 2; i < raw.length; i += 2) w.push((raw[i] as number[])[0]);
  return w as (0 | 1 | 2 | 3)[];
};
const next = (url: string) => {
  const log = parseTenhou(url);
  const b = logToBoard(log);
  return nextRound(log.setup, { kind: 'agari', winners: winnersOf(log.result.raw), deltas: log.result.raw[1] as number[] }, riichiSeats(b));
};
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

describe('次の局の開始条件', () => {
  it('子のロン（立直者が放銃）：親流れ・本場0・供託0・立直棒を引いて合計が保たれる', () => {
    const n = next(SAMPLE_URL); // 南三局2本場：席3（立直）が親の席2に放銃
    const log = parseTenhou(SAMPLE_URL);
    expect(riichiSeats(logToBoard(log))).toEqual([3]);
    expect(n.setup.scores).toEqual([21200, 13800, 67700, -2700]);
    expect(sum(n.setup.scores)).toBe(sum(log.setup.scores) + log.setup.kyotaku * 1000);
    expect(n.setup.kyotaku).toBe(0);
  });
  it('親の和了は連荘して本場が積まれる', () => {
    const n = next(SAMPLE_URL); // 南三局（kyoku 6）の親は席2＝和了者
    expect(n.renchan).toBe(true);
    expect(n.setup).toMatchObject({ kyoku: 6, honba: 3 });
  });
  it('子の和了は次の局へ、本場は0', () => {
    const n = next(KAN_URL); // 南一局（親=席0）、席2の和了
    expect(n.renchan).toBe(false);
    expect(n.setup).toMatchObject({ kyoku: 5, honba: 0, kyotaku: 0, scores: [29300, 2700, 48500, 19500] });
  });
  it('立直ツモ：自分の立直棒は収支に入っているので、引いて元に戻す', () => {
    const n = next(RINSHAN_URL);
    expect(n.setup.scores).toEqual([27300, -1300, 46500, 27500]);
    expect(sum(n.setup.scores)).toBe(100000);
  });
  it('東一局の子の和了 → 東二局', () => {
    expect(next(CHANKAN_URL).setup).toMatchObject({ kyoku: 1, honba: 0, scores: [25000, 25000, 33000, 17000] });
  });
  it('流局：親聴牌で連荘、親ノーテンで流れ、全員0は判定できない', () => {
    const s = { kyoku: 2, honba: 1, kyotaku: 1, scores: [25000, 25000, 25000, 25000] };
    const tenpai = nextRound(s, { kind: 'ryukyoku', deltas: [-1000, -1000, 3000, -1000] }, [1]);
    expect(tenpai).toMatchObject({ renchan: true, setup: { kyoku: 2, honba: 2, kyotaku: 2 } });
    expect(tenpai.setup.scores).toEqual([24000, 23000, 28000, 24000]);
    expect(nextRound(s, { kind: 'ryukyoku', deltas: [3000, -1000, -1000, -1000] }, []).renchan).toBe(false);
    expect(nextRound(s, { kind: 'ryukyoku', deltas: [0, 0, 0, 0] }, [])).toMatchObject({ ambiguous: true, setup: { kyoku: 3 } });
    expect(nextRound(s, { kind: 'ryukyoku', reason: '九種九牌', deltas: [0, 0, 0, 0] }, [])).toMatchObject({ renchan: true, ambiguous: false });
  });
  it('南四局の親流れで半荘終了', () => {
    const s = { kyoku: 7, honba: 0, kyotaku: 0, scores: [25000, 25000, 25000, 25000] };
    expect(nextRound(s, { kind: 'agari', winners: [0], deltas: [1000, -1000, 0, 0] }, []).finished).toBe(true);
    expect(nextRound(s, { kind: 'agari', winners: [3], deltas: [0, -1000, 0, 1000] }, []).finished).toBe(false);
  });
});

describe('半荘まとめ', () => {
  it('複数局を1つの牌譜にまとめる（log に局の順で並ぶ）', () => {
    const a = toTenhouJson(parseTenhou(CHANKAN_URL));
    const b = toTenhouJson(parseTenhou(KAN_URL));
    const c = combineTenhou([a, b]);
    expect(c.log).toHaveLength(2);
    expect(c.log[0]).toEqual(a.log[0]);
    expect(c.log[1]).toEqual(b.log[0]);
    expect(c.name).toEqual(a.name);
  });
});
