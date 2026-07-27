/**
 * Antenna — RSS / Atom feed reader.
 *
 * Feeds live in the OS database (feeds table). Fetching rides the
 * kernel net layer (direct → CORS relay race); parsing is DOMParser
 * on the XML; article bodies are distilled html→md→html through the
 * escaped markdown pipeline, so remote feeds can't inject markup.
 */
import { listFeeds, addFeed, deleteFeed, on, off } from '../kernel/db.js';
import { fetchText } from '../kernel/net.js';
import { htmlToMarkdown, renderMarkdown, injectPreviewCSS } from './markdown.js';

export const WIDTH = 980;
export const HEIGHT = 640;

const STARTERS = [
  ['hacker news', 'https://news.ycombinator.com/rss'],
  ['lobsters', 'https://lobste.rs/rss'],
  ['bbc world', 'https://feeds.bbci.co.uk/news/world/rss.xml'],
];

/* ---------------- feed parsing (rss 2.0 + atom) ---------------- */
export function parseFeed(xml, feedUrl = '') {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('not valid RSS/Atom XML');
  const q = (el, sel) => el.querySelector(sel)?.textContent?.trim() || '';

  /* atom */
  if (doc.documentElement.localName === 'feed') {
    const entries = [...doc.querySelectorAll('entry')].map(e => ({
      title: q(e, 'title') || '(untitled)',
      link: e.querySelector('link[rel="alternate"]')?.getAttribute('href')
        || e.querySelector('link')?.getAttribute('href') || '',
      date: q(e, 'updated') || q(e, 'published'),
      body: e.querySelector('content')?.textContent || e.querySelector('summary')?.textContent || '',
    }));
    return { title: q(doc.documentElement, ':scope > title') || feedUrl, items: entries };
  }

  /* rss (incl. rdf) */
  const items = [...doc.querySelectorAll('item')].map(it => ({
    title: q(it, 'title') || '(untitled)',
    link: q(it, 'link') || it.querySelector('guid')?.textContent?.trim() || '',
    date: q(it, 'pubDate') || q(it, 'date'),
    body: it.getElementsByTagName('content:encoded')[0]?.textContent
      || q(it, 'description'),
  }));
  const chTitle = doc.querySelector('channel > title')?.textContent?.trim();
  return { title: chTitle || feedUrl, items };
}

