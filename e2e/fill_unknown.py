# 手牌の「?」をタップして、抜けていたツモ牌をパレットで埋める
import asyncio, json
from playwright.async_api import async_playwright
H = 'document.getElementById("host").__paifuEditor'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width': 390, 'height': 844})
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://localhost:5173/dev/editor.html'); await pg.wait_for_function('window.api')
        await pg.select_option('[data-act=samplesel]', '0'); await pg.wait_for_timeout(100)
        st = lambda: pg.evaluate(f'{H}.state()')
        issues = lambda: pg.evaluate("() => document.getElementById('host').shadowRoot.querySelector('div.issues')?.innerText ?? ''")
        flash = lambda: pg.evaluate("() => document.getElementById('host').shadowRoot.querySelector('.flash')?.innerText ?? ''")
        # Cさん（席2）の普通の巡のツモ牌を2つ消す
        orig = await pg.evaluate(f"""() => {{ const d = window.api.getData(); const b = d.seats[2]; const out = [];
          for (const [i, r] of b.river.entries()) {{ if (out.length < 2 && i > 2 && r.draw !== undefined && r.draw !== r.tile && r.calledBy === undefined) {{ out.push([i, r.draw, r.tsumogiri]); delete r.draw; delete r.tsumogiri; }} }}
          window.mount(d); return out; }}""")
        await pg.click('[data-act=pickseat][data-v="2"]'); await pg.wait_for_timeout(600)
        n_unk = await pg.locator('[data-act=unk][data-seat="2"]').count()
        before = await issues()
        await pg.dispatch_event('[data-act=unk][data-seat="2"]', 'click'); f1 = await flash()
        s1 = await st()
        await pg.click(f'[data-act=pal][data-t="{orig[0][1]}"]'); await pg.wait_for_timeout(100); f2 = await flash()
        await pg.click(f'[data-act=pal][data-t="{orig[1][1]}"]'); await pg.wait_for_timeout(300); f3 = await flash()
        s2 = await st()
        after = await issues()
        n_unk2 = await pg.locator('[data-act=unk][data-seat="2"]').count()
        restored = [s2['seats'][2]['river'][i].get('draw') for i, _, _ in orig]
        # 元の牌譜と同じに戻ったか（出力して比べる）
        await pg.click('[data-act=build]'); await pg.wait_for_timeout(200)
        ok = (n_unk >= 1 and s1['ui']['selected'] == {'seat': 2, 'idx': orig[0][0]} and restored == [orig[0][1], orig[1][1]]
              and n_unk2 == 0 and 'ツモ牌が入っていない' in before and 'ツモ牌が入っていない' not in after and 'すべて埋まりました' in f3)
        # 河の牌を選んで「ツモを入れる」でも、牌が挿入されずにツモだけ入る（以前は挿入になっていた）
        await pg.evaluate("() => { const d = window.api.getData(); delete d.seats[2].river[5].draw; window.mount(d); }")
        await pg.click('[data-act=pickseat][data-v="2"]'); await pg.wait_for_timeout(500)
        n0 = len((await st())['seats'][2]['river'])
        await pg.dispatch_event('[data-act=river][data-seat="2"][data-idx="5"]', 'click')
        await pg.click('[data-act=rinsert][data-v="draw"]'); await pg.click(f'[data-act=pal][data-t="{orig[0][1]}"]'); await pg.wait_for_timeout(200)
        s3 = await st()
        manual_ok = len(s3['seats'][2]['river']) == n0 and s3['seats'][2]['river'][5].get('draw') == orig[0][1]
        ok = ok and manual_ok
        print(json.dumps({'ok': ok, 'manual_draw_ok': manual_ok, 'unknown_before': n_unk, 'unknown_after': n_unk2, 'flash': [f1, f2, f3], 'issues_after': after, 'errors': errs}, ensure_ascii=False))
        await b.close()
asyncio.run(main())
