// NAGAの解析レポート（JSON）から、各打牌の「実際の打牌」と「NAGAの推奨」を取り出す。
// レポートの形：https://naga.dmv.nico/reports/{report_id}.json（pred[局][局面]、局面は Mjai のメッセージ）
// アプリからは /api/naga-report?id=… を通して読む（ブラウザから直接は読めないため）

/** 牌の並び（NAGAの打牌評価の34要素の順）：1m〜9m, 1p〜9p, 1s〜9s, 東南西北白發中 */
const ORDER = [
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `${n}m`),
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `${n}p`),
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `${n}s`),
  'E', 'S', 'W', 'N', 'P', 'F', 'C',
];
const HONOR: Record<string, number> = { E: 41, S: 42, W: 43, N: 44, P: 45, F: 46, C: 47 };

/** Mjai の牌名 → アプリの牌の番号（11〜19 萬子、21〜29 筒子、31〜39 索子、41〜47 字牌、51〜53 赤五） */
export function mjaiTile(p: string): number | null {
  if (HONOR[p]) return HONOR[p];
  const m = /^([1-9])([mps])(r?)$/.exec(p);
  if (!m) return null;
  const suit = { m: 1, p: 2, s: 3 }[m[2] as 'm' | 'p' | 's'];
  return m[3] ? 50 + suit : suit * 10 + Number(m[1]);
}
/** 赤五を普通の五として比べる */
const kindKey = (p: string) => p.replace(/r$/, '');

export type NagaCandidate = { tile: string; p: number };
/** 1打ごとの判断（タイプごとに並ぶ） */
export type NagaDecision = {
  seat: number;
  /** その家の何打目か（0から。振り返りの局面と同じ数え方） */
  discardIndex: number;
  real: string;
  /** タイプごとの推奨打牌（Mjai の牌名） */
  pred: (string | null)[];
  /** タイプごとの、実際に切った牌の評価（0〜1） */
  realP: (number | null)[];
  /** タイプごとの、評価の高い候補（5%以上、最大3つ） */
  top: NagaCandidate[][];
  /** タイプごとの、立直する評価（0〜1。立直できない局面は null） */
  riichi: (number | null)[];
  /** タイプごとの、牌ごとの評価（0.5%以上。赤五は普通の五にまとめる）。前の版で取り込んだものには無い */
  dist?: Record<string, number>[];
  /** 実際に立直したか */
  realRiichi?: boolean;
  /** タイプごとの、槓の判断（skip・ankan・kakan の評価 0〜1）。槓できる局面だけ */
  kan?: (Record<string, number> | null)[];
  /** 実際の槓（しなければ skip） */
  realKan?: string;
};
/** 打牌に対する、ほかの家の鳴きの判断 */
export type NagaCall = {
  /** 鳴ける家 */
  seat: number;
  /** 打牌した家と、その家の何打目か（振り返りの局面と同じ） */
  from: number;
  discardIndex: number;
  tile: string;
  /** タイプごとの評価（skip・chi_low・chi_mid・chi_high・pon・daiminkan の 0〜1） */
  opts: (Record<string, number> | null)[];
  /** 実際にしたこと */
  real: string;
};
export type NagaKyoku = { kyoku: number; honba: number; decisions: NagaDecision[]; calls?: NagaCall[] };

/** 鳴き・槓の判断の名前 */
export const ACTION_NAME: Record<string, string> = { hora: 'ロン', skip: 'スルー', chi_low: 'チー（下）', chi_mid: 'チー（嵌）', chi_high: 'チー（上）', pon: 'ポン', daiminkan: '明槓', ankan: '暗槓', kakan: '加槓' };
const HURO_KEY: Record<string, string> = { 0: 'skip', 1: 'chi_low', 2: 'chi_mid', 3: 'chi_high', 4: 'pon', 5: 'daiminkan' };
const KAN_KEY: Record<string, string> = { 0: 'skip', 1: 'ankan', 2: 'kakan' };
const toOpts = (o: Record<string, number> | null | undefined, names: Record<string, string>) =>
  o ? Object.fromEntries(Object.entries(o).map(([k, v]) => [names[k] ?? k, Math.round((v / 10000) * 1000) / 1000])) : null;
/** いちばん評価の高い選択 */
export const bestOf = (o: Record<string, number> | null | undefined) => (o ? Object.entries(o).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null : null);
export type NagaSummary = { reportId: string; types: string[]; kyokus: NagaKyoku[] };

/** 解析一覧・レポート画面のURLから report_id を取り出す */
export function nagaReportId(url: string): string | null {
  const m = /[?&]report_id=([0-9A-Za-z_-]+)/.exec(url) ?? /\/reports\/([0-9A-Za-z_-]+)\.json/.exec(url);
  return m ? m[1] : null;
}

