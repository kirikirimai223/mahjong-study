# 牌譜だけ取り込んだ局に、あとからNAGAの結果を付ける：振り返り画面でレポートのURLを貼る／勉強会の画面で半荘ごとに貼る
import asyncio, sys, os, json, gzip, urllib.parse
sys.path.insert(0, os.path.dirname(__file__))
from playwright.async_api import async_playwright
from mock_supabase import db, open_app
REPORT = json.loads(gzip.decompress(open('test/naga-report.json.gz', 'rb').read()))
RID = 'e3e4abcd1234567890abcdefv2_2'
URL = f'https://naga.dmv.nico/htmls/report_viewer.html?report_id={RID}&tw=0'
JSON = {'title': ['', ''], 'name': REPORT['player_info']['name'], 'rule': {'disp': '般南喰赤', 'aka': 1}, 'log': json.loads(REPORT['custom_haihu'][0])}
async def main():
    out = {}
    async with async_playwright() as p:
        b, ctx, pg, errs = await open_app(p)
        await ctx.route('**/api/naga-report**', lambda route: route.fulfill(json=REPORT))
        await pg.click('button:has-text("新しい勉強会")'); await pg.fill('input[placeholder="例：押し引き"]', 't'); await pg.click('button:has-text("作成")')
        await pg.click('.link-card'); await pg.click('summary:has-text("既にある牌譜を取り込む")')
        await pg.fill('details.import textarea', 'https://tenhou.net/6/#json=' + urllib.parse.quote(json.dumps(JSON, ensure_ascii=False)))
        await pg.click('details.import button:has-text("取り込む")'); await pg.wait_for_selector('.toast')
        r = db['study_rounds'][0]
        # 1. 振り返り画面：まだ無いと案内が出て、URLを貼ると評価が出る
        await pg.goto(f'http://localhost:5173/rounds/{r["id"]}/review'); await pg.wait_for_selector('.naga-none')
        none_txt = await pg.inner_text('.naga-none summary')
        await pg.click('.naga-none summary')
        await pg.fill('.naga-none input[type=url]', URL); await pg.click('.naga-none button:has-text("取り込む")')
        await pg.wait_for_selector('.naga .naga-row')
        out['review'] = 'まだ取り込まれていません' in none_txt and len(db['study_ai_reviews']) == 1 and db['study_ai_reviews'][0]['naga']['reportId'] == RID
        # 2. 勉強会の画面：半荘ごとに貼る（同じレポートなら置き換えて増えない）
        await pg.click('text=← 勉強会'); await pg.wait_for_selector('.game')
        await pg.click('.game button:has-text("NAGAの結果を取り込む")')
        await pg.fill('.naga-import input[type=url]', URL); await pg.click('.naga-import button:has-text("取り込む")')
        await pg.wait_for_selector('.toast:has-text("NAGAの結果")')
        toast = await pg.inner_text('.toast')
        out['game'] = '1局にNAGAの結果' in toast and len(db['study_ai_reviews']) == 1
        out['errors'] = errs
        await b.close()
    print(json.dumps({'ok': all(v is True for k, v in out.items() if k != 'errors') and not out['errors'], **out, 'toast': toast}, ensure_ascii=False))
asyncio.run(main())
