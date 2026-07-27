/**
 * ZerOS kernel — window manager.
 *
 * Draggable, resizable glass windows with focus-depth: the focused
 * window sits closest to the glass, unfocused ones recede (blur, dim,
 * shallower shadows). Shadows are cast away from the 0,0 light origin.
 */
import { emit } from './db.js';
import { provideWindowRects } from './motes.js';

const layer = () => document.getElementById('windows');

let zTop = 10;
let seq = 0;
const wins = new Map();          // id -> record

export const openWindows = () => [...wins.values()];
export const windowsFor = appId => openWindows().filter(w => w.appId === appId);

provideWindowRects(() =>
  openWindows()
    .filter(w => !w.el.classList.contains('minimized'))
    .map(w => {
      const r = w.el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    }),
);

export function focusWindow(id) {
  const w = wins.get(id);
  if (!w) return;
  zTop += 1;
  w.el.style.zIndex = zTop;
  for (const o of wins.values()) {
    const focused = o.id === id;
    o.el.classList.toggle('focused', focused);
    o.el.classList.toggle('blurred', !focused);
  }
  document.getElementById('tb-appname').textContent = '— ' + w.title;
  emit('wm:change');
}

export function closeWindow(id) {
  const w = wins.get(id);
  if (!w) return;
  try { w.onClose?.(); } catch (e) { console.warn(e); }
  w.el.classList.add('closing');
  setTimeout(() => w.el.remove(), 220);
  wins.delete(id);
  const rest = openWindows();
  if (rest.length) focusWindow(rest[rest.length - 1].id);
  else document.getElementById('tb-appname').textContent = '';
  emit('wm:change');
}

export function minimizeWindow(id) {
  const w = wins.get(id);
  if (!w) return;
  w.el.classList.add('minimized');
  emit('wm:change');
}

export function restoreWindow(id) {
  const w = wins.get(id);
  if (!w) return;
  w.el.classList.remove('minimized');
  focusWindow(id);
}

export function toggleMaximize(id) {
  const w = wins.get(id);
  if (!w) return;
  const el = w.el;
  if (el.classList.contains('maxed')) {
    el.classList.remove('maxed');
    Object.assign(el.style, w.savedBox);
  } else {
    w.savedBox = { left: el.style.left, top: el.style.top, width: el.style.width, height: el.style.height };
    el.classList.add('maxed');
    Object.assign(el.style, { left: '0px', top: '30px', width: '100vw', height: 'calc(100vh - 30px)' });
  }
  w.onResize?.();
  emit('wm:change');
}

/**
 * Create a window.
 * opts: { appId, title, icon (svg string or url), width, height, x, y,
 *         onClose(), onResize() }
 * Returns { id, el, body, setTitle, close, api }.
 */
export function createWindow(opts) {
  const id = 'w' + (++seq);
  const el = document.createElement('section');
  el.className = 'win opening';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', opts.title);

  const W = Math.min(opts.width || 560, window.innerWidth - 24);
  const H = Math.min(opts.height || 420, window.innerHeight - 90);
  const offset = (wins.size % 7) * 28;
  const x = opts.x ?? Math.max(12, (window.innerWidth - W) / 2 + offset - 60);
  const y = opts.y ?? Math.max(42, (window.innerHeight - H) / 2.4 + offset);
  Object.assign(el.style, { left: x + 'px', top: y + 'px', width: W + 'px', height: H + 'px' });

  const iconHtml = (opts.icon || '').startsWith('<svg')
    ? opts.icon
    : `<img src="${opts.icon || 'assets/logo.svg'}" alt="">`;
  const safeTitle = String(opts.title).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  el.innerHTML = `
    <div class="win-title">
      ${iconHtml}
      <span class="t">${safeTitle}</span>
      <div class="win-btns">
        <button class="b-min" title="minimize" aria-label="minimize"></button>
        <button class="b-max" title="maximize" aria-label="maximize"></button>
        <button class="b-close" title="close" aria-label="close"></button>
      </div>
    </div>
    <div class="win-body"></div>
    <div class="win-resize" title="resize"></div>
  `;

  layer().appendChild(el);
  setTimeout(() => el.classList.remove('opening'), 300);

  const body = el.querySelector('.win-body');
  const rec = {
    id, el, body,
    appId: opts.appId,
    title: opts.title,
    onClose: opts.onClose,
    onResize: opts.onResize,
    savedBox: null,
  };
  wins.set(id, rec);

  /* chrome buttons */
  el.querySelector('.b-close').addEventListener('click', e => { e.stopPropagation(); closeWindow(id); });
  el.querySelector('.b-min').addEventListener('click', e => { e.stopPropagation(); minimizeWindow(id); });
  el.querySelector('.b-max').addEventListener('click', e => { e.stopPropagation(); toggleMaximize(id); });
  el.addEventListener('pointerdown', () => focusWindow(id));

  /* drag by titlebar */
  const bar = el.querySelector('.win-title');
  bar.addEventListener('pointerdown', ev => {
    if (ev.target.closest('.win-btns') || el.classList.contains('maxed')) return;
    ev.preventDefault();
    try { bar.setPointerCapture(ev.pointerId); } catch { /* synthetic pointer */ }
    const sx = ev.clientX - el.offsetLeft;
    const sy = ev.clientY - el.offsetTop;
    const move = e => {
      el.style.left = Math.min(Math.max(e.clientX - sx, -W + 80), window.innerWidth - 40) + 'px';
      el.style.top = Math.min(Math.max(e.clientY - sy, 30), window.innerHeight - 60) + 'px';
    };
    const up = () => {
      bar.removeEventListener('pointermove', move);
      bar.removeEventListener('pointerup', up);
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up);
  });
  bar.addEventListener('dblclick', e => {
    if (!e.target.closest('.win-btns')) toggleMaximize(id);
  });

  /* resize handle */
  const grip = el.querySelector('.win-resize');
  grip.addEventListener('pointerdown', ev => {
    ev.preventDefault();
    ev.stopPropagation();
    try { grip.setPointerCapture(ev.pointerId); } catch { /* synthetic pointer */ }
    const sw = el.offsetWidth - ev.clientX;
    const sh = el.offsetHeight - ev.clientY;
    const move = e => {
      el.style.width = Math.max(320, sw + e.clientX) + 'px';
      el.style.height = Math.max(200, sh + e.clientY) + 'px';
      rec.onResize?.();
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      rec.onResize?.();
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
  });

  focusWindow(id);

  return {
    id, el, body,
    setTitle(t) {
      rec.title = t;
      el.querySelector('.win-title .t').textContent = t;
    },
    close: () => closeWindow(id),
    onResize(fn) { rec.onResize = fn; },
    onClose(fn) { rec.onClose = fn; },
  };
}
