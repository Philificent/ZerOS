/**
 * ZerOS kernel — desktop widgets.
 *
 * Clock (analog + digital) and SysMon: everything the browser will
 * admit about the machine — performance, connectivity, bluetooth,
 * battery, cpu, ram, screen — condensed into a live system
 * fingerprint.
 */
import { getSetting, on } from './db.js';

/* ---------------- clock ---------------- */
function clockWidget() {
  const el = document.createElement('div');
  el.className = 'widget w-clock';
  el.innerHTML = `
    <svg class="analog" viewBox="0 0 100 100" width="76" height="76" aria-hidden="true">
      <circle cx="50" cy="50" r="46" fill="hsl(var(--hue) 30% 8% / .5)"
              stroke="hsl(var(--hue) 50% 70% / .25)" stroke-width="1.5"/>
      <g id="wc-ticks" stroke="hsl(var(--hue) 20% 60% / .5)" stroke-width="1.5"></g>
      <line id="wc-h" x1="50" y1="50" x2="50" y2="30" stroke="var(--ink)" stroke-width="3.4" stroke-linecap="round"/>
      <line id="wc-m" x1="50" y1="50" x2="50" y2="20" stroke="var(--ink)" stroke-width="2.2" stroke-linecap="round"/>
      <line id="wc-s" x1="50" y1="56" x2="50" y2="16" stroke="var(--acc)" stroke-width="1.1" stroke-linecap="round"/>
      <circle cx="50" cy="50" r="2.4" fill="var(--acc)"/>
    </svg>
    <div class="digital">
      <div class="time"><span id="wc-time">--:--</span><b id="wc-sec">:--</b></div>
      <div class="date" id="wc-date"></div>
      <div class="tz" id="wc-tz"></div>
    </div>`;

  const ticks = el.querySelector('#wc-ticks');
  let t = '';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const r1 = i % 3 === 0 ? 39 : 42, r2 = 45;
    t += `<line x1="${50 + Math.sin(a) * r1}" y1="${50 - Math.cos(a) * r1}" x2="${50 + Math.sin(a) * r2}" y2="${50 - Math.cos(a) * r2}"/>`;
  }
  ticks.innerHTML = t;

  const hd = el.querySelector('#wc-h'), md = el.querySelector('#wc-m'), sd = el.querySelector('#wc-s');
  const rotate = (line, deg) => line.setAttribute('transform', `rotate(${deg} 50 50)`);

  function tick() {
    const d = new Date();
    const h = d.getHours(), m = d.getMinutes(), s = d.getSeconds();
    rotate(hd, (h % 12) * 30 + m * 0.5);
    rotate(md, m * 6 + s * 0.1);
    rotate(sd, s * 6);
    el.querySelector('#wc-time').textContent =
      `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    el.querySelector('#wc-sec').textContent = ':' + String(s).padStart(2, '0');
    el.querySelector('#wc-date').textContent =
      d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    el.querySelector('#wc-tz').textContent =
      Intl.DateTimeFormat().resolvedOptions().timeZone + ' · UTC' + (-d.getTimezoneOffset() / 60 >= 0 ? '+' : '') + (-d.getTimezoneOffset() / 60);
  }
  tick();
  setInterval(tick, 1000);
  return el;
}

/* ---------------- sysmon ---------------- */
export let liveFPS = 60;
(function fpsMeter() {
  let frames = 0, last = performance.now();
  const loop = t => {
    frames++;
    if (t - last >= 1000) { liveFPS = frames; frames = 0; last = t; }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
})();

async function collectFingerprint() {
  const nav = navigator;
  const fp = {
    'user agent': nav.userAgent,
    platform: nav.platform || '—',
    language: nav.languages?.join(', ') || nav.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    'color depth': screen.colorDepth + '-bit',
    'touch points': nav.maxTouchPoints,
    'pixel ratio': window.devicePixelRatio,
    'reduced motion': matchMedia('(prefers-reduced-motion: reduce)').matches ? 'yes' : 'no',
    cookies: nav.cookieEnabled ? 'enabled' : 'disabled',
    'do not track': nav.doNotTrack ?? '—',
  };
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    if (gl && ext) fp.gpu = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
  } catch { /* gpu hidden */ }
  return fp;
}

async function fingerprintHash(fp) {
  const raw = JSON.stringify(fp) + screen.width + screen.height + navigator.hardwareConcurrency;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return [...new Uint8Array(buf)].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
}

function sysWidget() {
  const el = document.createElement('div');
  el.className = 'widget w-sys';
  el.innerHTML = `
    <h4>System</h4>
    <div class="row"><span class="k">fingerprint</span><span class="v" id="ws-fp" title="SHA-256 of this machine's browser-visible traits">…</span></div>
    <div class="row"><span class="k">fps</span><span class="v" id="ws-fps">—</span></div>
    <div class="row"><span class="k">cpu cores</span><span class="v" id="ws-cpu">—</span></div>
    <div class="row"><span class="k">ram (approx)</span><span class="v" id="ws-ram">—</span></div>
    <div class="row"><span class="k">js heap</span><span class="v" id="ws-heap">—</span></div>
    <div class="meter"><i id="ws-heapbar" style="width:0%"></i></div>
    <div class="row"><span class="k">network</span><span class="v" id="ws-net">—</span></div>
    <div class="row"><span class="k">bluetooth</span><span class="v" id="ws-bt">—</span></div>
    <div class="row"><span class="k">battery</span><span class="v" id="ws-bat">—</span></div>
    <div class="meter"><i id="ws-batbar" style="width:0%"></i></div>
    <div class="row"><span class="k">screen</span><span class="v" id="ws-scr">—</span></div>
    <div class="row"><span class="k">window</span><span class="v" id="ws-win">—</span></div>
    <div class="row"><span class="k">storage</span><span class="v" id="ws-sto">—</span></div>
    <details>
      <summary>full fingerprint</summary>
      <div class="fp" id="ws-fplist"></div>
    </details>`;

  const $ = id => el.querySelector('#' + id);
  const nav = navigator;

  $('ws-cpu').textContent = (nav.hardwareConcurrency || '?') + ' threads';
  $('ws-ram').textContent = nav.deviceMemory ? '≥ ' + nav.deviceMemory + ' GB' : 'not exposed';

  collectFingerprint().then(async fp => {
    $('ws-fp').textContent = await fingerprintHash(fp);
    const list = $('ws-fplist');
    for (const [k, v] of Object.entries(fp)) {
      const row = document.createElement('div');
      row.className = 'row';
      const kk = document.createElement('span'); kk.className = 'k'; kk.textContent = k;
      const vv = document.createElement('span'); vv.className = 'v'; vv.textContent = String(v); vv.title = String(v);
      row.append(kk, vv);
      list.appendChild(row);
    }
  });

  if (nav.bluetooth?.getAvailability) {
    nav.bluetooth.getAvailability()
      .then(a => { $('ws-bt').textContent = a ? 'radio available' : 'unavailable'; })
      .catch(() => { $('ws-bt').textContent = 'blocked'; });
  } else $('ws-bt').textContent = 'no web-bt api';

  let battery = null;
  nav.getBattery?.().then(b => { battery = b; });

  function refresh() {
    $('ws-fps').textContent = liveFPS + ' fps';

    if (performance.memory) {
      const used = performance.memory.usedJSHeapSize / 1048576;
      const cap = performance.memory.jsHeapSizeLimit / 1048576;
      $('ws-heap').textContent = used.toFixed(1) + ' / ' + (cap / 1024).toFixed(1) + 'G MB';
      $('ws-heapbar').style.width = Math.min(100, (used / cap) * 100 * 8) + '%';
    } else $('ws-heap').textContent = 'chrome only';

    const c = nav.connection;
    $('ws-net').textContent = !nav.onLine
      ? 'offline'
      : c ? `${c.effectiveType || '?'} · ${c.downlink ?? '?'} Mb/s · ${c.rtt ?? '?'} ms` : 'online';

    if (battery) {
      $('ws-bat').textContent = Math.round(battery.level * 100) + '%' + (battery.charging ? ' ⚡' : '');
      $('ws-batbar').style.width = battery.level * 100 + '%';
    } else $('ws-bat').textContent = 'not exposed';

    $('ws-scr').textContent = `${screen.width}×${screen.height} @${window.devicePixelRatio}x`;
    $('ws-win').textContent = `${window.innerWidth}×${window.innerHeight}`;
  }
  refresh();
  setInterval(refresh, 2000);
  window.addEventListener('resize', refresh);

  nav.storage?.estimate?.().then(e => {
    const used = (e.usage / 1048576).toFixed(1);
    const quota = (e.quota / 1073741824).toFixed(1);
    $('ws-sto').textContent = `${used} MB of ${quota} GB`;
  });

  return el;
}

/* ---------------- topbar live bits ---------------- */
function initTopbar() {
  const clock = document.getElementById('tb-clock');
  const fps = document.getElementById('tb-fps');
  const net = document.getElementById('tb-net');
  setInterval(() => {
    const d = new Date();
    clock.textContent = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
      + '  ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    fps.textContent = liveFPS + 'fps';
    net.classList.toggle('offline', !navigator.onLine);
    net.title = navigator.onLine ? 'online' : 'offline';
  }, 1000);
}

export function initWidgets() {
  const host = document.getElementById('widgets');
  const clock = clockWidget();
  const sys = sysWidget();
  host.append(clock, sys);
  /* visibility is a preference (toggled in Preferences / ZeroShell) */
  const sync = () => {
    clock.style.display = getSetting('widget_clock', 'on') === 'off' ? 'none' : '';
    sys.style.display = getSetting('widget_sys', 'on') === 'off' ? 'none' : '';
  };
  sync();
  on('setting:widget_clock', sync);
  on('setting:widget_sys', sync);
  initTopbar();
}
