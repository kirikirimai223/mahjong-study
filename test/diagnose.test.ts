import { describe, expect, it } from 'vitest';
import { parseTenhou } from '../src/core/tenhou';
import { logToBoard } from '../src/core/board';
import { diagnose, seatCounts } from '../src/core/diagnose';
import { SAMPLE_URL, KAN_URL, RINSHAN_URL, CHANKAN_URL } from './fixtures';

const load = (u: string) => { const l = parseTenhou(u); return { board: logToBoard(l), names: l.meta.names }; };

describe('正しい終局図には何も出ない', () => {
  it.each([['南三局', SAMPLE_URL], ['四槓子', KAN_URL], ['嶺上開花', RINSHAN_URL], ['槍槓', CHANKAN_URL]])('%s', (_n, u) => {
    const { board, names } = load(u);
    expect(diagnose(board, names)).toEqual([]);
  });
});

describe('入力ミスを家と位置つきで返す', () => {
  it('手牌が1枚足りない', () => {
    const { board, names } = load(SAMPLE_URL);
    board.seats[0].hand.pop();
    expect(diagnose(board, names)).toEqual([
      { seat: 0, area: 'hand', message: 'Aさんの手牌が12枚（13枚のはず。あと1枚）' },
    ]);
  });

  it('副露のある家の手牌が多い', () => {
    const { board, names } = load(SAMPLE_URL);
    board.seats[1].hand.push(11);
    const [issue] = diagnose(board, names);
    expect(issue).toMatchObject({ seat: 1, area: 'hand' });
    expect(issue.message).toContain('10枚のはず。1枚多い');
  });

  it('河の途中の1枚が抜けている：その家の河が足りないと示す', () => {
    const { board, names } = load(SAMPLE_URL);
    board.seats[3].river.splice(5, 1); // Dさんの6打目を消す
    const issues = diagnose(board, names);
    expect(issues).toEqual([{ seat: 3, area: 'river', index: 16, message: 'Dさんの河が1枚足りない（17打目がない）' }]);
  });

  it('河に1枚多い：多い家の、手番に入らない牌の位置を示す', () => {
    const { board, names } = load(SAMPLE_URL);
    board.seats[0].river.push({ tile: 11, tsumogiri: false });
    const issues = diagnose(board, names);
    expect(issues).toEqual([{ seat: 0, area: 'river', index: 16, message: 'Aさんの17打目が多い（放銃したDさんの最後の打牌より後になる）' }]);
  });

  it('鳴かれた印だけ付いて副露がない', () => {
    const { board, names } = load(SAMPLE_URL);
    board.seats[1].melds = [];
    board.seats[1].hand.push(26, 28);
    const issues = diagnose(board, names);
    expect(issues).toContainEqual({ seat: 1, area: 'meld', message: '私：Aさんの16打目（七筒）を鳴いた副露が入っていない' });
  });

  it('立直後の手出し', () => {
    const { board, names } = load(SAMPLE_URL);
    board.seats[3].river[15].tsumogiri = false;
    expect(diagnose(board, names)).toContainEqual(expect.objectContaining({ seat: 3, area: 'river', index: 15 }));
  });

  it('途中の家の河が抜けて手番がずれる：残っている家と足りない家を両方示す', () => {
    const { board, names } = load(SAMPLE_URL);
    board.seats[1].river.splice(3, 1); // 私の4打目を消す（画面の削除と同じく、後ろの鳴きの位置も詰める）
    for (const b of board.seats) for (const m of b.melds) {
      if (m.kind !== 'ankan' && m.kind !== 'kakan' && m.from === 1 && m.riverIndex > 3) m.riverIndex--;
    }
    const issues = diagnose(board, names);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.area === 'river')).toBe(true);
    expect(issues.some((i) => i.seat === 1)).toBe(true);
  });

  it('席ごとの枚数：副露1つで手牌の目安が3枚減る', () => {
    const { board } = load(SAMPLE_URL);
    expect(seatCounts(board).map((c) => c.expectedHand)).toEqual([13, 10, 10, 13]);
  });
});

