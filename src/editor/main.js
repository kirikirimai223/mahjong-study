import { parseTenhou, toTenhouJson, toTenhouUrl } from '../core/tenhou';
import { combineTenhou, nextRound, riichiSeats, tenhouUrlOf } from '../core/game';
import { newId, openArchive, RECENT_LIMIT, roundOrder } from './archive.js';
import { BoardError, seededRandom, effectiveTsumogiri, knownTiles, logToBoard, reconstruct, replayTurns, sortTiles } from '../core/board';
import { kindOf, tileName } from '../core/types';
import { diagnose, seatCounts } from '../core/diagnose';
import { callOptions, kanOptions } from './calls.js';
import { SAMPLE_URL, KAN_URL, RINSHAN_URL, CHANKAN_URL } from '../../test/fixtures';
const SAMPLES = [['南三局（チー・立直）', SAMPLE_URL], ['四槓子（ポン・槓）', KAN_URL], ['嶺上開花', RINSHAN_URL], ['槍槓', CHANKAN_URL]];

// ---------- 牌 ----------
const SUIT_CH = ['萬', '筒', '索'];
const HONOR_CH = ['東', '南', '西', '北', '白', '發', '中'];
const NUM_CH = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const PALETTE = [
  [11, 12, 13, 14, 15, 16, 17, 18, 19, 51],
  [21, 22, 23, 24, 25, 26, 27, 28, 29, 52],
  [31, 32, 33, 34, 35, 36, 37, 38, 39, 53],
  [41, 42, 43, 44, 45, 46, 47],
];
const isRed = (t) => t >= 51 && t <= 53;
const suitOf = (t) => (isRed(t) ? t - 51 : t >= 41 ? 3 : Math.floor(t / 10) - 1);

function tileHTML(t, cls = '', attrs = '') {
  return `<span class="tile t${t} ${cls}" title="${tileName(t)}" ${attrs}><span class="face"></span></span>`;
}
const backHTML = () => '<span class="tile back"><span class="face"></span></span>';

// ---------- 状態 ----------
const KYOKU = ['東一局', '東二局', '東三局', '東四局', '南一局', '南二局', '南三局', '南四局'];
const emptySeat = () => ({ haipai: [], river: [], melds: [], hand: [] });
const STATE_VERSION = 4;
const initial = () => ({
  v: STATE_VERSION,
  me: 0,
  names: ['自分', '下家', '対面', '上家'],
  rule: { disp: '般南喰赤', aka: 1 },
  setup: { kyoku: 0, honba: 0, kyotaku: 0, scores: [25000, 25000, 25000, 25000], doraIndicators: [], uraIndicators: [] },
  seats: [emptySeat(), emptySeat(), emptySeat(), emptySeat()],
  result: { kind: 'none', winner: 0, from: 1, winTile: null, deltas: [0, 0, 0, 0], points: '', yaku: '', reason: '流局' },
  ui: { withDraw: true, autoAdvance: true, callWindow: null, pendingDraw: null, handTarget: 'haipai', seat: 0, mode: 'river', nextFlag: 'auto', selected: null, selectedHand: null, selectedMeld: null, riverInsert: null, pendingOwn: [], ankanNext: false, output: null },
});
let state = migrate(load()) ?? initial();
function migrate(st) {
  if (!st) return st;
  if (st.v >= STATE_VERSION) return st;
  const from = st.v ?? 0;
  st.v = STATE_VERSION;
  if (from >= 3) {
    // v4：倒した手牌は画面から消えたので、開始時の手牌がある家の古い値は捨てる
    for (const b of st.seats ?? []) if ((b.haipai ?? []).length === 13) b.hand = [];
    return st;
  }
  for (const b of st.seats ?? []) if ((b.haipai ?? []).length === 13) b.hand = [];
  const r = st.result;
  // 以前の版は結果の初期値が「和了」だった。何も入力していなければ未入力に戻す
  if (r && r.kind === 'agari' && !r.points && !r.yaku && r.deltas.every((d) => Number(d) === 0)) r.kind = 'none';
  for (const b of st.seats ?? []) if (!b.haipai) b.haipai = [];
  if (st.ui) st.ui.handTarget = 'haipai';
  if (st.ui && !st.ui.nextFlag) st.ui.nextFlag = 'auto';
  if (st.ui && st.ui.autoAdvance === undefined) { st.ui.autoAdvance = true; st.ui.withDraw = true; }
  return st;
}
const history = [];

function load() {
  try { const s = localStorage.getItem('paifu-editor'); return s ? JSON.parse(s) : null; } catch { return null; }
}
function save() {
  try { localStorage.setItem('paifu-editor', JSON.stringify(state)); } catch { /* 保存できない環境では何もしない */ }
}
function commit(fn) {
  history.push(JSON.stringify(state));
  if (history.length > 200) history.shift();
  fn(state);
  state.ui.output = null;
  if (!state.ui.keepClean) state.ui.dirty = true;
  delete state.ui.keepClean;
  const msg = state.ui.flashAfter;
  delete state.ui.flashAfter;
  save();
render();
  if (msg) flash(msg);
}
function undo() {
  const prev = history.pop();
  if (!prev) return;
  state = JSON.parse(prev);
  save();
render();
}

const dealer = () => state.setup.kyoku % 4;
const rel = (s) => (s - state.me + 4) % 4; // 0=自家 1=下家 2=対面 3=上家
const REL_NAME = ['自家', '下家', '対面', '上家'];
const seatLabel = (s) => `${state.names[s]}${s === dealer() ? '（親）' : ''}`;

// ---------- 残り枚数 ----------
function usedCounts() {
  const c = new Map();
  const add = (t) => { c.set(kindOf(t), (c.get(kindOf(t)) ?? 0) + 1); if (isRed(t)) c.set(t, (c.get(t) ?? 0) + 1); };
  // 配牌の牌は、河・副露・倒した手牌のどれかと同じ牌なので二重に数えない
  knownTiles(buildBoard()).forEach(add);
  state.ui.pendingOwn.forEach(add);
  if (state.ui.pendingDraw) add(state.ui.pendingDraw.tile);
  return c;
}
const akaOn = () => (state.rule?.aka ?? 1) !== 0;
const RED_OF = { 15: 51, 25: 52, 35: 53 };
// 残り枚数：赤ありなら各色の五は「赤1枚＋普通の五3枚」、赤なしなら普通の五4枚で赤は0枚
function remaining(t, c) {
  if (isRed(t)) return akaOn() ? 1 - (c.get(t) ?? 0) : 0;
  const all = c.get(kindOf(t)) ?? 0;
  if (RED_OF[t] && akaOn()) return 3 - (all - (c.get(RED_OF[t]) ?? 0));
  return 4 - all;
}

// ---------- 副露の補助 ----------
function pendingCall(seat) {
  for (let from = 0; from < 4; from++) {
    const river = state.seats[from].river;
    for (let i = 0; i < river.length; i++) {
      if (river[i].calledBy !== seat) continue;
      const done = state.seats[seat].melds.some((m) => m.from === from && m.riverIndex === i);
      if (!done) return { from, riverIndex: i, tile: river[i].tile };
    }
  }
  return null;
}
function meldKind(called, own, from, seat) {
  const ks = [called, ...own].map(kindOf);
  if (own.length === 3 && ks.every((k) => k === ks[0])) return 'daiminkan';
  if (own.length !== 2) return null;
  if (ks.every((k) => k === ks[0])) return 'pon';
  const sorted = [...ks].sort((a, b) => a - b);
  const seq = sorted[0] < 40 && Math.floor(sorted[0] / 10) === Math.floor(sorted[2] / 10)
    && sorted[1] === sorted[0] + 1 && sorted[2] === sorted[0] + 2;
  if (seq && from === (seat + 3) % 4) return 'chi';
  return null;
}

// ---------- 操作 ----------
function tapPalette(t) {
  const c = usedCounts();
  if (remaining(t, c) <= 0) return flash(`${tileName(t)}はもう残っていません`);
  const { seat, mode } = state.ui;
  if (mode === 'hand' && !state.ui.selectedHand) {
    const target = state.ui.handTarget;
    const limit = target === 'haipai' ? 13 : handLimit(seat);
    if (handArr(seat).length >= limit) {
      const n = state.seats[seat].melds.filter((m) => m.kind !== 'kakan').length;
      return flash(target === 'haipai' ? '手牌（開始時）は13枚までです。差し替えるときは牌をタップしてから選んでください'
        : `倒した手牌は${limit}枚までです${n ? `（副露${n}つ）` : ''}。差し替えるときは牌をタップしてから選んでください`);
    }
  }
  if ((mode === 'dora' || mode === 'ura') && (mode === 'dora' ? state.setup.doraIndicators : state.setup.uraIndicators).length >= 5) {
    return flash(`${mode === 'dora' ? 'ドラ' : '裏ドラ'}表示牌は5枚までです`);
  }
  commit((st) => {
    const b = st.seats[seat];
    if (mode === 'river') {
      const sel = st.ui.selected;
      if (st.ui.riverInsert && sel && sel.seat === seat) {
        if (st.ui.riverInsert === 'replace') {
          const r = b.river[sel.idx];
          r.tile = t;
          // 鳴かれた牌なら、鳴いた側の副露の牌も合わせる
          if (r.calledBy !== undefined) {
            const m = st.seats[r.calledBy].melds.find((x) => x.from === seat && x.riverIndex === sel.idx);
            if (m) m.called = t;
          }
        } else {
          const before = b.river[sel.idx];
          b.river.splice(sel.idx, 0, { tile: t, tsumogiri: (st.ui.nextFlag === 'tsumogiri' ? true : st.ui.nextFlag === 'tedashi' ? false : undefined) });
          for (const x of st.seats) for (const m of x.melds) {
            if (m.from === seat && m.riverIndex >= sel.idx) m.riverIndex++;
          }
          if (before && before.riichi === undefined && b.river.slice(0, sel.idx).some((r) => r.riichi)) b.river[sel.idx].tsumogiri = true;
        }
        st.ui.riverInsert = null;
        return;
      }
      if (st.ui.riverInsert === 'draw' && sel && sel.seat === seat) {
        b.river[sel.idx].draw = t;
        st.ui.riverInsert = null;
        return;
      }
      const afterRiichi = b.river.some((r) => r.riichi);
      // 手牌から切る入力：パレットはツモ牌だけを決める（選び直しもパレットで）。切る牌は手牌をタップ
      if (cutMode(seat)) {
        if (!expectsDraw(seat)) { st.ui.flashAfter = '鳴いた直後なのでツモはありません。手牌から切る牌をタップしてください'; return; }
        st.ui.pendingDraw = { seat, tile: t };
        st.ui.callWindow = null; // ツモった時点で、前の打牌への鳴きはなし
        st.ui.pick = null;
        return;
      }
      st.ui.callWindow = null;
      // 「ツモも入れる」：1回目のタップはツモ牌、2回目が捨て牌（同じ牌ならツモ切り）
      if (st.ui.withDraw && !st.ui.pendingDraw && expectsDraw(seat)) {
        st.ui.pendingDraw = { seat, tile: t };
        return;
      }
      const pd = st.ui.pendingDraw && st.ui.pendingDraw.seat === seat ? st.ui.pendingDraw.tile : undefined;
      const flag = afterRiichi ? true : pd !== undefined ? undefined : (st.ui.nextFlag === 'tsumogiri' ? true : st.ui.nextFlag === 'tedashi' ? false : undefined);
      const rt = { tile: t, tsumogiri: flag };
      if (pd !== undefined) rt.draw = pd;
      b.river.push(rt);
      st.ui.pendingDraw = null;
      st.ui.selected = { seat, idx: b.river.length - 1 };
    } else if (mode === 'hand') {
      const key = 'haipai';
      const arr = b[key] ?? [];
      const sh = st.ui.selectedHand;
      if (sh && sh.seat === seat && arr[sh.idx] !== undefined) {
        const next = [...arr];
        next[sh.idx] = t;
        b[key] = sortTiles(next);
        st.ui.selectedHand = null;
        return;
      }
      b[key] = sortTiles([...arr, t]);
    } else if (mode === 'meld') {
      if (st.ui.riverInsert !== 'kandraw' && (b.haipai ?? []).length === 13 && !st.ui.ankanNext) {
        st.ui.flashAfter = '副露に使う牌は、手牌からタップしてください';
        return;
      }
      if (st.ui.riverInsert === 'kandraw' && st.ui.selectedMeld) {
        const m = st.seats[st.ui.selectedMeld.seat].melds[st.ui.selectedMeld.idx];
        if (m) m.draw = t;
        st.ui.riverInsert = null;
        return;
      }
      if (st.ui.ankanNext) {
        const k = kindOf(t);
        const red = k % 10 === 5 && k < 40 ? 51 + Math.floor(k / 10) - 1 : null;
        const useRed = red && remaining(red, c) > 0;
        const tiles = useRed ? [k, k, k, red] : [k, k, k, k];
        const m = { kind: 'ankan', tiles, afterOwnDiscard: b.river.length };
        if (st.ui.pendingDraw && st.ui.pendingDraw.seat === seat) { m.draw = st.ui.pendingDraw.tile; st.ui.pendingDraw = null; }
        b.melds.push(m);
        st.ui.ankanNext = false;
      } else if (st.ui.meldTarget || pendingCall(seat)) {
        st.ui.pendingOwn.push(t);
      }
    } else if (mode === 'dora') {
      st.setup.doraIndicators.push(t);
    } else if (mode === 'ura') {
      st.setup.uraIndicators.push(t);
    } else if (mode === 'win') {
      st.result.winTile = t;
    }
  });
}

