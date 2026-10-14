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
 *
 * @ts-check
 */

/** @typedef {{ key: string, value: string }} SettingRow */
/** @typedef {{ id: number, name: string, kind: string, data: string, created_at?: string }} WallpaperRow */
/** @typedef {{ id: number, game: string, player: string, score: number, created_at?: string }} ScoreRow */
/** @typedef {{ id: number, title: string, content: string, updated_at?: string }} DocRow */
/** @typedef {{ id: number, cmd: string, created_at?: string }} HistoryRow */
/** @typedef {{ id: number, url: string, title: string, added_at?: string }} FeedRow */

export const bus = new EventTarget();
/**
 * @param {string} type
 * @param {any} [detail]
 */
export const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));
/**
 * @param {string} type
 * @param {(e: CustomEvent) => void} fn
 */
export const on = (type, fn) => bus.addEventListener(type, fn);
/**
 * @param {string} type
 * @param {(e: CustomEvent) => void} fn
 */
export const off = (type, fn) => bus.removeEventListener(type, fn);

/** Current schema version — bump when adding migrations */
const SCHEMA_VERSION = 2;

/** @type {Array<{version: number, name: string, up: (pg: any) => Promise<void>}>} */
const MIGRATIONS = [
  {
    version: 1,
    name: 'initial_schema',
    up: async (pg) => {
      await pg.exec(`
        CREATE TABLE IF NOT EXISTS settings (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS wallpapers (
          id         SERIAL PRIMARY KEY,
          name       TEXT NOT NULL,
          kind       TEXT NOT NULL DEFAULT 'css',
          data       TEXT NOT NULL,
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
        CREATE TABLE IF NOT EXISTS feeds (
          id         SERIAL PRIMARY KEY,
          url        TEXT NOT NULL UNIQUE,
          title      TEXT NOT NULL DEFAULT '',
          added_at   TIMESTAMPTZ DEFAULT now()
        );
      `);
    },
  },
  {
    version: 2,
    name: 'add_indexes',
    up: async (pg) => {
      // Performance indexes for common queries
      await pg.exec(`
        CREATE INDEX IF NOT EXISTS idx_scores_game_score ON scores(game, score DESC);
        CREATE INDEX IF NOT EXISTS idx_documents_updated ON documents(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_feeds_url ON feeds(url);
        CREATE INDEX IF NOT EXISTS idx_shell_history_id ON shell_history(id DESC);
      `);
    },
  },
];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_version (
  version    INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  applied_at TIMESTAMPTZ DEFAULT now()
);
`;

/** @type {Record<string, string>} */
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

/** @type {any} */
let pg = null;              // PGlite instance (null in fallback mode)
/** @type {'pglite' | 'local'} */
let mode = 'pglite';        // 'pglite' | 'local'
/** @type {Map<string, string>} */
const cache = new Map();    // settings cache

/* ---------------- localStorage fallback ---------------- */
const LS_KEY = 'zeros-fallback';
const ls = {
  /** @returns {any} */
  load() { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; } catch { return {}; } },
  /** @param {any} d */
  save(d) { try { localStorage.setItem(LS_KEY, JSON.stringify(d)); } catch { /* full */ } },
};

/* ---------------- migrations ---------------- */
/**
 * Run pending migrations against the database.
 * @param {any} pgInstance - PGlite instance
 * @param {(msg: string) => void} [progress]
 */
async function runMigrations(pgInstance, progress = () => {}) {
  // Create schema_version table first
  await pgInstance.exec(SCHEMA);

  // Get current version
  const result = await pgInstance.query('SELECT COALESCE(MAX(version), 0) as version FROM schema_version');
  let currentVersion = Number(result.rows[0]?.version || 0);

  // Run pending migrations in order
  for (const migration of MIGRATIONS) {
    if (migration.version > currentVersion) {
      progress(`migrating to v${migration.version} (${migration.name})…`);
      await migration.up(pgInstance);
      await pgInstance.query(
        'INSERT INTO schema_version (version, name) VALUES ($1, $2)',
        [migration.version, migration.name]
      );
      currentVersion = migration.version;
    }
  }
}

/* ---------------- init ---------------- */
/**
 * Initialize the database. Returns the mode and boot count.
 * @param {(msg: string) => void} [progress]
 * @returns {Promise<{mode: 'pglite' | 'local', boots: number}>}
 */

/**
 * The vendored bundle's first dynamic import races the wasm download and
 * throws "Failed to fetch dynamically imported module" once, then succeeds.
 * Retry before surrendering the OS to the localStorage fallback.
 * @param {number} tries
 * @returns {Promise<any>}
 */
async function loadPGlite(tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      return await import('../../vendor/pglite/index.js');
    } catch (err) {
      last = err;
      await new Promise(r => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw last;
}

/**
 * Open the OS database, running migrations. `blob` replaces an empty data
 * dir with a tarball from {@link dumpDB} — the caller must have deleted
 * the IndexedDB first, since PGlite refuses to load over an existing cluster.
 * @param {(msg: string) => void} progress
 * @param {Blob | File | null} [blob]
 */
async function openDB(progress, blob = null) {
  const { PGlite } = await loadPGlite();
  pg = blob
    ? new PGlite({ dataDir: 'idb://zeros', loadDataDir: blob })
    : new PGlite('idb://zeros');
  await pg.waitReady;
  progress('running migrations…');
  await runMigrations(pg, progress);
  mode = 'pglite';
}

export async function initDB(progress = () => {}) {
  try {
    progress('loading postgres (wasm)…');
    if (!await consumeRestore(progress)) await openDB(progress);
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

/** @returns {'pglite' | 'local'} */
export const dbMode = () => mode;

/* ---------------- dump / restore ---------------- */
/** IndexedDB name PGlite derives from `idb://zeros` (see vendor IDBFS). */
const IDB_NAME = '/pglite/zeros';
const DUMP_TYPE = 'application/gzip';

