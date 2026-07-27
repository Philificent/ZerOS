/**
 * ZerOS kernel — desktop: dock, desktop icons, wallpaper, toasts,
 * app launching.
 */
import { APPS, appById } from '../apps/registry.js';
import { createWindow, windowsFor, restoreWindow, focusWindow } from './wm.js';
import { on, getSetting, getWallpaper } from './db.js';

/* ---------------- toasts ---------------- */
let toastHost = null;
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

/* ---------------- app launching ---------------- */
const loaded = new Map();   // appId -> module

export async function launch(appId) {
  const app = appById(appId);
  if (!app) return toast(`no such app: ${appId}`);

  /* single-instance: focus/restore if already open */
  const open = windowsFor(appId);
  if (open.length) {
    const w = open[0];
    if (w.el.classList.contains('minimized')) restoreWindow(w.id);
    else focusWindow(w.id);
    return;
  }

  try {
    let mod = loaded.get(appId);
    if (!mod) {
      mod = await app.module();
      loaded.set(appId, mod);
    }
    const win = createWindow({
      appId,
      title: app.name,
      icon: app.icon,
      width: mod.WIDTH,
      height: mod.HEIGHT,
    });
    await mod.launch(win, { toast, launch });
  } catch (err) {
    console.error(`[zeros] failed to launch ${appId}`, err);
    toast(`${app.name} crashed on launch — see console`);
  }
}

/* ---------------- dock ---------------- */
function buildDock() {
  const dock = document.getElementById('dock');
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
