# NAGAの解析結果を取り込み、振り返りで推奨打牌と並べる（レポートは test/naga-report.json.gz、/api/naga-report は偽装）
import asyncio, sys, os, json, gzip
sys.path.insert(0, os.path.dirname(__file__))
from playwright.async_api import async_playwright
from mock_supabase import db, open_app
REPORT = json.loads(gzip.decompress(open(os.path.join(os.path.dirname(__file__), '..', 'test', 'naga-report.json.gz'), 'rb').read()))
RID = 'e3e4abcd1234567890abcdefv2_2'
async def main():
    out = {}
    async with async_playwright() as p:
        b, ctx, pg, errs = await open_app(p)
        asked = []
        async def api(route):
            asked.append(route.request.url)
            await route.fulfill(json=REPORT)
        await ctx.route('**/api/naga-report**', api)
        await pg.click('button:has-text("新しい勉強会")'); await pg.fill('input[placeholder="例：押し引き"]', 'NAGAテスト'); await pg.click('button:has-text("作成")')
        await pg.click('.link-card'); await pg.click('button:has-text("新しい半荘")'); await pg.click('button:has-text("作って東一局を入力")')
        await pg.wait_for_url('**/rounds/*'); await pg.wait_for_selector('.round-page')
        # 解析した局（東2局1本場）をそのまま天鳳形式で持たせる
        r = db['study_rounds'][0]
        r.update({'kyoku': 1, 'honba': 1, 'label': '東2局1本場', 'tenhou_json': {'title': ['', ''], 'name': ['Aさん', 'Bさん', 'Cさん', 'Dさん'], 'rule': {'disp': '般南喰赤', 'aka': 1}, 'log': json.loads(REPORT['custom_haihu'][0])}})
        r['editor']['names'] = ['Aさん', 'Bさん', 'Cさん', 'Dさん']
        await pg.reload(); await pg.wait_for_selector('.round-page')
        await pg.click('.roundbar button:has-text("解析")')
        steps = await pg.inner_text('.reviews .steps')
        await pg.fill('.reviews input[type=url]', f'https://naga.dmv.nico/htmls/report_viewer.html?report_id={RID}&tw=0')
        await pg.click('.reviews button:has-text("追加")')
        await pg.wait_for_selector('.reviews p.small:has-text("取り込みました")')
        msg = await pg.inner_text('.reviews p.small')
        row = db['study_ai_reviews'][0]
        out['import'] = (row['naga'] is not None and row['naga']['reportId'] == RID and len(row['naga']['kyoku']['decisions']) == 40
                         and asked and f'id={RID}' in asked[0] and '40打のうち' in msg and 'カスタム牌譜解析' in steps
                         and '取り込み済み' in await pg.inner_text('.reviews .list'))
        # 振り返り：最初の打牌（Bさんの9筒ツモ切り）。NAGAは4タイプとも9索
        await pg.click('.roundbar a:has-text("振り返り")'); await pg.wait_for_selector('.naga')
        t = await pg.inner_text('.naga')
        out['panel'] = ('ニシキ' in t and 'ウロボロス' in t and '違う' in t and '96%' in t and await pg.locator('.naga tr.ng').count() == 4)
        chips = await pg.locator('.naga .chips .chip').count()
        # 基準のタイプを変えても、違う打牌の一覧が出る。チップで飛べる
        await pg.select_option('.naga select', '2')
        await pg.click('.naga .chips .chip >> nth=1'); await pg.wait_for_timeout(200)
        cur = await pg.inner_text('.slider b')
        out['jump'] = chips > 0 and 'p=' in pg.url and await pg.locator('.naga .chips .chip.on').count() == 1
        await pg.screenshot(path='/tmp/naga.png', full_page=True)
        out['errors'] = errs
        await b.close()
    print(json.dumps({'ok': all(v is True for k, v in out.items() if k != 'errors') and not out['errors'], **out, 'msg': msg, 'chips': chips, 'cur': cur}, ensure_ascii=False))
asyncio.run(main())
