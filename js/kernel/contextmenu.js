/**
 * ZerOS kernel — desktop context menu.
 *
 * Right-click on bare desktop for the quick actions: forge or swap the
 * wallpaper, re-tint the whole OS from a hue strip, and flip the
 * atmosphere toggles — all without opening Preferences.
 */
import { getSetting, setSetting, listWallpapers, on } from './db.js';
import { setTheme, currentTheme } from './theme.js';
import { launch, toast } from './desktop.js';

const HUES = [0, 35, 90, 140, 175, 210, 265, 320];

let menu = null;

function closeMenu() {
  if (!menu) return;
  menu.remove();
  menu = null;
}

/* cycle: procedural default -> each stored wallpaper -> back */
async function nextWallpaper() {
  const rows = await listWallpapers();
  const ids = ['', ...rows.map(r => String(r.id))];
  const cur = String(getSetting('wallpaper', ''));
  const next = ids[(Math.max(0, ids.indexOf(cur)) + 1) % ids.length];
  await setSetting('wallpaper', next);
  const name = next === ''
    ? 'procedural (theme)'
    : (rows.find(r => String(r.id) === next)?.name || 'wallpaper #' + next);
  toast('wallpaper: ' + name);   // toast uses textContent — safe for stored names
}

function flip(key) {
  return setSetting(key, getSetting(key, 'on') === 'off' ? 'on' : 'off');
}

const MODES = { mono: 'duo', duo: 'comp', comp: 'mono' };
const MODE_LABEL = { mono: 'mono', duo: 'duotone', comp: 'complementary' };

function openMenu(x, y) {
  closeMenu();
  const t = currentTheme();
  const onoff = k => getSetting(k, 'on') === 'off' ? 'off' : 'on';

  menu = document.createElement('div');
  menu.className = 'ctxmenu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = `
    <button data-act="forge">✦ generate wallpaper (Vaporforge)</button>
    <button data-act="nextwp">⇆ next wallpaper</button>
    <button data-act="prefs">🖼 change wallpaper…</button>
    <div class="sep"></div>
    <div class="zlabel" style="padding:2px 10px 0">hue</div>
    <div class="hues">
      ${HUES.map(h => `<i data-hue="${h}" style="background:hsl(${h} 70% 55%)" title="${h}°"></i>`).join('')}
      <button data-act="huerand" title="random hue" style="width:auto;padding:0 4px;margin-left:auto">⚄</button>
    </div>
    <button data-act="mode">palette: ${MODE_LABEL[t.mode] || 'custom'}</button>
    <div class="sep"></div>
    <button data-act="motes">motes: ${onoff('motes')}</button>
    <button data-act="glow">cursor glow: ${onoff('cursorglow')}</button>
    <div class="sep"></div>
    <button data-act="prefs2">preferences…</button>`;

  document.body.appendChild(menu);

  /* keep it on screen */
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.min(x, window.innerWidth - r.width - 8) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - r.height - 8) + 'px';

  /* mark the closest hue dot as current */
  let best = null, bestD = 1e9;
  for (const i of menu.querySelectorAll('.hues i')) {
    const d = Math.abs(((parseFloat(i.dataset.hue) - t.hue + 540) % 360) - 180);
    if (d < bestD) { bestD = d; best = i; }
  }
  if (best && bestD < 25) best.classList.add('on');

  menu.addEventListener('click', async e => {
    const hueDot = e.target.closest('[data-hue]');
    if (hueDot) {
      await setTheme({ hue: hueDot.dataset.hue });
      for (const i of menu.querySelectorAll('.hues i')) i.classList.toggle('on', i === hueDot);
      return;                                   // stay open — invite hue play
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    switch (act) {
      case 'forge': closeMenu(); launch('wallgen'); break;
      case 'nextwp': await nextWallpaper(); break;
      case 'prefs':
      case 'prefs2': closeMenu(); launch('settings'); break;
      case 'huerand': await setTheme({ hue: Math.floor(Math.random() * 360) }); break;
      case 'mode': {
        const cur = currentTheme().mode;
        await setTheme({ mode: MODES[cur] || 'duo' });
        e.target.textContent = 'palette: ' + MODE_LABEL[MODES[cur] || 'duo'];
        break;
      }
      case 'motes': await flip('motes'); e.target.textContent = 'motes: ' + onoff('motes'); break;
      case 'glow': await flip('cursorglow'); e.target.textContent = 'cursor glow: ' + onoff('cursorglow'); break;
    }
  });
}

export function initContextMenu() {
  document.addEventListener('contextmenu', e => {
    const el = e.target;
    /* only on bare desktop / wallpaper — never over windows, icons,
       widgets, dock or the topbar */
    const bare = el.closest?.('#desktop') && !el.closest('.dicon') && !el.closest('.widget');
    if (!bare && el.id !== 'wallpaper') { closeMenu(); return; }
    e.preventDefault();
    openMenu(e.clientX, e.clientY);
  });
  document.addEventListener('pointerdown', e => {
    if (menu && !menu.contains(e.target)) closeMenu();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
  window.addEventListener('resize', closeMenu);
  window.addEventListener('blur', closeMenu);
  /* live re-tint while the menu is open keeps swatch state honest */
  on('setting:colormode', () => { /* labels update inline; nothing global */ });
}
