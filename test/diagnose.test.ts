import { describe, expect, it } from 'vitest';
import { parseTenhou } from '../src/core/tenhou';
import { logToBoard } from '../src/core/board';
import { diagnose, expectedRiverCounts, seatCounts } from '../src/core/diagnose';
import { replayTurns } from '../src/core/board';
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
    const all = diagnose(board, names);
    const issues = all.filter((i) => i.level !== 'warn');
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.area === 'river')).toBe(true);
    expect(issues.some((i) => i.seat === 1)).toBe(true);
    // 鳴きの位置から数えた河の枚数も添える（私が1枚少ない）
    const hint = all.find((i) => i.message.startsWith('参考：'));
    expect(hint?.message).toContain('私は1枚少ない');
  });

  it('鳴きの位置から数えた河の枚数：元の牌譜ではいまの枚数と一致する', () => {
    for (const u of [SAMPLE_URL, KAN_URL, RINSHAN_URL, CHANKAN_URL]) {
      const { board } = load(u);
      expect(expectedRiverCounts(board)).toEqual(board.seats.map((b) => b.river.length));
    }
  });

  it('鳴いた直後の打牌にツモが入っているとき：「この手番を消す」「ツモだけ外す」を出す', () => {
    const { board, names } = load(SAMPLE_URL);
    // チーした家の、鳴いた直後の打牌にツモを入れてしまう
    const caller = board.seats.findIndex((b) => b.melds.some((m) => m.kind === 'chi'));
    const m = board.seats[caller].melds.find((x) => x.kind === 'chi')!;
    const callerRiver = board.seats[caller].river;
    const idx = expectedAfter(board, caller, m);
    callerRiver[idx].draw = 19;
    const is = diagnose(board, names).find((i) => i.message.includes('鳴いた直後なのでツモはない'));
    // 後ろにまだ打牌があれば「この手番を消す」も出す（消すと、後ろの打牌が鳴いた後の打牌になる）
    expect(is?.fixes?.map((f) => f.kind)).toEqual(idx + 1 < callerRiver.length ? ['dropturn', 'dropdraw'] : ['dropdraw']);
    expect(is).toMatchObject({ seat: caller, index: idx });
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

// NAGAで「JSONが間違っています」になった実際の入力（2026/11/14 報告）。下家がポンしたまま流局している
const PON_THEN_RYUKYOKU_URL = "https://tenhou.net/5/#json=%7B%22title%22%3A%5B%22%22,%22%22%5D,%22name%22%3A%5B%22%E8%87%AA%E5%88%86%22,%22%E4%B8%8B%E5%AE%B6%22,%22%E5%AF%BE%E9%9D%A2%22,%22%E4%B8%8A%E5%AE%B6%22%5D,%22rule%22%3A%7B%22disp%22%3A%22%E8%88%AC%E5%8D%97%E5%96%B0%E8%B5%A4%22,%22aka%22%3A1%7D,%22log%22%3A%5B%5B%5B0,0,0%5D,%5B25000,25000,25000,25000%5D,%5B28%5D,%5B%5D,%5B11,11,12,14,15,19,22,23,24,29,29,37,37%5D,%5B31,46,19,45,33,37,34,27,43%5D,%5B60,60,12,60,60,19,60,60,19%5D,%5B14,15,17,25,25,26,28,33,34,35,36,36,43%5D,%5B47,45,42,39,46,42,18,%22c272628%22,32,%222525p25%22%5D,%5B60,60,60,60,60,60,17,18,43%5D,%5B13,14,16,16,22,23,24,27,27,29,29,32,33%5D,%5B41,41,46,44,32,19,13,22,25%5D,%5B60,60,60,60,60,60,60,60,60%5D,%5B14,15,51,23,24,26,26,27,35,36,38,38,45%5D,%5B43,46,21,32,47,18,%22c131451%22,%22c222324%22%5D,%5B60,60,60,60,60,60,45,27%5D,%5B%22%E5%85%A8%E5%93%A1%E4%B8%8D%E8%81%B4%22%5D%5D%5D%7D";

describe('局の終わり方', () => {
  const ryukyoku = (u: string, reason = '全員不聴') => {
    const l = parseTenhou(u);
    l.result = { raw: [reason, [0, 0, 0, 0]], kind: 'ryukyoku' };
    const board = logToBoard(l, { haipai: true, draws: true });
    board.seats.forEach((b) => { b.hand = []; }); // エディタと同じく、配牌とツモだけで入力した状態
    return { board, names: l.meta.names };
  };
  it('鳴いた後に打牌がないまま流局しているとエラー（報告された牌譜）', () => {
    const { board, names } = ryukyoku(PON_THEN_RYUKYOKU_URL);
    const issues = diagnose(board, names, { resultEntered: true });
    expect(issues.find((i) => i.level !== 'warn')).toMatchObject({ seat: 1, area: 'river', index: 9, message: expect.stringContaining('鳴いた後の打牌がない') });
  });
  it('山を引き切る前の荒牌流局は注意を出す。途中流局（九種九牌）は出さない', () => {
    const { board, names } = ryukyoku(SAMPLE_URL, '流局');
    // 南三局は和了で終わった局。結果だけ流局にすると、最後の打牌の後でツモが残っている
    const w = diagnose(board, names, { resultEntered: true }).filter((i) => i.area === 'result');
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ level: 'warn', message: expect.stringContaining('ツモがまだ') });
    const k = ryukyoku(SAMPLE_URL, '九種九牌');
    expect(diagnose(k.board, k.names, { resultEntered: true }).filter((i) => i.area === 'result')).toEqual([]);
  });
  it('ちょうど70回ツモって流局した局には注意を出さない', () => {
    const { board, names } = ryukyoku(SAMPLE_URL, '流局');
    // 鳴きなしで、親から順に18・18・17・17回ツモって切る（牌の種類はこの確認に関係ない）
    const dealer = board.setup.kyoku % 4;
    board.seats.forEach((b, s) => {
      const n = [18, 18, 17, 17][(s - dealer + 4) % 4];
      b.river = Array.from({ length: n }, () => ({ tile: 11 }));
      b.melds = [];
    });
    expect(diagnose(board, names, { resultEntered: true }).filter((i) => i.area === 'result')).toEqual([]);
  });
});

