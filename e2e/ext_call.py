# 鳴かれて河から消えた牌を鳴く／鳴いた後に切った牌を自分の河から指定する
# 指定した打牌が鳴いた後の打牌になるように、鳴かれた牌を相手の河の正しい位置へ動かす
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
        sr = "document.getElementById('host').shadowRoot"
        q = lambda sel: pg.evaluate(f"() => {sr}.querySelector('{sel}')?.innerText ?? ''")
        dealer = data['setup']['kyoku'] % 4
        draws = {s: [x['tile'] for x in data['acts'] if x['seat'] == s and x['type'] == 'draw'] for s in range(4)}
        await pg.click(f'[data-act=pickseat][data-v="{dealer}"]')
        for k in range(12):
            s = (dealer + k) % 4
            await pg.click(f'[data-act=pal][data-t="{draws[s][k // 4]}"]'); await pg.dispatch_event('[data-act=cut][data-drawn="1"]', 'click')
        caller, frm = (dealer + 1) % 4, (dealer + 2) % 4
        before = (await st())['seats'][frm]['river']
        await pg.click(f'[data-act=pickseat][data-v="{caller}"]')
        await pg.click('[data-act=mode][data-v="meld"]')
        await pg.click(f'[data-act=extfrom][data-v="{frm}"]')
        await pg.click('[data-act=pal][data-t="41"]')            # 河にない東を鳴いた
        s1 = await st()
        keys = await pg.evaluate(f"() => [...{sr}.querySelectorAll('[data-act=mpick][data-seat=\"{caller}\"][data-t=\"41\"]')].map(e => e.dataset.key)")
        for k in keys[:2]: await pg.dispatch_event(f'[data-act=mpick][data-seat="{caller}"][data-key="{k}"]', 'click')
        await pg.dispatch_event(f'[data-act=river][data-seat="{caller}"][data-idx="1"]', 'click')  # 鳴いた後に切ったのは2打目
        note = await q('.aftercallnote')
        marked = await pg.evaluate(f"() => [...{sr}.querySelectorAll('.tile.nextaftercall')].map(e => [e.dataset.seat, e.dataset.idx])")
        o = await pg.evaluate(f'{H}.options()'); idx = next(k for k, x in enumerate(o) if x.get('kind') == 'pon')
        await pg.click(f'[data-act=meldconfirm][data-v="{idx}"]')
        fl = await q('.flash'); s2 = await st()
        fr = s2['seats'][frm]['river']; cr = s2['seats'][caller]['river']; m = s2['seats'][caller]['melds']
        after = await pg.evaluate(f"() => [...{sr}.querySelectorAll('.tile.aftercall')].map(e => [e.dataset.seat, e.dataset.idx])")
        ok = (s1['ui']['meldTarget'] == {'from': frm, 'idx': 3} and '2打目' in note and '1打目に移します' in note and marked == [[str(caller), '1']]
              and fr[0]['tile'] == 41 and fr[0].get('calledBy') == caller and fr[1:] == before
              and m[0]['riverIndex'] == 0 and m[0]['kind'] == 'pon' and 'draw' not in cr[1] and cr[1]['tsumogiri'] is False
              and [str(caller), '1'] in after and '1打目に移しました' in fl)
        # 入れ済みの鳴きを選び直す：使う牌はそのまま「このポンのまま確定」。鳴いた後の打牌が同じなら知らせるだけ
        await pg.click('[data-act=mode][data-v="meld"]')
        await pg.dispatch_event(f'[data-act=river][data-seat="{frm}"][data-idx="0"]', 'click')
        keep = await pg.evaluate(f"() => [...{sr}.querySelectorAll('[data-act=meldconfirm]')].map(e => e.innerText)")
        await pg.dispatch_event('[data-act=meldconfirm]', 'click')
        fl2 = await q('.flash'); s3 = await st()
        ok = ok and keep == ['このポンのまま確定'] and '今と同じ' in fl2 and s3['seats'] == s2['seats']
        # 鳴いた後の打牌を3打目に直す → 鳴かれた牌が相手の河の2打目へ動き、前の2打目はツモが必要と知らせる
        await pg.dispatch_event(f'[data-act=river][data-seat="{caller}"][data-idx="2"]', 'click')
        await pg.dispatch_event('[data-act=meldconfirm]', 'click')
        fl3 = await q('.flash'); s4 = await st()
        fr4 = s4['seats'][frm]['river']; m4 = s4['seats'][caller]['melds']
        ok = ok and fr4[1]['tile'] == 41 and fr4[1].get('calledBy') == caller and m4[0]['riverIndex'] == 1 and len(m4) == 1 \
            and '3打目' in fl3 and '2打目に移しました' in fl3 and '2打目はツモが必要' in fl3 and 'draw' not in s4['seats'][caller]['river'][2]
        print(json.dumps({'ok': ok and not errs, 'flash3': fl3, 'keep': keep, 'flash2': fl2, 'note': note, 'marked': marked, 'flash': fl, 'after': after, 'from_river': fr, 'caller_river': cr, 'errors': errs}, ensure_ascii=False))
        await b.close()
asyncio.run(main())
