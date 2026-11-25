import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { agrees, callMiss, decisionMisses, extractNaga, mjaiTile, nagaReportId } from '../src/lib/naga';

// 実際のNAGAレポート（カスタム牌譜・東2局1本場・ニシキ／カガシ／アナンタ／ウロボロス。名前は伏せてある）
const report = JSON.parse(gunzipSync(readFileSync(new URL('./naga-report.json.gz', import.meta.url))).toString());

describe('NAGAレポートの読み取り', () => {
  it('レポートURLから report_id を取り出す', () => {
    expect(nagaReportId('https://naga.dmv.nico/htmls/report_viewer.html?report_id=e3e4abcd1234567890v2_2&tw=0')).toBe('e3e4abcd1234567890v2_2');
    expect(nagaReportId('https://naga.dmv.nico/reports/abc123def456ghi789.json')).toBe('abc123def456ghi789');
    expect(nagaReportId('https://example.com/')).toBeNull();
  });
  it('Mjai の牌名をアプリの牌に直す', () => {
    expect([mjaiTile('1m'), mjaiTile('9p'), mjaiTile('5s'), mjaiTile('5sr'), mjaiTile('E'), mjaiTile('C')]).toEqual([11, 29, 35, 53, 41, 47]);
  });
  it('局・本場と、各家の打牌ごとの判断を取り出す', () => {
    const s = extractNaga(report, 'x');
    expect(s.types).toEqual(['ニシキ', 'カガシ', 'アナンタ', 'ウロボロス']);
    expect(s.kyokus).toHaveLength(1);
    const k = s.kyokus[0];
    expect([k.kyoku, k.honba]).toEqual([1, 1]);
    // 打牌はこの局の打牌の数（40）だけ。家ごとに 0 打目から順に並ぶ
    expect(k.decisions).toHaveLength(40);
    for (let seat = 0; seat < 4; seat++) {
      const idx = k.decisions.filter((d) => d.seat === seat).map((d) => d.discardIndex);
      expect(idx).toEqual(idx.map((_, i) => i));
    }
    // 最初の打牌：南家（親）が9筒をツモ切り。4タイプとも9索を推す
    const d0 = k.decisions[0];
    expect(d0).toMatchObject({ seat: 1, discardIndex: 0, real: '9p', pred: ['9s', '9s', '9s', '9s'] });
    expect(agrees(d0, 0)).toBe(false);
    expect(d0.top[0][0]).toEqual({ tile: '9s', p: 0.956 });
    expect(d0.top[0].map((c) => c.tile)).toEqual(['9s']); // 6索（4%）は5%未満なので候補に出さない
    expect(d0.realP[0]).toBe(0.001);
    expect(d0.realP[2]).toBe(0);
    // 2打目：西家の東は全タイプ一致
    expect(agrees(k.decisions[1], 0) && agrees(k.decisions[1], 3)).toBe(true);
    // 立直の判断がある局面は、タイプごとの評価が入る
    expect(k.decisions.some((d) => d.riichi[0] !== null && d.riichi[2] !== null)).toBe(true);
  });
});

describe('立直・鳴き・槓の判断', () => {
  const k = extractNaga(report, 'x').kyokus[0];
  it('立直した打牌は立直の評価と並ぶ。カガシは黙聴を推したので立直も違う', () => {
    const r = k.decisions.filter((d) => d.realRiichi);
    expect(r.map((d) => [d.seat, d.discardIndex])).toEqual([[1, 5], [2, 9]]);
    expect(r[0].riichi[0]).toBeCloseTo(0.996, 3);
    expect(decisionMisses(r[0], 0)).toEqual([]);
    expect(decisionMisses(r[0], 1)).toEqual(['打牌', '立直']); // カガシは8索を切って黙聴
  });
  it('打牌に対するほかの家の鳴きの判断。ポンを推したのにスルーしたら違う', () => {
    const calls = k.calls!;
    expect(calls.map((c) => [c.seat, c.from, c.discardIndex, c.tile, c.real])).toEqual([[2, 1, 0, '9p', 'skip'], [3, 1, 2, '1m', 'skip'], [3, 1, 3, '1m', 'skip'], [2, 1, 4, '3s', 'skip']]);
    expect(calls[1].opts[0]).toEqual({ skip: 0.148, pon: 0.852 });
    expect(callMiss(calls[1], 0)).toBe(true);
    expect(callMiss(calls[0], 0)).toBe(false);
  });
  it('実際に鳴いたとき（チーの形・ポン）と、槓した局面の判断', () => {
    const msg = (m: object) => ({ info: { msg: m } });
    const dp = [Array(34).fill(0).map((_, i) => (i === 0 ? 10000 : 0))];
    const rep = {
      naga_types: { 0: 'オメガ' },
      pred: [[
        msg({ type: 'start_kyoku', bakaze: 'S', kyoku: 3, honba: 2 }),
        { ...msg({ type: 'tsumo', actor: 0, real_dahai: '3m', pred_dahai: ['1m'] }), dahai_pred: dp, kan: [{ 0: 3000, 1: 7000 }] },
        msg({ type: 'ankan', actor: 0, consumed: ['E', 'E', 'E', 'E'] }),
        { ...msg({ type: 'tsumo', actor: 0, real_dahai: '3m', pred_dahai: ['1m'] }), dahai_pred: dp },
        { ...msg({ type: 'dahai', actor: 0, pai: '3m' }), huro: { 1: [{ 0: 4000, 1: 6000 }], 2: [{ 0: 1000, 4: 9000 }] } },
        { ...msg({ type: 'chi', actor: 1, target: 0, pai: '3m', consumed: ['4m', '5m'], pred_dahai: ['1m'] }), dahai_pred: dp },
        msg({ type: 'dahai', actor: 1, pai: '9p' }),
      ]],
    };
    const kk = extractNaga(rep as never, 'y').kyokus[0];
    expect([kk.kyoku, kk.honba]).toEqual([6, 2]);
    expect(kk.calls!.map((c) => [c.seat, c.real])).toEqual([[1, 'chi_low'], [2, 'skip']]);
    expect(callMiss(kk.calls![0], 0)).toBe(false);
    expect(callMiss(kk.calls![1], 0)).toBe(true);
    // 暗槓した局面の判断は、嶺上牌をツモった後の打牌に付く
    expect(kk.decisions[0]).toMatchObject({ seat: 0, discardIndex: 0, realKan: 'ankan', kan: [{ skip: 0.3, ankan: 0.7 }] });
    expect(decisionMisses(kk.decisions[0], 0)).toEqual(['打牌']);
  });
});
