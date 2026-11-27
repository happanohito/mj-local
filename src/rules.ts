export const TILE_NAMES = [
  '一萬', '二萬', '三萬', '四萬', '五萬', '六萬', '七萬', '八萬', '九萬',
  '一筒', '二筒', '三筒', '四筒', '五筒', '六筒', '七筒', '八筒', '九筒',
  '一索', '二索', '三索', '四索', '五索', '六索', '七索', '八索', '九索',
  '東', '南', '西', '北', '白', '發', '中',
] as const;

export type Tile = number;
export type Seat = number;
export type Action =
  | { type: 'discard' | 'riichi'; tile: Tile }
  | { type: 'chi' | 'pon' | 'kan' | 'ankan' | 'kakan'; tiles: Tile[] }
  | { type: 'tsumo' | 'ron' | 'pass' | 'abort' };

export interface Meld {
  type: 'chi' | 'pon' | 'kan' | 'ankan' | 'kakan';
  tiles: Tile[];
  from?: Seat;
  called?: Tile;
}

export const kind = (tile: Tile) => Math.floor(tile / 4);
export const isRed = (tile: Tile) => [16, 52, 88].includes(tile);
export const isHonor = (type: number) => type >= 27;
export const isOutside = (type: number) => isHonor(type) || type % 9 === 0 || type % 9 === 8;
export const outside = Array.from({ length: 34 }, (_, i) => i).filter(isOutside);
export const closed = (melds: Meld[]) => melds.every(meld => meld.type === 'ankan');
export const tileName = (tile: Tile) => (isRed(tile) ? '赤' : '') + TILE_NAMES[kind(tile)];

export function kuikae(tile: Tile, calledTile: Tile, held: Tile[]) {
  const type = kind(tile);
  const called = kind(calledTile);
  if (type === called) return true;
  if (called >= 27 || type >= 27 || Math.floor(type / 9) !== Math.floor(called / 9)) return false;
  const [a, b] = held.map(kind).sort((x, y) => x - y);
  return b - a === 1 && ((called === a - 1 && type === b + 1) || (called === b + 1 && type === a - 1));
}

export const nextDora = (type: number) => {
  if (type < 27) return type % 9 === 8 ? type - 8 : type + 1;
  if (type < 31) return type === 30 ? 27 : type + 1;
  return type === 33 ? 31 : type + 1;
};

export function countTiles(tiles: Tile[]) {
  const counts = Array<number>(34).fill(0);
  for (const tile of tiles) counts[kind(tile)]++;
  return counts;
}

interface Group {
  type: 'sequence' | 'triplet' | 'quad';
  start: number;
  open: boolean;
}
type Shape = { type: 'pairs' | 'orphans' } | { type: 'standard'; pair: number; groups: Group[] };

function* groups(counts: number[], needed: number): Generator<Group[]> {
  const first = counts.findIndex(count => count > 0);
  if (first < 0) {
    if (!needed) yield [];
    return;
  }
  if (!needed) return;
  if (counts[first] >= 3) {
    counts[first] -= 3;
    for (const rest of groups(counts, needed - 1)) yield [{ type: 'triplet', start: first, open: false }, ...rest];
    counts[first] += 3;
  }
  if (first < 27 && first % 9 <= 6 && counts[first + 1] && counts[first + 2]) {
    counts[first]--;
    counts[first + 1]--;
    counts[first + 2]--;
    for (const rest of groups(counts, needed - 1)) yield [{ type: 'sequence', start: first, open: false }, ...rest];
    counts[first]++;
    counts[first + 1]++;
    counts[first + 2]++;
  }
}

function* shapes(counts: number[], meldCount: number): Generator<Shape> {
  if (!meldCount) {
    if (counts.filter(count => count === 2).length === 7) yield { type: 'pairs' };
    if (outside.every(type => counts[type]) && outside.some(type => counts[type] === 2)) yield { type: 'orphans' };
  }
  for (let pair = 0; pair < 34; pair++) {
    if (counts[pair] < 2) continue;
    counts[pair] -= 2;
    for (const decomposition of groups(counts, 4 - meldCount)) yield { type: 'standard', pair, groups: decomposition };
    counts[pair] += 2;
  }
}

export function waits(hand: Tile[], melds: Meld[]) {
  if (hand.length !== 13 - 3 * melds.length) return [];
  const counts = countTiles(hand);
  return counts.flatMap((count, type) => {
    // 形式聴牌では副露牌が4枚目でも待ちに含め、純手牌に4枚ある種類は除く。
    if (count >= 4) return [];
    const completed = counts.slice();
    completed[type]++;
    return shapes(completed, melds.length).next().done ? [] : [type];
  });
}

