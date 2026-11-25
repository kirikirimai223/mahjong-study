import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { extractMiai, miaiId, miaiTenhou, type MiaiResult } from '../src/lib/miai';
import { callMiss, decisionMisses } from '../src/lib/naga';
import { parseTenhou } from '../src/core/tenhou';
import { replayFrames } from '../src/core/replay';

// 実際のMiaiの解析結果（4人・半荘・南家を解析。名前は伏せてある）
const res: MiaiResult = JSON.parse(gunzipSync(readFileSync(new URL('./miai-review.json.gz', import.meta.url))).toString());
const me = res.review.seat;

describe('Miaiの解析結果の読み取り', () => {
  it('URLから id を取り出す', () => {
    expect(miaiId('https://riichi.miai.moe/r/85ad1412bfe0184d36b3?at=65')).toBe('85ad1412bfe0184d36b3');
    expect(miaiId('https://riichi.miai.moe/play')).toBeNull();
  });
  it('Mjai の出来事から、局ごとの牌譜（天鳳形式）を作る。どの局も最後まで再生でき、和了の結果が付く', () => {
    const j = miaiTenhou(res.review);
    expect(j.log).toHaveLength(10);
    for (let i = 0; i < j.log.length; i++) {
      const log = parseTenhou(JSON.stringify(j), i);
      const frames = replayFrames(log);
      expect(frames.at(-1)!.end).toBeTruthy();
      // 打牌の数が Mjai と同じ
      const evs = res.review.events;
      const starts = evs.flatMap((e, x) => (e.type === 'start_kyoku' ? [x] : []));
      const seg = evs.slice(starts[i], starts[i + 1] ?? evs.length);
      expect(frames.filter((f) => !f.end).length).toBe(seg.filter((e) => e.type === 'dahai').length);
    }
  });
  it('解析した家の判断が、打牌・鳴きにもれなく対応し、一致・不一致がMiaiと同じ', () => {
    const s = extractMiai(res);
    expect(s.types).toEqual(['Miai（ラス回避）']);
    let n = 0;
    const ev = res.review.events;
    const expected = res.review.decisions.filter((d) => ev[d.at].type !== 'tsumo' || d.options[d.played].event.type === 'dahai');
    const got: boolean[] = [];
    for (const k of s.kyokus) {
      for (const d of k.decisions) { expect(d.seat).toBe(me); }
      n += k.decisions.length + k.calls!.length;
    }
    // ツモ和了した判断は打牌に付かない
    expect(n).toBe(expected.length);
    // 順番に並べて比べる
    const all = s.kyokus.flatMap((k) => [...k.decisions.map((d) => ({ at: 0, ok: decisionMisses(d, 0).length === 0, d })), ...k.calls!.map((c) => ({ at: 0, ok: !callMiss(c, 0), c }))]);
    for (const x of all) got.push(x.ok);
    // 同じ牌のツモ切りと手出しの違いは、ここでは同じ打牌として数える
    const sameTile = (d: (typeof expected)[number]) => {
      const best = [...d.options].sort((x, y) => y.p - x.p)[0].event; const pl = d.options[d.played].event;
      return best.type === 'dahai' && pl.type === 'dahai' && best.pai?.replace('r', '') === pl.pai?.replace('r', '');
    };
    expect(got.filter((x) => !x).length).toBe(expected.filter((d) => !d.matched && !sameTile(d)).length);
  });
  it('鳴きの判断：ポンを推したのにチーした局面（7筒）、チーを推したのにスルーした局面（3萬）', () => {
    const calls = extractMiai(res).kyokus.flatMap((k) => k.calls!);
    const c = calls.find((x) => x.tile === '7p' && x.real === 'chi_mid')!;
    expect(c.opts[0]!.pon).toBeGreaterThan(0.99);
    expect(callMiss(c, 0)).toBe(true);
    const c2 = calls.find((x) => x.tile === '3m' && x.real === 'skip' && callMiss(x, 0))!;
    expect(c2.opts[0]!.chi_low).toBeCloseTo(0.723, 2);
  });
});
