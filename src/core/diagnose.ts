import { BoardSnapshot, Seat, SEATS, dealerOf, kindOf, shimochaOf, tileName } from './types';
import { BoardError, effectiveTsumogiri, forwardPlan, knownTiles, replayTurns, seededRandom } from './board';

/**
 * 入力中の終局図のどこがおかしいかを、家と位置つきで返す。
 * 画面はこの結果で、該当する家・牌・空き枠を赤く示す。
 */
export interface Issue {
  seat?: Seat;
  area: 'hand' | 'haipai' | 'river' | 'meld' | 'result' | 'tiles';
  /** warn は出力を止めない注意 */
  level?: 'warn';
  /** ワンタップで直せる場合の直し方 */
  fix?: { kind: 'tsumogiri'; seat: Seat; index: number; label: string };
  /** river のとき：問題の牌の位置。河の長さと同じ値なら「ここに牌が足りない」 */
  index?: number;
  message: string;
}

export interface SeatCounts {
  hand: number;
  expectedHand: number;
  haipai: number;
  river: number;
}

const nonKakanMelds = (b: BoardSnapshot['seats'][number]) => b.melds.filter((m) => m.kind !== 'kakan').length;

export function seatCounts(board: BoardSnapshot): SeatCounts[] {
  return board.seats.map((b) => ({
    hand: b.hand.length,
    expectedHand: 13 - 3 * nonKakanMelds(b),
    haipai: b.haipai?.length ?? 0,
    river: b.river.length,
  }));
}

export interface DiagnoseOptions {
  /** 結果（和了／流局）が入力済みか。未入力の間は、局の終わり方に関わるチェックをしない */
  resultEntered?: boolean;
}