export interface WinContext {
  hand: Tile[];
  melds: Meld[];
  tile: Tile;
  tsumo: boolean;
  dealer: boolean;
  wind: number;
  riichi?: 1 | 2 | 0;
  ippatsu?: boolean;
  first?: '天和' | '地和';
  last?: boolean;
  rinshan?: boolean;
  chankan?: boolean;
  indicators: Tile[];
  ura: Tile[];
}
export interface Yaku { name: string; han: number }
export interface Win {
  tile: Tile;
  tsumo: boolean;
  yaku: Yaku[];
  yakuman: string[];
  dora: { name: string; count: number }[];
  han: number;
  fu: number;
  base: number;
  value: number;
}

export function basicPoints(fu: number, han: number, yakuman = 0) {
  if (yakuman) return 8000 * yakuman;
  if (han >= 13) return 8000;
  if (han >= 11) return 6000;
  if (han >= 8) return 4000;
  if (han >= 6) return 3000;
  if (han === 5) return 2000;
  return Math.min(2000, fu * 2 ** (han + 2));
}

export const payment = (base: number, factor: number) => Math.ceil(base * factor / 100) * 100;
const handValue = (base: number, dealer: boolean, tsumo: boolean) => {
  if (!tsumo) return payment(base, dealer ? 6 : 4);
  return payment(base, 2) + 2 * payment(base, dealer ? 2 : 1);
};

function countDora(tiles: Tile[], ctx: WinContext) {
  const count = (indicators: Tile[]) => indicators.reduce((sum, tile) =>
    sum + tiles.filter(held => kind(held) === nextDora(kind(tile))).length, 0);
  const ura = ctx.riichi ? ctx.ura : [];
  return [
    { name: '表ドラ', count: count(ctx.indicators.slice(0, 1)) },
    { name: '槓ドラ', count: count(ctx.indicators.slice(1)) },
    { name: '裏ドラ', count: count(ura.slice(0, 1)) },
    { name: '槓裏', count: count(ura.slice(1)) },
    { name: '赤ドラ', count: tiles.filter(isRed).length },
  ];
}

