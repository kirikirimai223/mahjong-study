# 大きいパレットから卓へドラッグして河に置く：右半分ならツモ切り、左半分なら手出し。動かさずに離せばふつうのタップ
import asyncio, json
from playwright.async_api import async_playwright
H = 'document.getElementById("host").__paifuEditor'
sr = "document.getElementById('host').shadowRoot"
data = json.load(open('e2e/acts.json'))['sample']
async def drag(pg, t, side, release=True):
    await pg.evaluate(f"() => window.scrollBy(0, {sr}.querySelector('.table-wrap').getBoundingClientRect().top - 70)")
    pal = await pg.evaluate(f"() => {{ const r = {sr}.querySelector('.palette.big [data-act=pal][data-t=\"{t}\"]').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }}")
    wrap = await pg.evaluate(f"() => {{ const r = {sr}.querySelector('.table-wrap').getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }}")
    x = wrap[0] + wrap[2] * (0.25 if side == 'left' else 0.75); y = wrap[1] + wrap[3] * 0.5
    await pg.mouse.move(*pal); await pg.mouse.down()
    for k in range(1, 6): await pg.mouse.move(pal[0] + (x - pal[0]) * k / 5, pal[1] + (y - pal[1]) * k / 5)
    zones = await pg.evaluate(f"() => {{ const z = {sr}.querySelector('.dropzones'); return z ? z.className : null; }}")
    ghost = await pg.evaluate(f"() => !!{sr}.querySelector('.dragghost')")
    if release: await pg.mouse.up()
    return zones, ghost
