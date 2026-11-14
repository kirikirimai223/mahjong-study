# 開始時の手牌がある家は、最後に切られた牌にだけ鳴ける（前の巡の牌に鳴くと今の手牌から鳴いたことになり、枚数が合わない）
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
        for k in range(4):
            s = (dealer + k) % 4
            a = [x for x in data['acts'] if x['seat'] == s and x['type'] == 'draw'][0]
            await pg.click(f'[data-act=pal][data-t="{a["tile"]}"]'); await pg.dispatch_event('[data-act=cut][data-drawn="1"]', 'click')
        caller = (dealer + 1) % 4
        await pg.click(f'[data-act=pickseat][data-v="{caller}"]')
        await pg.click('[data-act=mode][data-v="meld"]')
        await pg.dispatch_event(f'[data-act=river][data-seat="{dealer}"][data-idx="0"]', 'click')  # 前の巡の牌
        f1 = await flash(); s1 = await st()
        await pg.dispatch_event(f'[data-act=river][data-seat="{(dealer + 3) % 4}"][data-idx="0"]', 'click')  # 最後に切られた牌
        s2 = await st()
        ok = ('最後に切られた牌だけ' in f1 and s1['ui'].get('meldTarget') is None
              and s2['ui'].get('meldTarget') == {'from': (dealer + 3) % 4, 'idx': 0} and not errs)
        print(json.dumps({'ok': ok, 'flash1': f1, 'target2': s2['ui'].get('meldTarget'), 'errors': errs}, ensure_ascii=False))
        await b.close()
asyncio.run(main())
