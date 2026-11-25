# 極雀の解析結果（偽装）のURLを貼って、牌譜10局と解析結果をまとめて取り込む。
# 続けてNAGAの結果（偽装）も同じ局に付け、振り返りで両方のタイプが並ぶ
import asyncio, sys, os, json, gzip
sys.path.insert(0, os.path.dirname(__file__))
from playwright.async_api import async_playwright
from mock_supabase import db, open_app
RES = json.loads(gzip.decompress(open('test/gokujan-review.json.gz', 'rb').read()))
GID = 'ffabe0c7f802aa73'
async def main():
    out = {}
    async with async_playwright() as p:
        b, ctx, pg, errs = await open_app(p)
        await ctx.route('**/api/gokujan**', lambda route: route.fulfill(json=RES))
        await pg.click('button:has-text("新しい勉強会")'); await pg.fill('input[placeholder="例：押し引き"]', '極雀テスト'); await pg.click('button:has-text("作成")')
        await pg.click('.link-card'); await pg.wait_for_selector('details.import[open] textarea')
        await pg.fill('details.import textarea', f'https://gokujan.com/review/{GID}')
        await pg.click('details.import button:has-text("取り込む")')
        await pg.wait_for_selector('.toast:has-text("取り込みました")')
        out['toast'] = await pg.inner_text('.toast')
        rv = db['study_ai_reviews']
        out['saved'] = len(db['study_rounds']) == 10 and len(rv) == 10 and all(r['engine'] == 'mortal' and r['naga']['reportId'] == f'gokujan:{GID}' for r in rv)
        # 東1局：北家が2打目に西を切った（極雀は1萬）→ 違う打牌に出る
        r0 = next(x for x in db['study_rounds'] if x['kyoku'] == 0 and x['honba'] == 0)
        await pg.goto(f'http://localhost:5173/rounds/{r0["id"]}/review'); await pg.wait_for_selector('.naga')
        txt = await pg.inner_text('.naga')
        out['types'] = '極雀 RIGEL 1.3' in txt
        out['mismatch_chips'] = await pg.locator('.naga .chips .chip').count()
        out['has_mismatch'] = out['mismatch_chips'] >= 2
        # 違う打牌の局面へ飛ぶと、鳴き判断（北のポン）か打牌の評価が出る
        await pg.locator('.naga .chips .chip').first.click(); await pg.wait_for_timeout(300)
        out['jump'] = '極雀' in await pg.inner_text('.naga')
        out['errors'] = errs
        await b.close()
    print(json.dumps({'ok': all(v is True for k, v in out.items() if k in ('saved', 'types', 'has_mismatch', 'jump')) and not out['errors'], **out}, ensure_ascii=False))
asyncio.run(main())
