/**
 * ZerOS kernel — atmosphere renderer.
 *
 * Two canvases share one geometric truth: all light in ZerOS radiates
 * from the browser origin (0,0) — a consistent vanishing point in the
 * top-left corner of the system window.
 *
 *  #shafts (behind windows): soft volumetric light wedges fanning out
 *          from the origin, breathing slowly.
 *  #motes  (above windows):  dust motes that live along the borders of
 *          open windows. Each mote drifts radially away from the origin
 *          and only lights up while it passes through a shaft.
 */
import { getSetting, on } from './db.js';
import { currentTheme, secondaryHue } from './theme.js';

const TAU = Math.PI * 2;

/* shaft definition: angle (rad from origin), angular width, strength */
let SHAFTS = [];
function rollShafts() {
  SHAFTS = [];
  const n = 4;
  for (let i = 0; i < n; i++) {
    SHAFTS.push({
      angle: 0.12 + (i / n) * (Math.PI / 2 - 0.24) + (Math.random() - 0.5) * 0.08,
      width: 0.05 + Math.random() * 0.07,
      strength: 0.5 + Math.random() * 0.5,
      phase: Math.random() * TAU,
    });
  }
}

/** light intensity 0..1 at a given angle from the origin, at time t */
function shaftLight(angle, t) {
  let v = 0;
  for (const s of SHAFTS) {
    const breathe = 0.75 + 0.25 * Math.sin(t * 0.00035 + s.phase);
    const d = (angle - s.angle) / s.width;
    v += s.strength * breathe * Math.exp(-d * d);
  }
  return Math.min(v, 1);
}

/* ---------------- shafts canvas ---------------- */
let shaftsCv, shaftsCtx, motesCv, motesCtx;
let W = 0, H = 0, DPR = 1;

function sizeCanvas(cv, ctx) {
  cv.width = Math.round(W * DPR);
  cv.height = Math.round(H * DPR);
  cv.style.width = W + 'px';
  cv.style.height = H + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

function resize() {
  W = window.innerWidth;
  H = window.innerHeight;
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  sizeCanvas(shaftsCv, shaftsCtx);
  sizeCanvas(motesCv, motesCtx);
}

function drawShafts(t) {
  const { hue, intensity, mode } = currentTheme();
  const h2 = secondaryHue(hue, mode);
  const reach = Math.hypot(W, H) * 1.1;
  const ctx = shaftsCtx;
  ctx.clearRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'lighter';

  SHAFTS.forEach((s, i) => {
    const breathe = 0.75 + 0.25 * Math.sin(t * 0.00035 + s.phase);
    const a0 = s.angle - s.width * 2.2;
    const a1 = s.angle + s.width * 2.2;
    const h = i % 2 ? h2 : hue;
    const alpha = 0.05 * intensity * s.strength * breathe;

    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, reach);
    grad.addColorStop(0, `hsl(${h} 80% 75% / ${alpha * 1.6})`);
    grad.addColorStop(0.25, `hsl(${h} 70% 60% / ${alpha})`);
    grad.addColorStop(1, 'transparent');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, reach, a0, a1);
    ctx.closePath();
    ctx.fill();
  });

  /* origin glow — the "sun" pinned to 0,0 */
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 320);
  g.addColorStop(0, `hsl(${hue} 85% 80% / ${0.16 * intensity})`);
  g.addColorStop(1, 'transparent');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 340, 340);
  ctx.globalCompositeOperation = 'source-over';
}

/* ---------------- cursor light ---------------- */
/* The pointer carries a faint lamp: motes inside its halo brighten,
   and its wake pushes them along + curls them into a small eddy. */
const CURSOR_R = 150;
const cursor = { x: -9999, y: -9999, vx: 0, vy: 0, t: 0, seen: false };

function initCursor() {
  window.addEventListener('pointermove', e => {
    const now = performance.now();
    if (cursor.seen) {
      const dt = Math.max(8, now - cursor.t);
      /* velocity in px/frame (16ms), smoothed */
      cursor.vx = cursor.vx * 0.6 + ((e.clientX - cursor.x) / dt) * 16 * 0.4;
      cursor.vy = cursor.vy * 0.6 + ((e.clientY - cursor.y) / dt) * 16 * 0.4;
    }
    cursor.x = e.clientX;
    cursor.y = e.clientY;
    cursor.t = now;
    cursor.seen = true;
  }, { passive: true });
  document.documentElement.addEventListener('mouseleave', () => { cursor.seen = false; });
}

/* ---------------- motes ---------------- */
const MAX_MOTES = 150;
let motes = [];
let getRects = () => [];   // injected by wm.js

/** register a provider that returns window border rects */
export function provideWindowRects(fn) { getRects = fn; }

function spawnMote(rect) {
  /* pick a point on the window border (the glass rim) */
  const side = Math.floor(Math.random() * 4);
  const pad = 6;               // rim thickness the motes inhabit
  let x, y;
  if (side === 0) { x = rect.x + Math.random() * rect.w; y = rect.y + (Math.random() - 0.5) * pad * 2; }
  else if (side === 1) { x = rect.x + rect.w + (Math.random() - 0.5) * pad * 2; y = rect.y + Math.random() * rect.h; }
  else if (side === 2) { x = rect.x + Math.random() * rect.w; y = rect.y + rect.h + (Math.random() - 0.5) * pad * 2; }
  else { x = rect.x + (Math.random() - 0.5) * pad * 2; y = rect.y + Math.random() * rect.h; }

  return {
    x, y,
    rect,
    born: performance.now(),
    life: 4000 + Math.random() * 6000,
    size: 0.5 + Math.random() * 1.4,
    drift: 0.03 + Math.random() * 0.12,   // radial px/frame away from 0,0
    wx: 0, wy: 0,                          // wake velocity from the cursor
    wobble: Math.random() * TAU,
    wobbleSpd: 0.001 + Math.random() * 0.002,
  };
}

