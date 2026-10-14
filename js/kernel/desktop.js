/**
 * ZerOS kernel — desktop: dock, desktop icons, wallpaper, toasts,
 * app launching.
 *
 * @ts-check
 */

import { APPS, appById } from '../apps/registry.js';
import { createWindow, windowsFor, restoreWindow, focusWindow, closeWindow } from './wm.js';
import { on, emit, getSetting, getWallpaper } from './db.js';

/** @typedef {{ id: string, el: HTMLElement, body: HTMLElement, appId: string, title: string, onClose?: () => void, onResize?: () => void, savedBox: any, setTitle: (t: string) => void, close: () => void, onResizeFn?: (fn: () => void) => void, onCloseFn?: (fn: () => void) => void }} WinHandle */

/* ---------------- toasts ---------------- */
let toastHost = null;

/**
 * Show a toast notification.
 * @param {string} msg
 * @param {number} [ms]
 */
export function toast(msg, ms = 3200) {
  if (!toastHost) {
    toastHost = document.createElement('div');
    toastHost.id = 'toasts';
    document.body.appendChild(toastHost);
  }
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  toastHost.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 350); }, ms);
}

/* ---------------- error boundary ---------------- */

/**
 * Show an error UI inside a window when an app crashes.
 * @param {WinHandle} win
 * @param {Error} err
 * @param {string} appName
 */
function showErrorBoundary(win, err, appName) {
  const stack = err.stack || err.message || String(err);
  win.body.innerHTML = `
    <div class="error-boundary">
      <div class="eb-icon">⚠</div>
      <h2>${escapeHtml(appName)} crashed</h2>
      <p class="eb-message">${escapeHtml(err.message || 'Unknown error')}</p>
      <details class="eb-details">
        <summary>Technical details</summary>
        <pre class="eb-stack">${escapeHtml(stack)}</pre>
      </details>
      <div class="eb-actions">
        <button class="zbtn primary" data-eb="reload">Reload app</button>
        <button class="zbtn ghost" data-eb="close">Close window</button>
        <button class="zbtn ghost" data-eb="report">Copy error</button>
      </div>
    </div>
  `;

  win.body.querySelector('[data-eb="reload"]')?.addEventListener('click', () => {
    // Reload the app by closing and relaunching
    const appId = win.appId;
    closeWindow(win.id);
    setTimeout(() => launch(appId), 300);
  });

  win.body.querySelector('[data-eb="close"]')?.addEventListener('click', () => {
    closeWindow(win.id);
  });

  win.body.querySelector('[data-eb="report"]')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(`ZerOS App Crash Report\nApp: ${appName}\nError: ${err.message}\n\nStack:\n${stack}`);
      toast('Error copied to clipboard');
    } catch {
      toast('Could not copy to clipboard');
    }
  });
}

/**
 * @param {string} s
 * @returns {string}
 */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------- app launching ---------------- */
/** @type {Map<string, any>} */
const loaded = new Map();   // appId -> module

/**
 * Launch an app, optionally handing it arguments (e.g. Antenna sending a
 * link to Inkwell). Fresh instances get the args as the third launch
 * parameter; an already-running instance hears them on `app:<id>:args`.
 * @param {string} appId
 * @param {any} [args]
 * @returns {Promise<void>}
 */
export async function launch(appId, args) {
  const app = appById(appId);
  if (!app) return toast(`no such app: ${appId}`);

  /* single-instance: focus/restore if already open */
  const open = windowsFor(appId);
  if (open.length) {
    const w = open[0];
    if (w.el.classList.contains('minimized')) restoreWindow(w.id);
    else focusWindow(w.id);
    if (args) emit(`app:${appId}:args`, args);
    return;
  }

  /** @type {WinHandle | null} */
  let win = null;

  try {
    let mod = loaded.get(appId);
    if (!mod) {
      mod = await app.module();
      loaded.set(appId, mod);
    }
    win = createWindow({
      appId,
      title: app.name,
      icon: app.icon,
      width: mod.WIDTH,
      height: mod.HEIGHT,
    });
    await mod.launch(win, { toast, launch }, args);
  } catch (err) {
    console.error(`[zeros] failed to launch ${appId}`, err);
    if (win) {
      // Show error boundary inside the window
      showErrorBoundary(win, err, app.name);
    } else {
      // Window creation failed — show toast
      toast(`${app.name} crashed on launch — see console`);
    }
  }
}

/* ---------------- dock ---------------- */
function buildDock() {
  const dock = document.getElementById('dock');
  if (!dock) return;
  dock.textContent = '';
  for (const app of APPS) {
    const b = document.createElement('button');
    b.className = 'dock-item';
    b.dataset.app = app.id;
    b.setAttribute('aria-label', app.name);
    const img = document.createElement('img');
    img.src = app.icon;
    img.alt = '';
    const tip = document.createElement('span');
    tip.className = 'tip';
    tip.textContent = app.name;
    const dot = document.createElement('span');
    dot.className = 'dot';
    b.append(img, tip, dot);
    b.addEventListener('click', () => launch(app.id));
    dock.appendChild(b);
  }
  on('wm:change', () => {
    for (const b of dock.querySelectorAll('.dock-item')) {
      b.classList.toggle('running', windowsFor(b.dataset.app).length > 0);
    }
  });
}

/* ---------------- desktop icons ---------------- */
function buildIcons() {
  const host = document.getElementById('desktop-icons');
  if (!host) return;
  host.textContent = '';
  for (const app of APPS) {
    const b = document.createElement('button');
    b.className = 'dicon';
    b.title = app.desc;
    const img = document.createElement('img');
    img.src = app.icon;
    img.alt = '';
    const label = document.createElement('span');
    label.textContent = app.name;
    b.append(img, label);
    b.addEventListener('dblclick', () => launch(app.id));
    b.addEventListener('keydown', e => { if (e.key === 'Enter') launch(app.id); });
    host.appendChild(b);
  }
}

/* ---------------- wallpaper ---------------- */
export async function applyWallpaper() {
  const el = document.getElementById('wallpaper');
  if (!el) return;
  const id = getSetting('wallpaper', '');
  if (!id) {   // procedural default (pure CSS, theme-reactive)
    el.style.backgroundImage = '';
    el.classList.remove('has-image');
    return;
  }
  const wp = await getWallpaper(id);
  if (!wp) { el.style.backgroundImage = ''; return; }
  if (wp.kind === 'image') {
    el.style.backgroundImage = `url("${wp.data}")`;
    el.classList.add('has-image');
  } else {
    el.style.backgroundImage = wp.data;
    el.classList.add('has-image');
  }
}

/* ---------------- init ---------------- */
export function initDesktop() {
  buildDock();
  buildIcons();
  applyWallpaper();
  on('setting:wallpaper', applyWallpaper);
  on('wallpapers:changed', applyWallpaper);
}
