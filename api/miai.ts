// Miai（riichi.miai.moe）の解析結果を中継する。ブラウザから直接は読めないため
// GET /api/miai?id=<解析のid>（https://riichi.miai.moe/r/<id> の id）→ /api/reviews/<id> の、使うところだけを返す
const ID = /^[0-9a-z]{8,40}$/i;
const HEADERS = { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (mahjong-study)' };

type Option = { event: unknown; p: number };
type Decision = { at: number; played: number; matched?: boolean; bad?: boolean; options: Option[] };

export async function GET(request: Request): Promise<Response> {
  const asset = new URL(request.url).searchParams.get('asset');
  // 説明ページ（/understand）の中身を調べるため、公開されている画面の部品だけは中継する
  if (asset != null) {
    if (!/^[A-Za-z0-9_-]{1,60}\.js$/.test(asset)) return json({ error: 'bad asset' }, 400);
    const a = await fetch(`https://riichi.miai.moe/assets/${asset}`, { headers: HEADERS });
    return new Response(await a.text(), { status: a.status, headers: { 'content-type': 'text/javascript; charset=utf-8' } });
  }
  const id = new URL(request.url).searchParams.get('id') ?? '';
  if (!ID.test(id)) return json({ error: '解析のidの形が正しくありません（https://riichi.miai.moe/r/… のURLを貼ってください）' }, 400);
  try {
    const r = await fetch(`https://riichi.miai.moe/api/reviews/${id}`, { headers: HEADERS });
    if (r.status === 404) return json({ error: '解析結果が見つかりません（URLが違うか、消えています）' }, 404);
    if (r.status === 401 || r.status === 403) return json({ error: 'この解析結果は公開されていません' }, 403);
    if (!r.ok) return json({ error: `Miaiがエラーを返しました（${r.status}）` }, 502);
    const body = (await r.json()) as { status?: string; review?: Record<string, unknown> };
    const rv = body.review;
    if (!rv || !Array.isArray(rv.events)) return json({ error: 'まだ解析が終わっていません。終わってからもう一度貼ってください' }, 404);
    const decisions = ((rv.decisions ?? []) as Decision[]).map((d) => ({ at: d.at, played: d.played, matched: d.matched, bad: d.bad, options: d.options.map((o) => ({ event: o.event, p: o.p })) }));
    const review = { names: rv.names, seat: rv.seat, mode: rv.mode, events: rv.events, results: rv.results, decisions };
    return new Response(JSON.stringify({ id, review }), {
      status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=600, s-maxage=3600' },
    });
  } catch {
    return json({ error: 'Miaiに接続できませんでした' }, 502);
  }
}

function json(v: unknown, status: number): Response {
  return new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}
