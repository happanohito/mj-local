import { useCallback, useEffect, useState, type DragEvent, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { actionKey, advance, nextRound, SEATS, startGame, viewOf, type Game, type Standing } from './game.ts';
import { isRed, kind, TILE_NAMES, tileName, type Action, type Meld, type Tile } from './rules.ts';
import { TileFace } from './tile-face.tsx';
import '@fontsource-variable/noto-sans-jp';
import './style.css';

const SAVE_KEY = 'local-mahjong.game';
const CPU_TURN_DELAY_MS = 750;
const seatName = (seat: number) => ['あなた', 'CPU 1', 'CPU 2', 'CPU 3'][seat];
const number = (points: number) => points.toLocaleString('ja-JP');
type View = ReturnType<typeof viewOf>;
type Confirm = 'new' | 'reset' | 'title';

function readSave(): Game | undefined {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw) as Game;
    if (data.version === 1 && data.players?.length === 4 && data.points?.length === 4 && data.dead?.length === 14
      && Array.isArray(data.wall) && ['turn', 'claim', 'result'].includes(data.phase?.type)) return data;
  } catch {
    return undefined;
  }
}

const tileClass = (tile: Tile) => 'tile' + (isRed(tile) ? ' red-five'
  : kind(tile) === 33 ? ' red' : kind(tile) === 32 ? ' green' : '');

function TileDisplay({ tile, highlight = false }: { tile: Tile; highlight?: boolean }) {
  return <span className={tileClass(tile) + (highlight ? ' sideways' : '')} title={tileName(tile)}
    role="img" aria-label={tileName(tile)}>
    <TileFace tile={tile} />
  </span>;
}

function Melds({ melds, seat }: { melds: Meld[]; seat: number }) {
  return <div className="melds" aria-label="副露">{melds.map((meld, i) => {
    const tiles = meld.tiles.filter(tile => tile !== meld.called).sort((a, b) => a - b);
    if (meld.called !== undefined && meld.from !== undefined) {
      const source = (meld.from - seat + 4) % 4;
      tiles.splice(source === 3 ? 0 : source === 2 ? 1 : tiles.length, 0, meld.called);
    }
    const label = { chi: 'チー', pon: 'ポン', kan: '大明槓', ankan: '暗槓', kakan: '加槓' }[meld.type];
    return <div className="meld" key={i} title={label + (meld.from !== undefined ? ' · ' + seatName(meld.from) + 'の打牌' : '')}>
      {tiles.map((tile, index) => meld.type === 'ankan' && (index === 0 || index === 3)
        ? <span className="tile back" key={tile} aria-label="伏せ牌" />
        : <TileDisplay key={tile} tile={tile} highlight={tile === meld.called} />)}
    </div>;
  })}</div>;
}

function Brand() {
  return <div className="brand"><span className="brand-mark" aria-hidden="true">東</span><span>ローカル麻雀</span></div>;
}

function Title({ saved, resume, start }: { saved?: Game; resume: () => void; start: () => void }) {
  return <main className="lobby">
    <div className="lobby-tiles" aria-hidden="true">{[108, 124, 132].map(tile => <TileDisplay key={tile} tile={tile} />)}</div>
    <h1>ローカル麻雀</h1>
    <p>四人打ち東風戦 · CPU 3人</p>
    <div className="lobby-actions">
      {saved && <button className="primary" onClick={resume}>続きから <small>東{saved.round}局 · {saved.honba}本場</small></button>}
      <button className={saved ? 'secondary' : 'primary'} onClick={start}>新規対局</button>
    </div>
  </main>;
}

const positions = ['south', 'east', 'north', 'west'];

function ScoreCard({ seat, data, dealer, active }: {
  seat: number; data: View['seats'][number]; dealer: boolean; active: boolean;
}) {
  return <div className={'seat-info' + (active ? ' active-seat' : '')} aria-current={active ? 'true' : undefined}>
    <span className={'wind' + (dealer ? ' dealer' : '')} title={dealer ? '親' : undefined}>{TILE_NAMES[data.wind]}</span>
    <span className="seat-identity"><strong>{seatName(seat)}</strong>{data.cpu && <small>{data.cpu}</small>}</span>
    <strong className="points">{number(data.points)}</strong>
    {data.riichi && <span className="riichi-mark">立直</span>}
  </div>;
}

