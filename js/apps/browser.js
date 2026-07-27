/**
 * Periscope — a small browser for ZerOS.
 *
 * An honest one: a static page can't fully "tap into" the host
 * browser, so Periscope offers two lenses —
 *   · live   — the real site in a sandboxed iframe (many sites send
 *              X-Frame-Options / CSP and refuse to be embedded)
 *   · reader — the page fetched through the kernel net layer and
 *              distilled to markdown (works on almost anything)
 * plus a one-click "open in host browser" escape hatch.
 */
import { htmlToMarkdown, renderMarkdown, injectPreviewCSS } from './markdown.js';
import { fetchText, fetchReader } from '../kernel/net.js';

export const WIDTH = 980;
export const HEIGHT = 660;

const HOME = [
  ['wikipedia', 'https://en.wikipedia.org'],
  ['hacker news', 'https://news.ycombinator.com'],
  ['lobsters', 'https://lobste.rs'],
  ['mdn', 'https://developer.mozilla.org'],
  ['example.com', 'https://example.com'],
];

export async function launch(win, os) {
  const body = win.body;
  body.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%;">
      <div style="display:flex;gap:8px;padding:8px 10px;align-items:center;border-bottom:1px solid hsl(var(--hue) 40% 60%/.12);flex:0 0 auto;">
        <button class="zbtn ghost" data-br="back" title="back" style="padding:4px 10px">‹</button>
        <button class="zbtn ghost" data-br="fwd" title="forward" style="padding:4px 10px">›</button>
        <input class="zinput" data-br="url" placeholder="url — enter to sail" spellcheck="false" style="flex:1;font-family:var(--mono);font-size:12px;">
        <div class="seg" data-br="mode">
          <button data-m="live">live</button>
          <button data-m="reader">reader</button>
        </div>
        <button class="zbtn ghost" data-br="ext" title="open in your real browser">↗</button>
      </div>
      <div data-br="hint" style="display:none;flex:0 0 auto;padding:5px 12px;font-size:11px;color:var(--ink-mute);border-bottom:1px solid hsl(var(--hue) 40% 60%/.1);"></div>
      <div style="flex:1;min-height:0;position:relative;">
        <div data-br="home" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;">
          <div style="font-size:26px;letter-spacing:.12em;color:var(--ink-dim);font-weight:200;">periscope</div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;max-width:420px;" data-br="quick"></div>
          <div style="font-size:11px;color:var(--ink-mute);max-width:380px;text-align:center;line-height:1.6;">
            live mode embeds the real site — sites that refuse framing appear blank;
            switch to reader mode to fetch them as distilled text instead.
          </div>
        </div>
        <iframe data-br="frame" title="page" referrerpolicy="no-referrer"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          style="display:none;position:absolute;inset:0;width:100%;height:100%;border:0;background:#fff;"></iframe>
        <div data-br="read" class="md-preview" style="display:none;position:absolute;inset:0;overflow:auto;padding:18px 26px;"></div>
        <div data-br="spin" style="display:none;position:absolute;inset:0;align-items:center;justify-content:center;font-size:12px;color:var(--ink-dim);font-family:var(--mono);background:hsl(var(--hue) 30% 4%/.55);">fetching…</div>
      </div>
    </div>`;

  injectPreviewCSS();
  const $ = s => body.querySelector(`[data-br="${s}"]`);
  const frame = $('frame'), read = $('read'), home = $('home'), spin = $('spin'), hint = $('hint');

  let mode = 'reader';                 // reader default: it always shows *something*
  let current = '';
  const hist = [];
  let hi = -1;
  let fetchGen = 0;

  const setHint = t => { hint.textContent = t || ''; hint.style.display = t ? 'block' : 'none'; };
  const syncMode = () => { for (const b of $('mode').children) b.classList.toggle('on', b.dataset.m === mode); };

  function show(which) {
    home.style.display = which === 'home' ? 'flex' : 'none';
    frame.style.display = which === 'live' ? 'block' : 'none';
    read.style.display = which === 'read' ? 'block' : 'none';
    spin.style.display = which === 'spin' ? 'flex' : 'none';
  }

  function normalize(u) {
    u = u.trim();
    if (!u) return '';
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    try { return new URL(u).href; } catch { return ''; }
  }

  async function go(url, push = true) {
    url = normalize(url);
    if (!url) return;
    current = url;
    $('url').value = url;
    if (push) {
      hist.splice(hi + 1);
      hist.push(url);
      hi = hist.length - 1;
    }
    win.setTitle('Periscope — ' + new URL(url).host);

    if (mode === 'live') {
      setHint('blank page? the site refuses to be embedded — flip to reader mode');
      show('live');
      frame.src = url;
      return;
    }

    /* reader mode */
    const gen = ++fetchGen;
    setHint('');
    show('spin');
    try {
      let md;
      try {
        const { text, contentType } = await fetchText(url);
        if (gen !== fetchGen) return;
        md = contentType.includes('html') || /^\s*(<!doctype|<html)/i.test(text)
          ? htmlToMarkdown(text, url)
          : text;
      } catch {
        md = await fetchReader(url);   // server-side reader, last resort
      }
      if (gen !== fetchGen) return;
      read.innerHTML = renderMarkdown(md);
      read.scrollTop = 0;
      /* keep navigation inside the periscope */
      for (const a of read.querySelectorAll('a[href^="http"]')) {
        a.addEventListener('click', e => { e.preventDefault(); go(a.href); });
      }
      show('read');
    } catch (err) {
      if (gen !== fetchGen) return;
      read.innerHTML = renderMarkdown(`# unreachable\n\n${url}\n\n> ${err.message}`);
      show('read');
    }
  }

  /* toolbar wiring */
  $('url').addEventListener('keydown', e => { if (e.key === 'Enter') go($('url').value); });
  $('back').addEventListener('click', () => { if (hi > 0) go(hist[--hi], false); });
  $('fwd').addEventListener('click', () => { if (hi < hist.length - 1) go(hist[++hi], false); });
  $('ext').addEventListener('click', () => {
    if (current) window.open(current, '_blank', 'noopener');
    else os.toast('nothing to open yet — enter a url first');
  });
  for (const b of $('mode').children) {
    b.addEventListener('click', () => {
      mode = b.dataset.m;
      syncMode();
      if (current) go(current, false);
    });
  }

  /* start page quick links */
  for (const [name, url] of HOME) {
    const b = document.createElement('button');
    b.className = 'zbtn ghost';
    b.textContent = name;
    b.addEventListener('click', () => go(url));
    $('quick').appendChild(b);
  }

  syncMode();
  show('home');
}
