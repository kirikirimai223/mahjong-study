# Supabase の REST をブラウザ内で偽装する（テスト用の共通部品）
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
        elif op == 'in': vals = [x.strip('"') for x in val.strip('()').split(',')]; rows = [r for r in rows if str(r.get(k)) in vals]
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

async def open_app(p):
    """偽装した Supabase とログイン済みの状態でアプリを開く"""
    b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width': 390, 'height': 844})
    await ctx.route(BASE + '/**', handle)
    pg = await ctx.new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    await pg.goto('http://localhost:5173/')
    exp = int(time.time()) + 3600
    sess = {'access_token': 'x.y.z', 'refresh_token': 'r', 'expires_at': exp, 'expires_in': 3600, 'token_type': 'bearer',
            'user': {'id': ME, 'email': 'me@example.com', 'aud': 'authenticated', 'role': 'authenticated'}}
    await pg.evaluate(f"localStorage.setItem('sb-iropkghvywccleympqnv-auth-token', {json.dumps(json.dumps(sess))})")
    await pg.reload(); await pg.wait_for_selector('h2:has-text("勉強会")')
    return b, ctx, pg, errs
