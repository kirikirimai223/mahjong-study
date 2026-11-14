# 鳴いた直後の打牌まわり：印、ツモが入っているエラーの直し方、ツモ切りボタン、局の開始時の手牌の表示
import asyncio, json
from playwright.async_api import async_playwright
H = 'document.getElementById("host").__paifuEditor'
SR = "document.getElementById('host').shadowRoot"
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width': 390, 'height': 844})
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://localhost:5173/dev/editor.html'); await pg.wait_for_function('window.api')
        await pg.select_option('[data-act=samplesel]', '0'); await pg.wait_for_timeout(100)
        st = lambda: pg.evaluate(f'{H}.state()')
        issues = lambda: pg.evaluate(f"() => {SR}.querySelector('div.issues')?.innerText ?? ''")
        flash = lambda: pg.evaluate(f"() => {SR}.querySelector('.flash')?.innerText ?? ''")
        res = {}
        # 1. 鳴いた直後の打牌に印（チー・ポンの数だけ）
        s0 = await st()
        calls = sum(1 for b_ in s0['seats'] for m in b_['melds'] if m['kind'] in ('chi', 'pon'))
        marks = await pg.evaluate(f"() => {SR}.querySelectorAll('[data-act=river].aftercall').length")
        res['marks'] = (marks, calls)
        # 鳴いた直後の打牌の位置（印の付いた牌）
        pos = await pg.evaluate(f"() => [...{SR}.querySelectorAll('[data-act=river].aftercall')].map(e => [Number(e.dataset.seat), Number(e.dataset.idx)])")
        seat, idx = pos[0]
        base = json.dumps(s0['seats'])
        # 2. 鳴いたのに普通の手番（ツモと打牌）を入れてしまった → 「この手番を消す」
        await pg.evaluate(f"() => {{ const d = window.api.getData(); d.seats[{seat}].river.splice({idx}, 0, {{ tile: 47, draw: 47, tsumogiri: true }}); window.mount(d); }}")
        i1 = await issues()
        await pg.click('[data-act=fix2]:has-text("この手番を消す")'); await pg.wait_for_timeout(100)
        s1 = await st(); i2 = await issues()
        res['dropturn'] = ('鳴いた直後なのでツモはない' in i1 and json.dumps(s1['seats']) == base and '矛盾はありません' in i2, i1[:80])
        # 3. 鳴いた後に切った牌にツモを入れてしまった → 「ツモだけ外す」
        await pg.evaluate(f"() => {{ const d = window.api.getData(); d.seats[{seat}].river[{idx}].draw = 47; window.mount(d); }}")
        await pg.click('[data-act=fix2]:has-text("ツモだけ外す")'); await pg.wait_for_timeout(100)
        s2 = await st(); r = s2['seats'][seat]['river'][idx]
        res['dropdraw'] = ('draw' not in r and '矛盾はありません' in await issues(), r)
        # 4. 河の枚数の参考（鳴きの位置から数えた枚数）
        await pg.click('[data-act=pickseat][data-v="1"]'); await pg.wait_for_timeout(500)
        await pg.dispatch_event('[data-act=river][data-seat="1"][data-idx="3"]', 'click'); await pg.dispatch_event('[data-act=river][data-seat="1"][data-idx="3"]', 'click')
        res['hint'] = '参考：鳴き' in await issues()
        # 5. ツモ切りボタン：配牌から入力して、ツモ牌を選んで「ツモ切り」
        await pg.evaluate("() => { const d = window.api.getData(); d.seats.forEach(s => { s.river = []; s.melds = []; }); d.result = { ...d.result, kind: 'none' }; window.mount(d); }")
        dealer = (await st())['setup']['kyoku'] % 4
        await pg.click(f'[data-act=pickseat][data-v="{dealer}"]'); await pg.wait_for_timeout(500)
        await pg.click('[data-act=pal][data-t="47"]')
        # 手牌の隙間をタップしても手牌の編集に切り替わらない
        await pg.dispatch_event(f'[data-act=zone][data-zone=hand][data-seat="{dealer}"]', 'click') if await pg.query_selector(f'[data-act=zone][data-zone=hand][data-seat="{dealer}"]') else None
        mode_after_gap = (await st())['ui']['mode']
        await pg.click('[data-act=tsumokiri]'); await pg.wait_for_timeout(100)
        s3 = await st(); rr = s3['seats'][dealer]['river']
        res['tsumokiri'] = (rr == [{'tile': 47, 'tsumogiri': True, 'draw': 47}] or (len(rr) == 1 and rr[0]['tile'] == 47 and rr[0].get('draw') == 47), mode_after_gap)
        # 6. 局の開始時の手牌の編集では副露を並べない
        await pg.select_option('[data-act=samplesel]', '0'); await pg.wait_for_timeout(100)
        s4 = await st(); cs = next(i for i, b_ in enumerate(s4['seats']) if b_['melds'])
        await pg.click(f'[data-act=pickseat][data-v="{cs}"]'); await pg.click('[data-act=mode][data-v=hand]'); await pg.wait_for_timeout(600)
        res['haipai_view'] = await pg.evaluate(f"() => {SR}.querySelector('.meldnote')?.innerText ?? ''")
        ok = (res['marks'][0] == res['marks'][1] and res['dropturn'][0] and res['dropdraw'][0] and res['hint']
              and res['tsumokiri'][0] and res['tsumokiri'][1] == 'river' and '副露は表示しません' in res['haipai_view'])
        print(json.dumps({'ok': ok, **res, 'errors': errs}, ensure_ascii=False))
        await b.close()
asyncio.run(main())
