import { closed, countTiles, isHonor, isOutside, isRed, kind, kuikae, nextDora, outside, score, waits,
  type Action, type Meld, type Tile } from './rules.ts';

export const CPU_TYPES = ['打点重視', '速度重視', 'バランス型'] as const;
export type CpuType = typeof CPU_TYPES[number];
interface CpuInput {
  type: CpuType;
  seat: number;
  hand: Tile[];
  options: Action[];
  seats: { river: Tile[]; melds: Meld[]; points: number; riichi: 0 | 1 | 2 }[];
  indicators: Tile[];
  call?: { tile: Tile; from: number };
  afterCall?: boolean;
  dealer: boolean;
  wind: number;
  round: number;
  honba: number;
  remaining: number;
}

type Packs = [melds: number, partial: number, pair: number];
const packCache = [new Map<number, Packs[]>(), new Map<number, Packs[]>()];

function packs(counts: number[], honors: boolean): Packs[] {
  const key = counts.reduce((value, count) => value * 5 + count, 0);
  if (!key) return [[0, 0, 0]];
  const cache = packCache[Number(honors)];
  const cached = cache.get(key);
  if (cached) return cached;
  const first = counts.findIndex(Boolean);
  const options = new Map<number, Packs>();
  function take(indices: number[], m: number, t: number, p: number) {
    indices.forEach(index => counts[index]--);
    for (const [melds, partial, pair] of packs(counts, honors)) {
      if (pair + p > 1 || melds + m > 4 || partial + t > 4) continue;
      const signature = (melds + m) * 10 + (partial + t) * 2 + pair + p;
      options.set(signature, [melds + m, partial + t, pair + p]);
    }
    indices.forEach(index => counts[index]++);
  }
  take([first], 0, 0, 0);
  if (counts[first] >= 3) take([first, first, first], 1, 0, 0);
  if (counts[first] >= 2) {
    take([first, first], 0, 1, 0);
    take([first, first], 0, 0, 1);
  }
  if (!honors) {
    if (counts[first + 1] && counts[first + 2]) take([first, first + 1, first + 2], 1, 0, 0);
    if (counts[first + 1]) take([first, first + 1], 0, 1, 0);
    if (counts[first + 2]) take([first, first + 2], 0, 1, 0);
  }
  const result = [...options.values()];
  cache.set(key, result);
  return result;
}

export function shanten(counts: number[], fixed: number) {
  let best = 8;
  const blocks = [0, 9, 18, 27].map(start => packs(counts.slice(start, start + 9), start === 27));
  function combine(index: number, melds: number, partial: number, pair: number) {
    if (index === blocks.length) {
      best = Math.min(best, 8 - 2 * melds - Math.min(partial, 4 - melds) - pair);
      return;
    }
    for (const [m, t, p] of blocks[index]) {
      if (melds + m <= 4 && pair + p <= 1) combine(index + 1, melds + m, partial + t, pair + p);
    }
  }
  combine(0, fixed, 0, 0);
  if (fixed) return best;
  const unique = counts.filter(Boolean).length;
  const pairs = counts.filter(count => count >= 2).length;
  const orphanKinds = outside.filter(type => counts[type] > 0);
  return Math.min(best, 6 - pairs + Math.max(0, 7 - unique),
    13 - orphanKinds.length - Number(orphanKinds.some(type => counts[type] >= 2)));
}

const weights: Record<CpuType, number[]> = {
  打点重視: [3, 2, 4, 2],
  速度重視: [4, 3, 1, 2],
  バランス型: [3, 2, 2, 2],
};

interface Evaluation { value: number; distance: number; ukeire: number; tile: Tile }
const compare = (a: Evaluation, b: Evaluation) =>
  b.value - a.value || a.distance - b.distance || b.ukeire - a.ukeire || a.tile - b.tile;

