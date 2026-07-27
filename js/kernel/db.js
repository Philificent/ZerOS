/**
 * ZerOS kernel — database layer.
 *
 * One living PostgreSQL database (PGlite, WASM) persisted to IndexedDB.
 * Every piece of OS state — settings, wallpapers, scores, documents,
 * shell history — lives in it. A tiny event bus makes the OS react to
 * writes, so `UPDATE settings ...` from ZeroShell re-skins the desktop.
 *
 * If PGlite cannot start (e.g. opened from file://), a localStorage
 * fallback keeps the OS bootable; raw SQL is then unavailable.
 */

export const bus = new EventTarget();
export const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));
export const on = (type, fn) => bus.addEventListener(type, fn);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS wallpapers (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'css',   -- 'css' | 'image'
  data       TEXT NOT NULL,                 -- css background value or data-URL
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS scores (
  id         SERIAL PRIMARY KEY,
  game       TEXT NOT NULL,
  player     TEXT NOT NULL DEFAULT 'you',
  score      INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS documents (
  id         SERIAL PRIMARY KEY,
  title      TEXT NOT NULL,
  content    TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS shell_history (
  id         SERIAL PRIMARY KEY,
  cmd        TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
`;

const DEFAULT_SETTINGS = {
  hue: '210',
  intensity: '0.55',
  colormode: 'duo',        // mono | duo | comp
  motes: 'on',
  cursorglow: 'on',        // cursor light that stirs the motes
  widget_clock: 'on',
  widget_sys: 'on',
  wallpaper: '',           // wallpaper id, '' = procedural default
  booted_times: '0',
};

let pg = null;              // PGlite instance (null in fallback mode)
let mode = 'pglite';        // 'pglite' | 'local'
const cache = new Map();    // settings cache

/* ---------------- localStorage fallback ---------------- */
const LS_KEY = 'zeros-fallback';
const ls = {
  load() { try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; } },
  save(d) { try { localStorage.setItem(LS_KEY, JSON.stringify(d)); } catch { /* full */ } },
};

/* ---------------- init ---------------- */
export async function initDB(progress = () => {}) {
  try {
    progress('loading postgres (wasm)…');
    const { PGlite } = await import('../../vendor/pglite/index.js');
    pg = new PGlite('idb://zeros');
    await pg.waitReady;
    progress('migrating schema…');
    await pg.exec(SCHEMA);
    mode = 'pglite';
  } catch (err) {
    console.warn('[zeros] PGlite unavailable, using localStorage fallback:', err);
    pg = null;
    mode = 'local';
  }
  progress('loading settings…');
  await loadSettings();
  const boots = parseInt(cache.get('booted_times') || '0', 10) + 1;
  await setSetting('booted_times', String(boots));
  return { mode, boots };
}

export const dbMode = () => mode;

/** Raw SQL access — powers ZeroShell. Throws in fallback mode. */
export async function sql(text, params = []) {
  if (!pg) throw new Error('raw SQL unavailable (PGlite failed to start)');
  return pg.query(text, params);
}

/** Re-read settings from DB and emit change events (used after raw SQL writes). */
export async function refreshFromDB() {
  const before = new Map(cache);
  await loadSettings();
  for (const [k, v] of cache) if (before.get(k) !== v) emit('setting:' + k, v);
  emit('db:refresh');
}

/* ---------------- settings ---------------- */
async function loadSettings() {
  if (pg) {
    const res = await pg.query('SELECT key, value FROM settings');
    cache.clear();
    for (const row of res.rows) cache.set(row.key, row.value);
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
      if (!cache.has(k)) {
        await pg.query('INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO NOTHING', [k, v]);
        cache.set(k, v);
      }
    }
  } else {
    const d = ls.load();
    cache.clear();
    for (const [k, v] of Object.entries({ ...DEFAULT_SETTINGS, ...(d.settings || {}) })) cache.set(k, String(v));
  }
}

export function getSetting(key, def = null) {
  return cache.has(key) ? cache.get(key) : def;
}

export async function setSetting(key, value) {
  value = String(value);
  cache.set(key, value);
  if (pg) {
    await pg.query(
      'INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = $2',
      [key, value],
    );
  } else {
    const d = ls.load();
    d.settings = d.settings || {};
    d.settings[key] = value;
    ls.save(d);
  }
  emit('setting:' + key, value);
}

/* ---------------- wallpapers ---------------- */
export async function listWallpapers() {
  if (pg) {
    const r = await pg.query('SELECT id, name, kind, data FROM wallpapers ORDER BY id');
    return r.rows;
  }
  return (ls.load().wallpapers || []);
}

export async function addWallpaper(name, kind, data) {
  if (pg) {
    const r = await pg.query(
      'INSERT INTO wallpapers (name, kind, data) VALUES ($1,$2,$3) RETURNING id',
      [name, kind, data],
    );
    emit('wallpapers:changed');
    return r.rows[0].id;
  }
  const d = ls.load();
  d.wallpapers = d.wallpapers || [];
  const id = Date.now();
  d.wallpapers.push({ id, name, kind, data });
  ls.save(d);
  emit('wallpapers:changed');
  return id;
}

export async function deleteWallpaper(id) {
  if (pg) await pg.query('DELETE FROM wallpapers WHERE id = $1', [id]);
  else {
    const d = ls.load();
    d.wallpapers = (d.wallpapers || []).filter(w => w.id !== id);
    ls.save(d);
  }
  emit('wallpapers:changed');
}

export async function getWallpaper(id) {
  if (pg) {
    const r = await pg.query('SELECT id, name, kind, data FROM wallpapers WHERE id = $1', [id]);
    return r.rows[0] || null;
  }
  return (ls.load().wallpapers || []).find(w => String(w.id) === String(id)) || null;
}

/* ---------------- game scores ---------------- */
export async function addScore(game, score, player = 'you') {
  if (pg) {
    await pg.query('INSERT INTO scores (game, player, score) VALUES ($1,$2,$3)', [game, player, score]);
  } else {
    const d = ls.load();
    d.scores = d.scores || [];
    d.scores.push({ game, player, score, created_at: new Date().toISOString() });
    ls.save(d);
  }
  emit('scores:changed', { game });
}

export async function topScores(game, n = 5) {
  if (pg) {
    const r = await pg.query(
      'SELECT player, score, created_at FROM scores WHERE game = $1 ORDER BY score DESC, id ASC LIMIT $2',
      [game, n],
    );
    return r.rows;
  }
  return (ls.load().scores || [])
    .filter(s => s.game === game)
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}

/* ---------------- documents (markdown) ---------------- */
export async function listDocs() {
  if (pg) {
    const r = await pg.query('SELECT id, title, updated_at FROM documents ORDER BY updated_at DESC');
    return r.rows;
  }
  return (ls.load().docs || []).map(({ id, title, updated_at }) => ({ id, title, updated_at }));
}

export async function getDoc(id) {
  if (pg) {
    const r = await pg.query('SELECT * FROM documents WHERE id = $1', [id]);
    return r.rows[0] || null;
  }
  return (ls.load().docs || []).find(x => String(x.id) === String(id)) || null;
}

export async function saveDoc(id, title, content) {
  if (pg) {
    if (id) {
      await pg.query('UPDATE documents SET title=$1, content=$2, updated_at=now() WHERE id=$3', [title, content, id]);
      emit('docs:changed');
      return id;
    }
    const r = await pg.query('INSERT INTO documents (title, content) VALUES ($1,$2) RETURNING id', [title, content]);
    emit('docs:changed');
    return r.rows[0].id;
  }
  const d = ls.load();
  d.docs = d.docs || [];
  if (id) {
    const doc = d.docs.find(x => String(x.id) === String(id));
    if (doc) { doc.title = title; doc.content = content; doc.updated_at = new Date().toISOString(); }
  } else {
    id = Date.now();
    d.docs.push({ id, title, content, updated_at: new Date().toISOString() });
  }
  ls.save(d);
  emit('docs:changed');
  return id;
}

export async function deleteDoc(id) {
  if (pg) await pg.query('DELETE FROM documents WHERE id = $1', [id]);
  else {
    const d = ls.load();
    d.docs = (d.docs || []).filter(x => String(x.id) !== String(id));
    ls.save(d);
  }
  emit('docs:changed');
}

/* ---------------- shell history ---------------- */
export async function addHistory(cmd) {
  if (pg) await pg.query('INSERT INTO shell_history (cmd) VALUES ($1)', [cmd]);
}

export async function getHistory(n = 100) {
  if (!pg) return [];
  const r = await pg.query('SELECT cmd FROM shell_history ORDER BY id DESC LIMIT $1', [n]);
  return r.rows.map(x => x.cmd).reverse();
}