export function diagnose(board: BoardSnapshot, names: readonly string[], opts: DiagnoseOptions = {}): Issue[] {
  const resultEntered = opts.resultEntered ?? true;
  const issues: Issue[] = [];
  const nm = (s: Seat) => names[s];
  const r = board.result;

  // 1. 同じ牌が5枚以上（配牌と、河・副露・倒した手牌の重なりは1枚と数える）
  const count = new Map<number, number>();
  for (const t of knownTiles(board)) count.set(kindOf(t), (count.get(kindOf(t)) ?? 0) + 1);
  for (const [k, n] of count) if (n > 4) issues.push({ area: 'tiles', message: `${tileName(k)}が${n}枚ある（4枚まで）` });
  // 赤の枚数：赤ありは各色の五が「赤1枚＋普通の五3枚」、赤なしは赤を使わない
  const aka = board.meta.rule.aka !== 0;
  const known = knownTiles(board);
  for (const red of [51, 52, 53]) {
    const reds = known.filter((t) => t === red).length;
    const blacks = known.filter((t) => t === kindOf(red)).length;
    if (!aka && reds) issues.push({ area: 'tiles', message: `赤なしのルールなのに${tileName(red)}が入っている` });
    if (aka && reds > 1) issues.push({ area: 'tiles', message: `${tileName(red)}が${reds}枚ある（1枚まで）` });
    if (aka && blacks > 3) issues.push({ area: 'tiles', message: `${tileName(kindOf(red))}（赤でない五）が${blacks}枚ある（赤ありなので3枚まで）` });
  }

  // 2. 手牌の枚数（副露1つにつき3枚減る。自摸の和了牌は別に入れる）
  seatCounts(board).forEach((c, s) => {
    if (c.haipai > 0 && c.haipai !== 13) {
      issues.push({ seat: s as Seat, area: 'haipai', message: `${nm(s as Seat)}の手牌（開始時）が${c.haipai}枚（13枚のはず。${c.haipai < 13 ? `あと${13 - c.haipai}枚` : `${c.haipai - 13}枚多い`}）` });
    }
    if (c.hand === 0) {
      // 倒した手牌は、配牌を入れていれば無くてもよい
      if (resultEntered && c.haipai === 0) issues.push({ seat: s as Seat, area: 'hand', message: `${nm(s as Seat)}の手牌（開始時の13枚）を入れてください` });
      else if (resultEntered && r.kind === 'agari' && r.winner === s && !finalHandDetermined(board, s as Seat)) {
        issues.push({ seat: s as Seat, area: 'hand', level: 'warn', message: `${nm(s as Seat)}（和了者）のツモが入っていない巡があるので、和了形はランダムになります` });
      }
      return;
    }
    if (c.hand === c.expectedHand) return;
    const diff = c.expectedHand - c.hand;
    issues.push({
      seat: s as Seat, area: 'hand',
      message: `${nm(s as Seat)}の手牌が${c.hand}枚（${c.expectedHand}枚のはず。${diff > 0 ? `あと${diff}枚` : `${-diff}枚多い`}）`,
    });
  });

  // 3. 鳴かれた印と副露の対応
  let meldOk = true;
  SEATS.forEach((from) => board.seats[from].river.forEach((t, i) => {
    if (t.calledBy === undefined) return;
    const by = t.calledBy;
    const found = board.seats[by].melds.some((m) => m.kind !== 'ankan' && m.kind !== 'kakan' && m.from === from && m.riverIndex === i);
    if (!found) {
      meldOk = false;
      issues.push({ seat: by, area: 'meld', message: `${nm(by)}：${nm(from)}の${i + 1}打目（${tileName(t.tile)}）を鳴いた副露が入っていない` });
    }
  }));
  SEATS.forEach((s) => board.seats[s].melds.forEach((m) => {
    if (m.kind === 'ankan' || m.kind === 'kakan') return;
    const src = board.seats[m.from].river[m.riverIndex];
    if (!src || src.calledBy !== s) {
      meldOk = false;
      issues.push({ seat: s, area: 'meld', message: `${nm(s)}の副露（${tileName(m.called)}）の元になる牌が${nm(m.from)}の河にない` });
    }
  }));

  // 3b. ツモ牌とツモ切りの食い違い
  SEATS.forEach((s) => board.seats[s].river.forEach((t, i) => {
    if (t.draw !== undefined && t.tsumogiri === true && t.draw !== t.tile) {
      issues.push({ seat: s, area: 'river', index: i, message: `${nm(s)}の${i + 1}打目：ツモ切りなのに、ツモ牌（${tileName(t.draw)}）と捨て牌（${tileName(t.tile)}）が違う` });
    }
  }));

  // 4. 立直後の手出し
  SEATS.forEach((s) => {
    const river = board.seats[s].river;
    const ri = river.findIndex((t) => t.riichi);
    if (ri < 0) return;
    river.forEach((t, i) => {
      if (i > ri && effectiveTsumogiri(t) === false) issues.push({ seat: s, area: 'river', index: i, message: `${nm(s)}の${i + 1}打目：立直後なのに手出しになっている` });
    });
  });

  // 5. 手番の流れ（鳴きの対応が取れているときだけ見る）
  if (meldOk) issues.push(...turnIssues(board, nm, resultEntered));

  // 5b. 配牌から順に追って、手出しした牌が手の中にない所
  if (meldOk) {
    const steps = replayTurns(board, false);
    SEATS.forEach((s) => {
      const b = board.seats[s];
      if (!b.haipai || b.haipai.length !== 13) return;
      try {
        forwardPlan(board, s, steps, undefined, seededRandom(1), names);
      } catch (e) {
        if (!(e instanceof BoardError)) throw e;
        const ri = (e as BoardError & { riverIndex?: number }).riverIndex;
        const issue: Issue = { seat: s, area: ri !== undefined ? 'river' : 'haipai', index: ri, message: e.message };
        // 手出しにしていた牌が、ツモ切りなら成り立つか
        if (ri !== undefined && b.river[ri].tsumogiri === false) {
          const trial = structuredClone(board);
          trial.seats[s].river[ri].tsumogiri = true;
          let ok = true;
          try { forwardPlan(trial, s, steps, undefined, seededRandom(1), names); } catch (e2) {
            ok = !(e2 instanceof BoardError && (e2 as BoardError & { riverIndex?: number }).riverIndex === ri);
          }
          if (ok) {
            issue.message += '。ツモ切りなら成り立ちます';
            issue.fix = { kind: 'tsumogiri', seat: s, index: ri, label: 'ツモ切りにする' };
          }
        }
        issues.push(issue);
      }
    });
  }

  // 6. 結果
  if (resultEntered && r.kind === 'agari' && r.winner === r.from && board.winTile === undefined) {
    issues.push({ seat: r.winner, area: 'result', message: `${nm(r.winner!)}の自摸の和了牌が入っていない` });
  }
  return issues;
}

