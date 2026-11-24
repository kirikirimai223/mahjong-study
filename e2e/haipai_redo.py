# 局の途中で開始時の手牌を入れ直すとき、副露に使った牌・手出しした牌もパレットで選べる。
# 「副露は表示しません」の注記で手牌の欄が縦に伸びない（データ：e2e/hori.json の手牌を消し、副露は残した状態）
import asyncio, json
from playwright.async_api import async_playwright
H = 'document.getElementById("host").__paifuEditor'
sr = "document.getElementById('host').shadowRoot"
async def main():
    d = json.load(open('e2e/hori.json')); d['seats'][2]['haipai'] = [28, 34, 34, 37]   # 八筒1・四索2・七索1だけ入れてある
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width': 390, 'height': 844})
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://localhost:5173/dev/editor.html'); await pg.wait_for_function('window.api')
        await pg.evaluate(f"() => window.api.setData({json.dumps(d)})")
        await pg.click('[data-act=pickseat][data-v="2"]'); await pg.click('[data-act=mode][data-v="hand"]')
        dis = lambda t: pg.evaluate(f"() => {sr}.querySelector('[data-act=pal][data-t=\"{t}\"]').disabled")
        before = {t: await dis(t) for t in (36, 38, 28)}
        for t in (36, 36, 36, 38, 38, 38, 38, 28): await pg.click(f'[data-act=pal][data-t="{t}"]')
        s = await pg.evaluate(f'{H}.state()'); hp = sorted(s['seats'][2]['haipai'])
        zone = await pg.evaluate(f"() => {{ const z = [...{sr}.querySelectorAll('.hand-zone')].find(e => e.querySelector('.meldnote')); const r = z.getBoundingClientRect(); const t = z.querySelector('.tile').getBoundingClientRect(); return [r.height, t.height]; }}")
        ok = (before == {36: False, 38: False, 28: False} and hp == sorted([28, 34, 34, 37, 36, 36, 36, 38, 38, 38, 38, 28])
              and zone[0] < zone[1] * 1.6)
        print(json.dumps({'ok': ok and not errs, 'before_disabled': before, 'haipai': hp, 'zone_h': zone, 'errors': errs}, ensure_ascii=False))
        await pg.screenshot(path='/tmp/haipai.png')
        await b.close()
asyncio.run(main())
