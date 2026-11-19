# 河の牌を別の巡目へ動かす／入れ替える。鳴かれた牌を動かすと副露の位置も付いていき、
# 鳴いた直後の打牌の位置に来た牌はツモを外して手出しになる（データは実際に入力された局：e2e/hori.json）
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
        st = lambda: pg.evaluate(f'{H}.state()')
        fl = lambda: pg.evaluate(f"() => {sr}.querySelector('.flash')?.innerText ?? ''")
        tap = lambda s, i: pg.dispatch_event(f'[data-act=river][data-seat="{s}"][data-idx="{i}"]', 'click')
        # 1. ほりの14打目（四索）を、八筒ポンの後の6打目の位置へ動かす
        await pg.click('[data-act=pickseat][data-v="2"]'); await tap(2, 13)
        await pg.click('[data-act=rmove][data-v="move"]'); await tap(2, 5)
        s1 = await st(); f1 = await fl(); r = s1['seats'][2]['river']
        ok1 = (r[5]['tile'] == 34 and 'draw' not in r[5] and r[5]['tsumogiri'] is False and r[6]['tile'] == 13 and len(r) == 14
               and '6打目へ動かしました' in f1 and 'ツモを外して手出し' in f1)
        # 2. 戻して、あさくらの5打目（ほりがポンした八筒）を1打目と入れ替える → ポンの位置も1打目に
        await pg.click('[data-act=undo]') if await pg.locator('[data-act=undo]').count() else None
        s1b = await st(); undone = s1b['seats'][2]['river'] == d['seats'][2]['river']
        await tap(1, 4); await pg.click('[data-act=rmove][data-v="swap"]'); await tap(1, 0)
        s2 = await st(); r1 = s2['seats'][1]['river']; pon = [m for m in s2['seats'][2]['melds'] if m['kind'] == 'pon'][0]
        ok2 = undone and r1[0]['tile'] == 28 and r1[0].get('calledBy') == 2 and r1[4]['tile'] == 39 and 'calledBy' not in r1[4] and pon['riverIndex'] == 0
        # 3. 別の家の河をタップすると知らせる
        await tap(1, 2); await pg.click('[data-act=rmove][data-v="move"]'); await tap(0, 1)
        f3 = await fl(); ok3 = 'あさくらの河の牌をタップ' in f3
        print(json.dumps({'ok': ok1 and ok2 and ok3 and not errs, 'ok1': ok1, 'ok2': ok2, 'ok3': ok3, 'flash1': f1, 'flash3': f3, 'errors': errs}, ensure_ascii=False))
        await b.close()
asyncio.run(main())
