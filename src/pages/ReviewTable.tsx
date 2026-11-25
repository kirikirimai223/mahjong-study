// 振り返りの卓：NAGAの解析画面のように、4人の河を中央の周りに、手牌を卓の縁に並べる。
// 選んだ視点の家を手前（下）にし、ほかの家は下家＝右・対面＝上・上家＝左に回して置く。
import type { ReplayFrame, ReplaySeat } from '../core/replay';
import { Tile } from '../lib/tiles';
import { probOf, type NagaDecision } from '../lib/naga';

const WIND = ['東', '南', '西', '北'];
const KYOKU = ['東一局', '東二局', '東三局', '東四局', '南一局', '南二局', '南三局', '南四局', '西一局', '西二局', '西三局', '西四局'];
const ROT = [0, -90, 180, 90]; // 手前・下家・対面・上家

export type TableSetup = { kyoku: number; honba: number; kyotaku: number; scores: number[]; doraIndicators: number[] };

export function ReviewTable({ frame, names, setup, view, randomized, naga, nagaType }: {
  frame: ReplayFrame; names: string[]; setup: TableSetup; view: number; randomized: number[];
  naga?: NagaDecision; nagaType: number;
}) {
  const dealer = setup.kyoku % 4;
  const end = frame.end;
  return (
    <div className="rtable" data-view={view}>
      <div className="r-center">
        <b>{KYOKU[setup.kyoku] ?? ''}</b>
        <small>{setup.honba}本場・供託{setup.kyotaku}</small>
        <span className="r-dora">{setup.doraIndicators.map((t, i) => <Tile key={i} t={t} />)}</span>
        {end && <span className={`r-end ${end.kind}`}>{end.kind === 'tsumo' ? 'ツモ' : end.kind === 'ron' ? 'ロン' : end.points}</span>}
      </div>
      {[0, 1, 2, 3].map((seat) => {
        const rel = (seat - view + 4) % 4;
        const s = frame.seats[seat];
        const acting = seat === frame.seat && !end;
        const winner = end && end.winner === seat;
        const ronFrom = end && end.kind === 'ron' && end.from === seat && end.from !== end.winner;
        return (
          <div key={seat} className={`r-layer rel${rel} ${acting ? 'acting' : ''} ${winner ? 'winner' : ''}`} style={{ transform: `rotate(${ROT[rel]}deg)` }}>
            <div className="r-label">
              <span className="w">{WIND[(seat - dealer + 4) % 4]}</span>{names[seat]}
              <span className="sc">{setup.scores[seat]}</span>
              {end && end.deltas[seat] ? <span className={`d ${end.deltas[seat] > 0 ? 'p' : 'm'}`}>{end.deltas[seat] > 0 ? '+' : ''}{end.deltas[seat]}</span> : null}
              {randomized.includes(seat) && <span className="guess">仮</span>}
            </div>
            <River s={s} ronTile={ronFrom ? s.river.length - 1 : -1} />
            <Hand s={s} big={rel === 0} cutTile={acting ? frame.tile : undefined}
              winTile={winner ? end!.tile : undefined} tsumo={!!winner && end!.kind === 'tsumo'}
              naga={acting ? naga : undefined} nagaType={nagaType} />
          </div>
        );
      })}
    </div>
  );
}

function River({ s, ronTile }: { s: ReplaySeat; ronTile: number }) {
  return (
    <div className="r-river">
      {s.river.map((x, i) => (
        <Tile key={i} t={x.tile} cls={`${x.riichi ? 'yoko' : ''} ${x.tsumogiri ? 'tg' : ''} ${x.called ? 'called' : ''} ${i === ronTile ? 'ron' : ''}`} />
      ))}
    </div>
  );
}

function Hand({ s, big, cutTile, winTile, tsumo, naga, nagaType }: {
  s: ReplaySeat; big: boolean; cutTile?: number; winTile?: number; tsumo: boolean; naga?: NagaDecision; nagaType: number;
}) {
  // 切った牌を1枚だけ強調する（ツモ切りならツモ牌、手出しなら手牌の同じ牌）
  const cutDrawn = cutTile !== undefined && s.drawn !== undefined && s.drawn === cutTile;
  const cutAt = cutTile !== undefined && !cutDrawn ? s.hand.findIndex((t) => t === cutTile) : -1;
  const bar = (t: number) => {
    if (!naga) return null;
    const p = probOf(naga, nagaType, t);
    return <span className="r-bar"><i style={{ height: `${Math.round((p ?? 0) * 100)}%` }} />{p != null && p >= 0.1 ? <em>{Math.round(p * 100)}</em> : null}</span>;
  };
  const extra = winTile !== undefined ? winTile : s.drawn;
  return (
    <div className={`r-hand ${big ? 'big' : ''} ${naga ? 'with-bars' : ''}`}>
      {s.hand.map((t, i) => <span key={i} className="r-ht"><Tile t={t} cls={i === cutAt ? 'cut' : ''} />{bar(t)}</span>)}
      {extra !== undefined && (
        <span className="r-ht drawn">
          <Tile t={extra} cls={`${cutDrawn ? 'cut' : ''} ${winTile !== undefined ? 'win' : ''}`} />
          {winTile === undefined && bar(extra)}
          {winTile !== undefined && <em className="r-win">{tsumo ? 'ツモ' : 'ロン'}</em>}
        </span>
      )}
      {s.melds.length > 0 && <span className="r-gap" />}
      {s.melds.map((m, i) => (
        <span key={i} className="r-meld">
          {m.tiles.map((t, j) => <Tile key={j} t={t} cls={`${m.kind === 'ankan' && (j === 0 || j === 3) ? 'back' : ''} ${m.called !== undefined && j === 0 ? 'yoko' : ''}`} />)}
        </span>
      ))}
    </div>
  );
}

/** NAGAの選択：打牌した家の手牌を大きく並べ、牌ごとの評価を下に棒と%で出す（NAGAの解析画面の手牌と同じ見せ方） */
export function NagaHand({ s, naga, nagaType, cutTile }: { s: ReplaySeat; naga: NagaDecision; nagaType: number; cutTile: number }) {
  const cutDrawn = s.drawn !== undefined && s.drawn === cutTile;
  const cutAt = !cutDrawn ? s.hand.findIndex((t) => t === cutTile) : -1;
  const cell = (t: number, cut: boolean, key: string | number, drawn = false) => {
    const p = probOf(naga, nagaType, t);
    return (
      <span key={key} className={`nh-t ${drawn ? 'drawn' : ''}`}>
        <Tile t={t} cls={cut ? 'cut' : ''} />
        <span className="nh-bar"><i style={{ height: `${Math.round((p ?? 0) * 100)}%` }} /></span>
        <small>{p == null ? '' : p >= 0.005 ? `${Math.round(p * 100)}` : ''}</small>
      </span>
    );
  };
  return (
    <div className="naga-hand">
      {s.hand.map((t, i) => cell(t, i === cutAt, i))}
      {s.drawn !== undefined && cell(s.drawn, cutDrawn, 'd', true)}
    </div>
  );
}
