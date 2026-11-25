// NAGAの解析レポート（JSON）を中継する。ブラウザから naga.dmv.nico を直接読めないため（別ドメインの読み込みが許可されていない）
// GET /api/naga-report?id=<report_id>  → https://naga.dmv.nico/reports/<report_id>.json の中身をそのまま返す
const ID = /^[0-9A-Za-z_-]{16,200}$/;

export async function GET(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get('id') ?? '';
  if (!ID.test(id)) return json({ error: 'report_id の形が正しくありません' }, 400);
  let res: Response;
  try {
    res = await fetch(`https://naga.dmv.nico/reports/${id}.json`, { headers: { accept: 'application/json' } });
  } catch {
    return json({ error: 'NAGAに接続できませんでした' }, 502);
  }
  if (res.status === 404) return json({ error: 'レポートが見つかりません（解析中か、IDが違います）' }, 404);
  if (!res.ok) return json({ error: `NAGAがエラーを返しました（${res.status}）` }, 502);
  const body = await res.text();
  // 解析が終わったレポートは変わらないので、しばらくキャッシュしてよい
  return new Response(body, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=3600, s-maxage=86400' } });
}

function json(v: unknown, status: number): Response {
  return new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}