export function score(ctx: WinContext): Win | undefined {
  const { melds, tile, tsumo } = ctx;
  if (ctx.hand.length !== 13 - 3 * melds.length) return;
  const hand = [...ctx.hand, tile];
  const tiles = [...hand, ...melds.flatMap(meld => meld.tiles)];
  const types = tiles.map(kind);
  const counts = countTiles(hand);
  const winning = kind(tile);
  const menzen = closed(melds);
  const fixed: Group[] = melds.map(meld => ({
    type: meld.type === 'chi' ? 'sequence' : meld.type === 'pon' ? 'triplet' : 'quad',
    start: Math.min(...meld.tiles.map(kind)),
    open: meld.type !== 'ankan',
  }));
  const dora = countDora(tiles, ctx);
  let best: Win | undefined;

  function evaluate(shape: Shape, waitGroup: number) {
    const yaku: Yaku[] = [];
    const yakuman: string[] = [];
    const add = (name: string, han: number, condition: unknown) => { if (condition) yaku.push({ name, han }); };
    const limit = (name: string, condition: unknown) => { if (condition) yakuman.push(name); };
    const suits = new Set(types.filter(type => !isHonor(type)).map(type => Math.floor(type / 9)));
    const honors = types.some(isHonor);
    limit('字一色', types.every(isHonor));
    limit('清老頭', !honors && types.every(isOutside));
    limit('緑一色', types.every(type => [19, 20, 21, 23, 25, 32].includes(type)));
    if (ctx.first) limit(ctx.first, true);
    if (shape.type === 'orphans') limit(counts[winning] === 2 ? '国士無双十三面待ち' : '国士無双', true);
    if (!melds.length && suits.size === 1 && !honors) {
      const start = Math.floor(winning / 9) * 9;
      const minimum = (type: number) => type % 9 === 0 || type % 9 === 8 ? 3 : 1;
      if (counts.slice(start, start + 9).every((count, i) => count >= minimum(i))) {
        limit(counts[winning] > minimum(winning) ? '純正九蓮宝燈' : '九蓮宝燈', true);
      }
    }

    add('ダブルリーチ', 2, ctx.riichi === 2);
    add('リーチ', 1, ctx.riichi === 1);
    add('一発', 1, ctx.riichi && ctx.ippatsu);
    add('門前清自摸和', 1, menzen && tsumo);
    add('嶺上開花', 1, ctx.rinshan);
    add('搶槓', 1, ctx.chankan);
    add(tsumo ? '海底摸月' : '河底撈魚', 1, ctx.last);
    add('断幺九', 1, types.every(type => !isOutside(type)));
    add('混老頭', 2, types.every(isOutside));
    add('混一色', menzen ? 3 : 2, suits.size === 1 && honors);
    add('清一色', menzen ? 6 : 5, suits.size === 1 && !honors);
    add('七対子', 2, shape.type === 'pairs');

    let fu = 25;
    if (shape.type === 'standard') {
      const all = [...shape.groups, ...fixed];
      const seq = all.filter(group => group.type === 'sequence').map(group => group.start);
      const sets = all.filter(group => group.type !== 'sequence').map(group => group.start);
      const concealedSets = all.filter((group, i) =>
        group.type !== 'sequence' && !group.open && (tsumo || i !== waitGroup)).length;
      const quads = all.filter(group => group.type === 'quad').length;
      const dragons = sets.filter(type => type >= 31).length;
      const winds = sets.filter(type => type >= 27 && type < 31).length;
      limit('大三元', dragons === 3);
      limit('大四喜', winds === 4);
      limit('小四喜', winds === 3 && shape.pair >= 27 && shape.pair < 31);
      limit(waitGroup < 0 ? '四暗刻単騎' : '四暗刻', concealedSets === 4);
      limit('四槓子', quads === 4);

      const pairFu = 2 * (Number(shape.pair === 27) + Number(shape.pair === ctx.wind) + Number(shape.pair >= 31));
      const target = shape.groups[waitGroup];
      const narrow = !target || (target.type === 'sequence' && (
        winning === target.start + 1 || (target.start % 9 === 0 && winning === target.start + 2)
        || (target.start % 9 === 6 && winning === target.start)));
      const pinfu = menzen && seq.length === 4 && !pairFu && !narrow;
      add('平和', 1, pinfu);
      const duplicatePairs = [...new Set(seq)].reduce((sum, type) =>
        sum + Math.floor(seq.filter(start => start === type).length / 2), 0);
      add('一盃口', 1, menzen && duplicatePairs === 1);
      add('二盃口', 3, menzen && duplicatePairs === 2);
      add('対々和', 2, sets.length === 4);
      add('三暗刻', 2, concealedSets === 3);
      add('三槓子', 2, quads === 3);
      add('小三元', 2, dragons === 2 && shape.pair >= 31);
      add('場風 東', 1, sets.includes(27));
      add('自風 ' + TILE_NAMES[ctx.wind], 1, sets.includes(ctx.wind));
      for (const dragon of [31, 32, 33]) add(TILE_NAMES[dragon], 1, sets.includes(dragon));

      add('三色同順', menzen ? 2 : 1, seq.some(type => type < 9 && seq.includes(type + 9) && seq.includes(type + 18)));
      add('三色同刻', 2, sets.some(type => type < 9 && sets.includes(type + 9) && sets.includes(type + 18)));
      add('一気通貫', menzen ? 2 : 1, seq.some(type => type % 9 === 0 && seq.includes(type + 3) && seq.includes(type + 6)));
      const outsideGroups = seq.length && isOutside(shape.pair) && sets.every(isOutside)
        && seq.every(type => type % 9 === 0 || type % 9 === 6);
      add('混全帯幺九', menzen ? 2 : 1, outsideGroups && honors);
      add('純全帯幺九', menzen ? 3 : 2, outsideGroups && !honors);

      fu = 20 + pairFu + (narrow ? 2 : 0) + (menzen && !tsumo ? 10 : 0) + (tsumo && !pinfu ? 2 : 0);
      all.forEach((group, i) => {
        if (group.type === 'sequence') return;
        const open = group.open || (!tsumo && i === waitGroup);
        fu += (open ? 2 : 4) * (isOutside(group.start) ? 2 : 1) * (group.type === 'quad' ? 4 : 1);
      });
      if (!menzen && !tsumo) fu = Math.max(30, fu);
      fu = Math.ceil(fu / 10) * 10;
    }

    if (!yaku.length && !yakuman.length) return;
    const han = yaku.reduce((sum, entry) => sum + entry.han, 0) + dora.reduce((sum, entry) => sum + entry.count, 0);
    const base = basicPoints(fu, han, yakuman.length);
    const value = handValue(base, ctx.dealer, tsumo);
    if (!best || value > best.value || (value === best.value && (han > best.han || (han === best.han && fu > best.fu)))) {
      best = { tile, tsumo, yaku, yakuman, dora, han, fu, base, value };
    }
  }

  for (const shape of shapes(counts.slice(), melds.length)) {
    if (shape.type !== 'standard') {
      evaluate(shape, -1);
      continue;
    }
    if (winning === shape.pair) evaluate(shape, -1);
    shape.groups.forEach((group, i) => {
      if (winning === group.start || (group.type === 'sequence' && winning > group.start && winning <= group.start + 2)) {
        evaluate(shape, i);
      }
    });
  }
  return best;
}
