# 既にある牌譜の取り込み：天鳳牌譜エディタのURL4つと、NAGAのレポート（偽装）を貼って取り込む。
# 取り込んだ局をエディタで開いて「保存」すると、元の牌譜と同じ天鳳形式になる（入力内容が正しく再現できている）
import asyncio, sys, os, json, gzip, re, urllib.parse
sys.path.insert(0, os.path.dirname(__file__))
from playwright.async_api import async_playwright
from mock_supabase import db, open_app
fx = open('test/fixtures.ts').read()
URLS = dict(re.findall(r"export const (\w+)_URL\s*=\s*\n?\s*'([^']+)'", fx))
dec = lambda u: json.loads(urllib.parse.unquote(u.split('#json=')[1]).split('&ts=')[0])
REPORT = json.loads(gzip.decompress(open('test/naga-report.json.gz', 'rb').read()))
RID = 'e3e4abcd1234567890abcdefv2_2'
async def main():
    out = {}
    async with async_playwright() as p:
        b, ctx, pg, errs = await open_app(p)
        await ctx.route('**/api/naga-report**', lambda route: route.fulfill(json=REPORT))
        await pg.click('button:has-text("新しい勉強会")'); await pg.fill('input[placeholder="例：押し引き"]', '取り込みテスト'); await pg.click('button:has-text("作成")')
        await pg.click('.link-card'); await pg.wait_for_selector('summary:has-text("既にある牌譜を取り込む")')
        await pg.click('summary:has-text("既にある牌譜を取り込む")')
        text = '\n'.join([URLS[k] for k in ('SAMPLE', 'KAN', 'RINSHAN', 'CHANKAN')] + [f'https://naga.dmv.nico/htmls/report_viewer.html?report_id={RID}&tw=0'])
        await pg.fill('details.import textarea', text)
        await pg.click('details.import button:has-text("取り込む")')
        await pg.wait_for_selector('.toast:has-text("取り込みました")')
        toast = await pg.inner_text('.toast')
        out['saved'] = len(db['study_rounds']) == 5 and len(db['study_ai_reviews']) == 1 and db['study_ai_reviews'][0]['naga']['reportId'] == RID
        # 取り込んだ局をエディタで開き、保存して天鳳形式を組み直す → 元と同じ
        same = {}
        for k in ('SAMPLE', 'KAN', 'RINSHAN', 'CHANKAN'):
            orig = dec(URLS[k])
            r = next(x for x in db['study_rounds'] if x['tenhou_json']['log'][0] == orig['log'][0])
            r['tenhou_json'] = None
            await pg.goto(f'http://localhost:5173/rounds/{r["id"]}'); await pg.wait_for_selector('.round-page')
            await pg.click('.roundbar button:has-text("保存")'); await pg.wait_for_timeout(600)
            same[k] = r['tenhou_json'] is not None and r['tenhou_json']['log'] == orig['log']
        out['roundtrip'] = all(same.values())
        # NAGAの局は、振り返りでそのまま推奨打牌と並ぶ
        nr = next(x for x in db['study_rounds'] if x['kyoku'] == 1 and x['honba'] == 1)
        await pg.goto(f'http://localhost:5173/rounds/{nr["id"]}/review'); await pg.wait_for_selector('.naga')
        out['naga'] = 'ニシキ' in await pg.inner_text('.naga')
        out['errors'] = errs
        await b.close()
    print(json.dumps({'ok': all(v is True for k, v in out.items() if k != 'errors') and not out['errors'], **out, 'toast': toast, 'same': same}, ensure_ascii=False))
asyncio.run(main())
