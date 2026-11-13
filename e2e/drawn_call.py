# 鳴く家が先にパレットでツモ牌を選んでから副露を入れたとき：ツモ牌は鳴きに使えず、鳴いたらツモは取り消される
import asyncio, json
from playwright.async_api import async_playwright
H = 'document.getElementById("host").__paifuEditor'
data = json.load(open('e2e/acts.json'))['sample']
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width': 390, 'height': 844})
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://localhost:5173/dev/editor.html'); await pg.wait_for_function('window.api')
        await pg.evaluate(f"""() => {{ const s = window.api.getData(); s.setup = {json.dumps(data['setup'])}; s.names = {json.dumps(data['names'])};
          s.seats.forEach((b, i) => {{ b.haipai = {json.dumps(data['haipai'])}[i]; }}); window.mount(s); }}""")
        st = lambda: pg.evaluate(f'{H}.state()')
        flash = lambda: pg.evaluate("() => document.getElementById('host').shadowRoot.querySelector('.flash')?.innerText ?? ''")
        dealer = data['setup']['kyoku'] % 4
        await pg.click(f'[data-act=pickseat][data-v="{dealer}"]')
        for k in range(3):
            s = (dealer + k) % 4
            a = [x for x in data['acts'] if x['seat'] == s and x['type'] == 'draw'][0]
            await pg.click(f'[data-act=pal][data-t="{a["tile"]}"]'); await pg.dispatch_event('[data-act=cut][data-drawn="1"]', 'click')
        caller = (dealer + 3) % 4; frm = (dealer + 2) % 4
        await pg.click('[data-act=pal][data-t="13"]')  # 鳴く家がツモ牌（三萬）を先に選んでしまう
        await pg.click('[data-act=mode][data-v="meld"]')
        await pg.dispatch_event(f'[data-act=river][data-seat="{frm}"][data-idx="0"]', 'click')
        await pg.dispatch_event(f'[data-act=mpick][data-seat="{caller}"][data-key="d"]', 'click')
        f1 = await flash(); s1 = await st()
        await pg.dispatch_event(f'[data-act=mpick][data-seat="{caller}"][data-key="h1"]', 'click')
        await pg.dispatch_event(f'[data-act=mpick][data-seat="{caller}"][data-key="h2"]', 'click')
        o = await pg.evaluate(f'{H}.options()'); idx = next(k for k, x in enumerate(o) if x.get('kind') == 'chi')
        await pg.click(f'[data-act=meldconfirm][data-v="{idx}"]')
        await pg.dispatch_event(f'[data-act=meldcut][data-seat="{caller}"][data-t="11"]', 'click')
        f2 = await flash(); s2 = await st()
        ok = ('チー・ポンに使えません' in f1 and not (s1['ui'].get('pick') or {}).get('keys', []) and 'ツモ（三萬）は取り消しました' in f2
              and s2['seats'][caller]['melds'][0]['own'] == [51, 16] and s2['ui']['pendingDraw'] is None)
        print(json.dumps({'ok': ok, 'flash1': f1, 'flash2': f2, 'errors': errs}, ensure_ascii=False))
        await b.close()
asyncio.run(main())
