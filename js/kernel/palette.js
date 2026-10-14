/**
 * ZerOS kernel — command palette (Spotlight-style launcher).
 *
 * Press Cmd/Ctrl+K to open. Fuzzy-search across:
 *   - Apps (launch any installed app)
 *   - Documents (open in Inkwell)
 *   - Settings (quick toggles)
 *   - SQL queries (run in ZeroShell)
 *   - System actions (lock, preferences, etc.)
 *
 * @ts-check
 */

import { APPS } from '../apps/registry.js';
import { launch, toast } from './desktop.js';
import { listDocs, getSetting, setSetting } from './db.js';
import { setTheme } from './theme.js';
import { openWindows, focusWindow } from './wm.js';

/** @typedef {{id: string, type: 'app' | 'doc' | 'setting' | 'sql' | 'action', title: string, subtitle?: string, icon?: string, keywords: string[], run: () => void | Promise<void>}} PaletteItem */

let paletteEl = null;
let inputEl = null;
let listEl = null;
let isOpen = false;
let selectedIndex = 0;
let currentItems = [];

/**
 * Build the list of available palette items.
 * @returns {Promise<PaletteItem[]>}
 */
async function buildItems() {
  /** @type {PaletteItem[]} */
  const items = [];

  // Apps
  for (const app of APPS) {
    items.push({
      id: 'app:' + app.id,
      type: 'app',
      title: app.name,
      subtitle: app.desc,
      icon: app.icon,
      keywords: [app.id, app.name.toLowerCase(), app.desc.toLowerCase(), 'launch', 'open', 'start'],
      run: () => launch(app.id),
    });
  }

  // Documents
  try {
    const docs = await listDocs();
    for (const doc of docs) {
      items.push({
        id: 'doc:' + doc.id,
        type: 'doc',
        title: doc.title || 'Untitled',
        subtitle: 'Inkwell document',
        icon: 'assets/icons/markdown.svg',
        keywords: ['document', 'inkwell', 'markdown', 'edit', doc.title?.toLowerCase() || ''],
        run: () => launch('markdown', { docId: doc.id }),
      });
    }
  } catch { /* DB might not be ready */ }

  // Window actions
  const wins = openWindows();
  for (const w of wins) {
    if (w.el.classList.contains('minimized')) continue;
    items.push({
      id: 'win:' + w.id,
      type: 'action',
      title: `Focus: ${w.title}`,
      subtitle: 'Bring window to front',
      icon: 'assets/logo.svg',
      keywords: ['window', 'focus', 'switch', 'bring', w.title.toLowerCase()],
      run: () => focusWindow(w.id),
    });
  }

  // Settings toggles
  const toggles = [
    { key: 'motes', label: 'Motes', desc: 'Atmospheric dust particles' },
    { key: 'cursorglow', label: 'Cursor Glow', desc: 'Pointer light effect' },
    { key: 'widget_clock', label: 'Clock Widget', desc: 'Show/hide clock' },
    { key: 'widget_sys', label: 'System Widget', desc: 'Show/hide sysmon' },
  ];
  for (const t of toggles) {
    const current = getSetting(t.key, 'on') === 'on';
    items.push({
      id: 'toggle:' + t.key,
      type: 'setting',
      title: `${current ? 'Hide' : 'Show'} ${t.label}`,
      subtitle: t.desc,
      keywords: ['toggle', 'setting', 'preference', t.key, t.label.toLowerCase(), current ? 'hide' : 'show'],
      run: async () => {
        await setSetting(t.key, current ? 'off' : 'on');
        toast(`${t.label} ${current ? 'hidden' : 'shown'}`);
      },
    });
  }

  // Theme presets
  const hues = [
    { hue: 0, name: 'Red' },
    { hue: 35, name: 'Orange' },
    { hue: 90, name: 'Green' },
    { hue: 140, name: 'Teal' },
    { hue: 175, name: 'Cyan' },
    { hue: 210, name: 'Blue' },
    { hue: 265, name: 'Purple' },
    { hue: 320, name: 'Pink' },
  ];
  for (const h of hues) {
    items.push({
      id: 'theme:' + h.hue,
      type: 'setting',
      title: `Theme: ${h.name}`,
      subtitle: `Hue ${h.hue}°`,
      keywords: ['theme', 'color', 'hue', 'tint', h.name.toLowerCase(), String(h.hue)],
      run: async () => {
        await setTheme({ hue: h.hue });
        toast(`Theme: ${h.name}`);
      },
    });
  }

  // System actions
  items.push({
    id: 'action:prefs',
    type: 'action',
    title: 'Open Preferences',
    subtitle: 'Settings & customization',
    icon: 'assets/icons/settings.svg',
    keywords: ['preferences', 'settings', 'config', 'options'],
    run: () => launch('settings'),
  });
  items.push({
    id: 'action:shell',
    type: 'action',
    title: 'Open ZeroShell',
    subtitle: 'SQL terminal',
    icon: 'assets/icons/shell.svg',
    keywords: ['shell', 'terminal', 'sql', 'database', 'psql', 'query'],
    run: () => launch('zeroshell'),
  });
  items.push({
    id: 'action:wallgen',
    type: 'action',
    title: 'Generate Wallpaper',
    subtitle: 'Vaporforge',
    icon: 'assets/icons/wallgen.svg',
    keywords: ['wallpaper', 'background', 'generate', 'forge', 'vaporforge'],
    run: () => launch('wallgen'),
  });

  // Quick SQL queries
  const queries = [
    { title: 'Show all settings', sql: 'SELECT * FROM settings ORDER BY key;' },
    { title: 'Show game scores', sql: 'SELECT game, player, score, created_at FROM scores ORDER BY created_at DESC LIMIT 20;' },
    { title: 'Show documents', sql: 'SELECT id, title, updated_at FROM documents ORDER BY updated_at DESC;' },
    { title: 'Show tables', sql: "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;" },
    { title: 'System info', sql: 'SELECT version();' },
  ];
  for (const q of queries) {
    items.push({
      id: 'sql:' + q.title,
      type: 'sql',
      title: q.title,
      subtitle: 'Run in ZeroShell',
      icon: 'assets/icons/shell.svg',
      keywords: ['sql', 'query', 'database', 'select', q.title.toLowerCase()],
      run: () => launch('zeroshell', { command: q.sql }),
    });
  }

  return items;
}