const fmtDate = d => {
  const t = new Date(d);
  return isNaN(t) ? '' : t.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

/* ---------------- UI ---------------- */
export async function launch(win, os) {
  const body = win.body;
  body.innerHTML = `
    <div style="display:grid;grid-template-columns:190px 250px 1fr;height:100%;min-height:0;">
      <div style="display:flex;flex-direction:column;min-height:0;border-right:1px solid hsl(var(--hue) 40% 60%/.12);">
        <div class="zlabel" style="padding:10px 12px 6px;">feeds</div>
        <div data-fx="feeds" style="flex:1;overflow:auto;"></div>
        <div style="padding:8px;display:flex;flex-direction:column;gap:6px;border-top:1px solid hsl(var(--hue) 40% 60%/.1);">
          <input class="zinput" data-fx="addurl" placeholder="feed url…" spellcheck="false" style="font-size:11px;font-family:var(--mono);">
          <button class="zbtn" data-fx="add" style="font-size:11px;">add feed</button>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;min-height:0;border-right:1px solid hsl(var(--hue) 40% 60%/.12);">
        <div class="zlabel" style="padding:10px 12px 6px;" data-fx="feedname">items</div>
        <div data-fx="items" style="flex:1;overflow:auto;"></div>
      </div>
      <div data-fx="article" class="md-preview" style="overflow:auto;padding:16px 22px;min-height:0;">
        <div style="color:var(--ink-mute);font-size:12px;padding-top:30vh;text-align:center;">
          pick a feed on the left — or add one<br><br>
          <span data-fx="starters" style="display:inline-flex;gap:8px;flex-wrap:wrap;justify-content:center;"></span>
        </div>
      </div>
    </div>`;

  injectPreviewCSS();
  const $ = s => body.querySelector(`[data-fx="${s}"]`);

  let activeFeedId = null;
  let itemGen = 0;
  const cache = new Map();            // feedId -> parsed feed

  /* ---- feed list ---- */
  async function renderFeeds() {
    const feeds = await listFeeds();
    const host = $('feeds');
    host.textContent = '';
    for (const f of feeds) {
      const row = document.createElement('div');
      row.style.cssText = `display:flex;align-items:center;gap:6px;padding:7px 10px;cursor:pointer;font-size:12px;
        border-left:2px solid ${String(f.id) === String(activeFeedId) ? 'var(--acc)' : 'transparent'};
        background:${String(f.id) === String(activeFeedId) ? 'hsl(var(--hue) 40% 40%/.14)' : 'transparent'};`;
      const name = document.createElement('span');
      name.textContent = f.title || new URL(f.url).host;
      name.style.cssText = 'flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      const x = document.createElement('button');
      x.textContent = '×';
      x.title = 'remove feed';
      x.style.cssText = 'border:0;background:none;color:var(--ink-mute);cursor:pointer;font-size:13px;padding:0 2px;';
      x.addEventListener('click', async e => {
        e.stopPropagation();
        x.disabled = true;
        cache.delete(f.id);
        if (String(activeFeedId) === String(f.id)) { activeFeedId = null; $('items').textContent = ''; $('feedname').textContent = 'items'; }
        await deleteFeed(f.id);        // emits feeds:changed → re-render
      });
      row.append(name, x);
      row.addEventListener('click', () => openFeed(f));
      host.appendChild(row);
    }
    if (!feeds.length) {
      const empty = document.createElement('div');
      empty.textContent = 'no feeds yet';
      empty.style.cssText = 'padding:10px 12px;font-size:11px;color:var(--ink-mute);';
      host.appendChild(empty);
    }
  }

  /* ---- items ---- */
  async function openFeed(f, force = false) {
    activeFeedId = f.id;
    renderFeeds();
    const gen = ++itemGen;
    const host = $('items');
    $('feedname').textContent = f.title || new URL(f.url).host;
    host.textContent = '';
    const note = document.createElement('div');
    note.textContent = 'fetching…';
    note.style.cssText = 'padding:10px 12px;font-size:11px;color:var(--ink-mute);font-family:var(--mono);';
    host.appendChild(note);

    try {
      let feed = !force && cache.get(f.id);
      if (!feed) {
        const { text } = await fetchText(f.url);
        feed = parseFeed(text, f.url);
        cache.set(f.id, feed);
        if (feed.title && feed.title !== f.title) addFeed(f.url, feed.title);  // remember real name
      }
      if (gen !== itemGen) return;
      host.textContent = '';
      for (const item of feed.items.slice(0, 60)) {
        const row = document.createElement('div');
        row.style.cssText = 'padding:8px 12px;cursor:pointer;border-bottom:1px solid hsl(var(--hue) 40% 60%/.07);';
        const t = document.createElement('div');
        t.textContent = item.title;
        t.style.cssText = 'font-size:12px;line-height:1.35;';
        const d = document.createElement('div');
        d.textContent = fmtDate(item.date);
        d.style.cssText = 'font-size:10px;color:var(--ink-mute);margin-top:2px;';
        row.append(t, d);
        row.addEventListener('click', () => {
          for (const r of host.children) r.style.background = 'transparent';
          row.style.background = 'hsl(var(--hue) 40% 40%/.14)';
          openArticle(item);
        });
        host.appendChild(row);
      }
      if (!feed.items.length) { note.textContent = 'feed is empty'; host.appendChild(note); }
    } catch (err) {
      if (gen !== itemGen) return;
      note.textContent = 'failed: ' + err.message;
      host.textContent = '';
      host.appendChild(note);
    }
  }

  /* ---- article pane ---- */
  function openArticle(item) {
    const art = $('article');
    const looksHtml = /<[a-z][\s\S]*>/i.test(item.body);
    const md = looksHtml ? htmlToMarkdown(item.body, item.link) : item.body;
    const head = `# ${item.title}\n\n` + (item.date ? `*${new Date(item.date).toLocaleString()}*\n\n` : '');
    art.innerHTML = renderMarkdown(head + md);
    if (item.link) {
      const p = document.createElement('p');
      const a = document.createElement('a');
      a.href = item.link;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = 'read original ↗';
      p.appendChild(a);
      art.appendChild(p);
    }
    art.scrollTop = 0;
  }

  /* ---- add feed ---- */
  async function add(urlRaw) {
    let url = (urlRaw || '').trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    $('add').disabled = true;
    try {
      const { text } = await fetchText(url);
      const feed = parseFeed(text, url);
      const id = await addFeed(url, feed.title);     // emits feeds:changed
      cache.set(id, feed);
      $('addurl').value = '';
      openFeed({ id, url, title: feed.title });
      os.toast(`subscribed: ${feed.title}`);
    } catch (err) {
      os.toast('not a readable feed: ' + err.message);
    } finally {
      $('add').disabled = false;
    }
  }
  $('add').addEventListener('click', () => add($('addurl').value));
  $('addurl').addEventListener('keydown', e => { if (e.key === 'Enter') add($('addurl').value); });

  /* starter suggestions in the empty article pane */
  for (const [name, url] of STARTERS) {
    const b = document.createElement('button');
    b.className = 'zbtn ghost';
    b.style.fontSize = '11px';
    b.textContent = name;
    b.addEventListener('click', () => add(url));
    $('starters').appendChild(b);
  }

  const onFeedsChanged = () => renderFeeds();
  on('feeds:changed', onFeedsChanged);
  win.onClose(() => off('feeds:changed', onFeedsChanged));

  renderFeeds();
}