type Entry = {
  huro?: Record<string, (Record<string, number> | null)[]>;
  kan?: (Record<string, number> | null)[];
  info: { msg: { type: string; actor?: number; target?: number; consumed?: string[]; pai?: string; bakaze?: string; kyoku?: number; honba?: number; real_dahai?: string; pred_dahai?: (string | null)[] } };
  dahai_pred?: (number[] | null)[];
  dahai_detail?: (number[][] | null)[];
  reach?: (number | null)[];
};
type Report = { naga_types: Record<string, string>; pred: Entry[][] };

/** 評価の配列 → 牌ごとの確率（赤五は普通の五にまとめる） */
function distribution(e: Entry, ti: number): Map<string, number> | null {
  const out = new Map<string, number>();
  const plain = e.dahai_pred?.[ti];
  if (plain) {
    plain.forEach((v, i) => { if (v) out.set(ORDER[i], v / 10000); });
    return out;
  }
  const detail = e.dahai_detail?.[ti];
  if (detail) {
    // アナンタ・ウロボロス：[通常の打牌, 立直しての打牌] × 37（34種の後に赤五 5mr・5pr・5sr）
    for (const row of detail) row.forEach((v, i) => {
      if (!v) return;
      const k = i < 34 ? ORDER[i] : ['5m', '5p', '5s'][i - 34];
      out.set(k, (out.get(k) ?? 0) + v / 10000);
    });
    return out;
  }
  return null;
}
function riichiP(e: Entry, ti: number): number | null {
  const r = e.reach?.[ti];
  if (typeof r === 'number') return r / 10000;
  const detail = e.dahai_detail?.[ti];
  if (detail && detail[1]) { const s = detail[1].reduce((a, b) => a + b, 0); return s > 0 ? s / 10000 : null; }
  return null;
}

/** レポート全体から、局ごとの打牌の判断を取り出す */
export function extractNaga(report: Report, reportId: string): NagaSummary {
  const keys = Object.keys(report.naga_types).sort((a, b) => Number(a) - Number(b));
  const types = keys.map((k) => report.naga_types[k]);
  const kyokus: NagaKyoku[] = [];
  for (const entries of report.pred) {
    const start = entries[0]?.info.msg;
    if (!start || start.type !== 'start_kyoku') continue;
    const ba = ['E', 'S', 'W', 'N'].indexOf(start.bakaze ?? 'E');
    const kyoku: NagaKyoku = { kyoku: ba * 4 + ((start.kyoku ?? 1) - 1), honba: start.honba ?? 0, decisions: [], calls: [] };
    const count = [0, 0, 0, 0];
    const pending: (NagaDecision | null)[] = [null, null, null, null];
    // 槓をした局面の判断は、嶺上牌をツモった後の打牌の判断に付けて残す
    const carry: ({ kan: (Record<string, number> | null)[]; realKan: string } | null)[] = [null, null, null, null];
    let calls: NagaCall[] = []; // 直前の打牌に対する鳴きの判断（次の出来事で、したかどうかが決まる）
    const closeCalls = (m: Entry['info']['msg']) => {
      for (const c of calls) {
        if ((m.type === 'chi' || m.type === 'pon' || m.type === 'daiminkan') && m.actor === c.seat) c.real = m.type === 'chi' ? chiKind(m.pai ?? '', m.consumed ?? []) : m.type;
        kyoku.calls!.push(c);
      }
      calls = [];
    };
    for (const e of entries.slice(1)) {
      const m = e.info.msg;
      const actor = m.actor ?? -1;
      if (calls.length && m.type !== 'reach_accepted' && m.type !== 'dora') closeCalls(m);
      if (m.type === 'reach' && pending[actor]) pending[actor]!.realRiichi = true;
      if ((m.type === 'ankan' || m.type === 'kakan') && pending[actor]) {
        carry[actor] = { kan: pending[actor]!.kan ?? [], realKan: m.type };
        pending[actor] = null;
      }
      if ((m.type === 'tsumo' || m.type === 'chi' || m.type === 'pon') && (e.dahai_pred || e.dahai_detail)) {
        const pred = keys.map((_, ti) => m.pred_dahai?.[ti] ?? null);
        const dists = keys.map((_, ti) => distribution(e, ti));
        pending[actor] = {
          seat: actor, discardIndex: count[actor], real: m.real_dahai ?? '', pred,
          realP: [], // 実際の打牌が分かってから埋める
          top: dists.map((d) => (d ? [...d].filter(([, p]) => p >= 0.05).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([tile, p]) => ({ tile, p: Math.round(p * 1000) / 1000 })) : [])),
          riichi: keys.map((_, ti) => riichiP(e, ti)),
          dist: dists.map((d) => Object.fromEntries([...(d ?? new Map())].filter(([, p]) => p >= 0.005).map(([t, p]) => [t, Math.round(p * 1000) / 1000]))),
        };
        // 評価の分布は実際の打牌の評価を出すのにだけ使う
        (pending[actor] as NagaDecision & { _d?: (Map<string, number> | null)[] })._d = dists;
        if (e.kan) { pending[actor]!.kan = e.kan.map((o) => toOpts(o, KAN_KEY)); pending[actor]!.realKan = 'skip'; }
        if (carry[actor]) { pending[actor]!.kan = carry[actor]!.kan; pending[actor]!.realKan = carry[actor]!.realKan; carry[actor] = null; }
      } else if (m.type === 'dahai' && actor >= 0) {
        const d = pending[actor] as (NagaDecision & { _d?: (Map<string, number> | null)[] }) | null;
        if (d) {
          if (!d.real) d.real = m.pai ?? '';
          d.realP = (d._d ?? []).map((dist) => (dist ? Math.round((dist.get(kindKey(d.real)) ?? 0) * 1000) / 1000 : null));
          delete d._d;
          kyoku.decisions.push(d);
        }
        pending[actor] = null;
        // この打牌に対する、ほかの家の鳴きの判断
        for (const [seat, per] of Object.entries(e.huro ?? {})) {
          calls.push({ seat: Number(seat), from: actor, discardIndex: count[actor], tile: m.pai ?? '', opts: keys.map((_, ti) => toOpts(per[ti], HURO_KEY)), real: 'skip' });
        }
        count[actor]++;
      }
    }
    if (calls.length) closeCalls({ type: 'end' });
    kyokus.push(kyoku);
  }
  return { reportId, types, kyokus };
}

