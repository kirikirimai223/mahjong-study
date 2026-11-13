# 段階③：勉強会の一覧（件数・絞り込み）、勉強会・半荘の編集、解析レポートURL、勉強会の削除
import asyncio, sys, os
sys.path.insert(0, os.path.dirname(__file__))
from playwright.async_api import async_playwright
from mock_supabase import db, open_app
async def main():
    async with async_playwright() as p:
        b, ctx, pg, errs = await open_app(p)
        for title, ppl in [('押し引き', 'Aさん、Bさん、Cさん、私'), ('鳴き判断', 'たなか すずき')]:
            await pg.click('button:has-text("新しい勉強会")')
            await pg.fill('input[placeholder="例：押し引き"]', title); await pg.fill('input[placeholder="例：いいだ、たなか"]', ppl)
            await pg.click('button:has-text("作成")'); await pg.wait_for_selector(f'text={title}')
        await pg.click('.link-card:has-text("押し引き")')
        await pg.click('button:has-text("新しい半荘")'); await pg.click('button:has-text("作って東一局を入力")')
        await pg.wait_for_url('**/rounds/*'); await pg.wait_for_selector('.round-page')
        await pg.select_option('[data-act=samplesel]', '3'); await pg.wait_for_timeout(200)
        # 解析パネル：URLコピー（保存して組む）→ レポートURL追加
        await ctx.grant_permissions(['clipboard-read', 'clipboard-write'])
        await pg.click('.roundbar button:has-text("解析")')
        await pg.click('button:has-text("この局のURLをコピー")'); await pg.wait_for_timeout(600)
        print('after copy msg:', await pg.inner_text('.reviews p.small'), '| json saved:', db['study_rounds'][0]['tenhou_json'] is not None)
        clip = await pg.evaluate('navigator.clipboard.readText()'); print('clipboard is tenhou url:', clip.startswith('https://tenhou.net/6/#json='))
        await pg.fill('.reviews input[type=url]', 'notaurl'); await pg.click('.reviews button:has-text("追加")'); await pg.wait_for_timeout(200)
        print('bad url msg:', await pg.inner_text('.reviews p.small'))
        await pg.fill('.reviews input[type=url]', 'https://naga.dmv.nico/htmls/abc.html'); await pg.fill('.reviews input[placeholder^="メモ"]', 'ω・全員視点')
        await pg.click('.reviews button:has-text("追加")'); await pg.wait_for_timeout(300)
        print('reviews:', [(r['engine'], r['report_url'], r['note']) for r in db['study_ai_reviews']], '| list:', await pg.inner_text('.reviews .list'))
        await pg.screenshot(path='/tmp/reviews.png')
        await pg.click('text=← 戻る'); await pg.wait_for_selector('.game')
        print('badge:', await pg.inner_text('.rounds li'))
        # 半荘の編集
        await pg.click('.game button:has-text("編集")'); await pg.fill('.game input >> nth=0', '半荘A'); await pg.click('.game button:has-text("保存")'); await pg.wait_for_timeout(300)
        print('game name:', db['study_games'][0]['name'], await pg.inner_text('.game h3'))
        # 勉強会の編集
        await pg.click('main > .row button:has-text("編集")'); await pg.fill('textarea', 'ベタオリの基準を話す'); await pg.click('form button:has-text("保存")'); await pg.wait_for_timeout(300)
        print('note shown:', await pg.inner_text('p.note'))
        # 一覧：件数と絞り込み
        await pg.click('text=← 勉強会の一覧'); await pg.wait_for_selector('.link-card'); await pg.wait_for_timeout(300)
        print('list:', [t.replace('\n', ' / ') for t in await pg.locator('.link-card').all_inner_texts()])
        await pg.fill('input.search', 'すずき'); print('filter すずき:', await pg.locator('.link-card').count())
        await pg.fill('input.search', 'ベタオリ'); print('filter ベタオリ（メモ）:', await pg.locator('.link-card').count())
        await pg.fill('input.search', 'なし語'); print('filter none:', await pg.inner_text('main'))
        await pg.fill('input.search', '')
        # 勉強会の削除（2回押し）
        await pg.click('.link-card:has-text("押し引き")'); await pg.click('main > .row button:has-text("編集")')
        await pg.click('button:has-text("この勉強会を削除")'); print('armed:', await pg.inner_text('button.danger >> nth=0'))
        await pg.click('button:has-text("半荘・局ごと本当に削除")'); await pg.wait_for_selector('h2:has-text("勉強会")')
        print('after delete: sessions', len(db['study_sessions']), 'games', len(db['study_games']), 'rounds', len(db['study_rounds']), 'reviews', len(db['study_ai_reviews']))
        await pg.screenshot(path='/tmp/stage3.png', full_page=True)
        print('errs', errs); await b.close()
asyncio.run(main())
