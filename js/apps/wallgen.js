/**
 * Vaporforge — the ZerOS wallpaper generator.
 *
 * Drives the vendored `waterpipe-ts` library (fractal-curve smoke on
 * canvas). The smoke is rendered OFFSCREEN at the desktop's native
 * resolution — never below the current screen size — and the window
 * shows a live cover-fit preview of that frame, so what you apply is
 * pixel-for-pixel what the wallpaper becomes (no upscaling, no fuzz).
 */
import { waterpipe } from '../../vendor/waterpipe/index.js';
import { addWallpaper, setSetting } from '../kernel/db.js';
import { themeColors } from '../kernel/theme.js';

export const WIDTH = 860;
export const HEIGHT = 600;

export async function launch(win, os) {
  const body = win.body;
  body.innerHTML = `
    <div style="display:flex;height:100%;min-height:0;">
      <div style="flex:1;position:relative;min-width:0;background:#000;">
        <canvas data-wg="cv" style="position:absolute;inset:0;width:100%;height:100%;"></canvas>
        <div data-wg="hint" style="position:absolute;left:10px;bottom:8px;font-size:10px;color:hsl(0 0% 100%/.4);font-family:var(--mono);pointer-events:none;">waterpipe-ts · fractal smoke</div>
      </div>
      <div style="flex:0 0 240px;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:12px;border-left:1px solid hsl(var(--hue) 40% 60%/.12);">
        <div>
          <div class="zlabel" style="margin-bottom:6px">presets</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;">
            <button class="zbtn ghost" data-preset="theme">theme smoke</button>
            <button class="zbtn ghost" data-preset="ember">ember</button>
            <button class="zbtn ghost" data-preset="abyss">abyss</button>
            <button class="zbtn ghost" data-preset="ghost">ghost</button>
          </div>
        </div>
        <label><span class="zlabel">smoke core</span><br><input type="color" data-wg="c1" value="#88aaff" style="width:100%;height:30px;border:0;background:transparent;cursor:pointer"></label>
        <label><span class="zlabel">smoke haze</span><br><input type="color" data-wg="c2" value="#0a0d1a" style="width:100%;height:30px;border:0;background:transparent;cursor:pointer"></label>
        <label><span class="zlabel">bg inner</span><br><input type="color" data-wg="b1" value="#101528" style="width:100%;height:30px;border:0;background:transparent;cursor:pointer"></label>
        <label><span class="zlabel">bg outer</span><br><input type="color" data-wg="b2" value="#05070d" style="width:100%;height:30px;border:0;background:transparent;cursor:pointer"></label>
        <label><span class="zlabel">opacity <b data-wg="vo">0.12</b></span>
          <input type="range" class="zrange" data-wg="op" min="0.02" max="0.5" step="0.01" value="0.12"></label>
        <label><span class="zlabel">sources <b data-wg="vn">2</b></span>
          <input type="range" class="zrange" data-wg="nc" min="1" max="6" step="1" value="2"></label>
        <label><span class="zlabel">detail <b data-wg="vi">9</b></span>
          <input type="range" class="zrange" data-wg="it" min="6" max="11" step="1" value="9"></label>
        <label><span class="zlabel">line width <b data-wg="vl">1.5</b></span>
          <input type="range" class="zrange" data-wg="lw" min="0.5" max="6" step="0.5" value="1.5"></label>
        <button class="zbtn" data-wg="reroll">↻ re-roll</button>
        <button class="zbtn primary" data-wg="apply">set as wallpaper</button>
        <button class="zbtn ghost" data-wg="dl">download png</button>
        <div style="font-size:10.5px;color:var(--ink-mute);line-height:1.5">captured at your screen's native resolution and stored in the <code>wallpapers</code> table.</div>
      </div>
    </div>`;

  const $ = s => body.querySelector(`[data-wg="${s}"]`);
  const cv = $('cv');
  const pctx = cv.getContext('2d');

  /* Offscreen render target at the desktop's resolution. waterpipe
     measures a detached canvas via its width/height ATTRIBUTES and
     multiplies by devicePixelRatio itself, so the backing store ends
     up at true native pixels (e.g. 1710×1112 css → 3420×2224 px). */
  const RW = Math.max(screen.width, 1280);
  const RH = Math.max(screen.height, 800);
  const rc = document.createElement('canvas');
  rc.setAttribute('width', String(RW));
  rc.setAttribute('height', String(RH));

  const opts = () => ({
    gradientStart: $('c1').value,
    gradientEnd: $('c2').value,
    bgColorInner: $('b1').value,
    bgColorOuter: $('b2').value,
    smokeOpacity: parseFloat($('op').value),
    numCircles: parseInt($('nc').value, 10),
    iterations: parseInt($('it').value, 10),
    /* sliders are tuned for a ~550px preview — scale strokes and pace
       up with the render height so the smoke reads the same at 4K */
    lineWidth: parseFloat($('lw').value) * Math.max(1, RH / 550),
    drawsPerFrame: Math.max(12, Math.round(12 * (RH / 550))),
    /* the vendored build leaves 'auto' radii unresolved (NaN), so give
       real numbers scaled to the render canvas */
    minMaxRad: Math.round(RH * 0.55),
    maxMaxRad: Math.round(RH * 0.85),
  });

  /* seed colors from the live OS theme */
  function seedFromTheme() {
    const t = themeColors();
    $('c1').value = t.accent;
    $('c2').value = t.deep2;
    $('b1').value = t.deep;
    $('b2').value = '#04050a';
  }
  seedFromTheme();

  const effect = waterpipe(rc, opts());
  /* waterpipe re-measures once via ResizeObserver's initial callback;
     on a detached canvas that reads back the dpr-inflated width attr
     and doubles the backing store — the first measure is the right
     one, so stop observing (we never resize the render canvas) */
  effect.resizeObserver?.disconnect();

  /* ---- live preview: cover-fit blit of the native-res frame ---- */
  function sizePreview() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.max(1, Math.round(cv.clientWidth * dpr));
    cv.height = Math.max(1, Math.round(cv.clientHeight * dpr));
  }
  sizePreview();
  let prevRaf = 0;
  function blit() {
    prevRaf = requestAnimationFrame(blit);
    if (cv.width < 4 && cv.clientWidth > 4) sizePreview();   // late first layout
    if (!rc.width || !cv.width) return;
    const scale = Math.max(cv.width / rc.width, cv.height / rc.height);
    const sw = cv.width / scale, sh = cv.height / scale;
    pctx.drawImage(rc, (rc.width - sw) / 2, (rc.height - sh) / 2, sw, sh, 0, 0, cv.width, cv.height);
  }
  blit();

  win.onResize(sizePreview);         // render canvas never resizes — only the preview
  win.onClose(() => { cancelAnimationFrame(prevRaf); effect.destroy(); });

  const labels = { op: 'vo', nc: 'vn', it: 'vi', lw: 'vl' };
  for (const id of ['c1', 'c2', 'b1', 'b2', 'op', 'nc', 'it', 'lw']) {
    $(id).addEventListener('input', () => {
      if (labels[id]) $(labels[id]).textContent = $(id).value;
      effect.setOptions(opts());
    });
  }

  const PRESETS = {
    theme: () => { seedFromTheme(); return {}; },
    ember: () => { $('c1').value = '#ff8830'; $('c2').value = '#200400'; $('b1').value = '#1c0800'; $('b2').value = '#050100'; return {}; },
    abyss: () => { $('c1').value = '#20e0c0'; $('c2').value = '#001418'; $('b1').value = '#02181e'; $('b2').value = '#010508'; return {}; },
    ghost: () => { $('c1').value = '#c8d4ee'; $('c2').value = '#10121a'; $('b1').value = '#171a24'; $('b2').value = '#07080d'; return {}; },
  };
  for (const b of body.querySelectorAll('[data-preset]')) {
    b.addEventListener('click', () => {
      PRESETS[b.dataset.preset]();
      effect.setOptions(opts());
    });
  }

  $('reroll').addEventListener('click', () => effect.generate());

  $('apply').addEventListener('click', async () => {
    $('apply').disabled = true;
    try {
      /* 1:1 copy of the native-resolution backing store */
      const dataUrl = effect.toDataURL(rc.width, rc.height, 'image/jpeg', 0.88);
      const name = 'vaporforge ' + new Date().toLocaleString();
      const id = await addWallpaper(name, 'image', dataUrl);
      await setSetting('wallpaper', String(id));
      os.toast('wallpaper forged and applied');
    } catch (err) {
      os.toast('capture failed: ' + err.message);
    } finally {
      $('apply').disabled = false;
    }
  });

  $('dl').addEventListener('click', () =>
    effect.download('zeros-wallpaper.png', rc.width, rc.height));
}