export function choose(input: CpuInput): Action {
  const win = input.options.find(action => action.type === 'tsumo' || action.type === 'ron');
  if (win) return win;
  if (input.options.length === 1) return input.options[0];

  const own = input.seats[input.seat];
  const opponentsInRiichi = input.seats.filter((other, seat) => seat !== input.seat && other.riichi);
  const known = new Set([...input.hand, ...input.indicators, ...input.seats.flatMap(player => [
    ...player.river, ...player.melds.flatMap(meld => meld.tiles),
  ])]);
  if (input.call) known.add(input.call.tile);
  const remaining = countTiles([...known]).map(count => 4 - count);
  const [progressWeight, acceptanceWeight, pointsWeight, safetyWeight] = weights[input.type];
  const yakuhai = [...new Set([27, input.wind, 31, 32, 33])];

  function evaluate(hand: Tile[], melds: Meld[], discarded: Tile, riichi: boolean, special: boolean): Evaluation {
    const counts = countTiles(hand);
    const distance = shanten(counts, melds.length);
    const targets = distance === 0 ? waits(hand, melds) : counts.flatMap((_, type) => {
      if (remaining[type] <= 0) return [];
      counts[type]++;
      const improves = shanten(counts, melds.length) < distance;
      counts[type]--;
      return improves ? [type] : [];
    });
    const ukeire = targets.reduce((sum, type) => sum + remaining[type], 0);
    const all = [...hand, ...melds.flatMap(meld => meld.tiles)];
    const types = all.map(kind);
    const suits = [0, 1, 2].map(suit => types.filter(type => Math.floor(type / 9) === suit && type < 27).length);
    const hasYakuTile = yakuhai.some(type => melds.some(meld => kind(meld.tiles[0]) === type)
      || counts[type] >= 3 || (counts[type] === 2 && remaining[type]));
    const tanyao = !types.some(isOutside) || (types.filter(isOutside).length <= 2
      && melds.every(meld => meld.tiles.every(tile => !isOutside(kind(tile)))));
    const flush = Math.max(...suits) >= types.filter(type => !isHonor(type)).length - 2
      && melds.flatMap(meld => meld.tiles.map(kind)).filter(type => !isHonor(type))
        .every(type => suits[Math.floor(type / 9)] === Math.max(...suits));
    const triplets = melds.every(meld => meld.type !== 'chi') && counts.filter(count => count >= 2).length + melds.length >= 4;
    const sequences = melds.filter(meld => meld.type === 'chi').map(meld => Math.min(...meld.tiles.map(kind)));
    const hasSequenceYaku = [0, 1, 2, 3, 4, 5, 6].some(rank => {
      const lines = [rank, rank + 9, rank + 18];
      return sequences.every(start => lines.includes(start))
        && lines.every(start => sequences.includes(start) || counts.slice(start, start + 3).filter(Boolean).length >= 2);
    }) || [0, 9, 18].some(suit => {
      const lines = [suit, suit + 3, suit + 6];
      return sequences.every(start => lines.includes(start))
        && lines.every(start => sequences.includes(start) || counts.slice(start, start + 3).filter(Boolean).length >= 2);
    });
    const dora = all.filter(isRed).length + input.indicators.reduce((sum, tile) =>
      sum + types.filter(type => type === nextDora(kind(tile))).length, 0);
    let points = 0;
    if (distance === 0) {
      const furiten = targets.includes(kind(discarded)) || own.river.some(previous => targets.includes(kind(previous)));
      for (const type of targets) {
        for (let copy = 0; copy < 4; copy++) {
          const tile = type * 4 + copy;
          if (known.has(tile)) continue;
          const context = { hand, melds, tile, dealer: input.dealer, wind: input.wind, indicators: input.indicators,
            ura: [], riichi: riichi ? 1 as const : own.riichi };
          const ron = furiten ? undefined : score({ ...context, tsumo: false });
          const tsumo = score({ ...context, tsumo: true });
          points += ((ron?.value ?? 0) * 0.65 + (tsumo?.value ?? 0) * 0.35) / Math.max(1, ukeire);
        }
      }
    } else if (hasYakuTile || tanyao || flush || triplets || hasSequenceYaku || closed(melds)) {
      points = 900 + 850 * dora + (flush ? 2200 : 0) + (closed(melds) ? 1000 : 0)
        + (triplets ? 850 : 0) + (hasSequenceYaku ? 500 : 0);
    }
    const safety = opponentsInRiichi.reduce((sum, opponent) =>
      sum + Number(opponent.river.some(tile => kind(tile) === kind(discarded))), 0);
    const value = -distance * progressWeight + Math.min(1.5, ukeire / 30) * acceptanceWeight
      + Math.min(4, points / 4000) * pointsWeight + safety * safetyWeight * 0.65
      - (riichi ? 0.16 + 1000 / Math.max(own.points, 1000) + 0.12 * opponentsInRiichi.length : 0);
    return { value: special && !closed(melds) && !points ? -Infinity : value, distance, ukeire, tile: discarded };
  }

  const ranked = input.options.flatMap((action, index) => {
    if (action.type === 'abort' || action.type === 'ron' || action.type === 'tsumo') return [];
    const ordinary = action.type === 'pass' || action.type === 'discard';
    let result: Evaluation;
    if ('tile' in action) {
      result = evaluate(input.hand.filter(tile => tile !== action.tile), own.melds, action.tile, action.type === 'riichi',
        Boolean(input.afterCall));
    } else if ('tiles' in action) {
      const hand = input.hand.filter(tile => !action.tiles.includes(tile));
      const melds = own.melds.slice();
      const call = input.call;
      if (action.type === 'kakan') {
        const i = melds.findIndex(meld => meld.type === 'pon' && kind(meld.tiles[0]) === kind(action.tiles[0]));
        melds[i] = { ...melds[i], type: 'kakan', tiles: [...melds[i].tiles, ...action.tiles] };
      } else {
        melds.push({ type: action.type, tiles: call ? [...action.tiles, call.tile] : action.tiles });
      }
      if ((action.type === 'chi' || action.type === 'pon') && call) {
        result = hand.filter(tile => !kuikae(tile, call.tile, action.tiles))
          .map(tile => evaluate(hand.filter(other => other !== tile), melds, tile, false, true)).sort(compare)[0];
      } else {
        result = evaluate(hand, melds, -1, false, true);
      }
    } else {
      result = evaluate(input.hand, own.melds, -1, false, false);
    }
    if (!result) return [];
    return [{ action, result, ordinary, index }];
  });
  ranked.sort((a, b) => b.result.value - a.result.value || Number(b.ordinary) - Number(a.ordinary)
    || compare(a.result, b.result) || a.index - b.index);
  return ranked[0]?.action ?? input.options[0];
}

