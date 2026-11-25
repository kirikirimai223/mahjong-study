import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { editorFromTenhou, parseSources, roundRows } from '../src/lib/importTenhou';
import { extractNaga } from '../src/lib/naga';
import { SAMPLE_URL, KAN_URL, RINSHAN_URL, CHANKAN_URL } from './fixtures';

const jsonOf = (u: string) => JSON.parse(decodeURIComponent(u.split('#json=')[1]).replace(/&ts=.*$/, ''));
const report = JSON.parse(gunzipSync(readFileSync(new URL('./naga-report.json.gz', import.meta.url))).toString());

describe('既にある牌譜の取り込み', () => {
  it('貼られた行から、牌譜エディタのURL・NAGAのレポート・天鳳の対局を読み分ける', () => {
    const src = parseSources(`${SAMPLE_URL}\nhttps://naga.dmv.nico/htmls/report_viewer.html?report_id=abcdef0123456789v2_2&tw=0\nhttps://tenhou.net/0/?log=2026010112gm-0029-0000-abcd1234&tw=2`);
    expect(src.map((s) => s.kind)).toEqual(['json', 'naga', 'tenhou']);
    expect(src[2]).toEqual({ kind: 'tenhou', logId: '2026010112gm-0029-0000-abcd1234' });
    expect(parseSources(JSON.stringify(jsonOf(KAN_URL)))[0].kind).toBe('json');
    expect(() => parseSources('よくわからない文字')).toThrow('読めない行');
  });
  it.each([['南三局', SAMPLE_URL], ['四槓子', KAN_URL], ['嶺上開花', RINSHAN_URL], ['槍槓', CHANKAN_URL]])('%s：和了の結果と、開始時の手牌・ツモ・河が入る', (_n, u) => {
    const j = jsonOf(u);
    const e = editorFromTenhou(j, 0);
    const raw = j.log[0];
    expect(e.setup.kyoku).toBe(raw[0][0]);
    expect(e.names).toEqual(j.name);
    expect(e.result).toMatchObject({ kind: 'agari', winner: raw[16][2][0], from: raw[16][2][1], deltas: raw[16][1] });
    (e.seats as { haipai: number[]; river: unknown[] }[]).forEach((s, i) => {
      expect(s.haipai).toEqual(raw[4 + i * 3]);
      expect(s.river.length).toBe(raw[6 + i * 3].filter((x: unknown) => x !== 0 && !(typeof x === 'string' && /[ak]/.test(x))).length); // 暗槓・加槓の印は河の牌ではない
    });
  });
  it('NAGAのカスタム牌譜（流局）を、解析結果つきの局にする', () => {
    const json = { title: ['NAGA解析', ''], name: report.player_info.name, rule: { disp: '般南喰赤', aka: 1 }, log: report.custom_haihu.flatMap((s: string) => JSON.parse(s)) };
    const rows = roundRows({ name: 'x', json, naga: extractNaga(report, 'rid'), reportUrl: 'u' });
    expect(rows).toHaveLength(1);
    expect(rows[0].row).toMatchObject({ kyoku: 1, honba: 1, label: '東二局 1本場', summary: '全員不聴' }); // 流局の種類は牌譜のまま
    expect((rows[0].row.editor.result as { kind: string }).kind).toBe('ryukyoku');
    expect(rows[0].naga?.kyoku.decisions).toHaveLength(40);
  });
});

describe('極雀のURL', () => {
  it('解析結果のURLを読み取る', async () => {
    const { parseSources } = await import('../src/lib/importTenhou');
    expect(parseSources('https://gokujan.com/review/ffabe0c7f802aa73')).toEqual([{ kind: 'gokujan', id: 'ffabe0c7f802aa73', url: 'https://gokujan.com/review/ffabe0c7f802aa73' }]);
  });
});
