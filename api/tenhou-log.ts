// 天鳳の対局の牌譜（天鳳牌譜エディタと同じJSON）を中継する。ブラウザから tenhou.net を直接は読めないため
// GET /api/tenhou-log?log=2026010112gm-0029-0000-abcd1234
const LOG = /^\d{10}gm-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{8}$/;

export async function GET(request: Request): Promise<Response> {
  const log = new URL(request.url).searchParams.get('log') ?? '';
  if (!LOG.test(log)) return json({ error: '天鳳の牌譜ID（2026…gm-…）の形が正しくありません' }, 400);
  let res: Response;
  try {
    res = await fetch(`https://tenhou.net/5/mjlog2json.cgi?${log}`, { headers: { referer: `https://tenhou.net/6/?log=${log}`, accept: 'application/json' } });
  } catch {
    return json({ error: '天鳳に接続できませんでした' }, 502);
  }
  const body = await res.text();
  if (!res.ok || !body.trim().startsWith('{')) return json({ error: `天鳳から牌譜を読めませんでした（${res.status}）` }, 502);
  return new Response(body, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=86400' } });
}

function json(v: unknown, status: number): Response {
  return new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}