/**
 * Fuzzy search items by query.
 * @param {PaletteItem[]} items
 * @param {string} query
 * @returns {PaletteItem[]}
 */
function fuzzySearch(items, query) {
  if (!query.trim()) return items.slice(0, 20);

  const q = query.toLowerCase().trim();
  const words = q.split(/\s+/);

  const scored = items.map(item => {
    const searchText = [item.title, item.subtitle || '', ...item.keywords].join(' ').toLowerCase();
    let score = 0;

    // Exact match in title = highest score
    if (item.title.toLowerCase() === q) score += 100;
    // Title starts with query
    else if (item.title.toLowerCase().startsWith(q)) score += 50;
    // Title contains query
    else if (item.title.toLowerCase().includes(q)) score += 30;
    // Any keyword matches
    else if (item.keywords.some(k => k.includes(q))) score += 20;
    // Subtitle contains
    else if ((item.subtitle || '').toLowerCase().includes(q)) score += 10;
    // Fuzzy match (all words present)
    else if (words.every(w => searchText.includes(w))) score += 5;
    else return { item, score: -1 };

    // Boost by type priority
    if (item.type === 'app') score += 5;
    else if (item.type === 'action') score += 3;

    return { item, score };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map(s => s.item);
}

/**
 * Render the palette list.
 * @param {PaletteItem[]} items
 */
function renderList(items) {
  currentItems = items;
  selectedIndex = Math.min(selectedIndex, Math.max(0, items.length - 1));

  if (!listEl) return;

  if (items.length === 0) {
    listEl.innerHTML = '<div class="palette-empty">No results</div>';
    return;
  }

  listEl.innerHTML = items.map((item, i) => {
    const icon = item.icon
      ? `<img src="${item.icon}" alt="">`
      : `<span class="palette-icon-placeholder">${getTypeIcon(item.type)}</span>`;
    return `
      <button class="palette-item ${i === selectedIndex ? 'selected' : ''}" data-index="${i}" role="option">
        <span class="palette-icon">${icon}</span>
        <span class="palette-text">
          <span class="palette-title">${escapeHtml(item.title)}</span>
          ${item.subtitle ? `<span class="palette-subtitle">${escapeHtml(item.subtitle)}</span>` : ''}
        </span>
        <span class="palette-type">${item.type}</span>
      </button>
    `;
  }).join('');

  // Scroll selected into view
  const selected = listEl.querySelector('.palette-item.selected');
  selected?.scrollIntoView({ block: 'nearest' });
}

/**
 * @param {string} s
 * @returns {string}
 */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * @param {string} type
 * @returns {string}
 */
function getTypeIcon(type) {
  const icons = {
    app: '🚀',
    doc: '📄',
    setting: '⚙️',
    sql: '🗄️',
    action: '⚡',
  };
  return icons[type] || '•';
}

/**
 * Select an item by index.
 * @param {number} index
 */
function selectItem(index) {
  selectedIndex = index;
  if (listEl) {
    listEl.querySelectorAll('.palette-item').forEach((el, i) => {
      el.classList.toggle('selected', i === index);
    });
    const selected = listEl.querySelector('.palette-item.selected');
    selected?.scrollIntoView({ block: 'nearest' });
  }
}

/**
 * Execute the selected item.
 */
async function executeSelected() {
  const item = currentItems[selectedIndex];
  if (!item) return;
  closePalette();
  try {
    await item.run();
  } catch (err) {
    console.error('[palette] action failed:', err);
    toast('Action failed — see console');
  }
}

/**
 * Open the command palette.
 */
export async function openPalette() {
  if (isOpen) return;
  isOpen = true;
  selectedIndex = 0;

  paletteEl = document.createElement('div');
  paletteEl.id = 'palette-overlay';
  paletteEl.innerHTML = `
    <div class="palette" role="dialog" aria-label="Command palette">
      <div class="palette-header">
        <span class="palette-search-icon">⌕</span>
        <input type="text" class="palette-input" placeholder="Type a command or search…" autocomplete="off" spellcheck="false">
        <kbd class="palette-esc">esc</kbd>
      </div>
      <div class="palette-list" role="listbox"></div>
      <div class="palette-footer">
        <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
        <span><kbd>↵</kbd> run</span>
        <span><kbd>esc</kbd> close</span>
      </div>
    </div>
  `;
  document.body.appendChild(paletteEl);

  inputEl = paletteEl.querySelector('.palette-input');
  listEl = paletteEl.querySelector('.palette-list');

  // Close on overlay click
  paletteEl.addEventListener('click', (e) => {
    if (e.target === paletteEl) closePalette();
  });

  // Input handling
  inputEl.addEventListener('input', async () => {
    const query = inputEl.value;
    const allItems = await buildItems();
    renderList(fuzzySearch(allItems, query));
  });

  // Keyboard navigation
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectItem(Math.min(selectedIndex + 1, currentItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectItem(Math.max(selectedIndex - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      executeSelected();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closePalette();
    }
  });

  // Mouse selection
  listEl.addEventListener('click', (e) => {
    const item = e.target.closest('.palette-item');
    if (item) {
      selectedIndex = Number(item.dataset.index);
      executeSelected();
    }
  });

  listEl.addEventListener('mousemove', (e) => {
    const item = e.target.closest('.palette-item');
    if (item) {
      const index = Number(item.dataset.index);
      if (index !== selectedIndex) selectItem(index);
    }
  });

  // Show initial items
  const allItems = await buildItems();
  renderList(allItems.slice(0, 20));

  // Focus input
  setTimeout(() => inputEl?.focus(), 0);
}

/**
 * Close the command palette.
 */
export function closePalette() {
  if (!isOpen || !paletteEl) return;
  isOpen = false;
  paletteEl.remove();
  paletteEl = null;
  inputEl = null;
  listEl = null;
  currentItems = [];
}

/**
 * Toggle the command palette.
 */
export function togglePalette() {
  if (isOpen) closePalette();
  else openPalette();
}

/**
 * Initialize the palette (listen for escape events from shortcuts).
 */
export function initPalette() {
  document.addEventListener('zeros:escape', () => {
    if (isOpen) closePalette();
  });
}
