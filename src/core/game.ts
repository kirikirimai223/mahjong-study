// 半荘（複数局）のまとめ：次の局の開始条件と、複数局の天鳳JSON
import type { BoardSnapshot, RoundSetup, Seat } from './types';
import type { TenhouJson } from './tenhou';

/** この局で立直が成立した家（立直宣言牌でロンされた場合は不成立） */
export function riichiSeats(board: BoardSnapshot): Seat[] {
  const out: Seat[] = [];
  board.seats.forEach((b, s) => {
    const i = b.river.findIndex((r) => r.riichi);
    if (i < 0) return;
    const r = board.result;
    const ronOnDeclare = r.kind === 'agari' && r.from === s && r.winner !== s && i === b.river.length - 1;
    if (!ronOnDeclare) out.push(s as Seat);
  });
  return out;
}

const ABORTIVE = /九種|四風|四家|四開|四槓|三家|途中/;

export type NextRound = {
  setup: Pick<RoundSetup, 'kyoku' | 'honba' | 'kyotaku' | 'scores'>;
  /** 親が続くか */
  renchan: boolean;
  /** 流局で収支がすべて0（全員聴牌か全員ノーテンか分からない） */
  ambiguous: boolean;
  /** 南四局が終わった（親が続く場合を除く） */
  finished: boolean;
};

/**
 * 結果から次の局の局・本場・供託・持ち点を出す。
 * 天鳳形式の収支には立直棒の1000点が入っていないので、立直した家から引く。
 * 和了者の収支には供託と本場がすでに入っている前提。
 */
export function nextRound(
  setup: Pick<RoundSetup, 'kyoku' | 'honba' | 'kyotaku' | 'scores'>,
  result: { kind: 'agari' | 'ryukyoku'; winners?: Seat[]; reason?: string; deltas: number[] },
  riichi: Seat[],
): NextRound {
  const dealer = setup.kyoku % 4;
  const scores = setup.scores.map((p, s) => p + (result.deltas[s] ?? 0) - (riichi.includes(s as Seat) ? 1000 : 0)) as RoundSetup["scores"];
  let renchan: boolean;
  let ambiguous = false;
  let honba: number;
  let kyotaku: number;
  if (result.kind === 'agari') {
    renchan = (result.winners ?? []).includes(dealer as Seat);
    honba = renchan ? setup.honba + 1 : 0;
    kyotaku = 0;
  } else {
    honba = setup.honba + 1;
    kyotaku = setup.kyotaku + riichi.length;
    if (result.reason && ABORTIVE.test(result.reason)) renchan = true;
    else if (result.deltas.every((d) => !d)) { renchan = false; ambiguous = true; }
    else renchan = (result.deltas[dealer] ?? 0) > 0;
  }
  const kyoku = renchan ? setup.kyoku : setup.kyoku + 1;
  return { setup: { kyoku: Math.min(kyoku, 7), honba, kyotaku, scores }, renchan, ambiguous, finished: kyoku > 7 };
}

/** 1局ずつの天鳳JSONを、局の順に1つの牌譜（log に複数局）にまとめる */
export function combineTenhou(jsons: TenhouJson[], title?: [string, string]): TenhouJson {
  if (!jsons.length) throw new Error('まとめる局がありません');
  const head = jsons[0];
  return { title: title ?? head.title, name: head.name, rule: head.rule, log: jsons.flatMap((j) => j.log) };
}

export const tenhouUrlOf = (json: TenhouJson): string =>
  `https://tenhou.net/6/#json=${encodeURIComponent(JSON.stringify(json))}`;