function River({ seat, view, dragging, drop }: { seat: number; view: View; dragging: boolean; drop: (event: DragEvent) => void }) {
  const player = seat === 0;
  return <div className={'river ' + positions[seat] + (player && dragging ? ' drop-target' : '')}
    aria-label={seatName(seat) + 'の捨て牌'}
    onDragOver={player && dragging ? event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } : undefined}
    onDrop={player ? drop : undefined}>
    {view.seats[seat].river.filter(entry => !entry.called).map(entry => <TileDisplay key={entry.tile} tile={entry.tile}
      highlight={entry.riichi} />)}
    {player && dragging && <span className="drop-label">ここにドロップして打牌</span>}
  </div>;
}

const actionLabels = {
  chi: 'チー', pon: 'ポン', kan: '大明槓', ankan: '暗槓', kakan: '加槓',
  ron: 'ロン', tsumo: 'ツモ', pass: '見送り', abort: '九種九牌', riichi: 'リーチ',
} as const;

function Table({ view, play }: { view: View; play: (action: Action) => void }) {
  const [selected, setSelected] = useState<Tile>();
  const [dragging, setDragging] = useState<Tile>();
  const [riichi, setRiichi] = useState(false);
  const [candidate, setCandidate] = useState<'chi' | 'pon'>();
  const discards = view.options.filter(action => action.type === (riichi ? 'riichi' : 'discard'));
  const legal = new Set(discards.flatMap(action => 'tile' in action ? [action.tile] : []));
  const ordered = view.hand.filter(tile => tile !== view.drawn).sort((a, b) => a - b);
  if (view.drawn !== undefined) ordered.push(view.drawn);

  function send(action: Action) {
    setSelected(undefined);
    setDragging(undefined);
    setRiichi(false);
    setCandidate(undefined);
    play(action);
  }
  function discard(tile: Tile) {
    if (legal.has(tile)) send({ type: riichi ? 'riichi' : 'discard', tile });
  }
  function drop(event: DragEvent) {
    event.preventDefault();
    if (dragging !== undefined && event.dataTransfer.getData('text/plain') === String(dragging)) discard(dragging);
    setDragging(undefined);
  }

  const actionTypes = [...new Set(view.options.map(action => action.type))].filter(type => type !== 'discard');
  const turnLabel = view.turn === undefined ? 'あなたの選択' : seatName(view.turn) + 'の手番';
  const message = riichi ? 'リーチ宣言牌を選んでください'
    : candidate ? '使う牌の組み合わせを選んでください'
    : view.claim ? seatName(view.claim.from) + (view.claim.mode === 'kakan' ? 'が加槓' : 'の打牌')
    : view.turn === 0 ? '牌を2回クリック、または河へドラッグ' : '';
  return <main className="game">
    <div className="table">
      {SEATS.filter(seat => seat !== 0).map(seat => <section className={'opponent ' + positions[seat]} key={seat}>
        <ScoreCard seat={seat} data={view.seats[seat]} dealer={view.dealer === seat} active={view.turn === seat} />
        <div className="opponent-hand" aria-label={'手牌 ' + view.seats[seat].hidden + '枚'}>
          {Array.from({ length: view.seats[seat].hidden }, (_, i) => <span className="tile back" key={i} />)}
        </div>
        <Melds melds={view.seats[seat].melds} seat={seat} />
      </section>)}
      {SEATS.map(seat => <River key={seat} seat={seat} view={view} dragging={dragging !== undefined} drop={drop} />)}
      <section className="tracker" aria-label="局の情報">
        <div className="turn-label" role="status">{turnLabel}</div>
        <div className="round">東 <strong>{view.round}</strong> 局</div>
        <div className="counters"><span>本場 <b>{view.honba}</b></span><span>供託 <b>{view.sticks}</b></span><span>残り <b>{view.remaining}</b></span></div>
        <div className="indicators"><span>ドラ表示</span>{view.indicators.map(tile => <TileDisplay key={tile} tile={tile} />)}</div>
      </section>
      <section className="player">
        <div className="controls">
          <div className="prompt" aria-live="polite">{message}{view.claim && <TileDisplay tile={view.claim.tile} />}</div>
          <div className="actions">
            {(riichi || candidate) && <button className="secondary" onClick={() => {
              setRiichi(false); setCandidate(undefined); setSelected(undefined);
            }}>取消</button>}
            {candidate ? view.options.filter(action => action.type === candidate).map(action => 'tiles' in action &&
              <button className="secondary call-option" key={actionKey(action)} onClick={() => send(action)}>
                {action.tiles.map(tile => <TileDisplay key={tile} tile={tile} />)}
              </button>)
              : !riichi && actionTypes.flatMap(type => {
                const options = view.options.filter(action => action.type === type);
                if ((type === 'chi' || type === 'pon') && options.length > 1) {
                  return <button className="secondary" key={type} onClick={() => setCandidate(type)}>{actionLabels[type]}</button>;
                }
                if (type === 'riichi') {
                  return <button className="primary" key={type} onClick={() => {
                    setRiichi(true); setSelected(undefined);
                  }}>リーチ</button>;
                }
                return options.map(action => <button className={type === 'ron' || type === 'tsumo' ? 'primary' : 'secondary'}
                  key={actionKey(action)} onClick={() => send(action)}>
                  {actionLabels[type]}{'tiles' in action && options.length > 1 && ' ' + tileName(action.tiles[0])}
                </button>);
              })}
          </div>
        </div>
        <div className="player-hand" aria-label="あなたの手牌">{ordered.map(tile => {
          const enabled = legal.has(tile);
          return <button key={tile} title={tileName(tile)} aria-label={tileName(tile)} disabled={!enabled}
            aria-pressed={selected === tile} draggable={enabled}
            className={tileClass(tile) + (selected === tile ? ' selected' : '') + (tile === view.drawn ? ' drawn' : '')}
            onClick={() => selected === tile ? discard(tile) : setSelected(tile)}
            onDragStart={event => {
              event.dataTransfer.setData('text/plain', String(tile));
              event.dataTransfer.effectAllowed = 'move';
              setDragging(tile);
            }}
            onDragEnd={() => setDragging(undefined)}><TileFace tile={tile} /></button>;
        })}</div>
        <div className="player-meta">
          <ScoreCard seat={0} data={view.seats[0]} dealer={view.dealer === 0} active={view.turn === 0} />
          <Melds melds={view.seats[0].melds} seat={0} />
        </div>
      </section>
    </div>
  </main>;
}

