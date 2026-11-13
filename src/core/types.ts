// 牌は天鳳のコードをそのまま使う（11-19萬 21-29筒 31-39索 41-47字 51-53赤五）
export type Tile = number;
// 起家（東一局の親）を0とする席番号。天鳳JSONの並びと同じ
export type Seat = 0 | 1 | 2 | 3;

export interface RoundSetup {
  kyoku: number; // 0=東一局 … 7=南四局
  honba: number;
  kyotaku: number;
  scores: [number, number, number, number];
  doraIndicators: Tile[];
  uraIndicators: Tile[];
}

/** 天鳳JSONの結果配列はそのまま保持し、解析に使う項目だけ取り出す */
export interface RoundResult {
  raw: unknown[];
  kind: 'agari' | 'ryukyoku';
  winner?: Seat;
  from?: Seat; // 自摸和了なら winner と同じ
}

export interface GameMeta {
  title: string[];
  names: [string, string, string, string];
  rule: { disp: string; aka: number };
}

// ---- 中間形式：RoundLog（天鳳JSONと1対1） ----

export type TakeEntry =
  | { kind: 'draw'; tile: Tile }
  | { kind: 'chi' | 'pon' | 'daiminkan'; called: Tile; own: Tile[]; from: Seat };

export type DiscardEntry =
  | { kind: 'discard'; tile: Tile; tsumogiri: boolean; riichi: boolean }
  | { kind: 'dummy' } // 大明槓の後の位置合わせ
  | { kind: 'ankan'; tiles: Tile[] }
  | { kind: 'kakan'; added: Tile; called: Tile; own: Tile[]; from: Seat };

export interface SeatLog {
  haipai: Tile[];
  take: TakeEntry[];
  discard: DiscardEntry[];
}

export interface RoundLog {
  meta: GameMeta;
  setup: RoundSetup;
  seats: [SeatLog, SeatLog, SeatLog, SeatLog];
  result: RoundResult;
}

// ---- 入力形式：BoardSnapshot（終局図） ----

export interface RiverTile {
  tile: Tile;
  /** true=ツモ切り / false=手出し / 未指定=不明（ランダムで組むときに自由に決める） */
  tsumogiri?: boolean;
  /** この打牌の直前にツモった牌（嶺上牌を含む）。未指定ならランダムで組む */
  draw?: Tile;
  riichi?: boolean; // 横向き（立直宣言牌）
  calledBy?: Seat; // 鳴かれて河から消えた牌。元の位置に入れておく
}

export type Meld =
  | { kind: 'chi' | 'pon' | 'daiminkan'; from: Seat; riverIndex: number; called: Tile; own: Tile[] }
  | { kind: 'ankan'; tiles: Tile[]; afterOwnDiscard: number; draw?: Tile }
  | { kind: 'kakan'; ponIndex: number; added: Tile; afterOwnDiscard: number; draw?: Tile };
// ankan / kakan の draw は、槓する直前のツモ（槓のあとの嶺上牌は次の打牌の draw）

export interface SeatBoard {
  /** 配牌13枚。入力していなければ空か未指定（ランダムで組む） */
  haipai?: Tile[];
  river: RiverTile[]; // 捨てた順
  melds: Meld[]; // 鳴いた順
  /** 倒した手牌（自摸の和了牌は含めない）。入力していなければ空 */
  hand: Tile[];
}

export interface BoardSnapshot {
  meta: GameMeta;
  setup: RoundSetup;
  seats: [SeatBoard, SeatBoard, SeatBoard, SeatBoard];
  result: RoundResult;
  winTile?: Tile; // 自摸和了のときだけ。ロン牌は放銃者の河の最後の牌
}

export const SEATS: Seat[] = [0, 1, 2, 3];
export const dealerOf = (setup: RoundSetup): Seat => (setup.kyoku % 4) as Seat;
export const kamichaOf = (s: Seat): Seat => ((s + 3) % 4) as Seat;
export const toimenOf = (s: Seat): Seat => ((s + 2) % 4) as Seat;
export const shimochaOf = (s: Seat): Seat => ((s + 1) % 4) as Seat;
/** 赤五を黒の五と同じ種類として数えるためのキー */
export const kindOf = (t: Tile): Tile => (t >= 51 && t <= 53 ? (t - 51 + 1) * 10 + 5 : t);

const SUITS = ['萬', '筒', '索'];
const HONORS = ['東', '南', '西', '北', '白', '發', '中'];
const NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
/** エラー表示用の牌名（例: 13→三萬、52→赤五筒、45→白） */
export const tileName = (t: Tile): string => {
  if (t >= 51 && t <= 53) return `赤五${SUITS[t - 51]}`;
  if (t >= 41 && t <= 47) return HONORS[t - 41];
  return `${NUM[(t % 10) - 1]}${SUITS[Math.floor(t / 10) - 1]}`;
};
