import { choose, CPU_TYPES, type CpuType } from './cpu.ts';
import { closed, isOutside, isRed, kind, kuikae, payment, score, waits, type Action, type Meld, type Seat, type Tile,
  type Win } from './rules.ts';

export const SEATS = [0, 1, 2, 3];
export const HUMAN = 0;
const distance = (from: Seat, to: Seat) => (to - from + 4) % 4;
const nextSeat = (seat: Seat) => (seat + 1) % 4;
const orderedFrom = (seat: Seat) => SEATS.map((_, i) => (seat + i) % 4);
const remove = (hand: Tile[], tiles: Tile[]) => hand.filter(tile => !tiles.includes(tile));
export const windOf = (dealer: Seat, seat: Seat) => 27 + distance(dealer, seat);

interface Discard { tile: Tile; called?: boolean; riichi?: boolean }
interface Player {
  hand: Tile[];
  melds: Meld[];
  river: Discard[];
  riichi: 0 | 1 | 2;
  ippatsu: boolean;
  furiten: boolean;
  riichiFuriten: boolean;
  draws: number;
  liability: Record<string, Seat>;
}

type Turn = { type: 'turn'; seat: Seat; drawn?: Tile; rinshan?: boolean; skippedTsumo?: boolean; forbidden?: number[] };
type Claim = {
  type: 'claim';
  from: Seat;
  tile: Tile;
  mode: 'discard' | 'kakan';
  riichi?: 1 | 2;
  last?: boolean;
  responses: (Action | null)[];
};
export interface Standing { seat: Seat; points: number }
interface Winner { seat: Seat; from?: Seat; win: Win; ura: Tile[]; liability?: Seat }
interface Transfer { from?: Seat; to: Seat; points: number; reason: string }
interface RoundResult {
  kind: 'win' | 'draw' | 'abort';
  label: string;
  winners: Winner[];
  tenpai: Seat[];
  nagashi: Seat[];
  delta: number[];
  transfers: Transfer[];
  final?: Standing[];
  repeat: boolean;
}

export interface Game {
  version: 1;
  human: Seat;
  firstDealer: Seat;
  cpu: (CpuType | null)[];
  points: number[];
  dealer: Seat;
  round: number;
  honba: number;
  sticks: number;
  players: Player[];
  roundStart: number[];
  wall: Tile[];
  dead: Tile[];
  indicators: number;
  delayedDora: boolean;
  kanSeats: Seat[];
  interrupted: boolean;
  phase: Turn | Claim | { type: 'result'; result: RoundResult };
}

export const indicatorsOf = (game: Game) => game.dead.slice(4, 4 + 2 * game.indicators).filter((_, i) => i % 2 === 0);
const uraOf = (game: Game) => game.dead.slice(4, 4 + 2 * game.indicators).filter((_, i) => i % 2 === 1);

export function startGame(random = Math.random): Game {
  const firstDealer = Math.floor(random() * 4);
  const cpu = SEATS.map(seat => seat === HUMAN ? null : CPU_TYPES[Math.floor(random() * CPU_TYPES.length)]);
  const points = SEATS.map(() => 25000);
  return deal({ version: 1, human: HUMAN, firstDealer, cpu, points, dealer: firstDealer, round: 1, honba: 0, sticks: 0 }, random);
}

type Match = Pick<Game, 'version' | 'human' | 'firstDealer' | 'cpu' | 'points' | 'dealer' | 'round' | 'honba' | 'sticks'>;

