# 段階⑤：ホーム画面に追加（PWA）と招待の案内文。本番ビルドを vite preview（:4173）で開いて確かめる
#   npm run build && npx vite preview --port 4173 --strictPort
import asyncio, sys, os, json
sys.path.insert(0, os.path.dirname(__file__))
from playwright.async_api import async_playwright
from mock_supabase import db, open_app
O = 'http://localhost:4173'
async def main():
    out = {}
    async with async_playwright() as p:
        # 1. 招待リンクから来ると、登録の画面でアドレスが入っている
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width': 390, 'height': 844})
        await pg.goto(O + '/?signup=1&email=' + 'friend%40example.com')
        out['signup'] = await pg.locator('button.primary').inner_text() == '登録する' and await pg.input_value('input[type=email]') == 'friend@example.com'
        # 2. マニフェストとアイコン、サービスワーカー
        man = await pg.evaluate("() => fetch(document.querySelector('link[rel=manifest]').href).then(r => r.json())")
        icons = await pg.evaluate(f"() => Promise.all({json.dumps([i['src'] for i in man['icons']] + ['/apple-touch-icon.png', '/favicon.png'])}.map(u => fetch(u).then(r => r.ok && r.headers.get('content-type'))))")
        out['manifest'] = man['display'] == 'standalone' and man['name'] == '麻雀勉強会' and all(t == 'image/png' for t in icons)
        await pg.evaluate("() => navigator.serviceWorker.ready")
        await pg.reload(); await pg.wait_for_timeout(300)
        out['sw'] = await pg.evaluate("() => !!navigator.serviceWorker.controller")
        # 3. つながらなくても画面は開く（データは読めない）
        await pg.context.set_offline(True)
        await pg.goto(O + '/'); await pg.wait_for_selector('h1:has-text("麻雀勉強会")', timeout=5000)
        out['offline'] = True
        await b.close()
        # 4. 招待すると案内文（登録リンクつき）が出て、コピーできる
        b, ctx, pg, errs = await open_app(p, O)
        await ctx.grant_permissions(['clipboard-read', 'clipboard-write'], origin=O)
        await pg.click('a:has-text("メンバー")')
        await pg.fill('input[type=email]', 'Friend@Example.com'); await pg.click('button:has-text("招待")')
        await pg.wait_for_selector('.invite-text')
        txt = await pg.inner_text('.invite-text')
        await pg.click('.invite-text + .row button:has-text("コピー")'); await pg.wait_for_timeout(200)
        clip = await pg.evaluate('navigator.clipboard.readText()')
        out['invite'] = (db['study_invites'][0]['email'] == 'friend@example.com' and O + '/?signup=1&email=friend%40example.com' in txt and clip == txt)
        out['errors'] = errs
        await b.close()
    print(json.dumps({'ok': all(v is True for k, v in out.items() if k != 'errors') and not out['errors'], **out, 'invite_text': txt}, ensure_ascii=False))
asyncio.run(main())
