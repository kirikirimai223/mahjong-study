// 極雀（gokujan.com）の解析結果を中継する。ブラウザから直接は読めないため
// GET /api/gokujan?path=/review/<id> など（gokujan.com の中のパスだけ）
const PATH = /^\/[A-Za-z0-9_\-./?=&%]{1,300}$/;

export async function GET(request: Request): Promise<Response> {
  const path = new URL(request.url).searchParams.get('path') ?? '';
  if (!PATH.test(path) || path.includes('..')) return json({ error: 'パスの形が正しくありません' }, 400);
  let res: Response;
  try {
    res = await fetch(`https://gokujan.com${path}`, { headers: { accept: 'application/json, text/html;q=0.9, */*;q=0.8', 'user-agent': 'Mozilla/5.0 (mahjong-study)' } });
  } catch {
    return json({ error: '極雀に接続できませんでした' }, 502);
  }
  const body = await res.text();
  return new Response(body, { status: res.status, headers: { 'content-type': res.headers.get('content-type') ?? 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
}

function json(v: unknown, status: number): Response {
  return new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}