function deal(match: Match, random: () => number): Game {
  const tiles = Array.from({ length: 136 }, (_, i) => i);
  for (let i = tiles.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
  }
  const dead = tiles.splice(-14);
  const players: Player[] = SEATS.map(() => ({
    hand: [], melds: [], river: [], riichi: 0, ippatsu: false, furiten: false, riichiFuriten: false, draws: 0, liability: {},
  }));
  const order = orderedFrom(match.dealer);
  for (let dealt = 0; dealt < 13; dealt++) {
    for (const seat of order) players[seat].hand.push(tiles.pop()!);
  }
  const game: Game = {
    version: 1, human: match.human, firstDealer: match.firstDealer, cpu: match.cpu, points: match.points.slice(),
    dealer: match.dealer, round: match.round, honba: match.honba, sticks: match.sticks,
    players, roundStart: match.points.slice(), wall: tiles, dead, indicators: 1, delayedDora: false,
    kanSeats: [], interrupted: false, phase: { type: 'turn', seat: match.dealer },
  };
  draw(game, game.dealer);
  return game;
}

export function nextRound(game: Game, random = Math.random) {
  if (game.phase.type !== 'result' || game.phase.result.final) return game;
  const { kind: outcome, repeat } = game.phase.result;
  return deal({ ...game, dealer: repeat ? game.dealer : nextSeat(game.dealer), round: game.round + Number(!repeat),
    honba: outcome === 'win' && !repeat ? 0 : game.honba + 1 }, random);
}

function draw(game: Game, seat: Seat, rinshan = false) {
  const player = game.players[seat];
  const tile = rinshan ? game.dead[game.kanSeats.length - 1] : game.wall.pop()!;
  // 補充する牌は生牌の末尾から移し、王牌を14枚に保つ。
  if (rinshan) game.dead[game.kanSeats.length - 1] = game.wall.shift()!;
  player.draws++;
  player.hand.push(tile);
  game.phase = { type: 'turn', seat, drawn: tile, rinshan };
}

const revealDelayed = (game: Game) => {
  if (game.delayedDora) game.indicators++;
  game.delayedDora = false;
};

function winFor(game: Game, seat: Seat, tile: Tile, tsumo: boolean): Win | undefined {
  const player = game.players[seat];
  const { phase } = game;
  const hand = tsumo ? remove(player.hand, [tile]) : player.hand;
  const chankan = phase.type === 'claim' && phase.mode === 'kakan';
  const rinshan = Boolean(tsumo && phase.type === 'turn' && phase.rinshan);
  const last = tsumo ? !game.wall.length && !rinshan : phase.type === 'claim' && Boolean(phase.last);
  const dealer = seat === game.dealer;
  const first = tsumo && player.draws === 1 && !game.interrupted ? dealer ? '天和' : '地和' : undefined;
  if (!tsumo) {
    if (player.furiten || player.riichiFuriten) return;
    const waiting = waits(hand, player.melds);
    if (!waiting.includes(kind(tile)) || player.river.some(entry => waiting.includes(kind(entry.tile)))) return;
  }
  return score({ hand, melds: player.melds, tile, tsumo, dealer, wind: windOf(game.dealer, seat),
    riichi: player.riichi, ippatsu: player.ippatsu, indicators: indicatorsOf(game), ura: uraOf(game),
    first, chankan, rinshan, last });
}

function selections(tiles: Tile[], number: number): Tile[][] {
  if (!number) return [[]];
  return tiles.flatMap((tile, i) => selections(tiles.slice(i + 1), number - 1).map(rest => [tile, ...rest]));
}

