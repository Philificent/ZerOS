/**
 * Preferences — wallpaper (incl. your own uploads), widgets, color
 * theme, atmosphere.
 *
 * The color system is intentionally narrow: one hue dial + one
 * intensity dial + a palette mode (mono / duotone / complementary).
 */
import { getSetting, setSetting, listWallpapers, deleteWallpaper, addWallpaper, on, off } from '../kernel/db.js';
import { setTheme, currentTheme } from '../kernel/theme.js';

export const WIDTH = 620;
export const HEIGHT = 640;

/* built-in CSS wallpapers (theme-aware via hue vars where possible) */
const BUILTINS = [
  ['midnight ramp', 'linear-gradient(135deg, hsl(230 45% 12%), hsl(260 50% 7%) 55%, hsl(200 60% 5%))'],
  ['deep ember', 'radial-gradient(120% 140% at 85% 90%, hsl(12 65% 14%), hsl(260 30% 6%) 60%, hsl(230 30% 4%))'],
  ['aurora floor', 'linear-gradient(160deg, hsl(160 60% 8%), hsl(200 70% 10%) 45%, hsl(250 45% 7%))'],
  ['carbon', 'repeating-linear-gradient(45deg, hsl(220 15% 7%) 0 12px, hsl(220 18% 9%) 12px 24px)'],
  ['void', 'radial-gradient(100% 100% at 0% 0%, hsl(220 30% 10%), hsl(220 30% 3%) 70%)'],
];