describe('入力途中（結果が未入力）', () => {
  const emptyBoard = () => {
    const { board, names } = load(SAMPLE_URL);
    const extra = [[21, 22, 23, 24], [25, 26, 27, 28], [29, 31, 32, 33], [34, 35, 36, 37]];
    // 赤ありなので、普通の五萬は3枚まで（1家だけ赤五萬）
    board.seats.forEach((b, s) => { b.river = []; b.melds = []; b.hand = [11, 12, 13, 14, s === 0 ? 51 : 15, 16, 17, 18, 19, ...extra[s]]; });
    board.winTile = undefined;
    return { board, names };
  };

  it('赤あり：普通の五が4枚あるとエラー／赤なし：赤があるとエラー、普通の五4枚はよい', () => {
    const { board, names } = emptyBoard();
    board.seats[0].hand[4] = 15;
    expect(diagnose(board, names, { resultEntered: false }).map((i) => i.message)).toEqual(['五萬（赤でない五）が4枚ある（赤ありなので3枚まで）']);
    board.meta.rule = { disp: '般南喰', aka: 0 };
    expect(diagnose(board, names, { resultEntered: false })).toEqual([]);
    board.seats[0].hand[4] = 51;
    expect(diagnose(board, names, { resultEntered: false }).map((i) => i.message)).toEqual(['赤なしのルールなのに赤五萬が入っている']);
  });

  it('配牌時点（全員13枚・河なし）はエラーにならない', () => {
    const { board, names } = emptyBoard();
    expect(diagnose(board, names, { resultEntered: false })).toEqual([]);
  });

  it('親が1枚切っただけの状態もエラーにならない', () => {
    const { board, names } = emptyBoard();
    const dealer = board.setup.kyoku % 4;
    board.seats[dealer].river.push({ tile: 47, tsumogiri: true });
    expect(diagnose(board, names, { resultEntered: false })).toEqual([]);
  });

  it('1家の河をまとめて先に入れても、途中ならエラーにならない', () => {
    const { board, names } = load(SAMPLE_URL);
    [0, 1, 3].forEach((s) => { board.seats[s].river = board.seats[s].river.map(({ calledBy, ...r }) => r); });
    board.seats.forEach((b) => { b.melds = []; });
    board.seats[1].river = []; board.seats[2].river = []; board.seats[3].river = [];
    board.seats[1].hand.push(26, 28, 11); board.seats[2].hand.push(25, 26, 11);
    expect(diagnose(board, names, { resultEntered: false })).toEqual([]);
  });

  it('手牌をまだ入れていない家は、入力途中ならエラーにしない', () => {
    const { board, names } = emptyBoard();
    board.seats[2].hand = [];
    expect(diagnose(board, names, { resultEntered: false })).toEqual([]);
    expect(diagnose(board, names, { resultEntered: true }).some((i) => i.area === 'hand')).toBe(true);
  });

  it('入力途中でも、手牌の枚数違いや立直後の手出しは知らせる', () => {
    const { board, names } = load(SAMPLE_URL);
    board.seats[0].hand.pop();
    board.seats[3].river[15].tsumogiri = false;
    const issues = diagnose(board, names, { resultEntered: false });
    expect(issues.map((i) => i.area).sort()).toEqual(['hand', 'river']);
  });
});

describe('配牌を入れた場合のチェック', () => {
  const withHaipai = () => { const l = parseTenhou(SAMPLE_URL); return { board: logToBoard(l, { haipai: true }), names: l.meta.names }; };

  it('配牌と倒した手牌の両方が正しければ何も出ない', () => {
    const { board, names } = withHaipai();
    expect(diagnose(board, names)).toEqual([]);
  });

  it('配牌だけ（倒した手牌なし）でもエラーにならない。和了者には注意だけ出る', () => {
    const { board, names } = withHaipai();
    board.seats.forEach((b) => { b.hand = []; });
    const issues = diagnose(board, names);
    expect(issues).toEqual([expect.objectContaining({ seat: 2, area: 'hand', level: 'warn' })]);
  });

  it('配牌が12枚', () => {
    const { board, names } = withHaipai();
    board.seats[0].haipai!.pop();
    expect(diagnose(board, names)).toContainEqual(expect.objectContaining({ seat: 0, area: 'haipai', message: 'Aさんの手牌（開始時）が12枚（13枚のはず。あと1枚）' }));
  });

  it('配牌にない牌を1打目で手出し：その河の位置を示す', () => {
    const { board, names } = withHaipai();
    const c = board.seats[2];
    c.hand = [];
    c.river[0].tsumogiri = false;
    c.haipai = c.haipai!.filter((t) => t !== c.river[0].tile);
    while (c.haipai.length < 13) c.haipai.push(41);
    const issues = diagnose(board, names, { resultEntered: false });
    expect(issues).toContainEqual(expect.objectContaining({ seat: 2, area: 'river', index: 0 }));
  });

  it('配牌も倒した手牌もない家（結果入力後）', () => {
    const { board, names } = withHaipai();
    board.seats[3].hand = []; delete board.seats[3].haipai;
    expect(diagnose(board, names)).toContainEqual({ seat: 3, area: 'hand', message: 'Dさんの手牌（開始時の13枚）を入れてください' });
  });
});

describe('配牌にない牌を1打目に切る', () => {
  const setup = (flag: boolean | undefined) => {
    const l = parseTenhou(SAMPLE_URL);
    const board = logToBoard(l, { haipai: true });
    board.seats.forEach((b) => { b.river = []; b.melds = []; b.hand = []; });
    const dealer = board.setup.kyoku % 4;
    const notInHaipai = [11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 24, 25, 26, 27, 28, 29].find((t) => !board.seats[dealer].haipai!.includes(t))!;
    board.seats[dealer].river.push({ tile: notInHaipai, tsumogiri: flag });
    return { board, names: l.meta.names, dealer };
  };
  it('手出し/ツモ切りが自動（未指定）なら、ツモ切りとして成り立つのでエラーにしない', () => {
    const { board, names } = setup(undefined);
    expect(diagnose(board, names, { resultEntered: false })).toEqual([]);
  });
  it('ツモ切りならエラーにしない', () => {
    const { board, names } = setup(true);
    expect(diagnose(board, names, { resultEntered: false })).toEqual([]);
  });
  it('手出しにしてあれば、エラーと「ツモ切りにする」の直し方を出す', () => {
    const { board, names, dealer } = setup(false);
    const [issue] = diagnose(board, names, { resultEntered: false });
    expect(issue).toMatchObject({ seat: dealer, area: 'river', index: 0, fix: { kind: 'tsumogiri', seat: dealer, index: 0 } });
    expect(issue.message).toContain('ツモ切りなら成り立ちます');
  });
});
