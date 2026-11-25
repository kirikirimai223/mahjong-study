# 振り返りで選んだ「打牌の絞り込み」「手前」「基準」が、別の局を開いても名前で選び直される。
# 長いタイプ名（Miai ラス回避）が欠けずに出る
import asyncio, sys, os, json, gzip
sys.path.insert(0, os.path.dirname(__file__))
from playwright.async_api import async_playwright
from mock_supabase import db, open_app
RES = json.loads(gzip.decompress(open('test/miai-review.json.gz', 'rb').read()))
async def main():
    out = {}
    async with async_playwright() as p:
        b, ctx, pg, errs = await open_app(p)
        await ctx.route('**/api/miai**', lambda route: route.fulfill(json=RES))
        await pg.click('button:has-text("新しい勉強会")'); await pg.fill('input[placeholder="例：押し引き"]', '設定テスト'); await pg.click('button:has-text("作成")')
        await pg.click('.link-card'); await pg.wait_for_selector('details.import[open] textarea')
        await pg.fill('details.import textarea', 'https://riichi.miai.moe/r/85ad1412bfe0184d36b3')
        await pg.click('details.import button:has-text("取り込む")'); await pg.wait_for_selector('.toast:has-text("取り込みました")')
        rs = sorted(db['study_rounds'], key=lambda x: (x['kyoku'], x['honba']))
        await pg.goto(f'http://localhost:5173/rounds/{rs[0]["id"]}/review'); await pg.wait_for_selector('.naga')
        await pg.select_option('.rv-opts select >> nth=0', '1'); await pg.select_option('.rv-opts select >> nth=1', '2')
        await pg.wait_for_timeout(200)
        # 別の局へ
        await pg.goto(f'http://localhost:5173/rounds/{rs[3]["id"]}/review'); await pg.wait_for_selector('.naga')
        await pg.wait_for_timeout(300)
        out['seat'] = await pg.eval_on_selector('.rv-opts select >> nth=0', 'e => e.value') == '1'
        out['view'] = await pg.eval_on_selector('.rv-opts select >> nth=1', 'e => e.value') == '2'
        for _ in range(20):
            if await pg.locator('.naga-row .nm').count(): break
            await pg.click('button[aria-label="次"]'); await pg.wait_for_timeout(120)
        nm = pg.locator('.naga-row .nm').first
        out['name'] = await nm.inner_text()
        out['fits'] = await nm.evaluate('e => e.scrollWidth <= e.clientWidth + 1')
        await pg.locator('.naga').screenshot(path='/tmp/prefs.png')
        out['errors'] = errs
        await b.close()
    print(json.dumps({'ok': out['seat'] and out['view'] and out['fits'] and not out['errors'], **out}, ensure_ascii=False))
asyncio.run(main())
