# Miaiの解析結果（偽装）のURLを貼って、牌譜10局と解析結果をまとめて取り込む
import asyncio, sys, os, json, gzip
sys.path.insert(0, os.path.dirname(__file__))
from playwright.async_api import async_playwright
from mock_supabase import db, open_app
RES = json.loads(gzip.decompress(open('test/miai-review.json.gz', 'rb').read()))
GID = '85ad1412bfe0184d36b3'
async def main():
    out = {}
    async with async_playwright() as p:
        b, ctx, pg, errs = await open_app(p)
        await ctx.route('**/api/miai**', lambda route: route.fulfill(json=RES))
        await pg.click('button:has-text("新しい勉強会")'); await pg.fill('input[placeholder="例：押し引き"]', 'Miaiテスト'); await pg.click('button:has-text("作成")')
        await pg.click('.link-card'); await pg.wait_for_selector('details.import[open] textarea')
        await pg.fill('details.import textarea', f'https://riichi.miai.moe/r/{GID}?at=65')
        await pg.click('details.import button:has-text("取り込む")')
        await pg.wait_for_selector('.toast:has-text("取り込みました")')
        out['toast'] = await pg.inner_text('.toast')
        rv = db['study_ai_reviews']
        out['saved'] = len(db['study_rounds']) == 10 and len(rv) == 10 and all(r['engine'] == 'other' and r['naga']['reportId'] == f'miai:{GID}' for r in rv)
        # 東1局：南家の3打目（Miaiは2索）→ 違う打牌に出る
        r0 = next(x for x in db['study_rounds'] if x['kyoku'] == 0 and x['honba'] == 0)
        await pg.goto(f'http://localhost:5173/rounds/{r0["id"]}/review'); await pg.wait_for_selector('.naga')
        txt = await pg.inner_text('.naga')
        out['types'] = 'Miai（ラス回避）' in txt
        out['mismatch_chips'] = await pg.locator('.naga .chips .chip').count()
        out['has_mismatch'] = out['mismatch_chips'] >= 2
        # 違う打牌の局面へ飛ぶと、鳴き判断（北のポン）か打牌の評価が出る
        await pg.locator('.naga .chips .chip').first.click(); await pg.wait_for_timeout(300)
        out['jump'] = 'Miai（ラス回避）' in await pg.inner_text('.naga')
        # 南家（B）だけに絞ると、ほかの家の打牌でも D が鳴ける局面で止まり、D の鳴き判断だけが出る
        await pg.goto(f'http://localhost:5173/rounds/{r0["id"]}/review'); await pg.wait_for_selector('.naga')
        await pg.select_option('.rv-opts select >> nth=0', '1'); await pg.wait_for_timeout(300)
        seen = []
        for _ in range(40):
            head = await pg.inner_text('.rv-top')
            if 'Bの鳴き判断' in head:
                t = await pg.inner_text('.naga')
                seen.append(('Bの鳴き判断' in t, 'ポン' in t or 'スルー' in t or 'チー' in t or 'ロン' in t, 'Aの鳴き判断' not in t and 'Cの鳴き判断' not in t))
            nxt = pg.locator('button[aria-label="次"]')
            if await nxt.is_disabled(): break
            await nxt.click(); await pg.wait_for_timeout(120)
        out['call_stops'] = seen
        out['call_ok'] = len(seen) >= 2 and all(all(x) for x in seen)
        out['errors'] = errs
        await b.close()
    print(json.dumps({'ok': all(v is True for k, v in out.items() if k in ('saved', 'types', 'has_mismatch', 'jump', 'call_ok')) and not out['errors'], **out}, ensure_ascii=False))
asyncio.run(main())
