// 極雀（gokujan.com）の解析結果を中継する。ブラウザから直接は読めないため
// GET /api/gokujan?id=<解析のid>（https://gokujan.com/review/<id> の id）
//   → /api/v2/tasks/<id>/result で中身の場所（jsonUrl）を聞き、その中身（牌譜と解析）を返す
const ID = /^[0-9a-f]{8,40}$/i;
const BASE = 'https://gokujan.com';
const HEADERS = { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (mahjong-study)' };

export async function GET(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get('id') ?? '';
  if (!ID.test(id)) return json({ error: '解析のidの形が正しくありません（https://gokujan.com/review/… のURLを貼ってください）' }, 400);
  try {
    const r = await fetch(`${BASE}/api/v2/tasks/${id}/result`, { headers: HEADERS });
    if (r.status === 401 || r.status === 403) return json({ error: 'この解析結果は公開されていません（極雀にログインしないと見られない設定です）' }, 403);
    if (r.status === 404 || r.status === 410) return json({ error: '解析結果が見つかりません（解析中か、URLが違うか、期限切れです）' }, 404);
    if (!r.ok) return json({ error: `極雀がエラーを返しました（${r.status}）` }, 502);
    const meta = (await r.json()) as { success?: boolean; data?: { jsonUrl?: string | null; modelName?: string | null; nplayer?: number } };
    const url = meta.data?.jsonUrl;
    if (!url || !url.startsWith('/api/v2/tasks/')) return json({ error: 'まだ解析が終わっていないか、中身の場所が分かりませんでした' }, 404);
    const d = await fetch(`${BASE}${url}`, { headers: HEADERS });
    if (!d.ok) return json({ error: `解析の中身を読めませんでした（${d.status}）` }, 502);
    const data = (await d.json()) as Record<string, unknown>;
    // 使うところだけ返す
    const keep = ['engine', 'player_id', 'nplayer', 'mjai_log', 'split_logs', 'review', 'game_length'];
    const slim = Object.fromEntries(keep.filter((k) => k in data).map((k) => [k, data[k]]));
    return new Response(JSON.stringify({ modelName: meta.data?.modelName ?? null, data: slim }), {
      status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=600, s-maxage=3600' },
    });
  } catch {
    return json({ error: '極雀に接続できませんでした' }, 502);
  }
}

function json(v: unknown, status: number): Response {
  return new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}
