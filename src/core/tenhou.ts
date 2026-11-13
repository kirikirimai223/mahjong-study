import {
  DiscardEntry, GameMeta, RoundLog, RoundResult, Seat, SeatLog, TakeEntry, Tile,
  dealerOf, kamichaOf, shimochaOf, toimenOf,
} from './types';

/*
 * 天鳳JSON（tenhou.net/6）の文字列記法。すべて実牌譜で確認済み。
 *   ツモ切り 60 / 立直 "r42"（ツモ切り立直は "r60"）
 *   チー  "c272628"   … c + 鳴いた牌 + 自分の2枚（相手は必ず上家）
 *   ポン  "47p4747"   … p + 鳴いた牌。p の位置で相手を表す（先頭=上家 / 2桁目の後=対面 / 4桁目の後=下家）
 *   大明槓 "m39393939" … ポンと同じ考え方（下家は6桁目の後）。打牌の列には位置合わせの 0 が入る
 *   暗槓  "121212a12" … 打牌の列に入る
 *   加槓  "31k313131" … 元のポンの p を「k + 加えた牌」に置き換えたもの。打牌の列に入る
 * 赤五を含む暗槓・加槓での赤の位置は未確認。
 */
const TSUMOGIRI = 60;

const relFromMarker = (seat: Seat, markerPos: number, isKan: boolean): Seat => {
  if (markerPos === 0) return kamichaOf(seat);
  if (markerPos === 2) return toimenOf(seat);
  if (markerPos === (isKan ? 6 : 4)) return shimochaOf(seat);
  throw new Error(`鳴き記号の位置が想定外: ${markerPos}`);
};

const digits = (s: string): Tile[] => (s.match(/\d\d/g) ?? []).map(Number);

export function parseTake(seat: Seat, v: number | string): TakeEntry {
  if (typeof v === 'number') return { kind: 'draw', tile: v };
  const m = v.match(/[cpm]/);
  if (!m || m.index === undefined) throw new Error(`取得牌の記法が不明: ${v}`);
  const pos = m.index;
  const called = Number(v.slice(pos + 1, pos + 3));
  const own = digits(v.slice(0, pos) + v.slice(pos + 3));
  if (m[0] === 'c') return { kind: 'chi', called, own, from: kamichaOf(seat) };
  const kind = m[0] === 'p' ? 'pon' : 'daiminkan';
  return { kind, called, own, from: relFromMarker(seat, pos, kind === 'daiminkan') };
}

export function formatTake(seat: Seat, t: TakeEntry): number | string {
  if (t.kind === 'draw') return t.tile;
  const own = t.own.map(String);
  if (t.kind === 'chi') return `c${t.called}${own.join('')}`;
  const mark = `${t.kind === 'pon' ? 'p' : 'm'}${t.called}`;
  if (t.from === kamichaOf(seat)) return mark + own.join('');
  if (t.from === toimenOf(seat)) return own[0] + mark + own.slice(1).join('');
  return own.join('') + mark;
}

export function parseDiscard(v: number | string): DiscardEntry {
  if (v === 0) return { kind: 'dummy' };
  if (typeof v === 'number') return v === TSUMOGIRI
    ? { kind: 'discard', tile: TSUMOGIRI, tsumogiri: true, riichi: false }
    : { kind: 'discard', tile: v, tsumogiri: false, riichi: false };
  if (v.startsWith('r')) {
    const n = Number(v.slice(1));
    return { kind: 'discard', tile: n, tsumogiri: n === TSUMOGIRI, riichi: true };
  }
  if (v.includes('a')) return { kind: 'ankan', tiles: digits(v) };
  throw new Error(`打牌の記法が不明: ${v}`);
}

/** 加槓は打牌の列に入るが、相手の向きの解釈にポンと同じ席情報が要る */
export function parseDiscardFor(seat: Seat, v: number | string): DiscardEntry {
  if (typeof v === 'string' && v.includes('k')) {
    const pos = v.indexOf('k');
    const added = Number(v.slice(pos + 1, pos + 3));
    const pon = parseTake(seat, v.slice(0, pos) + 'p' + v.slice(pos + 3));
    if (pon.kind !== 'pon') throw new Error(`加槓の記法が不明: ${v}`);
    return { kind: 'kakan', added, called: pon.called, own: pon.own, from: pon.from };
  }
  return parseDiscard(v);
}

export function formatDiscard(seat: Seat, d: DiscardEntry): number | string {
  switch (d.kind) {
    case 'dummy': return 0;
    case 'ankan': return `${d.tiles[0]}${d.tiles[1]}${d.tiles[2]}a${d.tiles[3]}`;
    case 'kakan': {
      const pon = formatTake(seat, { kind: 'pon', called: d.called, own: d.own, from: d.from }) as string;
      return pon.replace('p', `k${d.added}`);
    }
    case 'discard': {
      const body = d.tsumogiri ? TSUMOGIRI : d.tile;
      return d.riichi ? `r${body}` : body;
    }
  }
}