describe('ツモ牌の抜け（手牌に「?」が出る原因）', () => {
  const full = (u: string) => {
    const l = parseTenhou(u);
    const board = logToBoard(l, { haipai: true, draws: true });
    board.seats.forEach((b) => { b.hand = []; });
    return { board, names: l.meta.names };
  };
  it.each([['南三局', SAMPLE_URL], ['四槓子', KAN_URL], ['嶺上開花', RINSHAN_URL], ['槍槓', CHANKAN_URL]])('%s：全巡のツモが入っていれば注意は出ない（鳴いた直後の打牌はツモなしで正しい）', (_, u) => {
    const { board, names } = full(u);
    expect(diagnose(board, names).filter((i) => i.message.includes('ツモ牌が入っていない'))).toEqual([]);
  });
  it('普通の巡のツモ牌が抜けていると、その家と何打目かを注意で示す（出力は止めない）', () => {
    const { board, names } = full(SAMPLE_URL);
    const s = board.seats.findIndex((b) => b.river.filter((r) => r.draw !== undefined).length > 5);
    const i = board.seats[s].river.findIndex((r, k) => k > 2 && r.draw !== undefined);
    delete board.seats[s].river[i].draw;
    delete board.seats[s].river[i].tsumogiri;
    const w = diagnose(board, names).filter((x) => x.message.includes('ツモ牌が入っていない'));
    expect(w).toEqual([expect.objectContaining({ seat: s, area: 'river', index: i, level: 'warn', message: expect.stringContaining(`${i + 1}打目`) })]);
    expect(diagnose(board, names).filter((x) => x.level !== 'warn')).toEqual([]);
  });
});

/** 鳴いた直後に切った牌の河の位置 */
function expectedAfter(board: Parameters<typeof replayTurns>[0], seat: number, meld: unknown) {
  const steps = replayTurns(board, false);
  const i = steps.findIndex((x) => x.kind === 'call' && x.meld === meld);
  const d = steps.slice(i + 1).find((x) => x.kind === 'discard' && x.seat === seat);
  return d && d.kind === 'discard' ? d.river : -1;
}