/** 配牌と全巡のツモが入っていて、最終形が決まるか */
function finalHandDetermined(board: BoardSnapshot, s: Seat): boolean {
  if ((board.seats[s].haipai ?? []).length !== 13) return false;
  try {
    return forwardPlan(board, s, replayTurns(board, false), undefined, seededRandom(1)).open.length === 0;
  } catch { return false; }
}

function turnIssues(board: BoardSnapshot, nm: (s: Seat) => string, resultEntered: boolean): Issue[] {
  const issues: Issue[] = [];
  const r = board.result;
  const ri = [0, 0, 0, 0];
  const kansDone = new Set<object>();
  const isTsumoWinner = (s: Seat) => r.kind === 'agari' && r.winner === s && r.from === s;
  const pendingKan = (s: Seat) => board.seats[s].melds.some(
    (m) => (m.kind === 'ankan' || m.kind === 'kakan') && !kansDone.has(m) && m.afterOwnDiscard === ri[s],
  );
  let cur: Seat = dealerOf(board.setup);
  let needDraw = true;
  let justCalled = false;
  let lastDiscarder: Seat | undefined;
  let lastWasKan = false;
  const log: { seat: Seat; index: number }[] = [];

  for (let guard = 0; guard < 1000; guard++) {
    const b = board.seats[cur];
    const done = ri[cur] >= b.river.length;
    if (needDraw && done && !isTsumoWinner(cur) && !pendingKan(cur)) break;
    lastWasKan = false;
    for (const m of b.melds) {
      if ((m.kind === 'ankan' || m.kind === 'kakan') && !kansDone.has(m) && m.afterOwnDiscard === ri[cur]) {
        kansDone.add(m);
        lastWasKan = true;
      }
    }
    if (done) break;
    const idx = ri[cur]++;
    const t = b.river[idx];
    if (justCalled && t.draw !== undefined) {
      issues.push({ seat: cur, area: 'river', index: idx, message: `${nm(cur)}の${idx + 1}打目：鳴いた直後なのでツモはないが、ツモ牌（${tileName(t.draw)}）が入っている` });
    } else if (justCalled && t.tsumogiri === true) {
      issues.push({ seat: cur, area: 'river', index: idx, message: `${nm(cur)}の${idx + 1}打目：鳴いた直後なのにツモ切りになっている` });
    }
    lastDiscarder = cur;
    log.push({ seat: cur, index: idx });
    if (t.calledBy !== undefined) {
      const by = t.calledBy;
      const m = board.seats[by].melds.find((x) => x.kind !== 'ankan' && x.kind !== 'kakan' && x.from === cur && x.riverIndex === idx);
      cur = by;
      needDraw = m?.kind === 'daiminkan';
      justCalled = m?.kind !== 'daiminkan';
    } else {
      cur = shimochaOf(cur);
      needDraw = true;
      justCalled = false;
    }
  }

  // 入力途中（結果が未入力）：どこで止まっていても、河の残りがあっても矛盾ではない
  if (!resultEntered) return issues;

  const left = SEATS.filter((s) => ri[s] < board.seats[s].river.length);
  if (left.length > 0) {
    // cur の番で河が尽きたのに、ほかの家の河が残っている
    const rest = left.map((s) => `${nm(s)}${board.seats[s].river.length - ri[s]}枚`).join('・');
    issues.push({
      seat: cur, area: 'river', index: board.seats[cur].river.length,
      message: `${nm(cur)}の${ri[cur] + 1}打目がない。ここで${nm(cur)}の番だが、まだ河が残っている（${rest}）。${nm(cur)}の河の抜けか、他家の河の入れすぎ・鳴きの付け忘れを確認`,
    });
    for (const s of left) {
      issues.push({ seat: s, area: 'river', index: ri[s], message: `${nm(s)}の河の${ri[s] + 1}打目以降が手番に入らない（${nm(cur)}の河の抜けが原因の可能性）` });
    }
    return issues;
  }

  // 終わり方と結果の整合。合わないときは「足りない家」と「多い家」のうち、直す枚数が少ない方を示す
  const missingFrom = (start: Seat, until: Seat, inclusive: boolean): Seat[] => {
    const out: Seat[] = [];
    for (let s = start, k = 0; k < 4; s = shimochaOf(s), k++) {
      if (s === until) { if (inclusive) out.push(s); break; }
      out.push(s);
    }
    return out;
  };
  const reportMissing = (seats: Seat[]) => seats.forEach((s) => {
    const n = board.seats[s].river.length;
    issues.push({ seat: s, area: 'river', index: n, message: `${nm(s)}の河が1枚足りない（${n + 1}打目がない）` });
  });

  if (r.kind === 'agari' && r.winner !== r.from) {
    const from = r.from!;
    const chankan = lastWasKan && cur === from;
    if (!chankan && lastDiscarder !== from) {
      const lastFrom = log.map((e) => e.seat).lastIndexOf(from);
      const extras = lastFrom >= 0 ? log.slice(lastFrom + 1) : [];
      const missing = missingFrom(cur, from, true);
      if (extras.length > 0 && extras.length <= missing.length) {
        for (const e of extras) {
          issues.push({ seat: e.seat, area: 'river', index: e.index, message: `${nm(e.seat)}の${e.index + 1}打目が多い（放銃した${nm(from)}の最後の打牌より後になる）` });
        }
      } else {
        reportMissing(missing);
      }
    }
  }
  if (r.kind === 'agari' && r.winner === r.from && cur !== r.winner) {
    reportMissing(missingFrom(cur, r.winner!, false));
  }
  // チー・ポンした家は必ず続けて切る。局が「鳴いただけ」で終わることはない（流局も自摸和了もできない）
  const tsumoAfterCall = r.kind === 'agari' && r.winner === r.from && r.winner === cur;
  if (justCalled && (r.kind !== 'agari' || tsumoAfterCall)) {
    const n = board.seats[cur].river.length;
    issues.push({ seat: cur, area: 'river', index: n, message: `${nm(cur)}が鳴いた後の打牌がない（${n + 1}打目）。鳴いたら続けて1枚切ります` });
  }
  // 荒牌流局は山を引き切ったときだけ起きる（ツモは嶺上牌を含めて70回）。途中で止めた局は牌譜として成り立たない
  if (r.kind === 'ryukyoku' && EXHAUSTIVE.has(String(r.raw[0] ?? '流局')) && issues.length === 0) {
    const draws = countDraws(board);
    if (draws < WALL_DRAWS) {
      issues.push({
        area: 'result', level: 'warn',
        message: `流局（${r.raw[0]}）だが、ツモがまだ${WALL_DRAWS - draws}回残っている（${draws}/${WALL_DRAWS}回）。山を引き切る前の流局は天鳳の牌譜として成り立たず、NAGAなどで解析できない`,
      });
    }
  }
  return issues;
}

/** 山を引き切って終わる流局（途中流局は含めない） */
const EXHAUSTIVE = new Set(['流局', '全員聴牌', '全員不聴', '流し満貫']);
/** 王牌14枚と配牌52枚を除いた山の枚数＝ツモの回数（槓をすると王牌が補われるので、嶺上牌も含めて数は変わらない） */
const WALL_DRAWS = 70;
function countDraws(board: BoardSnapshot): number {
  try { return replayTurns(board, false).filter((x) => x.kind === 'draw').length; } catch { return WALL_DRAWS; }
}