/**
 * Gzipped tarball of the live Postgres data dir. Null in fallback mode.
 * @returns {Promise<Blob | null>}
 */
export async function dumpDB() {
  if (!pg) return null;
  const blob = await pg.dumpDataDir('gzip');
  return blob.type ? blob : new Blob([blob], { type: DUMP_TYPE });
}

/**
 * Hand a dump to the next boot, close Postgres, and wipe its IndexedDB so
 * `loadDataDir` finds an empty filesystem. The caller reloads the page.
 * @param {Blob | File} blob
 * @returns {Promise<void>}
 */
export async function stageRestore(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  sessionStorage.setItem('zeros-restore', JSON.stringify({
    type: blob.type || DUMP_TYPE,
    b64: btoa(bin),
  }));
  if (pg) {
    try { await pg.close(); } catch (err) { console.warn('[zeros] close before restore:', err); }
    pg = null;
  }
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(IDB_NAME);
    req.onsuccess = () => resolve(undefined);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('database still open in another tab — close it and retry'));
  });
}

/**
 * Consume a dump staged by {@link stageRestore}. No-op when there is none.
 * @param {(msg: string) => void} progress
 * @returns {Promise<boolean>} whether a restore happened
 */
async function consumeRestore(progress) {
  const raw = sessionStorage.getItem('zeros-restore');
  if (!raw) return false;
  sessionStorage.removeItem('zeros-restore');
  progress('restoring database…');
  const { type, b64 } = JSON.parse(raw);
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  await openDB(progress, new Blob([bytes], { type }));
  return true;
}

/**
 * Raw SQL access — powers ZeroShell. Throws in fallback mode.
 * @param {string} text
 * @param {any[]} [params]
 * @returns {Promise<any>}
 */
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

/**
 * @param {string} key
 * @param {string | null} [def]
 * @returns {string | null}
 */
export function getSetting(key, def = null) {
  return cache.has(key) ? cache.get(key) : def;
}

/**
 * @param {string} key
 * @param {string | number | boolean} value
 * @returns {Promise<void>}
 */
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
/** @returns {Promise<WallpaperRow[]>} */
export async function listWallpapers() {
  if (pg) {
    const r = await pg.query('SELECT id, name, kind, data FROM wallpapers ORDER BY id');
    return r.rows;
  }
  return (ls.load().wallpapers || []);
}

/**
 * @param {string} name
 * @param {string} kind
 * @param {string} data
 * @returns {Promise<number>}
 */
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

/**
 * @param {number | string} id
 * @returns {Promise<void>}
 */
