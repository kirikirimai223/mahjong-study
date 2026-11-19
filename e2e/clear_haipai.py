# 開始時の手牌をすべて消すと、副露（と鳴かれた印）も消え、パレットの残り枚数が戻る（データ：e2e/hori.json）
import asyncio, json
from playwright.async_api import async_playwright
H = 'document.getElementById("host").__paifuEditor'
sr = "document.getElementById('host').shadowRoot"
async def main():
    d = json.load(open('e2e/hori.json'))
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width': 390, 'height': 844})
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://localhost:5173/dev/editor.html'); await pg.wait_for_function('window.api')
        await pg.evaluate(f"() => window.api.setData({json.dumps(d)})")
        left = lambda t: pg.evaluate(f"() => {sr}.querySelector('[data-act=pal][data-t=\"{t}\"]').innerText.trim()")
        before = {t: await left(t) for t in (36, 38, 28)}
        await pg.click('[data-act=pickseat][data-v="2"]'); await pg.click('[data-act=mode][data-v="hand"]')
        await pg.dispatch_event('[data-act=clearhaipai]', 'click')
        note = await pg.evaluate(f"() => {sr}.querySelector('[data-act=clearhaipai][data-v=yes]').parentElement.innerText")
        await pg.dispatch_event('[data-act=clearhaipai][data-v="yes"]', 'click')
        s = await pg.evaluate(f'{H}.state()')
        after = {t: await left(t) for t in (36, 38, 28)}
        fl = await pg.evaluate(f"() => {sr}.querySelector('.flash')?.innerText ?? ''")
        ok = (s['seats'][2]['haipai'] == [] and s['seats'][2]['melds'] == [] and len(s['seats'][2]['river']) == 14
              and all('calledBy' not in r for x in s['seats'] for r in x['river'])
              and '副露3つ' in note and '副露3つ' in fl
              and after == {36: '3', 38: '4', 28: '2'})
        print(json.dumps({'ok': ok and not errs, 'before': before, 'after': after, 'note': note, 'flash': fl, 'errors': errs}, ensure_ascii=False))
        await b.close()
asyncio.run(main())
