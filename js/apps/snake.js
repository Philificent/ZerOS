/**
 * Voltline — neon snake for ZerOS.
 * Canvas game; high scores persisted in the OS database.
 */
import { addScore, topScores } from '../kernel/db.js';
import { currentTheme } from '../kernel/theme.js';

export const WIDTH = 560;
export const HEIGHT = 520;

const COLS = 24, ROWS = 20;

export async function launch(win) {
  const body = win.body;
  body.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%;">
      <div style="display:flex;align-items:center;gap:12px;padding:8px 12px;flex:0 0 auto;">
        <span class="zlabel">score</span><b data-sn="score" style="font-variant-numeric:tabular-nums">0</b>
        <span class="zlabel">best</span><b data-sn="best" style="font-variant-numeric:tabular-nums;color:var(--acc)">0</b>
        <span style="flex:1"></span>
        <button class="zbtn" data-sn="btn">start</button>
      </div>
      <div style="flex:1;display:grid;place-items:center;padding:0 12px 8px;min-height:0;">
        <canvas data-sn="cv" tabindex="0" style="outline:none;border-radius:10px;border:1px solid hsl(var(--hue) 40% 60%/.2);max-width:100%;max-height:100%;"></canvas>
      </div>
      <div data-sn="scores" style="flex:0 0 auto;padding:4px 14px 10px;font-size:11px;color:var(--ink-dim);font-family:var(--mono);"></div>
    </div>`;

  const $ = s => body.querySelector(`[data-sn="${s}"]`);
  const cv = $('cv');
  const ctx = cv.getContext('2d');
  let cell = 22;

  function fit() {
    const box = cv.parentElement.getBoundingClientRect();
    cell = Math.max(10, Math.floor(Math.min(box.width / COLS, box.height / ROWS)));
    cv.width = COLS * cell;
    cv.height = ROWS * cell;
    draw();
  }
  win.onResize(fit);

  /* ---- state ---- */
  let snake, dir, nextDir, food, score, dead, running, timer, speed;

  function reset() {
    snake = [{ x: 8, y: 10 }, { x: 7, y: 10 }, { x: 6, y: 10 }];
    dir = { x: 1, y: 0 };
    nextDir = dir;
    score = 0;
    speed = 130;
    dead = false;
    placeFood();
    $('score').textContent = '0';
  }

  function placeFood() {
    do {
      food = { x: (Math.random() * COLS) | 0, y: (Math.random() * ROWS) | 0 };
    } while (snake.some(s => s.x === food.x && s.y === food.y));
  }

  function step() {
    dir = nextDir;
    const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
    if (head.x < 0 || head.y < 0 || head.x >= COLS || head.y >= ROWS ||
        snake.some(s => s.x === head.x && s.y === head.y)) {
      return gameOver();
    }
    snake.unshift(head);
    if (head.x === food.x && head.y === food.y) {
      score += 10;
      $('score').textContent = score;
      speed = Math.max(60, speed - 2);
      placeFood();
      schedule();
    } else {
      snake.pop();
    }
    draw();
  }

  function schedule() {
    clearInterval(timer);
    timer = setInterval(step, speed);
  }

  async function gameOver() {
    dead = true;
    running = false;
    clearInterval(timer);
    $('btn').textContent = 'again';
    draw();
    if (score > 0) {
      await addScore('snake', score);
      renderScores();
    }
  }

  function start() {
    reset();
    running = true;
    $('btn').textContent = 'restart';
    schedule();
    cv.focus();
    draw();
  }

  /* ---- render ---- */
  function draw() {
    const { hue } = currentTheme();
    ctx.clearRect(0, 0, cv.width, cv.height);

    /* faint grid */
    ctx.strokeStyle = `hsl(${hue} 30% 50% / .06)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < COLS; i++) { ctx.moveTo(i * cell, 0); ctx.lineTo(i * cell, cv.height); }
    for (let i = 1; i < ROWS; i++) { ctx.moveTo(0, i * cell); ctx.lineTo(cv.width, i * cell); }
    ctx.stroke();

    if (!snake) return;

    /* food */
    ctx.shadowColor = `hsl(${(hue + 180) % 360} 90% 65%)`;
    ctx.shadowBlur = 14;
    ctx.fillStyle = `hsl(${(hue + 180) % 360} 85% 62%)`;
    ctx.beginPath();
    ctx.arc(food.x * cell + cell / 2, food.y * cell + cell / 2, cell * 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    /* snake body — bright head fading down the tail */
    snake.forEach((s, i) => {
      const t = i / snake.length;
      ctx.fillStyle = dead
        ? `hsl(4 70% ${52 - t * 25}% / ${1 - t * 0.6})`
        : `hsl(${hue} 85% ${64 - t * 30}% / ${1 - t * 0.5})`;
      if (i === 0 && !dead) { ctx.shadowColor = `hsl(${hue} 90% 65%)`; ctx.shadowBlur = 16; }
      const p = cell * 0.08;
      roundRect(s.x * cell + p, s.y * cell + p, cell - p * 2, cell - p * 2, cell * 0.28);
      ctx.shadowBlur = 0;
    });

    if (dead) overlay('flatlined', `score ${score} — press start`);
    else if (!running) overlay('VOLTLINE', 'arrows / wasd · press start');
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();
  }

  function overlay(big, small) {
    ctx.fillStyle = 'hsl(0 0% 0% / .45)';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.textAlign = 'center';
    ctx.fillStyle = 'hsl(0 0% 96%)';
    ctx.font = `700 ${cell * 1.4}px system-ui`;
    ctx.fillText(big, cv.width / 2, cv.height / 2 - cell * 0.4);
    ctx.fillStyle = 'hsl(0 0% 70%)';
    ctx.font = `${cell * 0.6}px system-ui`;
    ctx.fillText(small, cv.width / 2, cv.height / 2 + cell);
  }

  /* ---- input ---- */
  const keymap = {
    ArrowUp: { x: 0, y: -1 }, KeyW: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 }, KeyS: { x: 0, y: 1 },
    ArrowLeft: { x: -1, y: 0 }, KeyA: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 }, KeyD: { x: 1, y: 0 },
  };
  function onKey(e) {
    const d = keymap[e.code];
    if (d) {
      e.preventDefault();
      if (!running && !dead) start();
      if (d.x !== -dir.x || d.y !== -dir.y) nextDir = d;
    } else if (e.code === 'Space') {
      e.preventDefault();
      if (!running) start();
    }
  }
  cv.addEventListener('keydown', onKey);
  $('btn').addEventListener('click', start);

  async function renderScores() {
    const rows = await topScores('snake', 5);
    if (rows.length) $('best').textContent = rows[0].score;
    $('scores').textContent = rows.length
      ? 'hall of fame  ·  ' + rows.map((r, i) => `${i + 1}. ${r.score}`).join('   ')
      : 'no scores yet — the database is waiting';
  }

  win.onClose(() => clearInterval(timer));

  reset();
  running = false;
  fit();
  renderScores();
}
