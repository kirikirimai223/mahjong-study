import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { agrees, extractNaga, mjaiTile, nagaReportId } from '../src/lib/naga';

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
