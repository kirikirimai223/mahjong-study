import { describe, expect, it } from 'vitest';
import { parseTenhou } from '../src/core/tenhou';
import { logToBoard } from '../src/core/board';
import { replayFrames } from '../src/core/replay';
import { kindOf } from '../src/core/types';
import { SAMPLE_URL, KAN_URL, RINSHAN_URL, CHANKAN_URL } from './fixtures';

const sorted = (a: number[]) => [...a].sort((x, y) => x - y);

describe.each([['南三局', SAMPLE_URL], ['四槓子', KAN_URL], ['嶺上開花', RINSHAN_URL], ['槍槓', CHANKAN_URL]])('%s の再生', (_, url) => {
  const log = parseTenhou(url);
  const board = logToBoard(log);
  const all = replayFrames(log);
  const frames = all.filter((f) => !f.end);

  it('局面は各家の河と同じ数・同じ順（エディタの河の位置で局面を指せる）', () => {
    for (let s = 0; s < 4; s++) {
      const mine = frames.filter((f) => f.seat === s);
      expect(mine.map((f) => f.discardIndex)).toEqual(board.seats[s].river.map((_, i) => i));
      expect(mine.map((f) => f.tile)).toEqual(board.seats[s].river.map((r) => r.tile));
    }
  });

  it('打牌の直前は、手牌＋ツモ牌が「14枚−副露1つにつき3枚」（鳴いた直後はツモなしで同じ枚数）', () => {
    for (const f of frames) {
      const me = f.seats[f.seat];
      const n = me.hand.length + (me.drawn !== undefined ? 1 : 0);
      expect(n).toBe(14 - 3 * me.melds.length);
      expect([...me.hand, ...(me.drawn !== undefined ? [me.drawn] : [])]).toContain(f.tile);
    }
  });

  it('切った牌は次の局面で河に入り、鳴かれた牌には印が付く', () => {
    const last = frames.at(-1)!;
    const calledInBoard = board.seats.flatMap((b) => b.river.filter((r) => r.calledBy !== undefined)).length;
    const calledInReplay = last.seats.flatMap((b) => b.river.filter((r) => r.called)).length;
    // 最後の打牌の後に鳴かれることはない（鳴きは次の打牌の前に反映される）
    expect(calledInReplay).toBe(calledInBoard);
  });

  it('最後に和了の1コマが付き、和了した家の手牌と和了牌（ツモ牌・放銃牌）が出る', () => {
    const end = all.at(-1)!;
    expect(end.end).toBeDefined();
    const w = board.result.winner!;
    expect(end.end).toMatchObject({ kind: board.result.from === w ? 'tsumo' : 'ron', winner: w });
    const me = end.seats[w];
    if (end.end!.kind === 'tsumo') expect(me.drawn).toBe(end.end!.tile);
    else {
      // ロン：放銃者の最後の打牌（槍槓なら加槓した牌）
      const from = end.seats[board.result.from!];
      const kakan = from.melds.find((m) => m.kind === 'kakan' && m.tiles.at(-1) === end.end!.tile);
      expect(kakan ? end.end!.tile : from.river.at(-1)!.tile).toBe(end.end!.tile);
    }
    // 和了形：手牌（＋ツモ牌）＋和了牌 が「14枚−副露1つにつき3枚」
    const n = me.hand.length + 1;
    expect(n).toBe(14 - 3 * me.melds.length);
    expect(end.end!.points).not.toBe('');
  });

  it('最後の打牌の時点で、他の家の手牌は終局図の手牌と同じ（自摸和了者は最後の打牌の後に槓・ツモがあるので除く）', () => {
    const last = frames.at(-1)!;
    const tsumoWinner = board.winTile !== undefined ? board.result.winner : undefined;
    for (let s = 0; s < 4; s++) {
      if (s === last.seat || s === tsumoWinner) continue;
      const me = last.seats[s];
      const hand = [...me.hand, ...(me.drawn !== undefined ? [me.drawn] : [])].map(kindOf);
      const expectHand = board.seats[s].hand.map(kindOf);
      expect(sorted(hand)).toEqual(sorted(expectHand));
    }
  });
});
