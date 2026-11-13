// 鳴き・槓の候補を、その家の今の手牌から作る（画面から使う純粋関数）
import { kindOf } from '../core/types';

const isRed = (t) => t >= 51 && t <= 53;

/** 手牌から、牌の種類 k の牌を n 枚選ぶ選び方（赤五と黒五は別の選び方として数える） */
export function chooseKind(hand, k, n) {
  const tiles = hand.filter((t) => kindOf(t) === k);
  const reds = tiles.filter(isRed).length;
  const blacks = tiles.length - reds;
  const out = [];
  for (let r = Math.min(reds, n); r >= 0; r--) {
    const b = n - r;
    if (b <= blacks) out.push([...Array(b).fill(k), ...tiles.filter(isRed).slice(0, r)]);
  }
  return out;
}

/** 捨て牌 t を、席 seat（捨てた家 from）が鳴く候補 */
export function callOptions(hand, t, seat, from) {
  const k = kindOf(t);
  const opts = [];
  if (seat === (from + 1) % 4 && k < 40) {
    const n = k % 10;
    const suit = k - n;
    for (const [a, b] of [[n - 2, n - 1], [n - 1, n + 1], [n + 1, n + 2]]) {
      if (a < 1 || b > 9) continue;
      for (const x of chooseKind(hand, suit + a, 1)) for (const y of chooseKind(hand, suit + b, 1)) {
        opts.push({ kind: 'chi', own: [...x, ...y] });
      }
    }
  }
  for (const own of chooseKind(hand, k, 2)) opts.push({ kind: 'pon', own });
  for (const own of chooseKind(hand, k, 3)) opts.push({ kind: 'daiminkan', own });
  return opts;
}

/** ツモ後の暗槓・加槓の候補。hand はツモ牌を含めた手 */
export function kanOptions(hand, melds) {
  const opts = [];
  const kinds = [...new Set(hand.map(kindOf))];
  for (const k of kinds) for (const tiles of chooseKind(hand, k, 4)) opts.push({ kind: 'ankan', tiles });
  melds.forEach((m, i) => {
    if (m.kind !== 'pon' || melds.some((x) => x.kind === 'kakan' && x.ponIndex === i)) return;
    for (const [added] of chooseKind(hand, kindOf(m.called), 1)) opts.push({ kind: 'kakan', ponIndex: i, added });
  });
  return opts;
}
