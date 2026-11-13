import asyncio, json, sys
from playwright.async_api import async_playwright
KEY = 'paifu-editor'
data = json.load(open('e2e/acts.json'))
async def play(pg, name):
    d = data[name]
    await pg.goto('http://localhost:5173/dev/editor.html')
    await pg.wait_for_function('window.api')
    # 局の設定と配牌だけ流し込む（配牌の入力画面は確認済み）。以降はすべて画面操作
    setup = json.dumps(d['setup']); names = json.dumps(d['names']); haipai = json.dumps(d['haipai'])
    await pg.evaluate(f"""() => {{ const s = window.api.getData();
      s.setup = {setup}; s.names = {names}; s.seats.forEach((b, i) => {{ b.haipai = {haipai}[i]; }});
      window.mount(s); }}""")
    await pg.click(f'[data-act=pickseat][data-v="{d["setup"]["kyoku"] % 4}"]')
    st = lambda: pg.evaluate('document.getElementById("host").__paifuEditor.state()')
    opts = lambda: pg.evaluate('document.getElementById("host").__paifuEditor.options()')
    manual_switch = 0
    prev_cut = None
    meld_cut = False
    acts = d['acts']; res = d['result']
    for i, a in enumerate(acts):
        s = await st()
        if a['type'] in ('draw', 'cut', 'kan') and s['ui']['seat'] != a['seat']:
            manual_switch += 1
            await pg.click(f'[data-act=pickseat][data-v="{a["seat"]}"]')
        if a['type'] == 'draw':
            await pg.click(f'[data-act=pal][data-t="{a["tile"]}"]')
            last = i == len(acts) - 1
            if last and res[0] == '和了' and res[2][0] == res[2][1] == a['seat']:
                await pg.click('[data-act=tsumoagari]')
        elif a['type'] == 'cut' and meld_cut:
            meld_cut = False
            sel = f'[data-act=meldcut][data-seat="{a["seat"]}"][data-t="{a["tile"]}"]'
            if await pg.query_selector(sel) is None: return {'error': f'meldcut target missing at {i}: {a}'}
            # 鳴いて切る前の手牌枚数（副露の分を除いた手牌＋切る1枚）
            await pg.dispatch_event(sel, 'click')
            s3 = await st()
            prev_cut = {'seat': a['seat'], 'idx': len(s3['seats'][a['seat']]['river']) - 1}
        elif a['type'] == 'cut':
            if a['riichi']:
                await pg.click('[data-act=riichinext]')
                if not await pg.eval_on_selector('[data-act=riichinext]', 'e => e.classList.contains("on")'):
                    return {'error': f'riichi button did not update at {i}'}
            sel = '[data-act=cut][data-drawn="1"]' if a['tsumogiri'] else f'[data-act=cut][data-seat="{a["seat"]}"][data-t="{a["tile"]}"]:not([data-drawn])'
            if not a['tsumogiri'] and await pg.query_selector(sel) is None:
                sel = f'[data-act=cut][data-seat="{a["seat"]}"][data-t="{a["tile"]}"]'  # ツモ牌と同じ牌を手出し
            if await pg.query_selector(sel) is None:
                s2 = await st()
                tiles = await pg.eval_on_selector_all(f'[data-act=cut][data-seat="{a["seat"]}"]', 'es => es.map(e => e.dataset.t + (e.dataset.drawn ? "*" : ""))')
                return {'error': f'cut target missing at {i}: {a}', 'prev': acts[max(0,i-3):i], 'ui_seat': s2['ui']['seat'], 'pending': s2['ui']['pendingDraw'], 'shown': tiles,
                        'river': [r['tile'] for r in s2['seats'][a['seat']]['river']]}
            await pg.dispatch_event(sel, 'click')
            s3 = await st()
            prev_cut = {'seat': a['seat'], 'idx': len(s3['seats'][a['seat']]['river']) - 1}
        elif a['type'] == 'call':
            # 「副露」→ 相手の河の牌 → 自分の手牌の牌 → 確定
            await pg.click('[data-act=mode][data-v="meld"]')
            s2 = await st()
            if s2['ui']['seat'] != a['seat']:
                await pg.dispatch_event(f'[data-act=cut][data-seat="{a["seat"]}"]', 'click')
            frm = prev_cut['seat']; idx = prev_cut['idx']
            await pg.dispatch_event(f'[data-act=river][data-seat="{frm}"][data-idx="{idx}"]', 'click')
            used = []
            for t in a['own']:
                keys = await pg.eval_on_selector_all(f'[data-act=mpick][data-seat="{a["seat"]}"][data-t="{t}"]', 'es => es.map(e => e.dataset.key)')
                k = next((k for k in keys if k not in used), None)
                if k is None: return {'error': f'call tile {t} not in hand at {i}: {a}'}
                used.append(k)
                await pg.dispatch_event(f'[data-act=mpick][data-seat="{a["seat"]}"][data-key="{k}"]', 'click')
            o = await opts()
            idx2 = next((k for k, x in enumerate(o) if x.get('seat') == a['seat'] and x['kind'] == a['kind'] and sorted(x.get('own', [])) == sorted(a['own'])), None)
            if idx2 is None: return {'error': f'meld confirm not found at {i}: {a}', 'opts': o}
            await pg.click(f'[data-act=meldconfirm][data-v="{idx2}"]')
            if a['kind'] != 'daiminkan':
                meld_cut = True
        elif a['type'] == 'kan':
            await pg.click('[data-act=mode][data-v="meld"]')
            want = a['tiles'] if a['kind'] == 'ankan' else [a['added']]
            used = []
            for t in want:
                keys = await pg.eval_on_selector_all(f'[data-act=mpick][data-seat="{a["seat"]}"][data-t="{t}"]', 'es => es.map(e => e.dataset.key)')
                k = next((k for k in keys if k not in used), None)
                if k is None: return {'error': f'kan tile {t} not in hand at {i}: {a}'}
                used.append(k)
                await pg.dispatch_event(f'[data-act=mpick][data-seat="{a["seat"]}"][data-key="{k}"]', 'click')
            o = await opts()
            idx2 = next((k for k, x in enumerate(o) if x['kind'] == a['kind']), None)
            if idx2 is None: return {'error': f'kan confirm not found at {i}: {a}', 'opts': o}
            await pg.click(f'[data-act=kan][data-v="{idx2}"]')
        # 毎手順のあと、全員の手牌枚数が合っているか（開始時13枚＋ツモ−捨て牌−副露・槓に使った牌）
        s4 = await st()
        if not s4['ui'].get('meldPending'):
            for seat, b in enumerate(s4['seats']):
                n = 13 + sum(1 for r in b['river'] if 'draw' in r) - len(b['river'])
                for m in b['melds']:
                    if m['kind'] in ('ankan',): n += (1 if 'draw' in m else 0) - 4
                    elif m['kind'] == 'kakan': n += (1 if 'draw' in m else 0) - 1
                    else: n -= len(m['own'])
                expect = 13 - 3 * sum(1 for m in b['melds'] if m['kind'] != 'kakan')
                if n != expect: return {'error': f'hand count mismatch after {i} {a}: seat {seat} has {n}, expected {expect}'}
        flash = await pg.query_selector('.flash')
    # 結果：ロンは最後の打牌への「ロン」ボタン（槍槓は加槓の後なので結果画面で直接）
    if res[0] == '和了' and res[2][0] != res[2][1]:
        o = await opts()
        idx = next((k for k, x in enumerate(o) if x['kind'] == 'ron' and x['seat'] == res[2][0]), None)
        if idx is not None:
            await pg.click(f'[data-act=call][data-v="{idx}"]')
        else:
            await pg.evaluate(f"""() => {{ const s = window.api.getData(); Object.assign(s.result, {{ kind: 'agari', winner: {res[2][0]}, from: {res[2][1]} }}); window.mount(s); }}""")
    # 点数・役の文字（画面の入力欄にあたる部分）
    await pg.evaluate(f"""() => {{ const s = window.api.getData(); const r = {json.dumps(res)};
      s.result.deltas = r[1]; if (r[0] === '和了') {{ s.result.points = r[2][3]; s.result.yaku = r[2].slice(4).join('\\n'); }}
      window.mount(s); }}""")
    issues = await pg.eval_on_selector('.issues', 'e => e.textContent.trim()')
    if await pg.eval_on_selector('[data-act=build]', 'e => e.disabled'):
        s2 = await st()
        return {'manual_seat_switches': manual_switch, 'issues': issues, 'result': s2['result'], 'hands': [b['hand'] for b in s2['seats']]}
    await pg.click('[data-act=build]')
    url = await pg.eval_on_selector('textarea.url', 'e => e.value') if await pg.query_selector('textarea.url') else None
    out = await pg.eval_on_selector('#output', 'e => e.textContent.trim()') if url is None else None
    return {'manual_seat_switches': manual_switch, 'issues': issues, 'url': url, 'out': out}

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={'width':390,'height':844})
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        res = {}
        for n in sys.argv[1:]:
            res[n] = await play(pg, n)
        json.dump(res, open('e2e/replay-result.json','w'), ensure_ascii=False)
        print(json.dumps({'errors': errs, **{k: {kk: (vv[:40] if isinstance(vv, str) and vv.startswith('http') else vv) for kk, vv in v.items()} for k, v in res.items()}}, ensure_ascii=False, indent=1)[:3000])
        await b.close()
asyncio.run(main())
