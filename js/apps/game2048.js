/**
 * Zero48 — 2048 in glass, for ZerOS.
 * Fully functional: slide, merge, win/lose detection, undo,
 * best score persisted in the OS database.
 */
import { addScore, topScores } from '../kernel/db.js';

export const WIDTH = 460;
export const HEIGHT = 560;

const N = 4;

export async function launch(win) {
  const body = win.body;
  body.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%;padding:12px;gap:10px;">
      <div style="display:flex;align-items:center;gap:12px;flex:0 0 auto;">
        <span class="zlabel">score</span><b data-g="score" style="font-variant-numeric:tabular-nums">0</b>
        <span class="zlabel">best</span><b data-g="best" style="font-variant-numeric:tabular-nums;color:var(--acc)">0</b>
        <span style="flex:1"></span>
        <button class="zbtn ghost" data-g="undo" title="undo one move">undo</button>
        <button class="zbtn" data-g="new">new game</button>
      </div>
      <div data-g="board" tabindex="0" style="flex:1;outline:none;position:relative;display:grid;grid-template-columns:repeat(4,1fr);grid-template-rows:repeat(4,1fr);gap:8px;padding:8px;border-radius:12px;background:hsl(var(--hue) 25% 12%/.55);border:1px solid hsl(var(--hue) 40% 60%/.15);user-select:none;touch-action:none;"></div>
      <div data-g="msg" style="flex:0 0 auto;min-height:16px;text-align:center;font-size:12px;color:var(--ink-dim);"></div>
    </div>`;

  const $ = s => body.querySelector(`[data-g="${s}"]`);
  const board = $('board');

  let grid, score, over, won, prev;

  const tileHue = v => {
    const step = Math.log2(v);            // 1..11
    return `hsl(calc(var(--hue) + ${step * 14}) 60% ${18 + step * 4}%)`;
  };

  function emptyGrid() { return Array.from({ length: N }, () => Array(N).fill(0)); }

  function addRandom() {
    const empt = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (!grid[r][c]) empt.push([r, c]);
    if (!empt.length) return;
    const [r, c] = empt[(Math.random() * empt.length) | 0];
    grid[r][c] = Math.random() < 0.9 ? 2 : 4;
  }

  function slide(row) {
    /* returns [newRow, gained] */
    const vals = row.filter(v => v);
    const out = [];
    let gained = 0;
    for (let i = 0; i < vals.length; i++) {
      if (vals[i] === vals[i + 1]) {
        out.push(vals[i] * 2);
        gained += vals[i] * 2;
        if (vals[i] * 2 === 2048) won = true;
        i++;
      } else out.push(vals[i]);
    }
    while (out.length < N) out.push(0);
    return [out, gained];
  }

  function move(dr, dc) {
    if (over) return;
    prev = { grid: grid.map(r => [...r]), score };
    let moved = false, gained = 0;

    const read = (i, j) => {
      /* walk line i, index j, in the movement direction */
      if (dc === -1) return [i, j];
      if (dc === 1) return [i, N - 1 - j];
      if (dr === -1) return [j, i];
      return [N - 1 - j, i];
    };

    for (let i = 0; i < N; i++) {
      const line = [];
      for (let j = 0; j < N; j++) { const [r, c] = read(i, j); line.push(grid[r][c]); }
      const [slid, g] = slide(line);
      gained += g;
      for (let j = 0; j < N; j++) {
        const [r, c] = read(i, j);
        if (grid[r][c] !== slid[j]) moved = true;
        grid[r][c] = slid[j];
      }
    }

    if (!moved) { prev = null; return; }
    score += gained;
    addRandom();
    if (!canMove()) over = true;
    render();
    if (over) end();
  }

  function canMove() {
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      if (!grid[r][c]) return true;
      if (c < N - 1 && grid[r][c] === grid[r][c + 1]) return true;
      if (r < N - 1 && grid[r][c] === grid[r + 1][c]) return true;
    }
    return false;
  }

  async function end() {
    $('msg').textContent = won ? '2048! the glass sings. game over.' : 'no moves left — game over';
    if (score > 0) { await addScore('2048', score); refreshBest(); }
  }

  function render() {
    board.textContent = '';
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const cellEl = document.createElement('div');
      const v = grid[r][c];
      cellEl.style.cssText = `
        display:grid;place-items:center;border-radius:9px;
        font-weight:700;font-size:${v >= 1024 ? 18 : v >= 128 ? 22 : 26}px;
        background:${v ? tileHue(v) : 'hsl(var(--hue) 20% 18%/.35)'};
        border:1px solid hsl(var(--hue) 50% 70%/${v ? '.22' : '.06'});
        color:${v ? 'hsl(var(--hue) 30% 94%)' : 'transparent'};
        box-shadow:${v >= 128 ? '0 0 18px hsl(var(--hue) 70% 55%/.35), ' : ''}4px 6px 12px hsl(var(--hue) 40% 3%/.4);
        transition:all 120ms var(--ease);`;
      cellEl.textContent = v || '';
      board.appendChild(cellEl);
    }
    $('score').textContent = score;
    if (won && !over) $('msg').textContent = '2048 reached — keep going for glory';
    else if (!over) $('msg').textContent = 'arrows / wasd / swipe';
  }

  function newGame() {
    grid = emptyGrid();
    score = 0; over = false; won = false; prev = null;
    addRandom(); addRandom();
    render();
    board.focus();
  }

  function undo() {
    if (!prev) return;
    grid = prev.grid; score = prev.score; over = false;
    prev = null;
    render();
  }

  async function refreshBest() {
    const rows = await topScores('2048', 1);
    if (rows.length) $('best').textContent = rows[0].score;
  }

  /* input: keyboard */
  const dirs = {
    ArrowLeft: [0, -1], KeyA: [0, -1],
    ArrowRight: [0, 1], KeyD: [0, 1],
    ArrowUp: [-1, 0], KeyW: [-1, 0],
    ArrowDown: [1, 0], KeyS: [1, 0],
  };
  board.addEventListener('keydown', e => {
    const d = dirs[e.code];
    if (d) { e.preventDefault(); move(d[0], d[1]); }
  });

  /* input: swipe / drag */
  let sx = 0, sy = 0;
  board.addEventListener('pointerdown', e => { sx = e.clientX; sy = e.clientY; });
  board.addEventListener('pointerup', e => {
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    if (Math.abs(dx) > Math.abs(dy)) move(0, dx > 0 ? 1 : -1);
    else move(dy > 0 ? 1 : -1, 0);
  });

  $('new').addEventListener('click', newGame);
  $('undo').addEventListener('click', undo);

  newGame();
  refreshBest();
}
