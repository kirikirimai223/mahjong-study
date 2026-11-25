import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { extractGokujan, gokujanId, gokujanTenhou, type GokujanResult } from '../src/lib/gokujan';
import { callMiss, decisionMisses } from '../src/lib/naga';
import { parseTenhou } from '../src/core/tenhou';

// 実際の極雀の解析結果（4人・半荘・北家を解析。名前は伏せてある）
const res: GokujanResult = JSON.parse(gunzipSync(readFileSync(new URL('./gokujan-review.json.gz', import.meta.url))).toString());

describe('極雀の解析結果の読み取り', () => {
  it('URLから id を取り出す', () => {
    expect(gokujanId('https://gokujan.com/review/ffabe0c7f802aa73')).toBe('ffabe0c7f802aa73');
    expect(gokujanId('https://gokujan.com/account/history')).toBeNull();
  });
  it('局ごとの牌譜（天鳳形式）が1つの半荘になる', () => {
    const j = gokujanTenhou(res.data);
    expect(j.log).toHaveLength(10);
    expect(j.name).toEqual(['A', 'B', 'C', 'D']);
    for (let i = 0; i < j.log.length; i++) expect(() => parseTenhou(JSON.stringify({ ...j, log: [j.log[i]] }))).not.toThrow();
  });
  it('解析した家の判断が、打牌・鳴きにもれなく対応する', () => {
    const s = extractGokujan(res, 'ffabe0c7f802aa73');
    expect(s.types).toEqual(['極雀 RIGEL 1.3']);
    expect(s.kyokus).toHaveLength(10);
    const me = res.data.player_id;
    let dahai = 0; let calls = 0;
    for (const [i, k] of s.kyokus.entries()) {
      const rk = res.data.review.kyokus[i];
      expect([k.kyoku, k.honba]).toEqual([rk.kyoku, rk.honba]);
      // 打牌の判断（dahai・立直）は打牌の数だけ、鳴きの判断（ほかの家の打牌）はその数だけ
      const selfE = rk.entries.filter((e) => e.last_actor === me && ['dahai', 'reach'].includes(e.actual.type)).length;
      const callE = rk.entries.filter((e) => e.last_actor !== me && !e.at_opponent_kakan).length;
      expect(k.decisions).toHaveLength(selfE);
      expect(k.calls).toHaveLength(callE);
      for (const d of k.decisions) expect(d.seat).toBe(me);
      dahai += k.decisions.length; calls += k.calls!.length;
    }
    expect(dahai + calls).toBeGreaterThan(140);
  });
  it('一致・不一致が極雀の判定と同じ', () => {
    const s = extractGokujan(res, 'x');
    const me = res.data.player_id;
    for (const [i, k] of s.kyokus.entries()) {
      const rk = res.data.review.kyokus[i];
      const selfE = rk.entries.filter((e) => e.last_actor === me && ['dahai', 'reach'].includes(e.actual.type));
      k.decisions.forEach((d, j) => expect(decisionMisses(d, 0).length === 0).toBe(selfE[j].is_equal));
      const callE = rk.entries.filter((e) => e.last_actor !== me && !e.at_opponent_kakan);
      k.calls!.forEach((c, j) => expect(!callMiss(c, 0)).toBe(callE[j].is_equal));
    }
  });
  it('鳴きの判断：ポンを推したのにスルーした局面', () => {
    const k = extractGokujan(res, 'x').kyokus[0];
    const c = k.calls!.find((x) => x.tile === 'N')!;
    expect(c.real).toBe('skip');
    expect(c.opts[0]!.pon).toBeCloseTo(0.977, 2);
  });
});

describe('NAGAと極雀を並べる', () => {
  it('タイプを並べ、極雀が解析していない家は空にする', async () => {
    const { mergeNaga } = await import('../src/lib/naga');
    const g = extractGokujan(res, 'x');
    const k = g.kyokus[0];
    const fakeNaga = { reportId: 'n', types: ['ニシキ'], kyoku: { ...k, decisions: [{ ...k.decisions[0], pred: ['1m'] }, { ...k.decisions[0], seat: 0, discardIndex: 0 }], calls: [] } };
    const m = mergeNaga([fakeNaga, { reportId: g.reportId, types: g.types, kyoku: k }])!;
    expect(m.types).toEqual(['ニシキ', '極雀 RIGEL 1.3']);
    const mine = m.kyoku.decisions.find((d) => d.seat === k.decisions[0].seat && d.discardIndex === 0)!;
    expect(mine.pred).toEqual(['1m', k.decisions[0].pred[0]]);
    const other = m.kyoku.decisions.find((d) => d.seat === 0)!;
    expect(other.pred[1]).toBeNull();
    expect(decisionMisses(other, 1)).toEqual([]);
    expect(m.kyoku.calls!.every((c) => c.opts.length === 2 && c.opts[0] === null)).toBe(true);
  });
});