/** 倒した手牌の上限：13枚から副露1つにつき3枚減る（加槓は数えない）。自摸の和了牌は別枠 */
/** この家の次の打牌の前にツモがあるか（鳴いた直後はない。大明槓のあとは嶺上牌がある） */
function expectsDraw(seat) {
  try {
    const steps = replayTurns(buildBoard(), false).filter((st) => st.seat === seat);
    const last = steps.at(-1);
    return !(last && last.kind === 'call' && last.meld.kind !== 'daiminkan');
  } catch { return true; }
}

/** 河の牌を消す。後ろの牌を鳴いた副露の位置も詰める */
function deleteRiver(st, seat, idx) {
  st.seats[seat].river.splice(idx, 1);
  for (const b of st.seats) b.melds = b.melds.filter((m) => !(m.from === seat && m.riverIndex === idx))
    .map((m) => (m.from === seat && m.riverIndex > idx ? { ...m, riverIndex: m.riverIndex - 1 } : m));
  st.ui.selected = null;
}
/** 副露を消す（そのポンを元にした加槓も消し、相手の河の「鳴かれた」印も外す） */
function removeMeld(st, seat, idx) {
  const melds = st.seats[seat].melds;
  const m = melds[idx];
  if (m && m.from !== undefined) { const src = st.seats[m.from].river[m.riverIndex]; if (src && src.calledBy === seat) delete src.calledBy; }
  st.seats[seat].melds = melds.filter((x, i) => i !== idx && !(x.kind === 'kakan' && x.ponIndex === idx))
    .map((x) => (x.kind === 'kakan' && x.ponIndex > idx ? { ...x, ponIndex: x.ponIndex - 1 } : x));
}
function handArrOf(st, seat) {
  const b = st.seats[seat];
  if (st.ui.handTarget === 'haipai') { b.haipai ??= []; return b.haipai; }
  return b.hand;
}
function handArr(seat) {
  const b = state.seats[seat];
  return (state.ui.handTarget === 'haipai' ? b.haipai : b.hand) ?? [];
}
function handLimit(seat) {
  return 13 - 3 * state.seats[seat].melds.filter((m) => m.kind !== 'kakan').length;
}

/** その家に視点を移して、指定した場所の編集に入る（牌を消したりはしない） */
function focus(seat, mode, extra = {}) {
  state.ui.seat = seat;
  state.ui.mode = mode;
  state.ui.pendingOwn = [];
  state.ui.ankanNext = false;
  state.ui.riverInsert = null;
  state.ui.selectedHand = null;
  state.ui.selectedMeld = null;
  state.ui.pick = null;
  state.ui.meldTarget = null;
  state.ui.meldPending = null;
  if (state.ui.pendingDraw && state.ui.pendingDraw.seat !== seat) state.ui.pendingDraw = null;
  if (mode !== 'river') state.ui.selected = null;
  Object.assign(state.ui, extra);
render();
}

function confirmMeld() {
  const seat = state.ui.seat;
  const pc = pendingCall(seat);
  if (!pc) return;
  const own = state.ui.pendingOwn;
  const kind = meldKind(pc.tile, own, pc.from, seat);
  if (!kind) return flash('チー（上家から・順子）、ポン（2枚）、大明槓（3枚）のどれにもならない組み合わせです');
  commit((st) => {
    st.seats[seat].melds.push({ kind, from: pc.from, riverIndex: pc.riverIndex, called: pc.tile, own: [...own] });
    st.ui.pendingOwn = [];
  });
}

let flashMsg = '';
function flash(msg) { flashMsg = msg; render(); setTimeout(() => { flashMsg = ''; render(); }, 2600); }

function buildBoard() {
  const r = state.result;
  const deltas = r.deltas.map(Number);
  const raw = r.kind === 'agari'
    ? ['和了', deltas, [Number(r.winner), Number(r.from), Number(r.winner), r.points, ...r.yaku.split('\n').map((s) => s.trim()).filter(Boolean)]]
    : [r.reason || '流局', deltas];
  if (r.kind === 'none') {
    return {
      meta: { title: ['', ''], names: state.names, rule: state.rule ?? { disp: '般南喰赤', aka: 1 } },
      setup: { ...state.setup, kyoku: Number(state.setup.kyoku), honba: Number(state.setup.honba), kyotaku: Number(state.setup.kyotaku), scores: state.setup.scores.map(Number) },
      seats: state.seats.map((b) => ({ haipai: b.haipai ?? [], river: b.river, melds: b.melds, hand: b.hand })),
      result: { raw: [], kind: 'ryukyoku' },
      winTile: undefined,
    };
  }
  return {
    meta: { title: ['', ''], names: state.names, rule: state.rule ?? { disp: '般南喰赤', aka: 1 } },
    setup: { ...state.setup, kyoku: Number(state.setup.kyoku), honba: Number(state.setup.honba), kyotaku: Number(state.setup.kyotaku), scores: state.setup.scores.map(Number) },
    seats: state.seats.map((b) => ({ haipai: b.haipai ?? [], river: b.river, melds: b.melds, hand: b.hand })),
    result: r.kind === 'agari'
      ? { raw, kind: 'agari', winner: Number(r.winner), from: Number(r.from) }
      : { raw, kind: 'ryukyoku' },
    winTile: r.kind === 'agari' && Number(r.winner) === Number(r.from) ? r.winTile ?? undefined : undefined,
  };
}