function Result({ view, proceed }: { view: View; proceed: () => void }) {
  const result = view.result!;
  return <main className="result-page">
    <div className="result-card">
      <p className="round-label">東{view.round}局 · {view.honba}本場</p>
      <h1>{result.label}</h1>
      {result.winners.map(({ seat, from, win, ura, liability }) => <article className="win" key={seat}>
        <div className="win-header"><strong>{seatName(seat)}{from === undefined ? 'のツモ' : ' ← ' + seatName(from)}</strong>
          <TileDisplay tile={win.tile} /><span>{win.yakuman.length ? win.yakuman.length + '倍役満'
            : win.han >= 13 ? '数え役満' : win.fu + '符 ' + win.han + '翻'}</span></div>
        <div className="yaku">{win.yakuman.length ? win.yakuman.join('・') : win.yaku.map(yaku => yaku.name + ' ' + yaku.han).join(' / ')}</div>
        <div className="dora-breakdown">{win.dora.filter(dora => dora.count)
          .map(dora => dora.name + ' ' + dora.count).join(' / ') || 'ドラなし'}</div>
        {ura.length > 0 && <div className="indicators"><span>裏ドラ表示</span>{ura.map(tile => <TileDisplay key={tile} tile={tile} />)}</div>}
        {liability !== undefined && <div>包　{seatName(liability)}</div>}
      </article>)}
      {result.kind === 'draw' && <p>テンパイ　{result.tenpai.length ? result.tenpai.map(seatName).join('、') : 'なし'}</p>}
      {result.nagashi.length > 0 && <p>成立　{result.nagashi.map(seatName).join('、')}</p>}
      <table><caption>点数の増減</caption><thead><tr><th>席</th><th>増減</th><th>持ち点</th></tr></thead>
        <tbody>{view.seats.map(({ wind, points }, seat) => <tr key={seat}>
          <th scope="row">{TILE_NAMES[wind]}　{seatName(seat)}</th>
          <td className={result.delta[seat] > 0 ? 'positive' : result.delta[seat] < 0 ? 'negative' : ''}>
            {result.delta[seat] > 0 ? '+' : ''}{number(result.delta[seat])}</td><td>{number(points)}</td>
        </tr>)}</tbody>
      </table>
      <button className="primary" onClick={proceed}>{result.final ? '最終結果へ' : '次の局'}</button>
    </div>
  </main>;
}