/** 実際の打牌が、そのタイプの推奨と同じか（赤五は区別しない） */
export const agrees = (d: NagaDecision, ti: number) => d.pred[ti] != null && kindKey(d.pred[ti]!) === kindKey(d.real);

/** アプリのサーバー経由でレポートを読む */
export async function fetchNagaReport(reportId: string): Promise<Report> {
  const res = await fetch(`/api/naga-report?id=${encodeURIComponent(reportId)}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `レポートを読めませんでした（${res.status}）`);
  return body as Report;
}

/** その牌（アプリの牌の番号）を切る評価。dist が無ければ候補から探す */
export function probOf(d: NagaDecision, ti: number, tile: number): number | null {
  const name = tileToMjai(tile);
  if (d.dist?.[ti]) return d.dist[ti][name] ?? 0;
  const c = d.top[ti]?.find((x) => kindKey(x.tile) === name);
  return c ? c.p : null;
}
/** アプリの牌の番号 → Mjai の牌名（赤五は普通の五） */
export function tileToMjai(t: number): string {
  if (t >= 51 && t <= 53) return `5${'mps'[t - 51]}`;
  if (t >= 41) return 'ESWNPFC'[t - 41];
  return `${t % 10}${'mps'[Math.floor(t / 10) - 1]}`;
}

/**
 * NAGAのレポートを読み、半荘の局（局・本場が同じもの）それぞれに解析結果を付ける。
 * rounds：その半荘の局。戻り値：付けた局の数と、レポートにあって合う局が無かった局の名前
 */
export async function attachNagaToRounds(reportUrl: string, rounds: { id: string; kyoku: number; honba: number }[]) {
  const { supabase } = await import('./supabase');
  const { extractGokujan, fetchGokujan, gokujanId } = await import('./gokujan');
  const gid = gokujanId(reportUrl);
  const rid = gid ? `gokujan:${gid}` : nagaReportId(reportUrl);
  if (!rid) throw new Error('NAGAのレポート（report_id の入ったURL）か、極雀の解析結果（https://gokujan.com/review/…）のURLを貼ってください');
  const engine = gid ? 'mortal' : 'naga';
  const sum = gid ? extractGokujan(await fetchGokujan(gid), gid) : extractNaga(await fetchNagaReport(rid), rid);
  let attached = 0;
  const unmatched: string[] = [];
  for (const k of sum.kyokus) {
    const r = rounds.find((x) => x.kyoku === k.kyoku && x.honba === k.honba) ?? (sum.kyokus.length === 1 && rounds.length === 1 ? rounds[0] : undefined);
    if (!r) { unmatched.push(kyokuName(k.kyoku, k.honba)); continue; }
    const naga = { reportId: rid!, types: sum.types, kyoku: k, fetchedAt: new Date().toISOString() };
    // 同じレポートを取り込み直したときは、前の分を置き換える
    const old = await supabase.from('study_ai_reviews').select('id, naga').eq('round_id', r.id).eq('engine', engine);
    if (old.error) throw old.error;
    const same = (old.data ?? []).find((x) => (x.naga as { reportId?: string } | null)?.reportId === rid);
    const res = same
      ? await supabase.from('study_ai_reviews').update({ naga, report_url: reportUrl }).eq('id', same.id)
      : await supabase.from('study_ai_reviews').insert({ round_id: r.id, engine, report_url: reportUrl, note: '', naga });
    if (res.error) throw res.error;
    attached++;
  }
  return { attached, unmatched, types: sum.types };
}
const kyokuName = (k: number, h: number) => `${['東', '南', '西', '北'][Math.floor(k / 4)]}${(k % 4) + 1}局${h ? `${h}本場` : ''}`;

/** チーの形：鳴いた牌が順子のいちばん下・真ん中・上のどれか */
function chiKind(pai: string, consumed: string[]) {
  const n = Number(pai[0]);
  const ns = consumed.map((c) => Number(c[0]));
  if (n < Math.min(...ns)) return 'chi_low';
  if (n > Math.max(...ns)) return 'chi_high';
  return 'chi_mid';
}

/** そのタイプの判断と実際が違うところ（打牌・立直・槓）。違うものの名前を返す */
export function decisionMisses(d: NagaDecision, ti: number): string[] {
  const out: string[] = [];
  if (d.pred[ti] != null && !agrees(d, ti)) out.push('打牌');
  const r = d.riichi[ti];
  if (r != null && (r >= 0.5) !== !!d.realRiichi) out.push('立直');
  const k = d.kan?.[ti];
  if (k && bestOf(k) !== (d.realKan ?? 'skip')) out.push('槓');
  return out;
}
export const callMiss = (c: NagaCall, ti: number) => { const b = bestOf(c.opts[ti]); return b != null && b !== c.real; };

/** 解析の結果（NAGAのタイプや極雀など）がいくつあるとき、1つにまとめる。タイプを並べ、無い局面のタイプは空にする */
export function mergeNaga<T extends { reportId: string; types: string[]; kyoku: NagaKyoku }>(list: T[]): T | null {
  if (list.length <= 1) return list[0] ?? null;
  const types = list.flatMap((x) => x.types);
  const n = types.length;
  const decisions = new Map<string, NagaDecision>();
  const calls = new Map<string, NagaCall>();
  let off = 0;
  const pad = <V>(arr: V[] | undefined, fill: V, o: number, len: number, into?: V[]) => {
    const out = into ?? Array.from({ length: n }, () => fill);
    for (let i = 0; i < len; i++) out[o + i] = arr?.[i] ?? fill;
    return out;
  };
  for (const x of list) {
    const len = x.types.length;
    for (const d of x.kyoku.decisions) {
      const key = `${d.seat}-${d.discardIndex}`;
      const cur = decisions.get(key);
      const base: NagaDecision = cur ?? { seat: d.seat, discardIndex: d.discardIndex, real: d.real, pred: [], realP: [], top: [], riichi: [], dist: [], kan: [] };
      base.pred = pad(d.pred, null, off, len, cur ? base.pred : undefined);
      base.realP = pad(d.realP, null, off, len, cur ? base.realP : undefined);
      base.top = pad(d.top, [], off, len, cur ? base.top : undefined);
      base.riichi = pad(d.riichi, null, off, len, cur ? base.riichi : undefined);
      base.dist = pad(d.dist, {}, off, len, cur ? base.dist : undefined);
      base.kan = pad(d.kan, null, off, len, cur ? base.kan : undefined);
      if (d.realRiichi) base.realRiichi = true;
      if (d.realKan && d.realKan !== 'skip') base.realKan = d.realKan; else base.realKan ??= d.realKan;
      decisions.set(key, base);
    }
    for (const c of x.kyoku.calls ?? []) {
      const key = `${c.seat}-${c.from}-${c.discardIndex}`;
      const cur = calls.get(key);
      const base: NagaCall = cur ?? { ...c, opts: [] };
      base.opts = pad(c.opts, null, off, len, cur ? base.opts : undefined);
      if (c.real !== 'skip') base.real = c.real;
      calls.set(key, base);
    }
    off += len;
  }
  // 足りない分（後から足したタイプにしか無い局面）を埋める
  for (const d of decisions.values()) {
    for (let i = 0; i < n; i++) { d.pred[i] ??= null; d.realP[i] ??= null; d.top[i] ??= []; d.riichi[i] ??= null; d.dist![i] ??= {}; d.kan![i] ??= null; }
    if (!d.kan!.some(Boolean)) delete d.kan;
  }
  for (const c of calls.values()) for (let i = 0; i < n; i++) c.opts[i] ??= null;
  const first = list[0];
  return { ...first, reportId: list.map((x) => x.reportId).join('+'), types, kyoku: { ...first.kyoku, decisions: [...decisions.values()].sort((a, b) => a.discardIndex - b.discardIndex || a.seat - b.seat), calls: [...calls.values()] } };
}
