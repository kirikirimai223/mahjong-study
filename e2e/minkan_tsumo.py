# 明槓の後の打牌（嶺上牌をツモって切った牌）にも鳴きの印が付く／ツモ和了の和了牌を、和了した家の手牌のタップで選べる
import asyncio, json
from playwright.async_api import async_playwright
H = 'document.getElementById("host").__paifuEditor'
sr = "document.getElementById('host').shadowRoot"
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width': 390, 'height': 844})
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://localhost:5173/dev/editor.html'); await pg.wait_for_function('window.api')
        await pg.select_option('[data-act=samplesel]', '1'); await pg.wait_for_timeout(200)   # 四槓子：明槓あり
        marks = await pg.evaluate(f"() => [...{sr}.querySelectorAll('.tile.aftercall')].map(e => [e.dataset.seat, e.dataset.idx])")
        ok1 = ['2', '15'] in marks
        await pg.select_option('[data-act=samplesel]', '2'); await pg.wait_for_timeout(200)   # 嶺上開花：ツモ和了
        s = await pg.evaluate(f'{H}.state()'); w = s['result']['winner']
        await pg.evaluate("() => { const d = window.api.getData(); d.result.winTile = null; window.api.setData(d); }")
        await pg.click(f'[data-act=pickseat][data-v="{w}"]'); await pg.click('[data-act=mode][data-v="result"]')
        await pg.click('[data-act=mode][data-v="win"]')
        hint = await pg.evaluate(f"() => {sr}.querySelector('.hint')?.innerText ?? ''")
        t = await pg.evaluate(f"() => {sr}.querySelector('[data-act=wintile][data-seat=\"{w}\"]').dataset.t")
        await pg.dispatch_event(f'[data-act=wintile][data-seat="{w}"][data-t="{t}"]', 'click')
        s2 = await pg.evaluate(f'{H}.state()')
        shown = await pg.evaluate(f"() => !!{sr}.querySelector('.tile.drawn.winning')")
        ok2 = s2['result']['winTile'] == int(t) and shown and '手牌から' in hint
        print(json.dumps({'ok': ok1 and ok2 and not errs, 'ok1': ok1, 'ok2': ok2, 'marks': marks, 'winTile': s2['result']['winTile'], 'errors': errs}, ensure_ascii=False))
        await b.close()
asyncio.run(main())