function runReconstruct() {
  try {
    const board = buildBoard();
    const log = reconstruct(board, {}, state.names);
    // 種を変えて2回組み、違いが出れば「未入力の所をランダムで補った」と分かる
    const a = JSON.stringify(toTenhouJson(reconstruct(board, { random: seededRandom(1) }, state.names)));
    const b = JSON.stringify(toTenhouJson(reconstruct(board, { random: seededRandom(2) }, state.names)));
    state.ui.output = { ok: true, url: toTenhouUrl(log), json: toTenhouJson(log), randomized: a !== b, haipai: log.seats.map((s) => s.haipai) };
  } catch (e) {
    const named = e instanceof BoardError && e.seat !== undefined && !e.message.startsWith(state.names[e.seat]);
    state.ui.output = { ok: false, message: (named ? `${state.names[e.seat]}：` : '') + e.message, seat: e.seat };
  }
render();
  document.getElementById('output')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function loadSample(url) {
  const log = parseTenhou(url);
  const b = logToBoard(log, { haipai: true, draws: true });
  const raw = log.result.raw;
  commit((st) => {
    Object.assign(st, initial());
    st.roundId = null; st.gameId = null; // サンプルは記録とは別物として開く
    st.me = Math.max(0, log.meta.names.indexOf('私'));
    st.names = [...log.meta.names];
    st.rule = { ...log.meta.rule };
    st.setup = structuredClone(b.setup);
    st.seats = structuredClone(b.seats).map((x) => ({ ...x, hand: [] })); // 倒した手牌は使わない（開始時の手牌と毎巡のツモで決まる）
    st.result = {
      kind: 'agari', winner: raw[2][0], from: raw[2][1], winTile: b.winTile ?? null,
      deltas: raw[1], points: raw[2][3], yaku: raw[2].slice(4).join('\n'), reason: '流局',
    };
    st.ui.seat = st.me;
  });
}

// ---------- 記録（最近の局・半荘） ----------
const arc = { be: null, recs: [], loading: true, error: null, busy: false };
const roundLabel = (setup) => `${KYOKU[setup.kyoku]}${setup.honba ? ` ${setup.honba}本場` : ''}`;
const games = () => arc.recs.filter((r) => r.type === 'game').sort((a, b) => b.createdAt - a.createdAt);
const roundsOf = (gid) => arc.recs.filter((r) => r.type === 'round' && r.gameId === gid).sort(roundOrder);
const recentRounds = () => arc.recs.filter((r) => r.type === 'round' && !r.gameId).sort((a, b) => b.savedAt - a.savedAt);
const findRec = (id) => arc.recs.find((r) => r.id === id);
const hasContent = (st) => st.seats.some((b) => (b.haipai ?? []).length || b.river.length || b.melds.length || b.hand.length);
const fmtTime = (ms) => { const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

function resultSummary(st) {
  const r = st.result;
  if (r.kind === 'agari') return `${st.names[r.winner]}の${Number(r.winner) === Number(r.from) ? 'ツモ' : `ロン（${st.names[r.from]}）`}${r.points ? ` ${r.points}` : ''}`;
  if (r.kind === 'ryukyoku') return r.reason || '流局';
  return '結果未入力';
}

async function initArchive() {
  try {
    arc.be = await openArchive();
    arc.recs = await arc.be.list();
  } catch (e) {
    arc.error = '記録を読み込めませんでした';
  }
  arc.loading = false;
  // 開いていた局・半荘が消えていたら（別の端末で削除など）紐付けを外す
  if (state.gameId && !findRec(state.gameId)) state.gameId = null;
  if (state.roundId && !findRec(state.roundId)) state.roundId = null;
  render();
}

async function putRec(rec) {
  await arc.be.put(rec);
  arc.recs = arc.recs.filter((r) => r.id !== rec.id).concat(rec);
}
async function delRec(id) {
  await arc.be.del(id);
  arc.recs = arc.recs.filter((r) => r.id !== id);
}
async function guarded(fn) {
  if (!arc.be || arc.busy) return;
  arc.busy = true; render();
  try { await fn(); } catch (e) {
    flash(e?.code === 'quota_exceeded' ? '保存できる量の上限に達しました。古い局や半荘を削除してください' : `保存できませんでした：${e?.message ?? e}`);
  } finally { arc.busy = false; render(); }
}

/** いまの局の天鳳JSON（組んだ結果があればそれ、なければ組んでみる。組めなければ null） */
function currentJson() {
  if (state.ui.output?.ok && state.ui.output.json) return state.ui.output.json;
  if (state.result.kind === 'none') return null;
  try { return toTenhouJson(reconstruct(buildBoard(), {}, state.names)); } catch { return null; }
}

async function saveCurrent({ quiet = false } = {}) {
  const now = Date.now();
  const prev = state.roundId ? findRec(state.roundId) : null;
  const rec = {
    type: 'round', id: prev?.id ?? newId(), gameId: state.gameId ?? null,
    createdAt: prev?.createdAt ?? now, savedAt: now,
    kyoku: Number(state.setup.kyoku), honba: Number(state.setup.honba),
    label: roundLabel(state.setup), summary: resultSummary(state),
    editor: structuredClone({ me: state.me, names: state.names, rule: state.rule, setup: state.setup, seats: state.seats, result: state.result }),
    json: currentJson(),
  };
  await putRec(rec);
  state.roundId = rec.id;
  state.ui.dirty = false;
  // 半荘に入っていない局は新しいものだけ残す
  for (const old of recentRounds().slice(RECENT_LIMIT)) await delRec(old.id);
  save();
  if (!quiet) flash(rec.json ? `${rec.label}を保存しました` : `${rec.label}を下書きとして保存しました（まだ天鳳形式に組めていません）`);
  return rec;
}

async function newGame(name) {
  const now = Date.now();
  const d = new Date(now);
  const day = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  const n = games().filter((g) => g.name.startsWith(day)).length + 1;
  const g = { type: 'game', id: newId(), name: name || `${day} 半荘${n}`, createdAt: now, savedAt: now, names: [...state.names] };
  await putRec(g);
  return g;
}

/** 結果から次の局を始める（いまの局は保存して半荘に入れる。半荘がなければ作る） */
async function goNextRound() {
  if (state.result.kind === 'none') return flash('先に局の結果を入力してください');
  const board = buildBoard();
  const r = state.result;
  const nx = nextRound(board.setup, {
    kind: r.kind, winners: r.kind === 'agari' ? [Number(r.winner)] : [], reason: r.reason, deltas: r.deltas.map(Number),
  }, riichiSeats(board));
  let made = null;
  if (!state.gameId) { made = await newGame(); state.gameId = made.id; }
  const rec = await saveCurrent({ quiet: true });
  if (nx.finished) { save(); return flash(`${rec.label}を保存しました。南四局が終わったので半荘はここまでです`); }
  const keep = { me: state.me, names: state.names, rule: state.rule, gameId: state.gameId };
  history.push(JSON.stringify(state));
  Object.assign(state, initial(), keep);
  state.setup = { ...nx.setup, doraIndicators: [], uraIndicators: [] };
  state.roundId = null;
  state.ui.seat = state.me;
  state.ui.archiveOpen = false;
  state.ui.dirty = false;
  save();
  const note = nx.ambiguous ? '（収支がすべて0なので親流れにしました。全員聴牌なら局を戻してください）' : '';
  flash(`${made ? `半荘「${made.name}」を作って` : ''}${rec.label}を保存。${roundLabel(state.setup)}を始めます${note}`);
}

function openRound(rec) {
  history.push(JSON.stringify(state));
  const e = structuredClone(rec.editor);
  Object.assign(state, initial(), { me: e.me, names: e.names, rule: e.rule, setup: e.setup, seats: e.seats, result: e.result });
  state.roundId = rec.id;
  state.gameId = rec.gameId ?? null;
  state.ui.seat = state.me;
  state.ui.archiveOpen = false;
  state.ui.dirty = false;
  save();
  render();
  flash(`${rec.label}を開きました`);
}

function blankRound() {
  history.push(JSON.stringify(state));
  const keep = { me: state.me, names: state.names, rule: state.rule, gameId: state.gameId };
  Object.assign(state, initial(), keep);
  state.roundId = null;
  state.ui.seat = state.me;
  state.ui.archiveOpen = false;
  state.ui.dirty = false;
  save();
  render();
}

/** 消える操作（未保存の変更を捨てる・削除）は2回押しで確定 */
function armed(key) {
  if (state.ui.armed === key) { state.ui.armed = null; return true; }
  state.ui.armed = key;
  render();
  setTimeout(() => { if (state.ui.armed === key) { state.ui.armed = null; render(); } }, 4000);
  return false;
}
const needsDiscard = () => state.ui.dirty && hasContent(state);

function gameExport(gid) {
  const g = findRec(gid);
  const rs = roundsOf(gid);
  const ok = rs.filter((r) => r.json);
  if (!ok.length) return null;
  const json = combineTenhou(ok.map((r) => r.json), [g?.name ?? '', '']);
  return { json, url: tenhouUrlOf(json), missing: rs.filter((r) => !r.json).map((r) => r.label) };
}

async function downloadJson(filename, obj) {
  const dl = await window.claude?.use?.('downloads').catch(() => null);
  const data = JSON.stringify(obj);
  if (!dl) {
    navigator.clipboard?.writeText(data).then(() => flash('この画面ではファイル保存が使えないので、JSONをコピーしました'), () => flash('ファイル保存が使えません'));
    return;
  }
  try { await dl.save({ filename, data }); } catch (e) { if (e?.code !== 'declined') flash('ファイルを保存できませんでした'); }
}

function archiveHTML() {
  if (!state.ui.archiveOpen) return '';
  if (arc.loading) return '<div class="arc"><p class="hint">記録を読み込んでいます…</p></div>';
  if (arc.error) return `<div class="arc"><p class="hint">${arc.error}</p></div>`;
  const dis = arc.busy ? 'disabled' : '';
  const cur = state.roundId ? findRec(state.roundId) : null;
  const status = !cur ? '未保存' : state.ui.dirty ? '保存後に変更あり' : '保存済み';
  const g = state.gameId ? findRec(state.gameId) : null;
  const arm = (k, label, armedLabel) => (state.ui.armed === k ? armedLabel : label);
  const roundRow = (r, inGame) => `<li class="${r.id === state.roundId ? 'cur' : ''}">
      <div class="rt"><b>${r.label}</b><small>${r.summary}${r.json ? '' : ' ・下書き'}</small><small>${fmtTime(r.savedAt)}</small></div>
      <div class="ra">
        ${r.id === state.roundId ? '<span class="tag">編集中</span>' : `<button data-act="arcopen" data-v="${r.id}" ${dis}>${needsDiscard() && state.ui.armed === `open:${r.id}` ? '変更を捨てて開く' : '開く'}</button>`}
        ${r.json ? `<button data-act="arcurl" data-v="${r.id}">URL</button>` : ''}
        ${!inGame && g ? `<button data-act="arcadd" data-v="${r.id}" ${dis}>半荘へ</button>` : ''}
        ${inGame ? `<button data-act="arcout" data-v="${r.id}" ${dis}>${arm(`out:${r.id}`, '外す', '本当に外す')}</button>` : ''}
        <button data-act="arcdel" data-v="${r.id}" class="danger" ${dis}>${arm(`del:${r.id}`, '削除', '本当に削除')}</button>
      </div></li>`;
  let gameSec;
  if (g) {
    const rs = roundsOf(g.id);
    const ex = state.ui.gameOut === g.id ? gameExport(g.id) : null;
    gameSec = `<section><h3>半荘 <input class="gname" data-act="gname" value="${g.name.replace(/"/g, '&quot;')}" aria-label="半荘の名前"></h3>
      ${rs.length ? `<ol class="rounds">${rs.map((r) => roundRow(r, true)).join('')}</ol>` : '<p class="hint">まだ局がありません。局を保存するとこの半荘に入ります</p>'}
      <div class="seg">
        <button data-act="gameout" ${rs.some((r) => r.json) ? '' : 'disabled'}>半荘をまとめて出力</button>
        <button data-act="gameclose" ${dis}>半荘から抜ける</button>
        <button data-act="gamedel" class="danger" ${dis}>${arm(`gdel:${g.id}`, '半荘を削除', '局ごと本当に削除')}</button>
      </div>
      ${ex ? `<div class="out good">
        <p>${rs.filter((r) => r.json).length}局を1つの牌譜にまとめました。${ex.missing.length ? `<br><small>組めていない局は入っていません：${ex.missing.join('、')}</small>` : ''}</p>
        <div class="seg"><button data-act="gamecopy">URLをコピー</button><button data-act="gamejson">JSONを保存</button><a href="${ex.url}" target="_blank" rel="noopener">天鳳で開く</a></div>
        <p class="hint">NAGAには1局ずつ貼る場合、各局の「URL」を使ってください</p>
      </div>` : ''}
    </section>`;
  } else {
    const gs = games();
    gameSec = `<section><h3>半荘</h3>
      <p class="hint">「次の局へ」を押すと、半荘を作って局を順に入れていきます</p>
      <div class="seg"><button data-act="gamenew" ${dis}>新しい半荘を始める</button></div>
      ${gs.length ? `<ul class="games">${gs.map((x) => `<li><div class="rt"><b>${x.name}</b><small>${roundsOf(x.id).length}局</small></div><div class="ra"><button data-act="gameopen" data-v="${x.id}" ${dis}>開く</button></div></li>`).join('')}</ul>` : ''}
    </section>`;
  }
  const recents = recentRounds();
  return `<div class="arc">
    <section class="now">
      <div class="rt"><b>この局：${roundLabel(state.setup)}</b><small>${status}${g ? `・${g.name}` : ''}</small></div>
      <div class="seg">
        <button data-act="arcsave" ${dis}>保存</button>
        <button data-act="arcnext" ${dis} ${state.result.kind === 'none' ? 'disabled' : ''}>保存して次の局へ</button>
        <button data-act="arcblank" ${dis}>${needsDiscard() && state.ui.armed === 'blank' ? '変更を捨てて新しい局' : '新しい局'}</button>
      </div>
    </section>
    ${gameSec}
    <section><h3>最近の局 <small>（半荘に入れていない局を${RECENT_LIMIT}局まで）</small></h3>
      ${recents.length ? `<ul class="rounds">${recents.map((r) => roundRow(r, false)).join('')}</ul>` : '<p class="hint">保存した局はまだありません</p>'}
    </section>
    <p class="hint">${arc.be?.kind === 'db' ? 'あなたのアカウントに保存しています（他の人からは見えません）' : 'このブラウザに保存しています'}</p>
  </div>`;
}

async function archiveAction(a, v, el) {
  switch (a) {
    case 'arctoggle': state.ui.archiveOpen = !state.ui.archiveOpen; state.ui.gameOut = null; return render();
    case 'arcsave': return guarded(() => saveCurrent());
    case 'arcnext': return guarded(goNextRound);
    case 'arcblank': if (needsDiscard() && !armed('blank')) return; return blankRound();
    case 'arcopen': { const r = findRec(v); if (!r) return; if (needsDiscard() && !armed(`open:${v}`)) return; return openRound(r); }
    case 'arcurl': { const r = findRec(v); if (!r?.json) return; return navigator.clipboard?.writeText(tenhouUrlOf(r.json)).then(() => flash(`${r.label}のURLをコピーしました`), () => flash('コピーできませんでした')); }
    case 'arcadd': return guarded(async () => { const r = findRec(v); await putRec({ ...r, gameId: state.gameId }); if (r.id === state.roundId) save(); });
    case 'arcout': if (!armed(`out:${v}`)) return; return guarded(async () => { const r = findRec(v); await putRec({ ...r, gameId: null }); });
    case 'arcdel': if (!armed(`del:${v}`)) return; return guarded(async () => { await delRec(v); if (state.roundId === v) { state.roundId = null; state.ui.dirty = true; save(); } });
    case 'gamenew': return guarded(async () => { const g = await newGame(); state.gameId = g.id; if (state.roundId) { const r = findRec(state.roundId); await putRec({ ...r, gameId: g.id }); } save(); });
    case 'gameopen': state.gameId = v; state.ui.gameOut = null; save(); return render();
    case 'gameclose': state.gameId = null; state.ui.gameOut = null; save(); return render();
    case 'gamedel': {
      const gid = state.gameId;
      if (!armed(`gdel:${gid}`)) return;
      return guarded(async () => {
        for (const r of roundsOf(gid)) await delRec(r.id);
        await delRec(gid);
        if (state.roundId && !findRec(state.roundId)) { state.roundId = null; state.ui.dirty = true; }
        state.gameId = null; save();
      });
    }
    case 'gameout': state.ui.gameOut = state.ui.gameOut === state.gameId ? null : state.gameId; return render();
    case 'gamecopy': { const ex = gameExport(state.gameId); return ex && navigator.clipboard?.writeText(ex.url).then(() => flash('半荘のURLをコピーしました'), () => flash('コピーできませんでした')); }
    case 'gamejson': { const ex = gameExport(state.gameId); const g = findRec(state.gameId); return ex && downloadJson(`${(g?.name ?? 'hanchan').replace(/[\\/:*?"<>|]/g, '-')}.json`, ex.json); }
  }
}
const ARCHIVE_ACTS = new Set(['arctoggle', 'arcsave', 'arcnext', 'arcblank', 'arcopen', 'arcurl', 'arcadd', 'arcout', 'arcdel', 'gamenew', 'gameopen', 'gameclose', 'gamedel', 'gameout', 'gamecopy', 'gamejson']);

// ---------- 描画：卓 ----------
const WIND = ['東', '南', '西', '北'];
const SEAT_ROT = [0, -90, 180, 90]; // 自家・下家・対面・上家の向き（卓の中心まわり）
const windOf = (s) => WIND[(s - dealer() + 4) % 4];
let tableAngle = 0; // 入力中の家が手前に来るように卓を回す（前回からの最短回転）

function targetAngle() {
  return -SEAT_ROT[rel(state.ui.seat)];
}
function updateAngle() {
  const target = targetAngle();
  let delta = ((target - tableAngle) % 360 + 540) % 360 - 180;
  tableAngle += delta;
}

function issuesFor(seat, area) {
  return currentIssues.filter((i) => i.seat === seat && (!area || i.area === area));
}

function riverRows(s) {
  const b = state.seats[s];
  const sel = state.ui.selected;
  const bad = new Map(issuesFor(s, 'river').map((i) => [i.index, i.message]));
  const cells = b.river.map((r, i) => {
    const cls = [
      effectiveTsumogiri(r) === true ? 'tg' : effectiveTsumogiri(r) === undefined ? 'unk' : '',
      r.draw !== undefined ? 'hasdraw' : '',
      r.riichi ? 'yoko' : '',
      r.calledBy !== undefined ? 'called' : '',
      sel && sel.seat === s && sel.idx === i ? 'sel' : '',
      bad.has(i) ? 'bad' : '',
      state.ui.meldTarget && state.ui.meldTarget.from === s && state.ui.meldTarget.idx === i ? 'target' : '',
    ].join(' ');
    return tileHTML(r.tile, cls, `data-act="river" data-seat="${s}" data-idx="${i}"`);
  });
  // 次に置く位置（入力中の家）と、足りない位置（エラー）
  const n = b.river.length;
  if (bad.has(n)) cells.push(`<span class="tile ghost bad" data-act="zone" data-zone="river" data-seat="${s}"><span class="face">?</span></span>`);
  else if (state.ui.seat === s && state.ui.mode === 'river') {
    const label = !state.ui.withDraw ? '＋' : state.ui.pendingDraw && state.ui.pendingDraw.seat === s ? '打' : expectsDraw(s) ? 'ツモ' : '打';
    cells.push(`<span class="tile ghost ${label.length > 1 ? 'small' : ''}"><span class="face">${label}</span></span>`);
  }
  if (cells.length === 0) return `<div class="rrow"><span class="placeholder">河</span></div>`;
  const rows = [];
  for (let i = 0; i < cells.length; i += 6) rows.push(`<div class="rrow">${cells.slice(i, i + 6).join('')}</div>`);
  return rows.join('');
}

/** 鳴いた牌を、鳴いた相手の方向に横向きで置く（上家=左、対面=中、下家=右） */
function meldTiles(m, s, idx) {
  const b = state.seats[s];
  if (m.kind === 'ankan') {
    return `${backHTML()}${tileHTML(m.tiles[1])}${tileHTML(m.tiles[2])}${backHTML()}`;
  }
  const kakan = b.melds.find((x) => x.kind === 'kakan' && x.ponIndex === idx);
  const called = kakan
    ? `<span class="stack">${tileHTML(kakan.added, 'yoko')}${tileHTML(m.called, 'yoko')}</span>`
    : tileHTML(m.called, 'yoko');
  const own = m.own.map((t) => tileHTML(t));
  const relFrom = (m.from - s + 4) % 4; // 3=上家 2=対面 1=下家
  const pos = relFrom === 3 ? 0 : relFrom === 2 ? 1 : own.length;
  own.splice(pos, 0, called);
  return own.join('');
}

/**
 * 今の手牌（配牌＋入れたツモ−捨てた牌−鳴き・槓に使った牌）。ツモ待ちの牌は含めない。
 * ツモを入れていない巡がある家は、手の中の分からない牌の数を unknown で返す。
 */
function currentHand(seat) {
  const b = state.seats[seat];
  const hand = [...(b.haipai ?? [])];
  let unknown = 0;
  const gain = [];
  const lose = [];
  for (const r of b.river) { if (r.draw !== undefined) gain.push(r.draw); lose.push(r.tile); }
  for (const m of b.melds) {
    if (m.kind === 'ankan') { lose.push(...m.tiles); if (m.draw !== undefined) gain.push(m.draw); }
    else if (m.kind === 'kakan') { lose.push(m.added); if (m.draw !== undefined) gain.push(m.draw); }
    else lose.push(...m.own);
  }
  hand.push(...gain);
  for (const t of lose) {
    const i = hand.indexOf(t);
    if (i >= 0) hand.splice(i, 1); else unknown++; // ツモ未入力の巡で引いた牌
  }
  const expected = handLimit(seat);
  unknown = Math.max(0, expected - hand.length);
  return { tiles: sortTiles(hand), unknown };
}
let uiOptions = []; // 鳴き・槓ボタンの中身（描画のたびに作り直す）
const KIND_NAME = { chi: 'チー', pon: 'ポン', daiminkan: '明槓', ankan: '暗槓', kakan: '加槓' };

/** 切った直後の鳴きボタン */
function callPanelHTML() {
  const cw = state.ui.callWindow;
  if (!cw) return '';
  if (cw.kakan !== undefined) {
    const rows = [1, 2, 3].map((k) => (cw.from + k) % 4).map((y) => {
      uiOptions.push({ kind: 'ron', seat: y });
      return `<button data-act="call" data-v="${uiOptions.length - 1}" class="ron">${state.names[y]}がロン（槍槓）</button>`;
    });
    return `<div class="callbox"><div class="seg"><small>${state.names[cw.from]}の加槓 ${tileHTML(cw.kakan, 'mini')} を槍槓するなら：</small></div><div class="seg">${rows.join('')}</div>
      <div class="seg"><small>なければ、パレットで嶺上牌を選ぶ</small></div></div>`;
  }
  const r = state.seats[cw.from].river[cw.idx];
  if (!r || r.calledBy !== undefined) return '';
  const others = [1, 2, 3].map((k) => (cw.from + k) % 4);
  const rons = others.map((y) => {
    uiOptions.push({ kind: 'ron', seat: y });
    return `<button data-act="call" data-v="${uiOptions.length - 1}" class="ron">${state.names[y]}がロン</button>`;
  }).join('');
  return `<div class="callbox"><div class="seg"><small>${state.names[cw.from]}の ${tileHTML(r.tile, 'mini')}：</small>${rons}</div>
    <div class="seg"><small>鳴くなら「副露」、なければ次の家のツモをパレットで選ぶ</small></div></div>`;
}

/**
 * 副露の入力：①相手の河から鳴く牌をタップ → ②自分の手牌から使う牌をタップ → ③確定。
 * 相手の河を選ばずに手牌（とツモ牌）だけを選べば、暗槓・加槓。
 */
function meldPanelHTML(seat) {
  const hasHaipai = (state.seats[seat].haipai ?? []).length === 13;
  const tg = state.ui.meldTarget;
  const target = tg ? state.seats[tg.from].river[tg.idx] : undefined;
  const pick = state.ui.pick && state.ui.pick.seat === seat ? state.ui.pick.keys : [];
  const own = hasHaipai ? pickTiles(seat, pick) : state.ui.pendingOwn;
  const step = (n, done, text) => `<div class="seg step ${done ? 'done' : ''}"><span class="no">${n}</span> ${text}</div>`;
  let confirm = '';
  if (target && own.length > 0) {
    const valid = (hasHaipai ? callOptions(own, target.tile, seat, tg.from) : callOptions(own, target.tile, seat, tg.from))
      .filter((o) => sameTiles(o.own, own));
    confirm = valid.map((o) => { uiOptions.push({ ...o, seat, from: tg.from, idx: tg.idx }); return `<button class="primary" data-act="meldconfirm" data-v="${uiOptions.length - 1}">${KIND_NAME[o.kind]}で確定</button>`; }).join('')
      || `<small>${own.length < 2 ? 'もう1枚選ぶ' : 'この組み合わせでは鳴けない（チーは上家からだけ）'}</small>`;
  } else if (!target && own.length > 0 && state.ui.pendingDraw && state.ui.pendingDraw.seat === seat) {
    const valid = kanOptions([...currentHand(seat).tiles, state.ui.pendingDraw.tile], state.seats[seat].melds)
      .filter((o) => sameTiles(o.kind === 'ankan' ? o.tiles : [o.added], own));
    confirm = valid.map((o) => { uiOptions.push(o); return `<button class="primary" data-act="kan" data-v="${uiOptions.length - 1}">${KIND_NAME[o.kind]}で確定</button>`; }).join('')
      || '<small>暗槓は4枚、加槓はポンした牌の4枚目を選ぶ</small>';
  }
  const mp = state.ui.meldPending;
  if (mp && mp.seat === seat) {
    return `<div class="ctx">
      ${step('①', true, `鳴く牌：${state.names[mp.from]}の ${tileHTML(state.seats[mp.from].river[mp.idx].tile, 'mini')}`)}
      ${step('②', true, `${KIND_NAME[mp.kind]}：${mp.own.map((t) => tileHTML(t, 'mini')).join('')}`)}
      ${step('③', false, '<b>切る牌を手牌からタップ</b>（鳴きと打牌を一緒に確定します）')}
      <div class="seg"><button data-act="meldreset">やり直し</button><button data-act="mode" data-v="river">やめる</button></div></div>`;
  }
  return `<div class="ctx">
    ${step('①', !!target, target ? `鳴く牌：${state.names[tg.from]}の ${tileHTML(target.tile, 'mini')}（${tg.idx + 1}打目）` : '相手の河から鳴く牌をタップ（槓なら飛ばす）')}
    ${step('②', own.length > 0, `${state.names[seat]}の${hasHaipai ? '手牌' : 'パレット'}から使う牌を${hasHaipai ? 'タップ' : '選ぶ'}：${own.map((t) => tileHTML(t, 'mini')).join('') || '<small>未選択</small>'}`)}
    <div class="seg">${confirm}<button data-act="meldreset">やり直し</button><button data-act="mode" data-v="river">やめる</button></div>
    <p class="hint">鳴く家を変えるときは、その家の手牌をタップ。副露をタップすると削除・加槓・槓前のツモを直せます</p>
    ${selMeldHTML()}
  </div>`;
}

/** ツモ牌を持っているときの槓：「槓する」を押して、手牌（とツモ牌）から使う牌をタップ */
function kanPanelHTML(seat) {
  const pd = state.ui.pendingDraw;
  if (!pd || pd.seat !== seat) return '';
  const possible = kanOptions([...currentHand(seat).tiles, pd.tile], state.seats[seat].melds);
  if (possible.length === 0) return '';
  if (!state.ui.kanPick) return '<button data-act="kanpick">槓する</button>';
  const pick = state.ui.pick && state.ui.pick.seat === seat ? state.ui.pick.keys : [];
  const tiles = pickTiles(seat, pick);
  const valid = possible.filter((o) => sameTiles(o.kind === 'ankan' ? o.tiles : [o.added], tiles));
  return `<div class="seg"><small>槓に使う牌をタップ（暗槓は4枚、加槓は1枚）</small> ${tiles.map((t) => tileHTML(t, 'mini')).join('')}
    ${valid.map((o) => { uiOptions.push(o); return `<button class="primary" data-act="kan" data-v="${uiOptions.length - 1}">${KIND_NAME[o.kind]}で確定</button>`; }).join('')}
    <button data-act="kanpick">やめる</button></div>`;
}

/**
 * 手牌の牌をタップして鳴き・槓に使う牌を選んでいる状態。
 * pick = { seat, keys: ['h3', 'd', ...] }（h=今の手牌の何枚目、d=ツモ牌）
 */
const pickTiles = (seat, keys) => {
  const hand = currentHand(seat).tiles;
  const pd = state.ui.pendingDraw && state.ui.pendingDraw.seat === seat ? state.ui.pendingDraw.tile : undefined;
  return keys.map((k) => (k === 'd' ? pd : hand[Number(k.slice(1))])).filter((t) => t !== undefined);
};
const sameTiles = (a, b) => JSON.stringify([...a].sort((x, y) => x - y)) === JSON.stringify([...b].sort((x, y) => x - y));
/** 鳴きの牌を選べる家か（切った直後で、捨てた家以外・配牌入力済み・まだ誰もツモっていない） */
const callPickable = () => false; // 鳴きは「副露」から入れる（切った直後はロンだけ受け付ける）
/** 副露の入力で、自分の手牌から使う牌を選べるか */
const meldPick = (s) => state.ui.mode === 'meld' && state.ui.seat === s && (state.seats[s].haipai ?? []).length === 13;

/** 手牌から切る入力が使えるか（配牌が13枚入っていて「ツモも入れる」がオン） */
/** 局の開始時の手牌（13枚）が入っている家 */
const hasStartHand = (s) => (state.seats[s].haipai ?? []).length === 13;
const cutMode = (s) => state.ui.withDraw && state.ui.mode === 'river' && state.ui.seat === s && (state.seats[s].haipai ?? []).length === 13;

/** 卓に出す手牌：編集中なら編集している方、そうでなければ倒した手牌（なければ配牌） */
function shownHand(s) {
  const b = state.seats[s];
  const editing = state.ui.seat === s && state.ui.mode === 'hand';
  if (editing) return { kind: 'haipai', tiles: b.haipai ?? [] };
  const mp = state.ui.meldPending;
  if (mp && mp.seat === s) {
    const tiles = [...currentHand(s).tiles];
    for (const t of mp.own) { const i = tiles.indexOf(t); if (i >= 0) tiles.splice(i, 1); }
    return { kind: 'meldcut', tiles, unknown: 0 };
  }
  if (cutMode(s) || meldPick(s) || hasStartHand(s)) { const c = currentHand(s); return { kind: 'current', tiles: c.tiles, unknown: c.unknown }; }
  if (b.hand.length > 0) return { kind: 'hand', tiles: b.hand };
  return { kind: 'haipai', tiles: b.haipai ?? [] };
}
function handRow(s) {
  const b = state.seats[s];
  const sh = state.ui.selectedHand;
  const shown = shownHand(s);
  const tag = '';
  const cutting = shown.kind === 'current' || shown.kind === 'meldcut';
  const pick = state.ui.pick && state.ui.pick.seat === s ? state.ui.pick.keys : [];
  const hand = tag + shown.tiles.map((t, i) => (cutting
    ? tileHTML(t, `cuttable ${pick.includes(`h${i}`) ? 'picked' : ''}`, `data-act="${shown.kind === 'meldcut' ? 'meldcut' : meldPick(s) ? 'mpick' : 'cut'}" data-seat="${s}" data-t="${t}" data-key="h${i}"`)
    : tileHTML(t, sh && sh.seat === s && sh.idx === i ? 'sel' : '', `data-act="hand" data-seat="${s}" data-idx="${i}"`))).join('')
    + (cutting && shown.unknown > 0 ? Array.from({ length: shown.unknown }, () => '<span class="tile ghost unknown"><span class="face">?</span></span>').join('') : '');
  // 副露は右端から内側へ順に並ぶ
  const melds = b.melds.map((m, i) => (m.kind === 'kakan' ? '' : `<span class="meld" data-act="meld" data-seat="${s}" data-idx="${i}">${meldTiles(m, s, i)}</span>`))
    .filter(Boolean).reverse().join('');
  const editing = state.ui.seat === s && state.ui.mode === 'hand';
  const limit = shown.kind === 'haipai' ? 13 : handLimit(s);
  const empty = editing && shown.tiles.length < limit && !sh ? '<span class="tile ghost"><span class="face">＋</span></span>' : '';
  const mpv = state.ui.meldPending && state.ui.meldPending.seat === s
    ? `<span class="gap"></span><span class="meld preview">${meldTiles({ ...state.ui.meldPending, called: state.seats[state.ui.meldPending.from].river[state.ui.meldPending.idx].tile }, s, -1)}</span>` : '';
  if (mpv) return `${hand}${mpv}<span class="gap"></span>${melds}`;
  const pdTile = state.ui.pendingDraw && state.ui.pendingDraw.seat === s
    ? `<span class="gap"></span>${tileHTML(state.ui.pendingDraw.tile, `drawn ${cutting ? 'cuttable' : ''} ${pick.includes('d') ? 'picked' : ''}`, cutting ? `data-act="${meldPick(s) ? 'mpick' : 'cut'}" data-seat="${s}" data-t="${state.ui.pendingDraw.tile}" data-drawn="1" data-key="d"` : '')}`
    : cutting && cutMode(s) && expectsDraw(s) ? '<span class="gap"></span><span class="tile ghost small"><span class="face">ツモ</span></span>' : '';
  if (pdTile) return `${hand}${empty}${pdTile}<span class="gap"></span>${melds}`;
  if (shown.tiles.length === 0 && !empty && b.melds.length === 0) return `<span class="placeholder wide">${b.hand.length === 0 && (b.haipai ?? []).length === 0 ? '手牌' : ''}</span>`;
  return `${hand}${empty}<span class="gap"></span>${melds}`;
}

function layerHTML(s) {
  const c = currentCounts[s];
  const active = state.ui.seat === s;
  const handBad = currentIssues.some((i) => i.seat === s && (i.area === 'hand' || i.area === 'haipai') && i.level !== 'warn');
  const riverBad = issuesFor(s, 'river').length > 0;
  const meldBad = issuesFor(s, 'meld').length > 0;
  const riichi = state.seats[s].river.some((r) => r.riichi);
  return `<div class="layer ${active ? 'active' : ''}" style="transform:rotate(${SEAT_ROT[rel(s)]}deg)">
    <div class="zone river-zone ${riverBad ? 'bad' : ''} ${active && state.ui.mode === 'river' ? 'editing' : ''}" data-act="zone" data-zone="river" data-seat="${s}">${riverRows(s)}</div>
    <div class="zone hand-zone ${handBad || meldBad ? 'bad' : ''} ${active && (state.ui.mode === 'hand' || state.ui.mode === 'meld') ? 'editing' : ''}" data-act="zone" data-zone="hand" data-seat="${s}">${handRow(s)}</div>
    <div class="seatlabel ${handBad ? 'bad' : ''}" data-act="zone" data-zone="label" data-seat="${s}">
      <b>${windOf(s)}</b>${state.names[s]}${riichi ? '<span class="stick"></span>' : ''}
      <span class="cnt ${handBad ? 'ng' : 'ok'}">${hasStartHand(s) ? `${shownHand(s).tiles.length + (state.ui.pendingDraw && state.ui.pendingDraw.seat === s ? 1 : 0)}枚` : `${c.haipai}/13`}</span>
    </div>
  </div>`;
}

function centerHTML() {
  const st = state.setup;
  const editing = state.ui.mode === 'dora' || state.ui.mode === 'ura';
  return `<div class="center ${editing ? 'editing' : ''}" data-act="center" style="transform:translate(-50%,-50%) rotate(${-tableAngle}deg)">
    <div class="kyoku">${KYOKU[st.kyoku]}</div>
    <div class="sub">${st.honba}本場 供託${st.kyotaku}</div>
    <div class="dora">${st.doraIndicators.map((t) => tileHTML(t, 'mini')).join('') || '<span class="tile mini ghost"><span class="face"></span></span><small>ドラ</small>'}</div>
    ${st.uraIndicators.length ? `<div class="dora ura">${st.uraIndicators.map((t) => tileHTML(t, 'mini')).join('')}</div>` : ''}
  </div>`;
}

let currentIssues = [];
let currentCounts = [];

function issuesHTML() {
  const errors = currentIssues.filter((i) => i.level !== 'warn');
  const warns = currentIssues.filter((i) => i.level === 'warn');
  const warnHTML = warns.map((i) => `<button class="issue warn" data-act="goissue" data-v="${currentIssues.indexOf(i)}">${i.message}</button>`).join('');
  if (errors.length === 0) return `<div class="issues ok">入力に矛盾はありません${warnHTML}</div>`;
  const open = state.ui.issuesOpen;
  const list = open ? errors : errors.slice(0, 2);
  return `<div class="issues">
    <div class="ih"><b>要確認 ${errors.length}件</b>${errors.length > 2 ? `<button data-act="toggleissues">${open ? '閉じる' : 'すべて表示'}</button>` : ''}</div>
    ${list.map((i) => `<div class="issue-row"><button class="issue" data-act="goissue" data-v="${currentIssues.indexOf(i)}">${i.message}</button>${i.fix ? `<button class="fixbtn" data-act="fix" data-v="${currentIssues.indexOf(i)}">${i.fix.label}</button>` : ''}</div>`).join('')}
    ${warnHTML}
  </div>`;
}

function paletteHTML() {
  const c = usedCounts();
  return `<div class="palette">${PALETTE.map((row) => `<div class="prow">${row.filter((t) => akaOn() || !isRed(t)).map((t) => {
    const n = remaining(t, c);
    return `<button class="pt ${n <= 0 ? 'none-left' : ''}" data-act="pal" data-t="${t}" ${n <= 0 ? 'disabled' : ''}>${tileHTML(t)}<i>${n}</i></button>`;
  }).join('')}</div>`).join('')}</div>`;
}

function contextHTML() {
  const { mode, seat, selected } = state.ui;
  const b = state.seats[seat];
  if (mode === 'river') {
    const r = selected && state.seats[selected.seat].river[selected.idx];
    const afterRiichi = b.river.some((x) => x.riichi);
    const pending = state.ui.pendingDraw && state.ui.pendingDraw.seat === seat ? state.ui.pendingDraw.tile : null;
    return `<div class="ctx">
      ${cutMode(seat) ? '' : `      <div class="seg">次に置く牌：
        <button data-act="nexttg" data-v="auto" class="${state.ui.nextFlag === 'auto' && !afterRiichi ? 'on' : ''}">自動</button>
        <button data-act="nexttg" data-v="tedashi" class="${state.ui.nextFlag === 'tedashi' && !afterRiichi ? 'on' : ''}">手出し</button>
        <button data-act="nexttg" data-v="tsumogiri" class="${state.ui.nextFlag === 'tsumogiri' || afterRiichi ? 'on' : ''}">ツモ切り</button>
        ${afterRiichi ? '<small>立直後はツモ切り</small>' : ''}
      </div>`}
      ${callPanelHTML()}
      <div class="seg"><button data-act="withdraw" class="${state.ui.withDraw ? 'on' : ''}">ツモも入れる</button>
        <button data-act="autoadv" class="${state.ui.autoAdvance ? 'on' : ''}">手番どおりに進める</button>
        ${cutMode(seat) ? '<button data-act="mode" data-v="meld" class="primary">副露</button>' : ''}
        ${cutMode(seat) ? (pending
          ? `ツモ ${tileHTML(pending, 'mini')} → <b>手牌から切る牌をタップ</b>（ツモった牌ならツモ切り）
             <button data-act="riichinext" class="${state.ui.riichiNext ? 'on' : ''}">立直して切る</button>
             <button data-act="tsumoagari">このツモで和了</button><button data-act="canceldraw">取消</button>`
          : expectsDraw(seat) ? '<small>パレットでツモ牌を選び、手牌から切る牌をタップ</small>'
            : `<small>鳴いた直後なのでツモなし。手牌から切る牌をタップ</small> <button data-act="riichinext" class="${state.ui.riichiNext ? 'on' : ''}">立直して切る</button>`)
        : state.ui.withDraw ? (pending
          ? `ツモ ${tileHTML(pending, 'mini')} → 捨て牌を選ぶ <button data-act="tgdraw">ツモ切り</button><button data-act="canceldraw">取消</button>`
          : expectsDraw(seat) ? '<small>パレットでツモ牌 → 捨て牌の順に選ぶ（同じ牌ならツモ切り）</small>' : '<small>鳴いた直後なのでツモなし。捨て牌を選ぶ</small>')
          : '<small>オンにすると、毎巡のツモ牌を入れて手牌から切る入力になります</small>'}</div>
      ${r ? `<div class="seg">選択中 ${tileHTML(r.tile, 'mini')}（${state.names[selected.seat]} ${selected.idx + 1}打目）
        <button data-act="settg" data-v="0" class="${r.tsumogiri === false ? 'on' : ''}">手出し</button>
        <button data-act="settg" data-v="1" class="${r.tsumogiri === true ? 'on' : ''}">ツモ切り</button>
        <button data-act="settg" data-v="u" class="${r.tsumogiri === undefined ? 'on' : ''}">不明</button>
        <button data-act="riichi" class="${r.riichi ? 'on' : ''}">立直（横）</button></div>
        <div class="seg">この手番のツモ：${r.draw !== undefined ? tileHTML(r.draw, 'mini') : '<small>未入力</small>'}
        <button data-act="rinsert" data-v="draw" class="${state.ui.riverInsert === 'draw' ? 'on' : ''}">${r.draw !== undefined ? 'ツモを変える' : 'ツモを入れる'}</button>
        ${r.draw !== undefined ? '<button data-act="deldraw">ツモを消す</button>' : ''}</div>
        <div class="seg"><button data-act="rinsert" data-v="replace" class="${state.ui.riverInsert === 'replace' ? 'on' : ''}">差し替え</button>
        <button data-act="rinsert" data-v="before" class="${state.ui.riverInsert === 'before' ? 'on' : ''}">この前に1枚入れる</button>
        <button data-act="delriver">削除</button>
        ${state.ui.riverInsert ? `<small>パレットで牌を選ぶ</small>` : ''}</div>
        ${r.calledBy !== undefined ? (() => { const m = state.seats[r.calledBy].melds.find((x) => x.from === selected.seat && x.riverIndex === selected.idx); return `<div class="seg"><small>${state.names[r.calledBy]}が${m ? KIND_NAME[m.kind] : '鳴'}した牌</small><button data-act="unmeld">この副露を取り消す</button></div>`; })() : ''}` : cutMode(seat) ? '' : '<p class="hint">パレットで捨てた順に置きます。河の牌をタップすると、手出し/ツモ切り・立直・差し替え・挿入ができます</p>'}
    </div>`;
  }
  if (mode === 'hand') {
    const sh = state.ui.selectedHand;
    const arr = b.haipai ?? [];
    return `<div class="ctx">
      <div class="seg"><b>${state.names[seat]}の手牌（局の開始時） ${arr.length}/13</b>
      ${sh && arr[sh.idx] !== undefined ? `選択中 ${tileHTML(arr[sh.idx], 'mini')} <button data-act="delhand">削除</button><small>パレットで選ぶと差し替え</small>`
        : `<small>${arr.length >= 13 ? '13枚そろいました。牌をタップすると差し替え・削除できます' : 'パレットで13枚選ぶ。牌をタップすると差し替え・削除'}</small>`}</div>
      ${arr.length >= 13 ? '<div class="seg"><button class="primary" data-act="mode" data-v="river">ツモ・打牌の入力へ</button></div>' : ''}</div>`;
  }
  if (mode === 'meld') return meldPanelHTML(seat);
  if (mode === 'dora' || mode === 'ura') {
    const list = mode === 'dora' ? state.setup.doraIndicators : state.setup.uraIndicators;
    return `<div class="ctx"><div class="seg"><button data-act="mode" data-v="dora" class="${mode === 'dora' ? 'on' : ''}">ドラ</button><button data-act="mode" data-v="ura" class="${mode === 'ura' ? 'on' : ''}">裏ドラ</button></div><div class="seg">${mode === 'dora' ? 'ドラ表示牌' : '裏ドラ表示牌'}：${list.map((t, i) => tileHTML(t, 'mini', `data-act="deldora" data-kind="${mode}" data-idx="${i}"`)).join('') || 'なし'}
      <small>タップで削除</small></div></div>`;
  }
  return '';
}

function selMeldHTML() {
  const sm = state.ui.selectedMeld;
  if (!sm || sm.seat !== state.ui.seat) return '';
  const b = state.seats[sm.seat];
  const m = b.melds[sm.idx];
  if (!m) return '';
  const tag = { chi: 'チー', pon: 'ポン', daiminkan: '明槓', ankan: '暗槓', kakan: '加槓' }[m.kind];
  const canKakan = m.kind === 'pon' && !b.melds.some((x) => x.kind === 'kakan' && x.ponIndex === sm.idx);
  const kan = m.kind === 'ankan' ? m : b.melds.find((x) => x.kind === 'kakan' && x.ponIndex === sm.idx);
  return `<div class="seg">選択中：${tag}
    ${canKakan ? `<button data-act="kakan">加槓する（${b.river.length}打目の後）</button>` : ''}
    <button data-act="delmeld">削除</button></div>
    ${kan ? `<div class="seg">槓する前のツモ：${kan.draw !== undefined ? tileHTML(kan.draw, 'mini') : '<small>未入力</small>'}
      <button data-act="rinsert" data-v="kandraw" class="${state.ui.riverInsert === 'kandraw' ? 'on' : ''}">${kan.draw !== undefined ? '変える' : '入れる'}</button></div>` : ''}`;
}

function setupHTML() {
  const st = state.setup;
  return `<details class="setup" ${state.ui.setupOpen ? 'open' : ''}><summary>${KYOKU[st.kyoku]} ${st.honba}本場 供託${st.kyotaku} ｜ ${st.scores.join(' / ')}</summary>
    <div class="grid">
      <label>局<select data-bind="setup.kyoku">${KYOKU.map((k, i) => `<option value="${i}" ${i == st.kyoku ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
      <label>本場<input type="number" min="0" data-bind="setup.honba" value="${st.honba}"></label>
      <label>供託<input type="number" min="0" data-bind="setup.kyotaku" value="${st.kyotaku}"></label>
      <label>赤<select data-act="akasel"><option value="1" ${akaOn() ? 'selected' : ''}>赤あり（各色の五に赤1枚）</option><option value="0" ${akaOn() ? '' : 'selected'}>赤なし</option></select></label>
      <label>自分の席<select data-bind="me">${[0, 1, 2, 3].map((s) => `<option value="${s}" ${s == state.me ? 'selected' : ''}>起家から${s + 1}番目</option>`).join('')}</select></label>
    </div>
    <div class="grid">${[0, 1, 2, 3].map((s) => `<label>${s === 0 ? '起家' : `起家+${s}`}<input data-bind="names.${s}" value="${state.names[s]}"><input type="number" step="100" data-bind="setup.scores.${s}" value="${st.scores[s]}"></label>`).join('')}</div>
  </details>`;
}

function resultHTML() {
  const r = state.result;
  const opt = (sel, includeTsumo) => [0, 1, 2, 3].map((s) => `<option value="${s}" ${s == sel ? 'selected' : ''}>${state.names[s]}${includeTsumo && s == r.winner ? '（ツモ）' : ''}</option>`).join('');
  return `<div class="ctx result">
    <div class="seg"><button data-act="rkind" data-v="none" class="${r.kind === 'none' ? 'on' : ''}">未入力</button><button data-act="rkind" data-v="agari" class="${r.kind === 'agari' ? 'on' : ''}">和了</button><button data-act="rkind" data-v="ryukyoku" class="${r.kind === 'ryukyoku' ? 'on' : ''}">流局</button></div>
    ${r.kind === 'none' ? '<p class="hint">局の結果を選ぶと、終わり方（最後に捨てた家・和了の形）と河の枚数の整合もチェックします</p>' : r.kind === 'agari' ? `<div class="grid">
      <label>和了者<select data-bind="result.winner">${opt(r.winner)}</select></label>
      <label>放銃者<select data-bind="result.from">${opt(r.from, true)}</select></label>
      <label>点数表記<input data-bind="result.points" value="${r.points}" placeholder="30符2飜2900点"></label>
    </div>
    ${r.winner == r.from ? `<div class="seg">和了牌：${r.winTile ? tileHTML(r.winTile, 'mini') : '未入力'} <button data-act="mode" data-v="win" class="${state.ui.mode === 'win' ? 'on' : ''}">パレットで選ぶ</button></div>` : '<p class="hint">ロン牌は放銃者の河の最後の牌として扱います（槍槓は加槓した牌）</p>'}
    <label class="wide">役（1行に1つ）<textarea data-bind="result.yaku" rows="3" placeholder="断幺九(1飜)">${r.yaku}</textarea></label>`
    : `<label class="wide">流局の種類<input data-bind="result.reason" value="${r.reason}"></label>`}
    ${r.kind === 'none' ? '' : `<div class="grid">${[0, 1, 2, 3].map((s) => `<label>${state.names[s]}の収支<input type="number" step="100" data-bind="result.deltas.${s}" value="${r.deltas[s]}"></label>`).join('')}</div>`}
  </div>`;
}

function outputHTML() {
  const o = state.ui.output;
  if (!o) return '';
  if (!o.ok) return `<div id="output" class="out bad">組めませんでした：${o.message}</div>`;
  return `<div id="output" class="out good">
    <p>${o.randomized ? '天鳳形式で出力しました。入力していない配牌・ツモはランダムで補っています（もう一度押すと補い方が変わります）。' : '天鳳形式で出力しました。すべて入力どおりで、ランダムで補った所はありません。'}<br><small>保存は上の「記録」から</small></p>
    <div class="haipai">${o.haipai.map((h, s) => `<div><b>${state.names[s]}の開始時の手牌</b>${h.map((t) => tileHTML(t, 'mini')).join('')}</div>`).join('')}</div>
    <div class="seg"><button data-act="copy">URLをコピー</button><a href="${o.url}" target="_blank" rel="noopener">天鳳の牌譜エディタで開く</a></div>
    <textarea readonly rows="3" class="url">${o.url}</textarea>
  </div>`;
}

function render() {
  uiOptions = [];
  const MODES = [['river', '河'], ['meld', '副露'], ['hand', '手牌'], ['dora', 'ドラ'], ['ura', '裏ドラ'], ['result', '結果']];
  const mode = state.ui.mode === 'win' ? 'result' : state.ui.mode;
  const board = buildBoard();
  save(); // 視点や選択もリロード後に戻せるように保存する
  const resultEntered = state.result.kind !== 'none';
  currentIssues = diagnose(board, state.names, { resultEntered });
  currentCounts = seatCounts(board);
  updateAngle();

  const app = document.getElementById('app');
  if (!document.getElementById('table')) {
    app.innerHTML = `<header id="hdr"></header><div id="archive"></div><div id="setup"></div>
      <div class="table-wrap"><div id="table"></div></div><div id="dock"></div>`;
  }
  document.getElementById('hdr').innerHTML = `<h1>牌譜エディタ</h1>
    <div class="tools"><button data-act="arctoggle" class="${state.ui.archiveOpen ? 'on' : ''}">記録${state.gameId && findRec(state.gameId) ? `・${roundsOf(state.gameId).length}局` : ''}</button><button data-act="undo" ${history.length ? '' : 'disabled'}>戻す</button><select data-act="samplesel" aria-label="サンプル"><option value="">サンプル</option>${SAMPLES.map(([n], i) => `<option value="${i}">${n}</option>`).join('')}</select><button data-act="clear">全消去</button></div>`;
  document.getElementById('archive').innerHTML = archiveHTML();
  document.getElementById('setup').innerHTML = setupHTML();
  const table = document.getElementById('table');
  table.style.transform = `rotate(${tableAngle}deg)`;
  table.innerHTML = [0, 1, 2, 3].map(layerHTML).join('') + centerHTML();
  const seatTab = (s) => {
    const bad = currentIssues.some((i) => i.seat === s && i.level !== 'warn');
    return `<button data-act="pickseat" data-v="${s}" class="${state.ui.seat === s ? 'on' : ''} ${bad ? 'ng' : ''}">${windOf(s)} ${state.names[s]}<small>${REL_NAME[rel(s)]}</small></button>`;
  };
  document.getElementById('dock').innerHTML = `
    <div class="tabs seats">${[0, 1, 2, 3].map(seatTab).join('')}</div>
    <div class="tabs modes">${MODES.map(([k, v]) => `<button data-act="mode" data-v="${k}" class="${mode === k ? 'on' : ''}">${v}</button>`).join('')}</div>
    ${mode === 'result' ? resultHTML() : contextHTML()}
    ${(mode !== 'result' || state.ui.mode === 'win') ? paletteHTML() : ''}
    ${issuesHTML()}
    ${!resultEntered ? '<p class="hint gohint">結果（和了／流局）を入力すると出力できます。入力途中の河の枚数差はエラーにしません</p>' : ''}
    <button class="go" data-act="build" ${currentIssues.some((i) => i.level !== 'warn') || !resultEntered ? 'disabled' : ''}>天鳳形式で出力<small>未入力の配牌・ツモはランダムで補います</small></button>
    ${outputHTML()}
    ${flashMsg ? `<div class="flash">${flashMsg}</div>` : ''}`;
  const det = document.querySelector('details.setup');
  if (det) det.addEventListener('toggle', () => { state.ui.setupOpen = det.open; });
}

// ---------- イベント ----------
document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const a = el.dataset.act;
  const v = el.dataset.v;
  const seat = Number(el.dataset.seat);
  const idx = Number(el.dataset.idx);
  if (ARCHIVE_ACTS.has(a)) return archiveAction(a, v, el);
  switch (a) {
    case 'pal': return tapPalette(Number(el.dataset.t));
    case 'pickseat': return focus(Number(v), state.ui.mode === 'result' || state.ui.mode === 'win' || state.ui.mode === 'dora' || state.ui.mode === 'ura' ? 'river' : state.ui.mode);
    case 'zone': {
      // 河・手牌の何もない所をタップ：その家に視点を移して、その場所の編集に入る
      const zone = el.dataset.zone;
      const mode = zone === 'hand' ? (state.ui.seat === seat && state.ui.mode === 'meld' ? 'meld' : 'hand') : 'river';
      if (state.ui.seat === seat && state.ui.mode === mode) return;
      return focus(seat, mode);
    }
    case 'center': return focus(state.ui.seat, state.ui.mode === 'ura' ? 'ura' : 'dora');
    case 'rinsert': state.ui.riverInsert = state.ui.riverInsert === v ? null : v; return render();
    case 'delhand': return commit((st) => { const sh = st.ui.selectedHand; (st.ui.handTarget === 'haipai' ? st.seats[sh.seat].haipai : st.seats[sh.seat].hand).splice(sh.idx, 1); st.ui.selectedHand = null; });
    case 'htarget': state.ui.handTarget = v; state.ui.selectedHand = null; return render();
    case 'mode': return focus(state.ui.seat, v, { selected: v === 'river' ? state.ui.selected : null });
    case 'nexttg': state.ui.nextFlag = v; return render();
    case 'withdraw': state.ui.withDraw = !state.ui.withDraw; state.ui.pendingDraw = null; return render();
    case 'cut': {
      ev.stopPropagation();
      // 副露の入力中に他家の手牌をタップ：鳴く家をその家に変える（選んだ鳴く牌はそのまま）
      if (state.ui.mode === 'meld' && seat !== state.ui.seat) {
        const target = state.ui.meldTarget && state.ui.meldTarget.from !== seat ? state.ui.meldTarget : null;
        return focus(seat, 'meld', { meldTarget: target });
      }
      const key = el.dataset.key;
      // 鳴きに使う牌を選ぶ（切った直後に、鳴く家の手牌をタップ）／槓に使う牌を選ぶ
      const picking = callPickable(seat) || (state.ui.kanPick && state.ui.pendingDraw && state.ui.pendingDraw.seat === seat);
      if (picking && key) {
        const cur = state.ui.pick && state.ui.pick.seat === seat ? state.ui.pick.keys : [];
        const keys = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
        if (state.ui.seat !== seat) return focus(seat, 'river', { pick: { seat, keys } });
        state.ui.pick = { seat, keys };
        return render();
      }
      if (!cutMode(seat)) return focus(seat, 'river');
      const pd = state.ui.pendingDraw && state.ui.pendingDraw.seat === seat ? state.ui.pendingDraw.tile : undefined;
      if (pd === undefined && expectsDraw(seat)) return flash('先にパレットでツモ牌を選んでください（鳴くなら、使う牌をタップ）');
      const tile = Number(el.dataset.t);
      const drawn = el.dataset.drawn === '1';
      if (!drawn && state.seats[seat].river.some((r) => r.riichi)) return flash('立直後は手出しできません。ツモった牌をタップしてください');
      const riichi = state.ui.riichiNext;
      state.ui.pendingDraw = null;
      state.ui.riichiNext = false;
      return commit((st) => {
        const b = st.seats[seat];
        const afterRiichi = b.river.some((r) => r.riichi);
        const rt = { tile, tsumogiri: drawn };
        if (pd !== undefined) rt.draw = pd;
        if (riichi && !afterRiichi) rt.riichi = true;
        b.river.push(rt);
        st.ui.selected = null; // 手牌から切る入力では、切った牌を選択状態にしない（操作欄を短く保つ）
        // 切った直後は鳴きを受け付ける。手番どおりに進めるなら、卓は下家に回す
        st.ui.callWindow = { from: seat, idx: b.river.length - 1 };
        if (st.ui.autoAdvance) st.ui.seat = (seat + 1) % 4;
      });
    }
    case 'riichinext': state.ui.riichiNext = !state.ui.riichiNext; return render();
    case 'autoadv': state.ui.autoAdvance = !state.ui.autoAdvance; return render();
    case 'clearpick': state.ui.pick = null; return render();
    case 'meldreset': state.ui.pick = null; state.ui.meldTarget = null; state.ui.pendingOwn = []; state.ui.meldPending = null; return render();
    case 'meldcut': {
      ev.stopPropagation();
      const o = state.ui.meldPending;
      if (!o || seat !== o.seat) return;
      const tile = Number(el.dataset.t);
      return commit((st) => {
        const r = st.seats[o.from].river[o.idx];
        r.calledBy = o.seat;
        const b = st.seats[o.seat];
        b.melds = b.melds.filter((m) => !(m.from === o.from && m.riverIndex === o.idx));
        b.melds.push({ kind: o.kind, from: o.from, riverIndex: o.idx, called: r.tile, own: [...o.own] });
        b.river.push({ tile, tsumogiri: false }); // 鳴いた直後はツモがないので手出し
        st.ui.meldPending = null; st.ui.meldTarget = null; st.ui.pick = null; st.ui.pendingOwn = [];
        st.ui.pendingDraw = null; st.ui.mode = 'river'; st.ui.selected = null;
        st.ui.callWindow = { from: o.seat, idx: b.river.length - 1 };
        st.ui.seat = st.ui.autoAdvance ? (o.seat + 1) % 4 : o.seat;
      });
    }
    case 'mpick': {
      ev.stopPropagation();
      if (seat !== state.ui.seat) return focus(seat, 'meld', { meldTarget: state.ui.meldTarget });
      const key = el.dataset.key;
      const cur = state.ui.pick && state.ui.pick.seat === seat ? state.ui.pick.keys : [];
      state.ui.pick = { seat, keys: cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key] };
      return render();
    }
    case 'meldconfirm': {
      const o = uiOptions[Number(v)];
      if (!o) return;
      // チー・ポンは、続けて切る牌を手牌から選ぶ（鳴きと打牌を一度に確定し、手牌の枚数が合わない時間を作らない）
      if (o.kind !== 'daiminkan' && (state.seats[o.seat].haipai ?? []).length === 13) {
        state.ui.meldPending = o;
        return render();
      }
      return commit((st) => {
        const r = st.seats[o.from].river[o.idx];
        r.calledBy = o.seat;
        st.seats[o.seat].melds = st.seats[o.seat].melds.filter((m) => !(m.from === o.from && m.riverIndex === o.idx));
        st.seats[o.seat].melds.push({ kind: o.kind, from: o.from, riverIndex: o.idx, called: r.tile, own: [...o.own] });
        st.ui.meldTarget = null; st.ui.pick = null; st.ui.pendingOwn = []; st.ui.callWindow = null; st.ui.pendingDraw = null;
        st.ui.seat = o.seat; st.ui.mode = 'river'; // 鳴いた家が手牌から切る
        st.ui.flashAfter = o.kind === 'daiminkan' ? '明槓しました。パレットで嶺上牌を選んでください' : `${KIND_NAME[o.kind]}しました。手牌から切る牌をタップしてください`;
      });
    }
    case 'kanpick': state.ui.kanPick = !state.ui.kanPick; state.ui.pick = null; return render();
    case 'call': {
      const o = uiOptions[Number(v)];
      if (!o) return;
      const cw = state.ui.callWindow;
      if (o.kind === 'ron') {
        return commit((st) => {
          Object.assign(st.result, { kind: 'agari', winner: o.seat, from: cw.from, winTile: null });
          st.ui.callWindow = null; st.ui.seat = o.seat; st.ui.mode = 'result';
        });
      }
      if (o.kind === 'manual') {
        // 配牌が入っていない家：鳴かれた印だけ付けて、副露の牌はパレットで選ぶ
        return commit((st) => {
          st.seats[cw.from].river[cw.idx].calledBy = o.seat;
          st.ui.callWindow = null; st.ui.seat = o.seat; st.ui.mode = 'meld'; st.ui.pendingOwn = [];
        });
      }
      return commit((st) => {
        const r = st.seats[cw.from].river[cw.idx];
        r.calledBy = o.seat;
        st.seats[o.seat].melds.push({ kind: o.kind, from: cw.from, riverIndex: cw.idx, called: r.tile, own: [...o.own] });
        st.ui.callWindow = null; st.ui.pendingDraw = null; st.ui.pick = null;
        st.ui.seat = o.seat; st.ui.mode = 'river';
      });
    }
    case 'kan': {
      const o = uiOptions[Number(v)];
      const pd = state.ui.pendingDraw;
      if (!o || !pd) return;
      state.ui.pendingDraw = null;
      state.ui.kanPick = false;
      state.ui.pick = null;
      return commit((st) => {
        const b = st.seats[pd.seat];
        if (o.kind === 'ankan') b.melds.push({ kind: 'ankan', tiles: [...o.tiles], afterOwnDiscard: b.river.length, draw: pd.tile });
        else {
          b.melds.push({ kind: 'kakan', ponIndex: o.ponIndex, added: o.added, afterOwnDiscard: b.river.length, draw: pd.tile });
          st.ui.callWindow = { from: pd.seat, kakan: o.added }; // 槍槓のロンを受け付ける
        }
        st.ui.flashAfter = '槓しました。パレットで嶺上牌を選んでください';
        st.ui.mode = 'river'; st.ui.meldTarget = null;
      });
    }
    case 'tsumoagari': {
      const pd = state.ui.pendingDraw;
      if (!pd) return;
      state.ui.pendingDraw = null;
      return commit((st) => {
        Object.assign(st.result, { kind: 'agari', winner: pd.seat, from: pd.seat, winTile: pd.tile });
        st.ui.mode = 'result';
      });
    }
    case 'canceldraw': state.ui.pendingDraw = null; return render();
    case 'tgdraw': {
      const pd = state.ui.pendingDraw;
      if (!pd) return;
      state.ui.pendingDraw = null;
      return commit((st) => {
        const b = st.seats[pd.seat];
        b.river.push({ tile: pd.tile, draw: pd.tile, tsumogiri: true });
        st.ui.selected = { seat: pd.seat, idx: b.river.length - 1 };
      });
    }
    case 'deldraw': return commit((st) => { const s = st.ui.selected; delete st.seats[s.seat].river[s.idx].draw; });
    case 'river': {
      ev.stopPropagation();
      // 副露の入力中：相手の河の牌をタップすると「鳴く牌」になる（視点は動かさない）
      if (state.ui.mode === 'meld') {
        if (seat === state.ui.seat) return flash('鳴く牌は相手の河からタップしてください');
        if (state.seats[seat].river[idx].calledBy !== undefined && state.seats[seat].river[idx].calledBy !== state.ui.seat) return flash('その牌はもう鳴かれています');
        state.ui.meldTarget = { from: seat, idx };
        return render();
      }
      // 他家の河：視点を移してその牌を選ぶ。正面の河：選択の切り替え
      if (state.ui.seat !== seat || state.ui.mode !== 'river') return focus(seat, 'river', { selected: { seat, idx, tapped: true } });
      const cur = state.ui.selected;
      // 選んである牌をもう一度タップしたら削除（置いた直後の自動選択は数えない。間違えたら「戻す」）
      if (cur && cur.tapped && cur.seat === seat && cur.idx === idx) return commit((st) => { deleteRiver(st, seat, idx); });
      state.ui.selected = { seat, idx, tapped: true };
      state.ui.riverInsert = null;
      return render();
    }
    case 'settg': return commit((st) => { const s = st.ui.selected; st.seats[s.seat].river[s.idx].tsumogiri = v === 'u' ? undefined : v === '1'; });
    case 'riichi': return commit((st) => {
      const s = st.ui.selected; const river = st.seats[s.seat].river;
      const on = !river[s.idx].riichi;
      river.forEach((r) => { delete r.riichi; });
      if (on) { river[s.idx].riichi = true; river.forEach((r, i) => { if (i > s.idx && r.tsumogiri !== false) r.tsumogiri = true; }); }
    });
    case 'delriver': return commit((st) => { deleteRiver(st, st.ui.selected.seat, st.ui.selected.idx); });
    case 'fix': {
      const is = currentIssues[Number(v)];
      if (is?.fix?.kind === 'tsumogiri') return commit((st) => { st.seats[is.fix.seat].river[is.fix.index].tsumogiri = true; });
      return;
    }
    case 'unmeld': return commit((st) => {
      const sel = st.ui.selected; const r = st.seats[sel.seat].river[sel.idx];
      const by = r.calledBy;
      const i = st.seats[by].melds.findIndex((m) => m.from === sel.seat && m.riverIndex === sel.idx);
      if (i >= 0) removeMeld(st, by, i); else delete r.calledBy;
    });
    case 'hand': {
      ev.stopPropagation();
      // 副露の入力中に他家の手牌をタップ：鳴く家をその家に変える（選んだ鳴く牌はそのまま）
      if (state.ui.mode === 'meld' && seat !== state.ui.seat) {
        const target = state.ui.meldTarget && state.ui.meldTarget.from !== seat ? state.ui.meldTarget : null;
        return focus(seat, 'meld', { meldTarget: target });
      }
      // 他家の手牌：視点を移して手牌の編集に入る（牌は消さない）。正面の手牌：その牌を選ぶ
      if (state.ui.seat !== seat || state.ui.mode !== 'hand') return focus(seat, 'hand');
      const sh = state.ui.selectedHand;
      if (sh && sh.seat === seat && sh.idx === idx) {
        return commit((st) => { handArrOf(st, seat).splice(idx, 1); st.ui.selectedHand = null; });
      }
      state.ui.selectedHand = { seat, idx };
      return render();
    }
    case 'meld': ev.stopPropagation(); return focus(seat, 'meld', { selectedMeld: { seat, idx } });
    case 'delmeld': return commit((st) => { const sm = st.ui.selectedMeld; removeMeld(st, sm.seat, sm.idx); st.ui.selectedMeld = null; });
    case 'kakan': return commit((st) => {
      const sm = st.ui.selectedMeld; const b = st.seats[sm.seat]; const pon = b.melds[sm.idx];
      const k = kindOf(pon.called);
      const red = k % 10 === 5 && k < 40 ? 51 + Math.floor(k / 10) - 1 : null;
      const added = red && remaining(red, usedCounts()) > 0 ? red : k;
      b.melds.push({ kind: 'kakan', ponIndex: sm.idx, added, afterOwnDiscard: b.river.length });
      st.ui.selectedMeld = null;
    });
    case 'meldok': return confirmMeld();
    case 'meldclear': state.ui.pendingOwn = []; return render();
    case 'ankan': state.ui.ankanNext = !state.ui.ankanNext; return render();
    case 'deldora': return commit((st) => { (el.dataset.kind === 'dora' ? st.setup.doraIndicators : st.setup.uraIndicators).splice(idx, 1); });
    case 'rkind': return commit((st) => { st.result.kind = v; });
    case 'build': return runReconstruct();
    case 'toggleissues': state.ui.issuesOpen = !state.ui.issuesOpen; return render();
    case 'goissue': {
      const is = currentIssues[Number(v)];
      if (is.seat !== undefined) state.ui.seat = is.seat;
      state.ui.mode = is.area === 'hand' || is.area === 'haipai' ? 'hand' : is.area === 'meld' ? 'meld' : is.area === 'result' ? 'result' : 'river';
      if (is.area === 'haipai') state.ui.handTarget = 'haipai';
      if (is.area === 'hand' && state.seats[is.seat]?.hand.length) state.ui.handTarget = 'hand';
      if (is.area === 'river' && is.index !== undefined && is.index < state.seats[is.seat].river.length) state.ui.selected = { seat: is.seat, idx: is.index };
    render();
      document.querySelector('.table-wrap')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    case 'copy':
      navigator.clipboard?.writeText(state.ui.output.url).then(() => flash('コピーしました'), () => flash('コピーできませんでした。下の欄から選択してコピーしてください'));
      return;
    case 'undo': return undo();
    case 'clear': return commit((st) => { Object.assign(st, initial()); st.roundId = null; });
  }
});

document.addEventListener('change', (ev) => {
  if (ev.target.dataset?.act === 'gname') {
    const g = findRec(state.gameId);
    const name = ev.target.value.trim();
    if (g && name && name !== g.name) guarded(() => putRec({ ...g, name, savedAt: Date.now() }));
    return;
  }
  if (ev.target.dataset?.act === 'akasel') {
    const on = ev.target.value === '1';
    return commit((st) => {
      st.rule = on ? { disp: '般南喰赤', aka: 1 } : { disp: '般南喰', aka: 0 };
      if (on) return;
      // 赤なしに切り替えたら、入っている赤五は普通の五に置き換える
      let n = 0;
      const fix = (t) => { if (t >= 51 && t <= 53) { n++; return kindOf(t); } return t; };
      const fixArr = (a) => { if (!a) return; for (let i = 0; i < a.length; i++) a[i] = fix(a[i]); };
      fixArr(st.setup.doraIndicators); fixArr(st.setup.uraIndicators);
      if (st.result.winTile) st.result.winTile = fix(st.result.winTile);
      for (const b of st.seats) {
        fixArr(b.haipai); fixArr(b.hand);
        for (const r of b.river) { r.tile = fix(r.tile); if (r.draw !== undefined) r.draw = fix(r.draw); }
        for (const m of b.melds) {
          if (m.called !== undefined) m.called = fix(m.called);
          if (m.added !== undefined) m.added = fix(m.added);
          if (m.draw !== undefined) m.draw = fix(m.draw);
          fixArr(m.own); fixArr(m.tiles);
        }
      }
      if (n) st.ui.flashAfter = `赤なしにしました。入っていた赤五${n}枚は普通の五に変えました`;
    });
  }
  if (ev.target.dataset?.act === 'samplesel') {
    const v = ev.target.value;
    if (v !== '') loadSample(SAMPLES[Number(v)][1]);
    return;
  }
  const el = ev.target.closest('[data-bind]');
  if (!el) return;
  const path = el.dataset.bind.split('.');
  commit((st) => {
    let o = st;
    for (const k of path.slice(0, -1)) o = o[k];
    const last = path.at(-1);
    o[last] = el.type === 'number' || el.tagName === 'SELECT' ? Number(el.value) : el.value;
  });
});

window.__paifuEditor = { options: () => uiOptions, state: () => state, archive: () => arc }; // 自動テスト用
render();
initArchive();