function Final({ standings, back }: { standings: Standing[]; back: () => void }) {
  return <main className="result-page"><div className="result-card">
    <h1>最終結果</h1>
    <table><thead><tr><th>順位</th><th>対局者</th><th>持ち点</th></tr></thead><tbody>
      {standings.map(({ seat, points }, i) => <tr key={seat}><th scope="row">{i + 1}位</th>
        <td>{seatName(seat)}</td><td>{number(points)}</td></tr>)}
    </tbody></table>
    <button className="primary" onClick={back}>タイトルへ戻る</button>
  </div></main>;
}

function Confirmation({ title, children, close, accept }: { title: string; children: ReactNode; close: () => void; accept: () => void }) {
  return <dialog ref={node => { if (node && !node.open) node.showModal(); }} onCancel={close} aria-labelledby="confirm-title">
    <h2 id="confirm-title">{title}</h2><p>{children}</p>
    <div className="actions"><button className="secondary" autoFocus onClick={close}>キャンセル</button>
      <button className="primary" onClick={accept}>確定</button></div>
  </dialog>;
}

function App() {
  const [saved, setSaved] = useState(readSave);
  const [game, setGame] = useState<Game>();
  const [final, setFinal] = useState<Standing[]>();
  const [confirm, setConfirm] = useState<Confirm>();
  const [storageError, setStorageError] = useState(false);

  const persist = useCallback((state: Game) => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(state));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }, []);

  useEffect(() => {
    if (confirm || game?.phase.type !== 'turn' || game.phase.seat === game.human) return;
    const timer = window.setTimeout(() => setGame(advance(game, persist, undefined, 'step')), CPU_TURN_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [confirm, game, persist]);

  function clear() {
    try {
      localStorage.removeItem(SAVE_KEY);
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
    setSaved(undefined);
  }

  function show(state: Game, initial = false, action?: Action) {
    if (initial) persist(state);
    setGame(advance(state, persist, action, 'pause'));
  }

  function accept() {
    if (confirm === 'new') show(startGame(), true);
    else { clear(); setGame(undefined); }
    setConfirm(undefined);
  }

  const view = game && viewOf(game);
  const titles = { new: '新しい対局を開始しますか？', reset: '対局をリセットしますか？', title: 'タイトルへ戻りますか？' };
  return <>
    <header className="site-header"><Brand />
      {game && <nav>
        <button className="quiet" onClick={() => setConfirm('reset')}>対局をリセット</button>
        <button className="quiet" onClick={() => setConfirm('title')}>タイトルへ戻る</button>
      </nav>}
    </header>
    {storageError && <p className="storage-error" role="status">保存領域にアクセスできませんでした。</p>}
    {view && game ? (view.result ? <Result view={view} proceed={() => {
      if (view.result?.final) {
        setFinal(view.result.final);
        setGame(undefined);
        clear();
      } else show(nextRound(game), true);
    }} /> : <Table view={view} play={action => show(game, false, action)} />)
      : final ? <Final standings={final} back={() => setFinal(undefined)} />
        : <Title saved={saved} resume={() => { if (saved) show(saved); }} start={() => saved ? setConfirm('new') : show(startGame(), true)} />}
    {confirm && <Confirmation title={titles[confirm]} close={() => setConfirm(undefined)} accept={accept}>
      {confirm === 'new' ? '保存済みの対局を破棄して、新しい対局を開始します。' : '進行中の対局と保存データを削除します。'}
    </Confirmation>}
  </>;
}

const root = document.getElementById('root');
if (!root) throw new Error('The application root is missing.');
createRoot(root).render(<App />);
