# アプリ全体を、Supabase の REST をブラウザ内で偽装して動かす（このサンドボックスからは Supabase に届かないため）
import asyncio, json, re, uuid, time, urllib.parse
from playwright.async_api import async_playwright
BASE = 'https://iropkghvywccleympqnv.supabase.co'
ME = '11111111-1111-1111-1111-111111111111'
db = {k: [] for k in ['study_members','study_invites','study_sessions','study_games','study_rounds','study_positions','study_comments','study_ai_reviews']}
db['study_members'].append({'id': ME, 'display_name': 'いいだ', 'is_admin': True, 'created_at': '2026-11-13T00:00:00Z'})
calls = []
def now(): return time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime()) + str(time.time_ns())[-6:]
def filt(rows, params):
    for k, v in params.items():
        if k in ('select', 'order', 'limit', 'columns'): continue
        op, _, val = v.partition('.')
        if op == 'eq': rows = [r for r in rows if str(r.get(k)) == val]
        elif op == 'in': vals = val.strip('()').split(','); rows = [r for r in rows if str(r.get(k)) in vals]
    if 'order' in params:
        for part in reversed(params['order'].split(',')):
            col, *rest = part.split('.')
            rows = sorted(rows, key=lambda r: (r.get(col) is None, str(r.get(col))), reverse='desc' in rest)
    return rows
def pick(rows, sel):
    if not sel or sel == '*': return rows
    cols = [c.strip() for c in sel.split(',')]
    return [{c: r.get(c) for c in cols} for r in rows]
