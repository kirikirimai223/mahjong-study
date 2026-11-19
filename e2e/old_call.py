# 前の巡の牌にも鳴ける。鳴く牌を選ぶと、鳴いた家のどの打牌が「鳴いた後の打牌」になるかを案内し、確定するとその打牌のツモを外す
# あわせて、ある家の開始時の手牌を一度に消せることも確かめる
import asyncio, json
from playwright.async_api import async_playwright
H = 'document.getElementById("host").__paifuEditor'
data = json.load(open('e2e/acts.json'))['sample']
hp = json.loads(json.dumps(data['haipai']))
hp[1][hp[1].index(39)] = 44   # 九索を東家（親）へ回す
hp[2][hp[2].index(47)] = 39
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width': 390, 'height': 844})
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://localhost:5173/dev/editor.html'); await pg.wait_for_function('window.api')
        await pg.evaluate(f"""() => {{ const s = window.api.getData(); s.setup = {json.dumps(data['setup'])}; s.names = {json.dumps(data['names'])};
          s.seats.forEach((b, i) => {{ b.haipai = {json.dumps(hp)}[i]; }}); window.mount(s); }}""")
        st = lambda: pg.evaluate(f'{H}.state()')
        sr = "document.getElementById('host').shadowRoot"
        flash = lambda: pg.evaluate(f"() => {sr}.querySelector('.flash')?.innerText ?? ''")
        dealer = data['setup']['kyoku'] % 4
        draws = {s: [x['tile'] for x in data['acts'] if x['seat'] == s and x['type'] == 'draw'] for s in range(4)}
        await pg.click(f'[data-act=pickseat][data-v="{dealer}"]')
        for k in range(8):
            s = (dealer + k) % 4
            await pg.click(f'[data-act=pal][data-t="{draws[s][k // 4]}"]')
            if k == 0: await pg.dispatch_event(f'[data-act=cut][data-seat="{s}"][data-t="39"]:not([data-drawn])', 'click')
            else: await pg.dispatch_event('[data-act=cut][data-drawn="1"]', 'click')
        caller = (dealer + 2) % 4
        s0 = await st(); assert [len(x['river']) for x in s0['seats']] == [2, 2, 2, 2], [len(x['river']) for x in s0['seats']]
        await pg.click(f'[data-act=pickseat][data-v="{caller}"]')
        await pg.click('[data-act=mode][data-v="meld"]')
        await pg.dispatch_event(f'[data-act=river][data-seat="{dealer}"][data-idx="0"]', 'click')  # 前の巡の九索
        s1 = await st()
        note = await pg.evaluate(f"() => {sr}.querySelector('.aftercallnote')?.innerText ?? ''")
        marked = await pg.evaluate(f"() => [...{sr}.querySelectorAll('.tile.nextaftercall')].map(e => [e.dataset.seat, e.dataset.idx])")
        keys = await pg.evaluate(f"() => [...{sr}.querySelectorAll('[data-act=mpick][data-seat=\"{caller}\"][data-t=\"39\"]')].map(e => e.dataset.key)")
        for k in keys[:2]: await pg.dispatch_event(f'[data-act=mpick][data-seat="{caller}"][data-key="{k}"]', 'click')
        o = await pg.evaluate(f'{H}.options()'); idx = next(k for k, x in enumerate(o) if x.get('kind') == 'pon')
        await pg.click(f'[data-act=meldconfirm][data-v="{idx}"]')
        f2 = await flash(); s2 = await st()
        cr = s2['seats'][caller]['river']
        ok1 = (s1['ui'].get('meldTarget') == {'from': dealer, 'idx': 0} and '1打目' in note and marked == [[str(caller), '0']]
               and s2['seats'][caller]['melds'][0]['kind'] == 'pon' and s2['seats'][dealer]['river'][0].get('calledBy') == caller
               and len(cr) == 2 and 'draw' not in cr[0] and cr[0]['tsumogiri'] is False and '1打目' in f2 and 'ツモ' in f2)
        print(await pg.evaluate(f"() => {sr}.querySelector('div.issues')?.innerText"))
        # 開始時の手牌をまとめて消す
        tgt = (dealer + 1) % 4
        await pg.click(f'[data-act=pickseat][data-v="{tgt}"]')
        await pg.click('[data-act=mode][data-v="hand"]')
        await pg.dispatch_event('[data-act=clearhaipai]', 'click')
        await pg.dispatch_event('[data-act=clearhaipai][data-v="yes"]', 'click')
        s3 = await st(); f3 = await flash()
        ok2 = s3['seats'][tgt]['haipai'] == [] and len(s3['seats'][tgt]['river']) == 2 and '消しました' in f3
        print(json.dumps({'ok': ok1 and ok2 and not errs, 'ok1': ok1, 'ok2': ok2, 'note': note, 'marked': marked, 'flash2': f2, 'flash3': f3, 'river': cr, 'errors': errs}, ensure_ascii=False))
        await b.close()
asyncio.run(main())
