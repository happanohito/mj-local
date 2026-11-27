import assert from 'node:assert/strict';
import test from 'node:test';
import { choose, CPU_TYPES, shanten } from '../src/cpu.ts';
import { advance, nextRound, startGame, viewOf } from '../src/game.ts';
import { basicPoints, countTiles, payment, score } from '../src/rules.ts';

function randomFrom(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

function tiles(notation, used = new Set()) {
  return [...notation.matchAll(/([0-9]+)([mpsz])/g)].flatMap(([, ranks, suit]) => [...ranks].map(digit => {
    const type = 'mpsz'.indexOf(suit) * 9 + (Number(digit) || 5) - 1;
    const copies = digit === '0' ? [0] : [1, 2, 3, 0];
    const tile = copies.map(copy => type * 4 + copy).find(id => !used.has(id));
    assert.notEqual(tile, undefined, notation);
    used.add(tile);
    return tile;
  }));
}

function evaluate(notation, winning, options = {}) {
  const used = new Set();
  return score({ hand: tiles(notation, used), melds: [], tile: tiles(winning, used)[0], tsumo: false,
    dealer: false, wind: 28, indicators: [], ura: [], ...options });
}

const noop = () => {};
const roundTrip = game => JSON.parse(JSON.stringify(game));

test('基本点を支払者ごとに切り上げる', () => {
  assert.equal(payment(basicPoints(30, 4), 4), 7700);
  assert.equal(payment(basicPoints(25, 2), 2), 800);
  assert.equal(payment(basicPoints(25, 2), 1), 400);
  assert.equal(payment(basicPoints(0, 0, 1), 2), 16000);
});

test('平和ツモ、ドラの重複、ドラのみの手、特殊な役満の待ちを判定する', () => {
  const pinfu = evaluate('123456m456p67s22z', '8s', { tsumo: true, wind: 29 });
  assert.equal(pinfu.fu, 20);
  assert(pinfu.yaku.some(yaku => yaku.name === '平和'));
  const context = { indicators: [12, 13] };
  const win = evaluate('406789m123p123s2z', '2z', { ...context, riichi: 1 });
  assert.deepEqual(win.dora.map(dora => dora.count), [1, 1, 0, 0, 1]);
  assert.equal(evaluate('406789m123p123s2z', '2z', context), undefined);
  assert.deepEqual(evaluate('19m19p19s1234567z', '1m').yakuman, ['国士無双十三面待ち']);
  assert.deepEqual(evaluate('1112345678999s', '5s').yakuman, ['純正九蓮宝燈']);
});

test('第1ツモで天和・地和を判定し、見送りを再開時も維持する', () => {
  const dealer = startGame(() => 0.1);
  dealer.players[0].hand = tiles('123456m123789p22z');
  dealer.phase = { type: 'turn', seat: 0, drawn: dealer.players[0].hand.at(-1) };
  assert(viewOf(dealer).options.some(action => action.type === 'tsumo'));
  const skipped = advance(dealer, noop, { type: 'pass' });
  assert(!viewOf(roundTrip(skipped)).options.some(action => action.type === 'tsumo'));
  assert(advance(dealer, noop, { type: 'tsumo' }).phase.result.winners[0].win.yakuman.includes('天和'));

  const child = startGame(() => 0.3);
  child.players[0].hand = dealer.players[0].hand;
  child.players[0].draws = 1;
  child.phase = dealer.phase;
  assert(advance(child, noop, { type: 'tsumo' }).phase.result.winners[0].win.yakuman.includes('地和'));
  child.interrupted = true;
  assert(!advance(child, noop, { type: 'tsumo' }).phase.result.winners[0].win.yakuman.includes('地和'));
});

function pendingRon(triple) {
  const game = startGame(() => 0.875);
  const used = new Set();
  const tile = tiles('2z', used)[0];
  game.points = [50000, 23500, 23500, 1000];
  game.roundStart = [50000, 23500, 23500, 3000];
  game.sticks = 2;
  game.honba = 2;
  game.wall = tiles('9s', used);
  game.players[3].river = [{ tile }];
  game.players[0].hand = tiles('123456m789p789s2z', used);
  game.players[1].hand = tiles('123789m456p123s2z', used);
  game.players[0].riichi = 1;
  game.players[1].riichi = 1;
  game.players[2].hand = triple ? tiles('123m123456789p2z', used) : tiles('234m456p345567s4z', used);
  game.players[2].riichi = triple ? 1 : 0;
  game.phase = { type: 'claim', from: 3, tile, mode: 'discard', riichi: 1, responses: [null, null, null, null] };
  return game;
}

test('ダブロンを復元し、放銃者が途中でトビになっても両者へ精算する', () => {
  const game = pendingRon(false);
  assert(viewOf(roundTrip(game)).options.some(action => action.type === 'ron'));
  const settled = advance(roundTrip(game), noop, { type: 'ron' });
  assert.deepEqual(settled, advance(game, noop, { type: 'ron' }));
  const { result } = settled.phase;
  assert.equal(result.label, 'ダブロン');
  assert.deepEqual(result.winners.map(winner => winner.seat), [0, 1]);
  assert(result.winners[0].win.value > game.points[3]);
  assert.equal(result.transfers.find(transfer => transfer.reason === '本場').to, 0);
  assert.equal(result.transfers.find(transfer => transfer.reason === '供託').to, 0);
  assert(result.final);
  assert.equal(settled.sticks, 0);
  assert.equal(settled.players[3].riichi, 0);
  assert.deepEqual(advance(roundTrip(settled), noop), settled);
});

test('トリプルロンは点数を動かさず途中流局になる', () => {
  const game = pendingRon(true);
  const settled = advance(game, noop, { type: 'ron' });
  assert.equal(settled.phase.result.label, '三家和了');
  assert(settled.phase.result.repeat);
  assert.deepEqual(settled.points, game.points);
  assert.equal(settled.sticks, 2);
});

function addedKan(robbed) {
  const game = startGame(() => 0.1);
  const used = new Set();
  const [first, second, called, tile] = tiles('3333m', used);
  game.players[0].melds = [{ type: 'pon', tiles: [first, second, called], called, from: 3 }];
  game.players[0].hand = [...tiles('456m123p789s5z', used), tile];
  game.players[1].hand = robbed ? tiles('12m123789p123s33z', used) : [];
  game.players[1].riichi = robbed ? 1 : 0;
  game.players[1].ippatsu = robbed;
  game.players[2].hand = [];
  game.players[3].hand = [];
  game.dead[0] = tiles('5z', used)[0];
  game.wall = Array.from({ length: 136 }, (_, id) => id).filter(id => !used.has(id)).slice(0, 10);
  game.phase = { type: 'turn', seat: 0, drawn: tile };
  return { game, action: { type: 'kakan', tiles: [tile] } };
}

test('搶槓を優先し、成立した加槓の槓ドラは嶺上ツモの打牌で公開する', () => {
  const robbery = addedKan(true);
  const robbed = advance(robbery.game, noop, robbery.action);
  assert.equal(robbed.players[0].melds[0].type, 'pon');
  const { win } = robbed.phase.result.winners[0];
  assert(win.yaku.some(yaku => yaku.name === '搶槓'));
  assert(win.yaku.some(yaku => yaku.name === '一発'));

  const kan = addedKan(false);
  const completed = advance(kan.game, noop, kan.action);
  assert.equal(completed.players[0].melds[0].type, 'kakan');
  assert.equal(completed.phase.rinshan, true);
  assert.equal(viewOf(completed).indicators.length, 1);
  const won = advance(completed, noop, { type: 'tsumo' }).phase.result.winners[0].win;
  assert(won.yaku.some(yaku => yaku.name === '嶺上開花'));
  assert.equal(won.dora.find(dora => dora.name === '槓ドラ').count, 0);
  const discarded = advance(completed, noop, { type: 'discard', tile: completed.phase.drawn });
  assert.equal(viewOf(discarded).indicators.length, 2);
});

function cpuInput(game) {
  const view = viewOf(game);
  return {
    seat: 0, hand: view.hand, options: view.options, indicators: view.indicators, call: view.claim,
    afterCall: game.phase.type === 'turn' && game.phase.drawn === undefined,
    seats: game.players.map((player, i) => ({
      river: player.river.map(entry => entry.tile), melds: player.melds, riichi: player.riichi, points: game.points[i],
    })),
    dealer: view.dealer === 0, wind: view.seats[0].wind, round: view.round, honba: view.honba, remaining: view.remaining,
  };
}

test('和了が合法ならCPUの全タイプが和了を選ぶ', () => {
  const input = cpuInput(pendingRon(false));
  for (const type of CPU_TYPES) assert.equal(choose({ ...input, type }).type, 'ron');
});

test('速度重視は三色のテンパイに進み、打点重視は門前を維持する', () => {
  const chi = { type: 'chi', tiles: [63, 67] };
  const pass = { type: 'pass' };
  const input = {
    seat: 0, hand: [14, 106, 121, 9, 31, 99, 15, 6, 67, 26, 63, 13, 101],
    options: [chi, pass], indicators: [117], call: { from: 3, tile: 68 },
    seats: [
      { river: [51, 37, 130, 83, 30, 61, 96, 45, 41], melds: [], riichi: 0, points: 18000 },
      { river: [33, 111, 132, 64, 86, 100, 135, 38, 0], melds: [], riichi: 0, points: 30200 },
      { river: [118, 109, 128, 134, 69, 57, 28, 82, 125, 107], riichi: 0, points: 30000,
        melds: [{ type: 'chi', tiles: [78, 80, 86], from: 1, called: 86 }] },
      { river: [116, 110, 129, 104, 124, 72, 1, 131, 123, 68], melds: [], riichi: 0, points: 21800 },
    ],
    dealer: false, wind: 29, round: 3, honba: 0, remaining: 33,
  };
  const handAfterCall = input.hand.filter(tile => ![...chi.tiles, 121].includes(tile));
  assert.equal(shanten(countTiles(input.hand), 0), 1);
  assert.equal(shanten(countTiles(handAfterCall), 1), 0);
  const win = score({ hand: handAfterCall, melds: [{ type: 'chi', tiles: [...chi.tiles, 68] }], tile: 32,
    tsumo: false, dealer: false, wind: 29, indicators: input.indicators, ura: [] });
  assert(win.yaku.some(yaku => yaku.name === '三色同順'));
  assert.equal(choose({ ...input, type: '速度重視' }), chi);
  assert.equal(choose({ ...input, type: '打点重視' }), pass);
});

test('速度重視でも役が見込めないポンは見送る', () => {
  const hand = tiles('456789m456p99s22z');
  const pon = { type: 'pon', tiles: hand.slice(9, 11) };
  const pass = { type: 'pass' };
  const action = choose({
    type: '速度重視', seat: 0, hand, options: [pon, pass], indicators: [],
    call: { tile: 104, from: 3 }, seats: Array.from({ length: 4 },
      () => ({ river: [], melds: [], points: 25000, riichi: 0 })),
    dealer: false, wind: 29, round: 1, honba: 0, remaining: 46,
  });
  assert.equal(action, pass);
});

function checkGame(game) {
  assert.equal(game.points.reduce((a, b) => a + b, 0) + 1000 * game.sticks, 100000);
  assert.equal(game.dealer, (game.firstDealer + game.round - 1) % 4);
  const physical = [...game.dead, ...game.wall, ...game.players.flatMap(player => [
    ...player.hand, ...player.river.filter(entry => !entry.called).map(entry => entry.tile),
    ...player.melds.flatMap(meld => meld.tiles),
  ])];
  assert.equal(physical.length, 136);
  assert.equal(new Set(physical).size, 136);
}

test('CPUの手番を表示する間は打牌せず、再開後も1手番ずつ進む', () => {
  const random = randomFrom(271828);
  let first = true;
  const game = startGame(() => {
    if (!first) return random();
    first = false;
    return 0.375;
  });
  const saves = [];
  const persist = state => saves.push(roundTrip(state));
  const waiting = advance(game, persist, undefined, 'pause');
  assert.equal(viewOf(waiting).turn, 1);
  assert.equal(viewOf(waiting).seats[1].river.length, 0);
  assert.equal(saves.length, 0);

  let stepped = advance(roundTrip(waiting), persist, undefined, 'step');
  assert.equal(stepped.players[1].river.length, 1);
  assert.equal(stepped.players[2].river.length, 0);
  assert.equal(stepped.players[3].river.length, 0);
  assert.deepEqual(saves.at(-1), roundTrip(stepped));
  while (viewOf(stepped).turn > 0) stepped = advance(stepped, persist, undefined, 'step');
  assert.deepEqual(stepped, advance(game, noop));
});

test('4席を起家にして東風戦を完走し、毎操作で牌と点数が保存される', () => {
  for (let dealer = 0; dealer < 4; dealer++) {
    const random = randomFrom(17157 * (dealer + 1));
    let game = advance(startGame(() => (dealer + 0.5) / 4), checkGame);
    assert.equal(game.firstDealer, dealer);
    const types = game.cpu.slice();
    for (let actions = 0; ; actions++) {
      assert(actions < 800, '対局が終了しない');
      assert.deepEqual(game.cpu, types);
      const view = viewOf(game);
      if (view.result) {
        const resumed = roundTrip(game);
        assert.deepEqual(advance(resumed, checkGame), resumed);
        if (view.result.final) {
          assert.equal(view.result.final.reduce((sum, entry) => sum + entry.points, 0), 100000);
          assert.equal(game.sticks, 0);
          break;
        }
        game = advance(nextRound(resumed, random), checkGame);
      } else {
        const input = cpuInput(game);
        const action = choose({ ...input, type: CPU_TYPES[dealer % 3] });
        assert(input.options.includes(action));
        game = advance(game, checkGame, action);
      }
    }
  }
});
