import { kind, TILE_NAMES, type Tile } from './rules.ts';

type Mark = [x: number, y: number, accent?: 'red' | 'green'];

const circles: Mark[][] = [
  [[18, 22]],
  [[18, 10], [18, 34, 'green']],
  [[8, 10, 'green'], [18, 22, 'red'], [28, 34]],
  [[9, 11], [27, 11], [9, 33], [27, 33]],
  [[9, 10], [27, 10], [18, 22, 'red'], [9, 34], [27, 34]],
  [[10, 8, 'green'], [26, 8, 'green'], [10, 22, 'red'], [26, 22, 'red'], [10, 36, 'red'], [26, 36, 'red']],
  [[6, 7, 'green'], [18, 11, 'green'], [30, 15, 'green'], [10, 26, 'red'], [26, 26, 'red'], [10, 37, 'red'], [26, 37, 'red']],
  [[10, 6], [26, 6], [10, 17], [26, 17], [10, 27], [26, 27], [10, 38], [26, 38]],
  [[6, 8, 'green'], [18, 8, 'green'], [30, 8, 'green'], [6, 22, 'red'], [18, 22, 'red'], [30, 22, 'red'], [6, 36], [18, 36], [30, 36]],
];

const bamboo: Mark[][] = [
  [],
  [[18, 10], [18, 34]],
  [[18, 9, 'red'], [9, 34], [27, 34]],
  [[9, 10], [27, 10], [9, 34], [27, 34]],
  [[9, 8], [27, 8], [18, 22, 'red'], [9, 36], [27, 36]],
  [[9, 8], [27, 8], [9, 22], [27, 22], [9, 36], [27, 36]],
  [[18, 6, 'red'], [9, 17], [27, 17], [9, 27], [27, 27], [9, 38], [27, 38]],
  [[8, 7], [28, 7], [13, 17], [23, 17], [13, 27], [23, 27], [8, 37], [28, 37]],
  [[6, 8, 'red'], [18, 8, 'red'], [30, 8, 'red'], [6, 22], [18, 22], [30, 22], [6, 36], [18, 36], [30, 36]],
];

function Bird() {
  return <>
    <path fill="currentColor"
      d="M3 30c7 4 10 0 13-6-4-6-1-13 5-15 4-2 9 0 11 4l-6 2c-2 1-2 3-1 5 6 8 0 18-9 18-6 0-10-3-13-8Z" />
    <path d="M8 34c4 0 8-4 10-9M15 35c4-2 7-6 7-10" fill="none" stroke="#f5eddc" strokeWidth="1.65" strokeLinecap="round" />
    <path d="M23 9l-1-4m3 4 2-4m3 9 4 1" fill="none" stroke="var(--tile-red)" strokeWidth="2.15" strokeLinecap="round" />
    <circle cx="25.2" cy="12" r="1" fill="#f5eddc" />
  </>;
}

const markClass = (accent: Mark[2]) => accent ? 'mark-' + accent : undefined;

export function TileFace({ tile }: { tile: Tile }) {
  const type = kind(tile);
  const name = TILE_NAMES[type];
  if (type >= 27) {
    return type === 31 ? <span className="white-dragon" aria-hidden="true" /> : <b aria-hidden="true">{name}</b>;
  }
  if (type < 9) {
    return <span className="man-face" aria-hidden="true"><b>{name[0]}</b><b>{name[1]}</b></span>;
  }

  const rank = type % 9 + 1;
  if (type < 18) {
    const radius = rank === 1 ? 12.2 : rank <= 5 ? 5.9 : 5;
    return <svg className="tile-emblem pin-face" viewBox="0 0 36 44" aria-hidden="true" focusable="false">
      {circles[rank - 1].map(([x, y, accent]) =>
        <g key={x + ',' + y} className={markClass(accent)}>
          <circle cx={x} cy={y} r={radius} fill="currentColor" />
          <circle cx={x} cy={y} r={radius * 0.51} fill="var(--tile-face-paper)" />
          {rank === 1 && <circle cx={x} cy={y} r={3.4} fill="var(--tile-red)" />}
        </g>)}
    </svg>;
  }

  return <svg className="tile-emblem sou-face" viewBox="0 0 36 44" aria-hidden="true" focusable="false">
    {rank === 1 ? <Bird /> : bamboo[rank - 1].map(([x, y, accent]) =>
      <g key={x + ',' + y} className={markClass(accent)} transform={'translate(' + x + ' ' + y + ')'}>
        <path d="M-3 -4.2Q0 -5.5 3 -4.2L2.5 0 3 4.2Q0 5.5-3 4.2L-2.5 0Z" fill="currentColor" />
        <path d="M-2.6 0H2.6" stroke="var(--tile-face-paper)" strokeWidth="1.2" />
      </g>)}
  </svg>;
}
