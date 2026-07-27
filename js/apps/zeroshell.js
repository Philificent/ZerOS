/**
 * ZeroShell ★ the ZerOS special feature.
 *
 * WHAT IT IS
 *   A terminal wired directly into the live PostgreSQL database
 *   (PGlite/WASM) that *is* the operating system's state. Settings,
 *   wallpapers, documents, game scores, shell history — all tables.
 *
 * WHY IT IS SPECIAL
 *   ZerOS has no hidden state: `UPDATE settings SET value='300'
 *   WHERE key='hue';` re-tints the whole desktop the instant the
 *   statement commits, because the kernel treats the database as the
 *   single source of truth and re-reads it after every write. You can
 *   inspect, script and even break your own OS with SQL — a real
 *   Postgres speaking over WASM inside a static web page.
 */
import { sql, refreshFromDB, addHistory, getHistory, dbMode, getSetting } from '../kernel/db.js';
import { APPS } from '../apps/registry.js';

export const WIDTH = 720;
export const HEIGHT = 480;

const MOTD = `ZeroShell — psql for your desktop. The OS *is* the database.
type  help  for commands ·  any SQL runs for real (try: SELECT * FROM settings;)`;

const HELP = `
  built-ins
    help                 this text
    tables               list OS tables
    apps                 list installed apps
    open <app-id>        launch an app (e.g. open snake)
    theme <hue> [int]    set theme hue 0-359 (+ intensity 0-1)
    neofetch             system summary with too much pride
    history              recent commands
    clear                wipe the screen

  everything else is executed as SQL against the live OS database.
    SELECT * FROM settings;
    UPDATE settings SET value='120' WHERE key='hue';     -- re-skins the OS
    SELECT game, max(score) FROM scores GROUP BY game;
    SELECT title FROM documents;`;