export async function deleteWallpaper(id) {
  if (pg) await pg.query('DELETE FROM wallpapers WHERE id = $1', [id]);
  else {
    const d = ls.load();
    d.wallpapers = (d.wallpapers || []).filter(w => w.id !== id);
    ls.save(d);
  }
  emit('wallpapers:changed');
}

/**
 * @param {number | string} id
 * @returns {Promise<WallpaperRow | null>}
 */
export async function getWallpaper(id) {
  if (pg) {
    const r = await pg.query('SELECT id, name, kind, data FROM wallpapers WHERE id = $1', [id]);
    return r.rows[0] || null;
  }
  return (ls.load().wallpapers || []).find(w => String(w.id) === String(id)) || null;
}

/* ---------------- game scores ---------------- */
/**
 * @param {string} game
 * @param {number} score
 * @param {string} [player]
 * @returns {Promise<void>}
 */
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

/**
 * @param {string} game
 * @param {number} [n]
 * @returns {Promise<ScoreRow[]>}
 */
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
/** @returns {Promise<Pick<DocRow, 'id' | 'title' | 'updated_at'>[]>} */
export async function listDocs() {
  if (pg) {
    const r = await pg.query('SELECT id, title, updated_at FROM documents ORDER BY updated_at DESC');
    return r.rows;
  }
  return (ls.load().docs || []).map(({ id, title, updated_at }) => ({ id, title, updated_at }));
}

/**
 * @param {number | string} id
 * @returns {Promise<DocRow | null>}
 */
export async function getDoc(id) {
  if (pg) {
    const r = await pg.query('SELECT * FROM documents WHERE id = $1', [id]);
    return r.rows[0] || null;
  }
  return (ls.load().docs || []).find(x => String(x.id) === String(id)) || null;
}

/**
 * @param {number | string | null} id
 * @param {string} title
 * @param {string} content
 * @returns {Promise<number>}
 */
export async function saveDoc(id, title, content) {
  if (pg) {
    if (id) {
      await pg.query('UPDATE documents SET title=$1, content=$2, updated_at=now() WHERE id=$3', [title, content, id]);
      emit('docs:changed');
      return Number(id);
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
  return Number(id);
}

/**
 * @param {number | string} id
 * @returns {Promise<void>}
 */
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
/**
 * @param {string} cmd
 * @returns {Promise<void>}
 */
export async function addHistory(cmd) {
  if (pg) await pg.query('INSERT INTO shell_history (cmd) VALUES ($1)', [cmd]);
}

/**
 * @param {number} [n]
 * @returns {Promise<string[]>}
 */
export async function getHistory(n = 100) {
  if (!pg) return [];
  const r = await pg.query('SELECT cmd FROM shell_history ORDER BY id DESC LIMIT $1', [n]);
  return r.rows.map(x => x.cmd).reverse();
}

/* ---------------- rss/atom feeds ---------------- */
/** @returns {Promise<FeedRow[]>} */
export async function listFeeds() {
  if (pg) {
    const r = await pg.query('SELECT id, url, title FROM feeds ORDER BY id');
    return r.rows;
  }
  return (ls.load().feeds || []);
}

/**
 * @param {string} url
 * @param {string} [title]
 * @returns {Promise<number>}
 */
export async function addFeed(url, title = '') {
  if (pg) {
    const r = await pg.query(
      'INSERT INTO feeds (url, title) VALUES ($1,$2) ON CONFLICT (url) DO UPDATE SET title = EXCLUDED.title RETURNING id',
      [url, title],
    );
    emit('feeds:changed');
    return r.rows[0].id;
  }
  const d = ls.load();
  d.feeds = d.feeds || [];
  let f = d.feeds.find(x => x.url === url);
  if (f) f.title = title;
  else { f = { id: Date.now(), url, title }; d.feeds.push(f); }
  ls.save(d);
  emit('feeds:changed');
  return f.id;
}

/**
 * @param {number | string} id
 * @returns {Promise<void>}
 */
export async function deleteFeed(id) {
  if (pg) await pg.query('DELETE FROM feeds WHERE id = $1', [id]);
  else {
    const d = ls.load();
    d.feeds = (d.feeds || []).filter(f => String(f.id) !== String(id));
    ls.save(d);
  }
  emit('feeds:changed');
}