async def handle(route):
    req = route.request
    u = urllib.parse.urlparse(req.url)
    params = dict(urllib.parse.parse_qsl(u.query))
    path = u.path
    calls.append((req.method, path, params))
    single = 'vnd.pgrst.object' in (req.headers.get('accept') or '')
    def reply(body, status=200):
        if single:
            body = body[0] if body else None
            if body is None: return route.fulfill(status=406, json={'message': 'no rows', 'code': 'PGRST116'})
        return route.fulfill(status=status, json=body)
    if path == '/rest/v1/rpc/study_join': return await route.fulfill(json=db['study_members'][0])
    m = re.match(r'/rest/v1/(study_\w+)$', path)
    if not m: return await route.fulfill(status=404, json={'message': 'mock: unknown ' + path})
    t = db[m.group(1)]
    if req.method == 'GET': return await reply(pick(filt(t, params), params.get('select')))
    if req.method == 'POST':
        body = json.loads(req.post_data); body = body if isinstance(body, list) else [body]
        out = []
        for r in body:
            r = {'id': str(uuid.uuid4()), 'created_at': now(), 'updated_at': now(), **r}
            if m.group(1) == 'study_rounds': r.setdefault('tenhou_json', None); r.setdefault('randomized_seats', [])
            if m.group(1) == 'study_sessions': r.setdefault('participants', []); r.setdefault('note', '')
            t.append(r); out.append(r)
        return await reply(pick(out, params.get('select')), 201)
    if req.method == 'PATCH':
        body = json.loads(req.post_data); rows = filt(t, params)
        for r in rows: r.update(body); r['updated_at'] = now()
        return await reply(pick(rows, params.get('select')))
    if req.method == 'DELETE':
        rows = filt(t, params)
        for r in rows: t.remove(r)
        return await reply([])
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width':390,'height':844})
        await ctx.route(BASE + '/**', handle)
        pg = await ctx.new_page()
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://localhost:5173/')
        exp = int(time.time()) + 3600
        sess = {'access_token': 'x.y.z', 'refresh_token': 'r', 'expires_at': exp, 'expires_in': 3600, 'token_type': 'bearer',
                'user': {'id': ME, 'email': 'me@example.com', 'aud': 'authenticated', 'role': 'authenticated'}}
        await pg.evaluate(f"localStorage.setItem('sb-iropkghvywccleympqnv-auth-token', {json.dumps(json.dumps(sess))})")
        await pg.reload(); await pg.wait_for_selector('text=勉強会')
        # 勉強会を作る
        await pg.click('button:has-text("新しい勉強会")'); await pg.fill('input[placeholder="例：押し引き"]', '押し引き'); await pg.fill('input[placeholder="例：いいだ、たなか"]', 'Aさん、Bさん、Cさん、私')
        await pg.click('button:has-text("作成")'); await pg.wait_for_selector('text=押し引き')
        await pg.click('.link-card'); await pg.wait_for_selector('text=新しい半荘')
        await pg.click('button:has-text("新しい半荘")'); await pg.click('button:has-text("作って東一局を入力")')
        await pg.wait_for_url('**/rounds/*'); await pg.wait_for_function('document.querySelector("div[ref], .round-page > div:last-child")?.__paifuEditor', timeout=5000)
        host = '.round-page > div:last-child'
        print('editor names', await pg.evaluate(f'document.querySelector("{host}").__paifuEditor.state().names'))
        # サンプル（槍槓・東一局）を入れて自動保存を待つ
        await pg.select_option('[data-act=samplesel]', '3'); await pg.wait_for_timeout(300)
        print('status dirty:', await pg.inner_text('.roundbar .status'))
        await pg.wait_for_timeout(3200)
        print('status after autosave:', await pg.inner_text('.roundbar .status'))
        r = db['study_rounds'][0]; print('saved row', r['label'], r['summary'], 'json', r['tenhou_json'] is not None)
        await pg.click('.roundbar button:has-text("保存")'); await pg.wait_for_timeout(600)
        r = db['study_rounds'][0]; print('after 保存 json', r['tenhou_json'] is not None, r['randomized_seats'])
        await pg.click('text=次の局へ'); await pg.wait_for_timeout(1200)
        print('rounds', [(x['label'], x['summary']) for x in db['study_rounds']], pg.url[-12:])
        print('next status', await pg.inner_text('.roundbar .status'))
        await pg.screenshot(path='/tmp/app_round.png')
        await pg.click('text=← 戻る'); await pg.wait_for_selector('text=半荘をまとめて出力')
        print('detail:', (await pg.inner_text('.game'))[:300])
        await pg.click('text=半荘をまとめて出力'); await pg.wait_for_timeout(200)
        print('out:', await pg.inner_text('.out'))
        await pg.screenshot(path='/tmp/app_detail.png', full_page=True)
        # 試作の書き出しファイルを取り込む
        d = await pg.evaluate('''async () => { const ed = document.querySelector(".round-page") ; return null; }''')
        p2 = await ctx.new_page(); await p2.goto('http://localhost:5173/dev/editor.html'); await p2.wait_for_function('window.api')
        await p2.select_option('[data-act=samplesel]', '1'); ed1 = await p2.evaluate('window.api.getData()')
        await p2.select_option('[data-act=samplesel]', '2'); ed2 = await p2.evaluate('window.api.getData()')
        recs = {'kind': 'paifu-records', 'version': 1, 'records': [
          {'type': 'game', 'id': 'g1', 'name': '11/10 半荘1', 'createdAt': 1},
          {'type': 'round', 'id': 'r1', 'gameId': 'g1', 'kyoku': 4, 'honba': 0, 'label': '南一局', 'summary': 'x', 'editor': ed1, 'json': {'title': ['', ''], 'name': ed1['names'], 'rule': ed1['rule'], 'log': [[1]]}, 'createdAt': 2},
          {'type': 'round', 'id': 'r2', 'gameId': None, 'kyoku': 5, 'honba': 0, 'label': '南二局', 'summary': 'y', 'editor': ed2, 'json': None, 'createdAt': 3}]}
        open('/tmp/recs.json', 'w').write(json.dumps(recs, ensure_ascii=False))
        await pg.click('summary:has-text("試作の記録を取り込む")')
        await pg.set_input_files('details.import input[type=file]', '/tmp/recs.json'); await pg.wait_for_timeout(800)
        print('toast', await pg.inner_text('.toast') if await pg.query_selector('.toast') else None)
        print('games', [g['name'] for g in db['study_games']], 'rounds', len(db['study_rounds']))
        await pg.set_input_files('details.import input[type=file]', 'e2e/acts.json.bad'); await pg.wait_for_timeout(500)
        print('bad file toast', await pg.inner_text('.toast') if await pg.query_selector('.toast') else None)
        await pg.screenshot(path='/tmp/app_detail.png', full_page=True)
        print('errs', errs); await b.close()
asyncio.run(main())