function stepMotes(t) {
  const rects = getRects();
  const enabled = getSetting('motes', 'on') !== 'off';

  /* population control: motes live on window borders; desktop edge counts as one frame */
  const targets = rects.length ? rects : [{ x: 0, y: 30, w: W, h: H - 30, ghost: true }];
  const desired = enabled ? Math.min(MAX_MOTES, 30 + targets.length * 40) : 0;

  motes = motes.filter(m => t - m.born < m.life);
  while (motes.length < desired) {
    motes.push(spawnMote(targets[Math.floor(Math.random() * targets.length)]));
  }
  if (motes.length > desired) motes.length = desired;

  const { hue, intensity } = currentTheme();
  const glowOn = getSetting('cursorglow', 'on') !== 'off' && cursor.seen;
  /* cursor momentum bleeds off while the pointer rests */
  if (t - cursor.t > 90) { cursor.vx *= 0.86; cursor.vy *= 0.86; }
  const spd = Math.min(40, Math.hypot(cursor.vx, cursor.vy));

  const ctx = motesCtx;
  ctx.clearRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'lighter';

  for (const m of motes) {
    /* drift radially away from the vanishing point at 0,0 */
    const dist = Math.hypot(m.x, m.y) || 1;
    m.x += (m.x / dist) * m.drift;
    m.y += (m.y / dist) * m.drift;
    /* small perpendicular wobble so the dust feels alive */
    m.wobble += m.wobbleSpd * 16;
    m.x += Math.cos(m.wobble) * 0.15;
    m.y += Math.sin(m.wobble) * 0.15;

    /* wake & eddy: the passing cursor drags motes along its path and
       curls them around its halo, then the disturbance decays */
    let near = 0;
    if (glowOn) {
      const dx = m.x - cursor.x, dy = m.y - cursor.y;
      const d = Math.hypot(dx, dy);
      if (d < CURSOR_R && d > 0.5) {
        near = 1 - d / CURSOR_R;
        const curl = (cursor.vx * dy - cursor.vy * dx) >= 0 ? 1 : -1;   // eddy spins with the pass side
        m.wx += (cursor.vx * 0.055 + (-dy / d) * curl * spd * 0.02) * near;
        m.wy += (cursor.vy * 0.055 + (dx / d) * curl * spd * 0.02) * near;
      }
    }
    m.wx *= 0.90; m.wy *= 0.90;
    m.x += Math.max(-3, Math.min(3, m.wx));
    m.y += Math.max(-3, Math.min(3, m.wy));

    const age = (t - m.born) / m.life;
    const fade = age < 0.15 ? age / 0.15 : age > 0.75 ? (1 - age) / 0.25 : 1;

    /* lit by the shafts from the origin, boosted inside the cursor halo */
    const angle = Math.atan2(m.y, m.x);
    const light = shaftLight(angle, t);
    let a = fade * (0.08 + 0.85 * light) * (0.35 + intensity * 0.65);
    a *= 1 + 2.2 * near;
    if (a < 0.02) continue;

    ctx.beginPath();
    ctx.arc(m.x, m.y, m.size * (1 + near * 0.7), 0, TAU);
    ctx.fillStyle = `hsl(${hue} 70% 85% / ${Math.min(a, 0.95)})`;
    ctx.fill();
    if (light > 0.55 || near > 0.45) {   /* sparkle in a shaft's core or beside the cursor */
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.size * 2.6, 0, TAU);
      ctx.fillStyle = `hsl(${hue} 90% 75% / ${Math.min(a * 0.25, 0.4)})`;
      ctx.fill();
    }
  }

  /* the cursor's own halo — subtle, swells slightly with speed */
  if (glowOn) {
    const r = 90 + spd * 2;
    const ga = (0.045 + Math.min(0.05, spd * 0.0035)) * (0.4 + intensity * 0.6);
    const g = ctx.createRadialGradient(cursor.x, cursor.y, 0, cursor.x, cursor.y, r);
    g.addColorStop(0, `hsl(${hue} 85% 78% / ${ga})`);
    g.addColorStop(0.45, `hsl(${hue} 75% 65% / ${ga * 0.35})`);
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.fillRect(cursor.x - r, cursor.y - r, r * 2, r * 2);
  }
  ctx.globalCompositeOperation = 'source-over';
}

/* ---------------- loop ---------------- */
let raf = 0;
let lastShaft = 0;

function loop(t) {
  raf = requestAnimationFrame(loop);
  if (t - lastShaft > 90) {           // shafts breathe slowly; ~11fps is plenty
    drawShafts(t);
    lastShaft = t;
  }
  stepMotes(t);
}

export function initAtmosphere() {
  shaftsCv = document.getElementById('shafts');
  motesCv = document.getElementById('motes');
  shaftsCtx = shaftsCv.getContext('2d');
  motesCtx = motesCv.getContext('2d');
  rollShafts();
  resize();
  initCursor();
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelAnimationFrame(raf);
    else raf = requestAnimationFrame(loop);
  });
  on('setting:hue', () => drawShafts(performance.now()));
  raf = requestAnimationFrame(loop);
}
