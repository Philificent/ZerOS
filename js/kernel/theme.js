/**
 * ZerOS kernel — theme engine.
 *
 * A deliberately narrow color system: ONE hue + ONE intensity dial,
 * expanded into a palette by mode:
 *   mono — secondary hue equals the primary
 *   duo  — secondary hue is a +40° neighbour (duotone)
 *   comp — secondary hue is the +180° complement
 * Everything else in the UI derives from the CSS custom properties
 * written here, so the whole OS re-tints from a single knob.
 *
 * @ts-check
 */

import { getSetting, setSetting, on } from './db.js';

/** @typedef {'mono' | 'duo' | 'comp'} ColorMode */
/** @typedef {{ hue: number, intensity: number, mode: ColorMode }} Theme */
/** @typedef {{ accent: string, accent2: string, deep: string, deep2: string, hue: number, hue2: number, intensity: number }} ThemeColors */

const root = document.documentElement;

/** @returns {Theme} */
export function currentTheme() {
  return {
    hue: parseFloat(getSetting('hue', '210')),
    intensity: parseFloat(getSetting('intensity', '0.55')),
    mode: /** @type {ColorMode} */ (getSetting('colormode', 'duo')),
  };
}

/**
 * @param {number} hue
 * @param {ColorMode} mode
 * @returns {number}
 */
export function secondaryHue(hue, mode) {
  if (mode === 'comp') return (hue + 180) % 360;
  if (mode === 'duo') return (hue + 40) % 360;
  return hue;
}

export function applyTheme() {
  const { hue, intensity, mode } = currentTheme();
  const sat = Math.round(20 + intensity * 65);       // 20%..85%
  root.style.setProperty('--hue', String(hue));
  root.style.setProperty('--hue2', String(secondaryHue(hue, mode)));
  root.style.setProperty('--sat', sat + '%');
  root.style.setProperty('--glow', intensity.toFixed(2));
}

/**
 * @param {{ hue?: number, intensity?: number, mode?: ColorMode }} opts
 * @returns {Promise<void>}
 */
export async function setTheme({ hue, intensity, mode }) {
  if (hue !== undefined) await setSetting('hue', String(hue));
  if (intensity !== undefined) await setSetting('intensity', String(intensity));
  if (mode !== undefined) await setSetting('colormode', mode);
}

export function initTheme() {
  applyTheme();
  on('setting:hue', applyTheme);
  on('setting:intensity', applyTheme);
  on('setting:colormode', applyTheme);
}

/** Convenience: theme accents as hex, for canvas consumers (waterpipe).
 * @returns {ThemeColors}
 */
export function themeColors() {
  const { hue, intensity, mode } = currentTheme();
  const h2 = secondaryHue(hue, mode);
  const sat = 20 + intensity * 65;
  return {
    accent: hslToHex(hue, sat, 60),
    accent2: hslToHex(h2, sat, 55),
    deep: hslToHex(hue, Math.min(sat, 45), 8),
    deep2: hslToHex(h2, Math.min(sat, 40), 5),
    hue, hue2: h2, intensity,
  };
}

/**
 * @param {number} h - hue 0-360
 * @param {number} s - saturation 0-100
 * @param {number} l - lightness 0-100
 * @returns {string} hex color
 */
export function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = x => Math.round(255 * x).toString(16).padStart(2, '0');
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}
