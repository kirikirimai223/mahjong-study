# 段階④：振り返り（巡目スライダーでの再生）と局面コメント・タグ・結論
import asyncio, sys, os
sys.path.insert(0, os.path.dirname(__file__))
from playwright.async_api import async_playwright
from mock_supabase import db, open_app
async def main():
    async with async_playwright() as p:
        b, ctx, pg, errs = await open_app(p)
        await pg.click('button:has-text("新しい勉強会")'); await pg.fill('input[placeholder="例：押し引き"]', '振り返りテスト'); await pg.click('button:has-text("作成")')
        await pg.click('.link-card'); await pg.click('button:has-text("新しい半荘")'); await pg.click('button:has-text("作って東一局を入力")')
        await pg.wait_for_url('**/rounds/*'); await pg.wait_for_selector('.round-page')
        await pg.select_option('[data-act=samplesel]', '0'); await pg.wait_for_timeout(200)  # 南三局（チー・立直）
        await pg.click('.roundbar button:has-text("保存")'); await pg.wait_for_timeout(500)
        await pg.click('.roundbar a:has-text("振り返り")'); await pg.wait_for_selector('.rtable')
        print('title:', await pg.inner_text('.review h2'))
        print('first:', await pg.inner_text('.slider b'), '| active seat tiles:', await pg.locator('.r-layer.acting .r-hand .tile').count(), '| cut:', await pg.locator('.r-layer.acting .cut').count())
        n = int(await pg.get_attribute('.slider input[type=range]', 'max')) + 1
        r = db['study_rounds'][0]['editor']; total = sum(len(s['river']) for s in r['seats'])
        print('frames:', n, 'editor river total:', total)
        for _ in range(5): await pg.click('button[aria-label="次"]'); await pg.wait_for_timeout(150)
        print('after 5 next:', await pg.inner_text('.slider b'), pg.url.split('?')[1])
        # この家の打牌だけ
        await pg.select_option('.rv-opts select >> nth=0', '3'); await pg.click('button[aria-label="次"]'); await pg.wait_for_timeout(300)
        print('seat3 filter:', await pg.inner_text('.slider b'))
        # 局面コメント（タグ付き）と結論
        await pg.fill('.notes >> nth=0 >> textarea[placeholder="この局面へのコメント"]', 'ここは押してよかった？')
        await pg.click('.notes >> nth=0 >> button.chip:has-text("押し引き")')
        await pg.fill('.notes >> nth=0 >> input', 'たなか')
        print('body value:', await pg.input_value('.notes >> nth=0 >> textarea[placeholder="この局面へのコメント"]'))
        await pg.click('.notes >> nth=0 >> button:has-text("コメントする")'); await pg.wait_for_timeout(300)
        await pg.fill('.notes >> nth=0 >> .conclusion textarea', '現物の打九萬で降りる'); await pg.click('button:has-text("結論を保存")'); await pg.wait_for_timeout(300)
        print('positions:', [(x['seat'], x['discard_index'], x['conclusion']) for x in db['study_positions']])
        print('comments:', [(x['speaker'], x['body'], x['tags'], x['position_id'] is not None) for x in db['study_comments']])
        print('note view:', (await pg.inner_text('.notes >> nth=0'))[:200].replace('\n', ' / '))
        print('chips:', await pg.inner_text('main.review > .chips'))
        # 同じ局面への2件目（同じ position を使う）
        await pg.fill('.notes >> nth=0 >> textarea[placeholder="この局面へのコメント"]', '2件目'); await pg.click('.notes >> nth=0 >> button:has-text("コメントする")'); await pg.wait_for_timeout(300)
        print('positions after 2nd:', len(db['study_positions']), 'comments:', len(db['study_comments']))
        # 編集・削除（自分のコメント）
        await pg.click('.notes >> nth=0 >> button.link:has-text("編集") >> nth=1'); await pg.fill('.comments textarea', '2件目（直した）'); await pg.click('.comments button:has-text("保存")'); await pg.wait_for_timeout(300)
        await pg.click('.notes >> nth=0 >> button.link:has-text("削除") >> nth=0'); await pg.click('.notes >> nth=0 >> button.link:has-text("本当に削除")'); await pg.wait_for_timeout(300)
        print('after edit/delete:', [x['body'] for x in db['study_comments']])
        # 局全体へのコメント
        await pg.fill('textarea[placeholder="この局全体へのコメント"]', '南三局の点数状況を確認'); await pg.click('.notes >> nth=1 >> button:has-text("コメントする")'); await pg.wait_for_timeout(300)
        print('round comment:', [(x['body'], x['position_id']) for x in db['study_comments'] if x['position_id'] is None])
        # 局面リンク（URL）で開き直すと同じ局面
        url = pg.url; await pg.goto(url); await pg.wait_for_selector('.rtable'); await pg.wait_for_timeout(500)
        print('reopen:', await pg.inner_text('.slider b'), '| comment shown:', '2件目（直した）' in await pg.inner_text('.notes >> nth=0'))
        await pg.screenshot(path='/tmp/stage4.png', full_page=True)
        await pg.click('text=← 勉強会'); await pg.wait_for_selector('.game')
        print('detail row:', await pg.inner_text('.rounds li .rt'))
        print('errs', errs); await b.close()
asyncio.run(main())