export async function launch(win, os) {
  const body = win.body;
  body.innerHTML = `
    <div data-zs="wrap" style="display:flex;flex-direction:column;height:100%;background:hsl(var(--hue) 35% 4%/.55);font-family:var(--mono);font-size:12.5px;line-height:1.55;">
      <div data-zs="out" style="flex:1;overflow:auto;padding:12px 14px;white-space:pre-wrap;word-break:break-word;"></div>
      <div style="flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:8px 14px;border-top:1px solid hsl(var(--hue) 40% 60%/.15);">
        <span style="color:var(--acc);flex:0 0 auto;">zeros=#</span>
        <input data-zs="in" spellcheck="false" autocomplete="off" style="flex:1;background:transparent;border:0;outline:none;color:var(--ink);font-family:var(--mono);font-size:12.5px;">
      </div>
    </div>`;

  const out = body.querySelector('[data-zs="out"]');
  const input = body.querySelector('[data-zs="in"]');

  const print = (text, color) => {
    const div = document.createElement('div');
    div.textContent = text;
    if (color) div.style.color = color;
    out.appendChild(div);
    out.scrollTop = out.scrollHeight;
  };
  const printHTMLTable = rows => {
    if (!rows.length) return print('(0 rows)', 'var(--ink-mute)');
    const cols = Object.keys(rows[0]);
    const widths = cols.map(c => Math.min(42, Math.max(c.length, ...rows.map(r => fmt(r[c]).length))));
    const line = (vals, pad = ' ') => vals.map((v, i) => String(v).slice(0, 42).padEnd(widths[i], pad)).join(' │ ');
    print(line(cols), 'var(--acc)');
    print(line(cols.map((_, i) => ''), '─'), 'var(--ink-mute)');
    for (const r of rows.slice(0, 200)) print(line(cols.map(c => fmt(r[c]))));
    print(`(${rows.length} row${rows.length === 1 ? '' : 's'})`, 'var(--ink-mute)');
  };
  const fmt = v => {
    if (v === null || v === undefined) return 'Ø';
    if (v instanceof Date) return v.toISOString().slice(0, 19).replace('T', ' ');
    const s = String(v);
    return s.length > 60 ? s.slice(0, 57) + '…' : s;
  };

  print(MOTD, 'var(--ink-dim)');
  if (dbMode() !== 'pglite') {
    print('\n⚠ PGlite is not running (fallback mode) — SQL disabled, built-ins still work.', 'hsl(40 80% 60%)');
  }
  print('');

  /* ---------------- history ---------------- */
  let hist = await getHistory(200);
  let hi = hist.length;
  let draft = '';

  /* ---------------- commands ---------------- */
  async function run(cmd) {
    print('zeros=# ' + cmd, 'var(--ink-dim)');
    const [word, ...rest] = cmd.trim().split(/\s+/);

    switch (word.toLowerCase()) {
      case 'help': return print(HELP);
      case 'clear': out.textContent = ''; return;
      case 'apps':
        return print(APPS.map(a => `  ${a.id.padEnd(10)} ${a.name.padEnd(12)} — ${a.desc}`).join('\n'));
      case 'open': {
        const id = rest[0];
        if (!APPS.some(a => a.id === id)) return print(`no such app: ${id}  (try "apps")`, 'hsl(6 70% 60%)');
        os.launch(id);
        return print(`launching ${id}…`);
      }
      case 'tables':
        return runSQL(`SELECT table_name, (SELECT count(*) FROM information_schema.columns c WHERE c.table_name = t.table_name) AS columns FROM information_schema.tables t WHERE table_schema='public' ORDER BY table_name;`);
      case 'theme': {
        const hue = parseFloat(rest[0]);
        if (isNaN(hue)) return print('usage: theme <hue 0-359> [intensity 0-1] [mono|duo|comp]', 'hsl(6 70% 60%)');
        const sets = [`UPDATE settings SET value='${Math.round(hue) % 360}' WHERE key='hue'`];
        if (rest[1] !== undefined) sets.push(`UPDATE settings SET value='${parseFloat(rest[1])}' WHERE key='intensity'`);
        if (rest[2]) sets.push(`UPDATE settings SET value='${rest[2].replace(/[^a-z]/g, '')}' WHERE key='colormode'`);
        for (const s of sets) await runSQL(s + ';', true);
        return;
      }
      case 'history':
        return print(hist.slice(-25).map((h, i) => `  ${String(hist.length - 25 + i + 1).padStart(4)}  ${h}`).join('\n') || '  (empty)');
      case 'neofetch': return neofetch();
      case '': return;
      default: return runSQL(cmd);
    }
  }

  async function runSQL(text, quiet = false) {
    try {
      const t0 = performance.now();
      const res = await sql(text);
      const dt = (performance.now() - t0).toFixed(1);
      const isWrite = /^\s*(insert|update|delete|create|drop|alter|truncate)/i.test(text);
      if (res.rows?.length) printHTMLTable(res.rows);
      else if (!quiet) print(`ok — ${res.affectedRows ?? 0} row(s) affected · ${dt} ms`, 'var(--ink-mute)');
      if (isWrite) {
        await refreshFromDB();       // ← the OS reacts to your SQL
        if (!quiet) print('⟳ kernel re-read the database', 'var(--acc)');
      }
    } catch (err) {
      print('ERROR: ' + err.message, 'hsl(6 70% 60%)');
    }
  }

  function neofetch() {
    const nav = navigator;
    const art = [
      '   ⣠⣶⣿⣿⣶⣄     ',
      '  ⣸⣿⠟⠉⠉⠻⣿⣇    ',
      '  ⣿⣿  ⢀⡾⢻⣿⣿    ',
      '  ⢿⣿⣀⡴⠋ ⣼⣿⡿    ',
      '   ⠙⠿⣿⣿⠿⠛     ',
    ];
    const info = [
      ['os', 'ZerOS 1.0 (glass/dark)'],
      ['kernel', 'browser ' + (nav.userAgentData?.brands?.map(b => b.brand + ' ' + b.version).join(', ') || nav.userAgent.split(' ').pop())],
      ['db', dbMode() === 'pglite' ? 'PostgreSQL (PGlite · idb://zeros)' : 'localStorage fallback'],
      ['uptime', Math.round(performance.now() / 1000) + 's'],
      ['boots', getSetting('booted_times', '?')],
      ['cpu', (nav.hardwareConcurrency || '?') + ' threads'],
      ['ram', nav.deviceMemory ? '≥' + nav.deviceMemory + ' GB' : 'undisclosed'],
      ['screen', `${screen.width}×${screen.height}@${devicePixelRatio}x`],
      ['theme', `hue ${getSetting('hue')} · ${getSetting('colormode')} · ${Math.round(parseFloat(getSetting('intensity', '0')) * 100)}%`],
    ];
    const lines = info.map(([k, v], i) => (art[i] || '          ') + '  ' + k.padEnd(8) + ' ' + v);
    for (let i = info.length; i < art.length; i++) lines.push(art[i]);
    print(lines.join('\n'), 'var(--acc)');
  }

  /* ---------------- input handling ---------------- */
  input.addEventListener('keydown', async e => {
    if (e.key === 'Enter') {
      const cmd = input.value;
      input.value = '';
      if (cmd.trim()) {
        hist.push(cmd);
        hi = hist.length;
        addHistory(cmd).catch(() => {});
      }
      await run(cmd);
      print('');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (hi === hist.length) draft = input.value;
      if (hi > 0) { hi--; input.value = hist[hi]; }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (hi < hist.length) {
        hi++;
        input.value = hi === hist.length ? draft : hist[hi];
      }
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      out.textContent = '';
    }
  });

  body.querySelector('[data-zs="wrap"]').addEventListener('click', () => {
    if (!getSelection().toString()) input.focus();
  });
  input.focus();
}