function distinctCalls(calls: Tile[][]) {
  const seen = new Set<string>();
  return calls.filter(tiles => {
    const key = tiles.map(tile => kind(tile) + (isRed(tile) ? 'r' : '')).sort().join(',');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function turnOptions(game: Game, phase: Turn): Action[] {
  const player = game.players[phase.seat];
  const { drawn } = phase;
  const options: Action[] = player.hand.filter(tile => player.riichi ? tile === drawn : !phase.forbidden?.includes(kind(tile)))
    .map(tile => ({ type: 'discard', tile }));
  if (drawn === undefined) return options;
  if (!phase.skippedTsumo && winFor(game, phase.seat, drawn, true)) options.push({ type: 'tsumo' }, { type: 'pass' });
  if (!game.interrupted && player.draws === 1 && new Set(player.hand.map(kind).filter(isOutside)).size >= 9) {
    options.push({ type: 'abort' });
  }
  if (!player.riichi && closed(player.melds) && game.points[phase.seat] >= 1000 && game.wall.length >= 4) {
    for (const tile of player.hand) {
      if (waits(remove(player.hand, [tile]), player.melds).length) options.push({ type: 'riichi', tile });
    }
  }
  if (!game.wall.length || game.kanSeats.length >= 4) return options;
  const previous = player.riichi ? waits(remove(player.hand, [drawn]), player.melds).join(',') : '';
  for (const type of new Set(player.hand.map(kind))) {
    const tiles = player.hand.filter(tile => kind(tile) === type);
    if (tiles.length !== 4) continue;
    if (player.riichi && (!tiles.includes(drawn) || waits(remove(player.hand, tiles),
      [...player.melds, { type: 'ankan', tiles }]).join(',') !== previous)) continue;
    options.push({ type: 'ankan', tiles });
  }
  if (!player.riichi) {
    for (const meld of player.melds) {
      if (meld.type !== 'pon') continue;
      const tile = player.hand.find(held => kind(held) === kind(meld.tiles[0]));
      if (tile !== undefined) options.push({ type: 'kakan', tiles: [tile] });
    }
  }
  return options;
}

function claimOptions(game: Game, phase: Claim, seat: Seat): Action[] {
  if (seat === phase.from || phase.responses[seat]) return [];
  const player = game.players[seat];
  const { tile, from } = phase;
  const type = kind(tile);
  const options: Action[] = [];
  if (winFor(game, seat, tile, false)) options.push({ type: 'ron' });
  const fourKan = game.kanSeats.length === 4 && new Set(game.kanSeats).size > 1;
  const fourRiichi = phase.riichi && game.players.filter(other => other.riichi).length === 3;
  if (phase.mode === 'discard' && !player.riichi && game.wall.length && !fourKan && !fourRiichi) {
    const same = player.hand.filter(held => kind(held) === type);
    for (const tiles of distinctCalls(selections(same, 2))) options.push({ type: 'pon', tiles });
    if (same.length === 3 && game.kanSeats.length < 4) options.push({ type: 'kan', tiles: same });
    if (nextSeat(from) === seat && type < 27) {
      for (let start = type - 2; start <= type; start++) {
        if (start < 0 || start % 9 > 6 || Math.floor(start / 9) !== Math.floor(type / 9)) continue;
        const [a, b] = [start, start + 1, start + 2].filter(candidate => candidate !== type)
          .map(candidate => player.hand.filter(held => kind(held) === candidate));
        const choices = distinctCalls(a.flatMap(first => b.map(second => [first, second])));
        for (const tiles of choices) {
          if (player.hand.some(held => !tiles.includes(held) && !kuikae(held, tile, tiles))) options.push({ type: 'chi', tiles });
        }
      }
    }
  }
  return [...options, { type: 'pass' }];
}

function actor(game: Game) {
  if (game.phase.type === 'turn') return game.phase.seat;
  if (game.phase.type === 'claim') {
    const claim = game.phase;
    return orderedFrom(claim.from).slice(1).find(seat => claim.responses[seat] === null);
  }
}

function optionsFor(game: Game, seat: Seat): Action[] {
  if (game.phase.type === 'turn' && game.phase.seat === seat) return turnOptions(game, game.phase);
  if (game.phase.type === 'claim') return claimOptions(game, game.phase, seat);
  return [];
}

export const actionKey = (action: Action) => 'tile' in action ? action.type + ':' + action.tile
  : 'tiles' in action ? action.type + ':' + action.tiles.join(',') : action.type;

function beginClaim(game: Game, from: Seat, tile: Tile, mode: Claim['mode'], riichi?: 1 | 2, last?: boolean) {
  game.phase = { type: 'claim', from, tile, mode, riichi, last, responses: SEATS.map(() => null) };
}

function interrupt(game: Game) {
  game.interrupted = true;
  for (const player of game.players) player.ippatsu = false;
}

function kanDraw(game: Game, seat: Seat, immediate: boolean) {
  interrupt(game);
  revealDelayed(game);
  game.kanSeats.push(seat);
  if (immediate) game.indicators++;
  else game.delayedDora = true;
  draw(game, seat, true);
}

function playTurn(game: Game, phase: Turn, action: Action) {
  const { seat, drawn } = phase;
  const player = game.players[seat];
  switch (action.type) {
    case 'tsumo':
      settleWins(game, [{ seat, win: winFor(game, seat, drawn!, true)!, ura: player.riichi ? uraOf(game) : [] }]);
      break;
    case 'pass':
      phase.skippedTsumo = true;
      break;
    case 'abort':
      abort(game, '九種九牌');
      break;
    case 'ankan':
      player.hand = remove(player.hand, action.tiles);
      player.melds.push({ type: 'ankan', tiles: action.tiles });
      kanDraw(game, seat, true);
      break;
    case 'kakan':
      revealDelayed(game);
      beginClaim(game, seat, action.tiles[0], 'kakan');
      break;
    case 'discard':
    case 'riichi': {
      player.hand = remove(player.hand, [action.tile]);
      player.river.push({ tile: action.tile });
      if (drawn !== undefined) player.furiten = false;
      if (player.riichi) player.ippatsu = false;
      revealDelayed(game);
      const riichi = action.type === 'riichi' ? (player.draws === 1 && !game.interrupted ? 2 : 1) : undefined;
      beginClaim(game, seat, action.tile, 'discard', riichi, !game.wall.length && !phase.rinshan);
      break;
    }
  }
}

function playResponse(game: Game, phase: Claim, seat: Seat, action: Action) {
  const player = game.players[seat];
  if (action.type !== 'ron' && waits(player.hand, player.melds).includes(kind(phase.tile))) {
    if (player.riichi) player.riichiFuriten = true;
    else player.furiten = true;
  }
  phase.responses[seat] = action;
  if (orderedFrom(phase.from).slice(1).some(other => !phase.responses[other])) return;
  const order = orderedFrom(phase.from).slice(1);
  const winners = order.filter(other => phase.responses[other]?.type === 'ron');
  if (winners.length === 3) {
    abort(game, '三家和了');
    return;
  }
  if (winners.length) {
    settleWins(game, winners.map(other => ({ seat: other, from: phase.from, win: winFor(game, other, phase.tile, false)!,
      ura: game.players[other].riichi ? uraOf(game) : [] })));
    return;
  }
  const from = game.players[phase.from];
  if (phase.mode === 'kakan') {
    const meld = from.melds.find(item => item.type === 'pon' && kind(item.tiles[0]) === kind(phase.tile))!;
    meld.tiles.push(phase.tile);
    meld.type = 'kakan';
    from.hand = remove(from.hand, [phase.tile]);
    kanDraw(game, phase.from, false);
    return;
  }
  if (phase.riichi) {
    game.points[phase.from] -= 1000;
    game.sticks++;
    from.riichi = phase.riichi;
    from.ippatsu = true;
    from.river.at(-1)!.riichi = true;
  }
  if (game.players.every(item => item.riichi)) {
    abort(game, '四家立直');
    return;
  }
  if (game.kanSeats.length === 4 && new Set(game.kanSeats).size > 1) {
    abort(game, '四槓散了');
    return;
  }
  const caller = order.find(other => ['pon', 'kan'].includes(phase.responses[other]!.type))
    ?? order.find(other => phase.responses[other]!.type === 'chi');
  if (caller !== undefined) {
    const call = phase.responses[caller]!;
    if (call.type === 'chi' || call.type === 'pon' || call.type === 'kan') {
      callDiscard(game, phase, caller, call.type, call.tiles);
    }
    return;
  }
  if (!game.interrupted && kind(phase.tile) >= 27 && kind(phase.tile) < 31
    && game.players.every(item => item.river.length === 1 && kind(item.river[0].tile) === kind(phase.tile))) {
    abort(game, '四風連打');
    return;
  }
  if (!game.wall.length) exhaustive(game);
  else draw(game, nextSeat(phase.from));
}

function callDiscard(game: Game, phase: Claim, caller: Seat, call: 'chi' | 'pon' | 'kan', tiles: Tile[]) {
  const player = game.players[caller];
  player.hand = remove(player.hand, tiles);
  game.players[phase.from].river.at(-1)!.called = true;
  player.melds.push({ type: call, tiles: [...tiles, phase.tile], from: phase.from, called: phase.tile });
  const type = kind(phase.tile);
  if (call !== 'chi' && type >= 27) {
    const declaredSets = player.melds.filter(meld => meld.type !== 'chi').map(meld => kind(meld.tiles[0]));
    if (type >= 31 && declaredSets.filter(value => value >= 31).length === 3) player.liability['大三元'] = phase.from;
    if (type < 31 && declaredSets.filter(value => value >= 27 && value < 31).length === 4) player.liability['大四喜'] = phase.from;
  }
  interrupt(game);
  if (call === 'kan') kanDraw(game, caller, false);
  else game.phase = { type: 'turn', seat: caller, forbidden: Array.from({ length: 34 }, (_, i) => i)
    .filter(type => kuikae(type * 4, phase.tile, tiles)) };
}

function standings(game: Game): Standing[] {
  return SEATS.map(seat => ({ seat, points: game.points[seat] })).sort((a, b) =>
    b.points - a.points || distance(game.firstDealer, a.seat) - distance(game.firstDealer, b.seat));
}

type Outcome = Omit<RoundResult, 'delta' | 'final'>;

function finish(game: Game, outcome: Outcome) {
  function transfer({ from, to, points }: Transfer) {
    if (from !== undefined) game.points[from] -= points;
    game.points[to] += points;
  }
  outcome.transfers.forEach(transfer);
  const leader = standings(game)[0].seat;
  const ended = game.points.some(points => points < 0) || (game.round === 4 && outcome.kind !== 'abort'
    && (!outcome.repeat || leader === game.dealer));
  if (ended && game.sticks) {
    const remaining = { to: leader, points: game.sticks * 1000, reason: '残り供託' };
    transfer(remaining);
    outcome.transfers.push(remaining);
    game.sticks = 0;
  }
  const delta = game.points.map((points, seat) => points - game.roundStart[seat]);
  game.phase = { type: 'result', result: { ...outcome, delta, final: ended ? standings(game) : undefined } };
}

function tsumoTransfers(game: Game, seat: Seat, base: number, reason: string): Transfer[] {
  return SEATS.filter(other => other !== seat).map(from => ({
    from, to: seat, points: payment(base, seat === game.dealer || from === game.dealer ? 2 : 1), reason,
  }));
}

function settleWins(game: Game, winners: Winner[]) {
  const transfers: Transfer[] = [];
  for (const [i, winner] of winners.entries()) {
    const { seat, from, win } = winner;
    const liability = win.yakuman.map(yaku => game.players[seat].liability[yaku]).find(value => value !== undefined);
    if (liability !== undefined) {
      winner.liability = liability;
      const split = from !== undefined && from !== liability;
      const share = split ? win.value / 2 : win.value;
      transfers.push({ from: liability, to: seat, points: share, reason: '包' });
      if (split) transfers.push({ from, to: seat, points: share, reason: '和了点' });
    } else if (from !== undefined) {
      transfers.push({ from, to: seat, points: win.value, reason: '和了点' });
    } else {
      transfers.push(...tsumoTransfers(game, seat, win.base, '和了点'));
    }
    if (i !== 0) continue;
    if (game.honba) {
      const payer = liability ?? from;
      if (payer !== undefined) transfers.push({ from: payer, to: seat, points: 300 * game.honba, reason: '本場' });
      else for (const other of SEATS.filter(other => other !== seat)) {
        transfers.push({ from: other, to: seat, points: 100 * game.honba, reason: '本場' });
      }
    }
    if (game.sticks) {
      transfers.push({ to: seat, points: game.sticks * 1000, reason: '供託' });
      game.sticks = 0;
    }
  }
  finish(game, { kind: 'win', label: winners.length === 2 ? 'ダブロン' : winners[0].win.tsumo ? 'ツモ和了' : 'ロン和了',
    winners, tenpai: [], nagashi: [], transfers, repeat: winners.some(winner => winner.seat === game.dealer) });
}

function exhaustive(game: Game) {
  const tenpai = SEATS.filter(seat => waits(game.players[seat].hand, game.players[seat].melds).length);
  const nagashi = SEATS.filter(seat => game.players[seat].river.length
    && game.players[seat].river.every(entry => !entry.called && isOutside(kind(entry.tile))));
  const transfers: Transfer[] = [];
  if (nagashi.length) {
    for (const seat of nagashi) transfers.push(...tsumoTransfers(game, seat, 2000, '流し満貫'));
  } else if (tenpai.length && tenpai.length < 4) {
    for (const from of SEATS.filter(seat => !tenpai.includes(seat))) {
      for (const to of tenpai) transfers.push({ from, to, points: 3000 / (4 - tenpai.length) / tenpai.length, reason: 'ノーテン罰符' });
    }
  }
  finish(game, { kind: 'draw', label: nagashi.length ? '流し満貫' : '流局', winners: [], tenpai, nagashi, transfers,
    repeat: tenpai.includes(game.dealer) });
}

function abort(game: Game, label: string) {
  finish(game, { kind: 'abort', label, winners: [], tenpai: [], nagashi: [], transfers: [], repeat: true });
}

export function advance(game: Game, persist: (state: Game) => void, requested?: Action): Game {
  const current = structuredClone(game);
  let first = true;
  while (current.phase.type !== 'result') {
    const seat = actor(current);
    if (seat === undefined) throw new Error('操作する席がありません。');
    const options = optionsFor(current, seat);
    const { phase } = current;
    let action: Action;
    if (seat === current.human) {
      if (first && requested) {
        const legal = options.find(option => actionKey(option) === actionKey(requested));
        if (!legal) return game;
        action = legal;
      } else if (phase.type === 'claim' && options.length === 1) action = options[0];
      else break;
    } else {
      action = choose({
        type: current.cpu[seat]!, seat, hand: current.players[seat].hand, options, indicators: indicatorsOf(current),
        seats: current.players.map((player, i) => ({
          river: player.river.map(entry => entry.tile), melds: player.melds, riichi: player.riichi, points: current.points[i],
        })),
        call: phase.type === 'claim' ? { tile: phase.tile, from: phase.from } : undefined,
        afterCall: phase.type === 'turn' && phase.drawn === undefined,
        dealer: seat === current.dealer, wind: windOf(current.dealer, seat),
        round: current.round, honba: current.honba, remaining: current.wall.length,
      });
    }
    first = false;
    if (phase.type === 'turn') playTurn(current, phase, action);
    else playResponse(current, phase, seat, action);
    persist(current);
  }
  return current;
}

export function viewOf(game: Game) {
  const { phase, human } = game;
  const myTurn = actor(game) === human;
  return {
    round: game.round, honba: game.honba, sticks: game.sticks, dealer: game.dealer,
    indicators: indicatorsOf(game), remaining: game.wall.length,
    seats: game.players.map((player, seat) => ({
      cpu: game.cpu[seat], points: game.points[seat], hidden: player.hand.length, river: player.river, melds: player.melds,
      riichi: Boolean(player.riichi), wind: windOf(game.dealer, seat),
    })),
    hand: game.players[human].hand,
    drawn: phase.type === 'turn' && phase.seat === human ? phase.drawn : undefined,
    claim: phase.type === 'claim' ? { from: phase.from, tile: phase.tile, mode: phase.mode } : undefined,
    options: myTurn ? optionsFor(game, human) : [],
    result: phase.type === 'result' ? phase.result : undefined,
  };
}