export async function launch(win, os) {
  const body = win.body;
  body.innerHTML = `
    <div class="app-pad" style="display:flex;flex-direction:column;gap:18px;">
      <section>
        <div class="zlabel" style="margin-bottom:10px">color theme</div>
        <div style="display:flex;flex-direction:column;gap:12px;">
          <label>hue <b data-st="huev"></b>
            <input type="range" class="zrange" data-st="hue" min="0" max="359" step="1"
              style="background:linear-gradient(90deg,hsl(0 70% 55%),hsl(60 70% 55%),hsl(120 70% 55%),hsl(180 70% 55%),hsl(240 70% 55%),hsl(300 70% 55%),hsl(359 70% 55%));height:10px;border-radius:5px;appearance:none;-webkit-appearance:none;">
          </label>
          <label>intensity <b data-st="intv"></b>
            <input type="range" class="zrange" data-st="int" min="0.1" max="1" step="0.05">
          </label>
          <div style="display:flex;align-items:center;gap:12px;">
            <span style="font-size:12px;color:var(--ink-dim)">palette</span>
            <div class="seg" data-st="mode">
              <button data-mode="mono">mono</button>
              <button data-mode="duo">duotone</button>
              <button data-mode="comp">complementary</button>
            </div>
            <span data-st="swatches" style="display:flex;gap:6px;margin-left:auto;"></span>
          </div>
        </div>
      </section>

      <section>
        <div class="zlabel" style="margin-bottom:10px">atmosphere</div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <label style="display:flex;align-items:center;gap:10px;font-size:13px;">
            <input type="checkbox" data-st="motes" style="accent-color:var(--acc);width:16px;height:16px;">
            dust motes on window borders (light from 0,0)
          </label>
          <label style="display:flex;align-items:center;gap:10px;font-size:13px;">
            <input type="checkbox" data-st="cglow" style="accent-color:var(--acc);width:16px;height:16px;">
            cursor glow — a soft light that stirs the motes in its wake
          </label>
        </div>
      </section>

      <section>
        <div class="zlabel" style="margin-bottom:10px">widgets</div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <label style="display:flex;align-items:center;gap:10px;font-size:13px;">
            <input type="checkbox" data-st="wclock" style="accent-color:var(--acc);width:16px;height:16px;">
            clock
          </label>
          <label style="display:flex;align-items:center;gap:10px;font-size:13px;">
            <input type="checkbox" data-st="wsys" style="accent-color:var(--acc);width:16px;height:16px;">
            system fingerprint
          </label>
        </div>
      </section>

      <section>
        <div class="zlabel" style="margin-bottom:10px">wallpaper</div>
        <div data-st="wps" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;"></div>
        <div style="margin-top:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
          <button class="zbtn" data-st="upload">upload your own…</button>
          <input type="file" data-st="file" accept="image/*" style="display:none">
          <span style="font-size:11px;color:var(--ink-mute)">
            or forge one in <a href="#" data-st="openwg" style="color:var(--acc)">Vaporforge</a>
          </span>
        </div>
      </section>
    </div>`;

  const $ = s => body.querySelector(`[data-st="${s}"]`);

  /* every bus subscription is tracked so a closed window goes silent */
  const subs = [];
  const listen = (type, fn) => { on(type, fn); subs.push([type, fn]); };
  win.onClose(() => { for (const [type, fn] of subs) off(type, fn); });

  /* ---- theme controls ---- */
  function syncTheme() {
    const t = currentTheme();
    $('hue').value = t.hue;
    $('huev').textContent = Math.round(t.hue) + '°';
    $('int').value = t.intensity;
    $('intv').textContent = Math.round(t.intensity * 100) + '%';
    for (const b of $('mode').children) b.classList.toggle('on', b.dataset.mode === t.mode);
    /* swatches */
    const h2 = t.mode === 'comp' ? (t.hue + 180) % 360 : t.mode === 'duo' ? (t.hue + 40) % 360 : t.hue;
    $('swatches').innerHTML =
      `<i style="width:18px;height:18px;border-radius:50%;background:hsl(${t.hue} 70% 55%);box-shadow:0 0 8px hsl(${t.hue} 70% 55%/.7)"></i>` +
      `<i style="width:18px;height:18px;border-radius:50%;background:hsl(${h2} 70% 55%);box-shadow:0 0 8px hsl(${h2} 70% 55%/.7)"></i>`;
  }
  $('hue').addEventListener('input', () => setTheme({ hue: $('hue').value }));
  $('int').addEventListener('input', () => setTheme({ intensity: parseFloat($('int').value) }));
  for (const b of $('mode').children) {
    b.addEventListener('click', () => setTheme({ mode: b.dataset.mode }));
  }
  listen('setting:hue', syncTheme);
  listen('setting:intensity', syncTheme);
  listen('setting:colormode', syncTheme);
  syncTheme();

  /* ---- atmosphere + widget toggles ---- */
  const bindToggle = (key, id) => {
    const el = $(id);
    const sync = () => { el.checked = getSetting(key, 'on') !== 'off'; };
    sync();
    el.addEventListener('change', () => setSetting(key, el.checked ? 'on' : 'off'));
    listen('setting:' + key, sync);   // stays honest when toggled from the context menu / shell
  };
  bindToggle('motes', 'motes');
  bindToggle('cursorglow', 'cglow');
  bindToggle('widget_clock', 'wclock');
  bindToggle('widget_sys', 'wsys');

  /* ---- wallpaper upload ---- */
  $('upload').addEventListener('click', () => $('file').click());
  $('file').addEventListener('change', async () => {
    const f = $('file').files[0];
    if (!f) return;
    try {
      const dataUrl = await fileToWallpaper(f);
      const name = f.name.replace(/\.[^.]+$/, '') || 'upload';
      const id = await addWallpaper(name, 'image', dataUrl);
      await setSetting('wallpaper', String(id));
      os.toast('wallpaper uploaded and applied');
    } catch (err) {
      os.toast('upload failed: ' + err.message);
    }
    $('file').value = '';
  });

  /* ---- wallpapers ----
   * renderWalls is async (it awaits the DB), so two overlapping runs
   * used to append the stored tiles twice. A generation counter makes
   * every run build off-DOM and only the newest one may commit; all
   * re-renders flow through bus events (no manual double-triggering). */
  let wallGen = 0;
  async function renderWalls() {
    const gen = ++wallGen;
    const current = getSetting('wallpaper', '');

    const tile = (label, bg, onclick, removable, isCurrent) => {
      const d = document.createElement('div');
      d.style.cssText = `position:relative;height:74px;border-radius:10px;cursor:pointer;overflow:hidden;
        border:2px solid ${isCurrent ? 'var(--acc)' : 'hsl(var(--hue) 30% 50%/.2)'};
        ${bg};display:flex;align-items:flex-end;`;
      const lab = document.createElement('span');
      lab.textContent = label;
      lab.style.cssText = 'font-size:10px;padding:3px 6px;background:hsl(0 0% 0%/.55);width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      d.appendChild(lab);
      d.addEventListener('click', onclick);
      if (removable) {
        const x = document.createElement('button');
        x.textContent = '×';
        x.title = 'delete';
        x.style.cssText = 'position:absolute;top:4px;right:4px;width:18px;height:18px;border-radius:50%;border:0;background:hsl(0 60% 45%/.85);color:#fff;cursor:pointer;font-size:12px;line-height:1;';
        x.addEventListener('click', async e => {
          e.stopPropagation();
          x.disabled = true;                       // one row per click, ever
          if (String(getSetting('wallpaper', '')) === String(removable)) {
            await setSetting('wallpaper', '');
          }
          await deleteWallpaper(removable);        // emits wallpapers:changed → re-render
        });
        d.appendChild(x);
      }
      return d;
    };

    const frag = document.createDocumentFragment();

    /* procedural default */
    frag.appendChild(tile('procedural (theme)', 'background:radial-gradient(120% 120% at 0% 0%, hsl(var(--hue) 50% 22%), hsl(var(--hue) 30% 6%) 60%)',
      () => setSetting('wallpaper', ''), null, current === ''));

    const rows = await listWallpapers();
    if (gen !== wallGen) return;                   // a newer render superseded this one

    /* built-ins (stored copies double as the row when applied) */
    for (const [name, css] of BUILTINS) {
      const stored = rows.find(w => w.kind === 'css' && w.name === name);
      frag.appendChild(tile(name, `background:${css}`, async () => {
        const id = stored ? stored.id : await addWallpaper(name, 'css', css);
        await setSetting('wallpaper', String(id));
      }, null, stored ? String(current) === String(stored.id) : false));
    }

    /* stored (generated / uploaded), minus the built-in css copies shown above */
    const builtinNames = new Set(BUILTINS.map(([name]) => name));
    for (const w of rows) {
      if (w.kind === 'css' && builtinNames.has(w.name)) continue;
      const bg = w.kind === 'image' ? `background-image:url("${w.data}");background-size:cover;background-position:center` : `background:${w.data}`;
      frag.appendChild(tile(w.name, bg,
        () => setSetting('wallpaper', String(w.id)),
        w.id, String(current) === String(w.id)));
    }

    const host = $('wps');
    host.textContent = '';
    host.appendChild(frag);                        // atomic swap, no half-rendered grid
  }
  renderWalls();
  listen('wallpapers:changed', renderWalls);
  listen('setting:wallpaper', renderWalls);

  $('openwg').addEventListener('click', e => { e.preventDefault(); os.launch('wallgen'); });
}

/** Decode an image file and re-encode it at (at most) the screen's
 *  native pixel size, so uploads don't bloat the wallpapers table. */
async function fileToWallpaper(file) {
  const bmp = await createImageBitmap(file);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const maxW = screen.width * dpr;
  const maxH = screen.height * dpr;
  const scale = Math.min(1, maxW / bmp.width, maxH / bmp.height);
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d').drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return c.toDataURL('image/jpeg', 0.9);
}
