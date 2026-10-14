/**
 * ZerOS kernel — global keyboard shortcuts.
 *
 * System-wide shortcuts that work regardless of which app is focused:
 *   Cmd/Ctrl + K     — open command palette
 *   Cmd/Ctrl + W     — close focused window
 *   Cmd/Ctrl + M     — minimize focused window
 *   Cmd/Ctrl + Tab   — cycle through windows
 *   Cmd/Ctrl + `     — cycle through windows (reverse)
 *   Cmd/Ctrl + ,     — open Preferences
 *   Cmd/Ctrl + L     — lock/sleep (dim screen)
 *   Escape           — close command palette / menus
 *
 * @ts-check
 */

import { openWindows, focusWindow, closeWindow, minimizeWindow } from './wm.js';
import { launch } from './desktop.js';
import { togglePalette } from './palette.js';

/** @type {Map<string, {description: string, handler: (e: KeyboardEvent) => void}>} */
const shortcuts = new Map();

let initialized = false;
let locked = false;
let lockOverlay = null;

/**
 * Register a global keyboard shortcut.
 * @param {string} combo - Key combination (e.g., 'mod+k', 'mod+shift+p')
 * @param {string} description - Human-readable description
 * @param {(e: KeyboardEvent) => void} handler - Handler function
 */
export function register(combo, description, handler) {
  shortcuts.set(normalizeCombo(combo), { description, handler });
}

/**
 * Normalize a key combination string.
 * @param {string} combo
 * @returns {string}
 */
function normalizeCombo(combo) {
  return combo.toLowerCase()
    .split('+')
    .map(k => k.trim())
    .sort()
    .join('+');
}

/**
 * Check if an event matches a key combination.
 * @param {KeyboardEvent} e
 * @param {string} combo
 * @returns {boolean}
 */
function matchesCombo(e, combo) {
  const parts = combo.toLowerCase().split('+').map(k => k.trim());
  const mod = parts.includes('mod') || parts.includes('cmd') || parts.includes('ctrl');
  const shift = parts.includes('shift');
  const alt = parts.includes('alt') || parts.includes('option');

  // Check modifiers
  const wantsMod = e.metaKey || e.ctrlKey;
  if (mod !== wantsMod) return false;
  if (shift !== e.shiftKey) return false;
  if (alt !== e.altKey) return false;

  // Get the actual key (excluding modifiers)
  const keyParts = parts.filter(k => !['mod', 'cmd', 'ctrl', 'shift', 'alt', 'option'].includes(k));
  if (keyParts.length !== 1) return false;

  const key = keyParts[0];
  const eKey = e.key.toLowerCase();

  // Special key mappings
  const keyMap = {
    ' ': 'space',
    'spacebar': 'space',
    'esc': 'escape',
    '`': '`',
    'backtick': '`',
    ',': ',',
    'comma': ',',
    '.': '.',
    'period': '.',
    '/': '/',
    'slash': '/',
    ';': ';',
    'semicolon': ';',
    'tab': 'tab',
  };

  const normalizedKey = keyMap[key] || key;
  const normalizedEKey = keyMap[eKey] || eKey;

  return normalizedKey === normalizedEKey;
}

/**
 * Handle keydown events.
 * @param {KeyboardEvent} e
 */
function onKeyDown(e) {
  // Don't handle shortcuts when typing in inputs (except for specific ones)
  const target = e.target;
  const isInput = target instanceof HTMLInputElement ||
                  target instanceof HTMLTextAreaElement ||
                  target instanceof HTMLSelectElement ||
                  (target instanceof HTMLElement && target.isContentEditable);

  // Escape always works
  if (e.key === 'Escape') {
    if (lockOverlay) {
      unlock();
      e.preventDefault();
      return;
    }
    // Close any open menus/palette via event
    document.dispatchEvent(new CustomEvent('zeros:escape'));
    return;
  }

  // Lock screen shortcut works everywhere
  if (matchesCombo(e, 'mod+l')) {
    e.preventDefault();
    toggleLock();
    return;
  }

  // Skip other shortcuts when typing in inputs
  if (isInput) return;

  for (const [combo, { handler }] of shortcuts) {
    if (matchesCombo(e, combo)) {
      e.preventDefault();
      handler(e);
      return;
    }
  }
}

