// riichi.miai.moe の解析結果を中継する（調査用：パスをそのまま中継）
const PATH = /^\/[A-Za-z0-9_\-./?=&%]{1,300}$/;
export async function GET(request: Request): Promise<Response> {
  const path = new URL(request.url).searchParams.get('path') ?? '';
  if (!PATH.test(path)) return new Response('bad path', { status: 400 });
  const r = await fetch(`https://riichi.miai.moe${path}`, { headers: { 'user-agent': 'Mozilla/5.0 (mahjong-study)', accept: '*/*' } });
  return new Response(await r.text(), { status: r.status, headers: { 'content-type': r.headers.get('content-type') ?? 'text/plain' } });
}
