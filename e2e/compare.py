import json, re, sys, urllib.parse
fx = open('test/fixtures.ts').read()
urls = dict(re.findall(r"export const (\w+)_URL\s*=\s*\n?\s*'([^']+)'", fx))
names = {'sample': 'SAMPLE', 'kan': 'KAN', 'rinshan': 'RINSHAN', 'chankan': 'CHANKAN'}
dec = lambda u: json.loads(urllib.parse.unquote(u.split('#json=')[1].split('&')[0]))
res = json.load(open(sys.argv[1]))
for k, v in res.items():
    if not v.get('url'): print(k, 'NO URL', {kk: vv for kk, vv in v.items() if kk != 'url'}); continue
    a, b = dec(v['url']), dec(urls[names[k]])
    print(k, 'log一致' if a['log'] == b['log'] else 'log不一致', 'switches', v['manual_seat_switches'])