/**
 * Toggle the lock screen.
 */
function toggleLock() {
  if (locked) {
    unlock();
  } else {
    lock();
  }
}

/**
 * Lock the screen.
 */
function lock() {
  locked = true;
  lockOverlay = document.createElement('div');
  lockOverlay.id = 'lockscreen';
  lockOverlay.innerHTML = `
    <div class="lock-inner">
      <svg viewBox="0 0 120 120" width="72" height="72" aria-hidden="true">
        <circle cx="60" cy="60" r="46" fill="none" stroke="var(--acc)" stroke-width="3" opacity="0.3"/>
        <path d="M42 44 H78 L42 76 H78" fill="none" stroke="var(--ink)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <div class="lock-time" id="lock-time"></div>
      <div class="lock-hint">Press any key or ⌘L to unlock</div>
    </div>
  `;
  document.body.appendChild(lockOverlay);

  // Update time
  const updateTime = () => {
    const el = document.getElementById('lock-time');
    if (el) {
      const now = new Date();
      el.textContent = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }
  };
  updateTime();
  const interval = setInterval(updateTime, 1000);
  lockOverlay.dataset.interval = String(interval);

  // Unlock on click or key
  const unlockHandler = () => {
    unlock();
  };
  lockOverlay.addEventListener('click', unlockHandler);
  document.addEventListener('keydown', unlockHandler, { once: true });
  lockOverlay._unlockHandler = unlockHandler;
}

/**
 * Unlock the screen.
 */
function unlock() {
  if (!locked || !lockOverlay) return;
  locked = false;
  clearInterval(Number(lockOverlay.dataset.interval));
  lockOverlay.removeEventListener('click', lockOverlay._unlockHandler);
  lockOverlay.remove();
  lockOverlay = null;
}

/**
 * Get the currently focused window.
 * @returns {any | null}
 */
function getFocusedWindow() {
  const wins = openWindows();
  return wins.find(w => w.el.classList.contains('focused')) || wins[wins.length - 1] || null;
}

/**
 * Cycle through windows (forward or backward).
 * @param {boolean} reverse
 */
function cycleWindows(reverse = false) {
  const wins = openWindows().filter(w => !w.el.classList.contains('minimized'));
  if (wins.length < 2) return;

  const focused = wins.findIndex(w => w.el.classList.contains('focused'));
  let next;
  if (reverse) {
    next = focused <= 0 ? wins.length - 1 : focused - 1;
  } else {
    next = focused < 0 || focused >= wins.length - 1 ? 0 : focused + 1;
  }
  focusWindow(wins[next].id);
}

/**
 * Initialize the shortcuts system.
 */
export function initShortcuts() {
  if (initialized) return;
  initialized = true;

  // Register built-in shortcuts
  register('mod+k', 'Open command palette', () => togglePalette());
  register('mod+w', 'Close window', () => {
    const win = getFocusedWindow();
    if (win) closeWindow(win.id);
  });
  register('mod+m', 'Minimize window', () => {
    const win = getFocusedWindow();
    if (win) minimizeWindow(win.id);
  });
  register('mod+tab', 'Next window', () => cycleWindows(false));
  register('mod+shift+tab', 'Previous window', () => cycleWindows(true));
  register('mod+`', 'Next window (reverse)', () => cycleWindows(true));
  register('mod+,', 'Open Preferences', () => launch('settings'));
  register('mod+l', 'Lock screen', () => toggleLock());
  register('mod+1', 'Launch Voltline', () => launch('snake'));
  register('mod+2', 'Launch Zero48', () => launch('g2048'));
  register('mod+3', 'Launch Inkwell', () => launch('markdown'));
  register('mod+4', 'Launch Vaporforge', () => launch('wallgen'));
  register('mod+5', 'Launch Periscope', () => launch('browser'));
  register('mod+6', 'Launch Antenna', () => launch('rss'));
  register('mod+7', 'Launch ZeroShell', () => launch('zeroshell'));

  document.addEventListener('keydown', onKeyDown);
}

/**
 * Get all registered shortcuts for display.
 * @returns {Array<{combo: string, description: string}>}
 */
export function getShortcuts() {
  return [...shortcuts.entries()].map(([combo, { description }]) => ({ combo, description }));
}