export interface TenhouJson {
  title: string[];
  name: string[];
  rule: { disp: string; aka: number };
  log: unknown[][];
}

/** tenhou.net/6 のURL または JSON文字列から、1局目を読む */
export function parseTenhou(input: string, roundIndex = 0): RoundLog {
  const json = input.includes('#json=')
    ? decodeURIComponent(input.split('#json=')[1].replace(/&ts=.*$/, ''))
    : input;
  const d = JSON.parse(json) as TenhouJson;
  const r = d.log[roundIndex] as any[];
  const [[kyoku, honba, kyotaku], scores, dora, ura] = r;
  const seats = [0, 1, 2, 3].map((s) => ({
    haipai: r[4 + s * 3] as Tile[],
    take: (r[5 + s * 3] as (number | string)[]).map((v) => parseTake(s as Seat, v)),
    discard: (r[6 + s * 3] as (number | string)[]).map((v) => parseDiscardFor(s as Seat, v)),
  })) as RoundLog['seats'];
  const raw = r[16] as unknown[];
  const result: RoundResult = raw[0] === '和了'
    ? { raw, kind: 'agari', winner: (raw[2] as number[])[0] as Seat, from: (raw[2] as number[])[1] as Seat }
    : { raw, kind: 'ryukyoku' };
  const meta: GameMeta = { title: d.title, names: d.name as GameMeta['names'], rule: d.rule };
  return { meta, setup: { kyoku, honba, kyotaku, scores, doraIndicators: dora, uraIndicators: ura }, seats, result };
}

export function toTenhouJson(log: RoundLog): TenhouJson {
  const { setup: s } = log;
  const round: unknown[] = [[s.kyoku, s.honba, s.kyotaku], s.scores, s.doraIndicators, s.uraIndicators];
  log.seats.forEach((p: SeatLog, i) => {
    round.push(p.haipai, p.take.map((t) => formatTake(i as Seat, t)), p.discard.map((d) => formatDiscard(i as Seat, d)));
  });
  round.push(log.result.raw);
  return { title: log.meta.title, name: log.meta.names, rule: log.meta.rule, log: [round] };
}

/** NAGAのカスタム牌譜解析にそのまま貼れるURL */
export const toTenhouUrl = (log: RoundLog): string =>
  `https://tenhou.net/6/#json=${encodeURIComponent(JSON.stringify(toTenhouJson(log)))}`;

// ---- 4家の列を時系列に並べ直す ----

export type TimelineEvent =
  | { type: 'take'; seat: Seat; index: number; entry: TakeEntry }
  | { type: 'discard'; seat: Seat; index: number; entry: DiscardEntry; tile?: Tile };

/** ツモ切り(60)は直前の取得牌に解決した tile を付けて返す */
export function timeline(log: RoundLog): TimelineEvent[] {
  const ti = [0, 0, 0, 0];
  const di = [0, 0, 0, 0];
  const lastTake: (Tile | undefined)[] = [];
  const events: TimelineEvent[] = [];
  let cur: Seat = dealerOf(log.setup);

  for (let guard = 0; guard < 1000; guard++) {
    const p = log.seats[cur];
    if (ti[cur] >= p.take.length) break; // 誰も取得しない = 局の終わり
    const take = p.take[ti[cur]];
    events.push({ type: 'take', seat: cur, index: ti[cur]++, entry: take });
    lastTake[cur] = take.kind === 'draw' ? take.tile : undefined;

    // 暗槓・加槓・大明槓のあとは嶺上牌を取得して打牌
    let d = p.discard[di[cur]];
    while (d && d.kind !== 'discard') {
      events.push({ type: 'discard', seat: cur, index: di[cur]++, entry: d });
      const rinshan = p.take[ti[cur]];
      if (!rinshan) break;
      events.push({ type: 'take', seat: cur, index: ti[cur]++, entry: rinshan });
      lastTake[cur] = rinshan.kind === 'draw' ? rinshan.tile : undefined;
      d = p.discard[di[cur]];
    }
    if (!d || d.kind !== 'discard') break; // 自摸和了
    const tile = d.tsumogiri ? lastTake[cur] : d.tile;
    if (tile === undefined) throw new Error(`席${cur}のツモ切りの元の牌がない`);
    events.push({ type: 'discard', seat: cur, index: di[cur]++, entry: d, tile });

    // 次の手番：その牌を鳴く家がいればその家（ツモなし）、いなければ下家
    const caller = ([1, 2, 3] as const)
      .map((k) => ((cur + k) % 4) as Seat)
      .find((s) => {
        const next = log.seats[s].take[ti[s]];
        return next && next.kind !== 'draw' && next.from === cur && next.called === tile;
      });
    cur = caller ?? shimochaOf(cur);
  }
  return events;
}