async def drag_to(pg, t, sel):
    await pg.evaluate(f"() => window.scrollBy(0, {sr}.querySelector('.table-wrap').getBoundingClientRect().top - 70)")
    pal = await pg.evaluate(f"() => {{ const r = {sr}.querySelector('.palette.big [data-act=pal][data-t=\"{t}\"]').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }}")
    x, y = await pg.evaluate(f"() => {{ const r = {sr}.querySelector('{sel}').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }}")
    await pg.mouse.move(*pal); await pg.mouse.down()
    for k in range(1, 6): await pg.mouse.move(pal[0] + (x - pal[0]) * k / 5, pal[1] + (y - pal[1]) * k / 5)
    hl = await pg.evaluate(f"() => [{sr}.querySelector('.dropzones p')?.textContent, !!{sr}.querySelector('.hand-zone.drophand')]")
    await pg.mouse.up()
    return hl
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width': 390, 'height': 844})
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://localhost:5173/dev/editor.html'); await pg.wait_for_function('window.api')
        st = lambda: pg.evaluate(f'{H}.state()')
        fl = lambda: pg.evaluate(f"() => {sr}.querySelector('.flash')?.innerText ?? ''")
        # 1. 河だけ記録する家（開始時の手牌なし）
        await pg.click('[data-act=pickseat][data-v="1"]')
        await pg.click('[data-act=dragmode]')
        fixed = await pg.evaluate(f"() => getComputedStyle({sr}.querySelector('.palette')).position")
        await pg.screenshot(path='/tmp/drag0.png')
        z1, g1 = await drag(pg, 41, 'right'); f1 = await fl()
        z2, g2 = await drag(pg, 15, 'left'); f2 = await fl()
        await pg.click('.palette.big [data-act=pal][data-t="23"]')   # タップ：これまでどおり（ツモも入れるなら、まずツモ牌）
        s1 = await st(); r = s1['seats'][1]['river']; pdraw = s1['ui']['pendingDraw']
        left = await pg.evaluate(f"() => [!!{sr}.querySelector('.dropzones'), !!{sr}.querySelector('.dragghost')]")
        ok1 = (fixed == 'fixed' and 'on-right' in z1 and 'on-left' in z2 and g1 and left == [False, False]
               and [(x['tile'], x.get('tsumogiri')) for x in r] == [(41, True), (15, False)] and pdraw == {'seat': 1, 'tile': 23}
               and r[0].get('draw') == 41 and 'draw' not in r[1] and 'ツモ切り' in f1 and '手出し' in f2)
        # 2. 盤の外で離すと何もしない
        await pg.click('[data-act=canceldraw]') if await pg.locator('[data-act=canceldraw]').count() else None
        await drag(pg, 42, 'right', release=False); await pg.mouse.move(195, 20); await pg.mouse.up()
        r2 = (await st())['seats'][1]['river']
        ok2 = len(r2) == 2
        # 3. 開始時の手牌がある家：右＝その牌をツモって切る、左＝ツモ牌を選んでから手牌の牌を切る
        await pg.evaluate(f"""() => {{ const s = window.api.getData(); s.setup = {json.dumps(data['setup'])}; s.names = {json.dumps(data['names'])};
          s.seats.forEach((b, i) => {{ b.haipai = {json.dumps(data['haipai'])}[i]; b.river = []; b.melds = []; }}); window.mount(s); }}""")
        dealer = data['setup']['kyoku'] % 4
        await pg.click(f'[data-act=pickseat][data-v="{dealer}"]')
        if not await pg.locator('[data-act=dragmode].on').count(): await pg.click('[data-act=dragmode]')
        await drag(pg, 47, 'right')
        s3 = await st(); r3 = s3['seats'][dealer]['river']
        nxt = (dealer + 1) % 4; h = data['haipai'][nxt][0]
        f4a = (await drag(pg, h, 'left'), await fl())[1]                  # ツモ牌がまだ → 知らせる
        await pg.click('.palette.big [data-act=pal][data-t="11"]')       # ツモ牌をタップで選ぶ
        await drag(pg, h, 'left')
        s4 = await st(); r4 = s4['seats'][nxt]['river']
        ok3 = (r3 == [{'tile': 47, 'tsumogiri': True, 'draw': 47}] and s3['ui']['seat'] == nxt and 'ツモ牌を選んで' in f4a
               and r4 == [{'tile': h, 'tsumogiri': False, 'draw': 11}])
        # 4. 手牌の欄に落とすと、その家の開始時の手牌に入る
        await pg.evaluate("() => { const d = window.api.getData(); d.seats.forEach((b) => { b.haipai = []; b.river = []; b.melds = []; }); window.api.setData(d); }")
        await pg.click('[data-act=pickseat][data-v="1"]')
        if not await pg.locator('[data-act=dragmode].on').count(): await pg.click('[data-act=dragmode]')
        await pg.wait_for_timeout(700)   # 卓が回り終わるまで待つ
        hl = await drag_to(pg, 19, '.hand-zone[data-seat="1"]')
        s5 = await st(); f5 = await fl()
        ok4 = s5['seats'][1]['haipai'] == [19] and s5['seats'][1]['river'] == [] and hl[1] and '手牌（開始時）へ' in (hl[0] or '') and '1/13' in f5
        # 5. 河の上限：鳴きのない局で南家は18枚まで
        await pg.evaluate("() => { const d = window.api.getData(); d.seats[1].haipai = []; d.seats[1].river = Array.from({ length: 18 }, () => ({ tile: 41, tsumogiri: true })); window.api.setData(d); }")
        await pg.click('[data-act=pickseat][data-v="1"]')
        if not await pg.locator('[data-act=dragmode].on').count(): await pg.click('[data-act=dragmode]')
        await drag(pg, 42, 'right'); f6 = await fl()
        n6 = len((await st())['seats'][1]['river'])
        await pg.evaluate("() => { const d = window.api.getData(); d.seats[1].river.push({ tile: 42, tsumogiri: true }); window.api.setData(d); }")
        iss = await pg.evaluate(f"() => {sr}.querySelector('div.issues')?.innerText ?? ''")
        ok5 = n6 == 18 and '枚までしか切れません' in f6 and '19枚あります' in iss
        ok3 = ok3 and ok4 and ok5
        print(json.dumps({'ok4': ok4, 'ok5': ok5, 'f5': f5, 'f6': f6, 'hl': hl}, ensure_ascii=False))
        print(json.dumps({'ok': ok1 and ok2 and ok3 and not errs, 'ok1': ok1, 'ok2': ok2, 'ok3': ok3, 'river1': r, 'r3': r3, 'r4': r4, 'f4a': f4a, 'errors': errs}, ensure_ascii=False))
        await b.close()
asyncio.run(main())
