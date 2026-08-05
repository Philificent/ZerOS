/**
 * Inkwell — the ZerOS markdown editor.
 *
 *  - live side-by-side preview (own renderer, HTML-escaped by design)
 *  - documents stored in the OS database
 *  - remote fetch: pull any URL, convert its HTML into markdown
 *    (DOM-walking html→md converter, CORS-proxy fallback) — other apps
 *    can hand a link over by launching Inkwell with { url }
 */
import { listDocs, getDoc, saveDoc, deleteDoc, on, off } from '../kernel/db.js';
import { fetchText, fetchReader } from '../kernel/net.js';

export const WIDTH = 940;
export const HEIGHT = 620;

/* ================= markdown → html (escaped, safe subset) ================= */
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(md) {
  let s = esc(md);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_, alt, src) =>
    /^https?:|^data:image/.test(src) ? `<img src="${src}" alt="${alt}">` : alt);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_, txt, href) =>
    /^https?:|^#/.test(href) ? `<a href="${href}" target="_blank" rel="noopener">${txt}</a>` : txt);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a, b) => `<strong>${a ?? b}</strong>`);
  s = s.replace(/\*([^*\n]+)\*|\b_([^_\n]+)_\b/g, (_, a, b) => `<em>${a ?? b}</em>`);
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  s = s.replace(/(^|\s)(https?:\/\/[^\s<]+[^\s<.,)])/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  return s;
}

export function renderMarkdown(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;

  const isTableRow = l => /^\s*\|.*\|\s*$/.test(l);
  const isTableSep = l => /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(l);

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*$/.test(line)) { i++; continue; }

    /* fenced code */
    const fence = line.match(/^```(\w*)/);
    if (fence) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code class="lang-${fence[1]}">${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }

    /* heading */
    const h = line.match(/^(#{1,6})\s+(.*)/);
    if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }

    /* hr */
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) { out.push('<hr>'); i++; continue; }

    /* blockquote */
    if (/^\s*>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${renderMarkdown(buf.join('\n'))}</blockquote>`);
      continue;
    }

    /* table */
    if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => inline(c.trim()));
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && isTableRow(lines[i])) rows.push(cells(lines[i++]));
      out.push('<table><thead><tr>' + head.map(c => `<th>${c}</th>`).join('') + '</tr></thead><tbody>'
        + rows.map(r => '<tr>' + r.map(c => `<td>${c}</td>`).join('') + '</tr>').join('') + '</tbody></table>');
      continue;
    }

    /* lists (with simple nesting by indent) */
    const li = line.match(/^(\s*)([-*+]|\d+[.)])\s+/);
    if (li) {
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)/);
        if (!m) break;
        items.push({ indent: m[1].length, ordered: /\d/.test(m[2]), text: m[3] });
        i++;
      }
      out.push(buildList(items, 0));
      continue;
    }

    /* paragraph */
    const buf = [line];
    i++;
    while (i < lines.length && !/^\s*$/.test(lines[i]) &&
           !/^(#{1,6}\s|```|\s*>|\s*([-*+]|\d+[.)])\s|\s*\|)/.test(lines[i])) {
      buf.push(lines[i++]);
    }
    out.push(`<p>${inline(buf.join(' '))}</p>`);
  }
  return out.join('\n');

  function buildList(items, depth) {
    if (!items.length) return '';
    const base = items[0].indent;
    const tag = items[0].ordered ? 'ol' : 'ul';
    let html = `<${tag}>`;
    for (let j = 0; j < items.length; j++) {
      if (items[j].indent <= base) {
        /* collect children (deeper indents) */
        let k = j + 1;
        while (k < items.length && items[k].indent > base) k++;
        const kids = items.slice(j + 1, k);
        html += `<li>${inline(items[j].text)}${kids.length ? buildList(kids, depth + 1) : ''}</li>`;
        j = k - 1;
      }
    }
    return html + `</${tag}>`;
  }
}

/* ================= html → markdown ================= */
export function htmlToMarkdown(html, baseUrl = '') {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const sel of ['script', 'style', 'noscript', 'iframe', 'svg', 'nav', 'footer', 'form', 'header [role="banner"]']) {
    doc.querySelectorAll(sel).forEach(n => n.remove());
  }
  const root = doc.querySelector('article, main, [role="main"]') || doc.body;
  const title = doc.querySelector('title')?.textContent?.trim();

  const abs = url => { try { return new URL(url, baseUrl || undefined).href; } catch { return url; } };

  function walk(node, ctx = {}) {
    if (node.nodeType === Node.TEXT_NODE) {
      return ctx.pre ? node.textContent : node.textContent.replace(/\s+/g, ' ');
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const kids = c => [...node.childNodes].map(n => walk(n, c)).join('');
    const tag = node.tagName.toLowerCase();

    switch (tag) {
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
        return `\n\n${'#'.repeat(+tag[1])} ${kids(ctx).trim()}\n\n`;
      case 'p': return `\n\n${kids(ctx).trim()}\n\n`;
      case 'br': return '  \n';
      case 'hr': return '\n\n---\n\n';
      case 'strong': case 'b': { const t = kids(ctx).trim(); return t ? `**${t}**` : ''; }
      case 'em': case 'i': { const t = kids(ctx).trim(); return t ? `*${t}*` : ''; }
      case 'del': case 's': { const t = kids(ctx).trim(); return t ? `~~${t}~~` : ''; }
      case 'code':
        if (ctx.pre) return kids(ctx);
        return '`' + kids(ctx).trim() + '`';
      case 'pre': {
        const lang = node.querySelector('code')?.className.match(/language-(\w+)/)?.[1] || '';
        return `\n\n\`\`\`${lang}\n${kids({ pre: true }).replace(/^\n+|\n+$/g, '')}\n\`\`\`\n\n`;
      }
      case 'a': {
        const href = node.getAttribute('href');
        const t = kids(ctx).trim();
        if (!href || href.startsWith('javascript:')) return t;
        return t ? `[${t}](${abs(href)})` : '';
      }
      case 'img': {
        const src = node.getAttribute('src');
        return src ? `![${node.getAttribute('alt') || ''}](${abs(src)})` : '';
      }
      case 'ul': case 'ol': {
        const ordered = tag === 'ol';
        const depth = ctx.listDepth || 0;
        let n = 0;
        const items = [...node.children].filter(c => c.tagName === 'LI').map(li => {
          n++;
          const inner = walk(li, { ...ctx, listDepth: depth + 1, isLi: true })
            .trim().replace(/\n{2,}/g, '\n').replace(/\n/g, '\n' + '  '.repeat(depth + 1));
          return '  '.repeat(depth) + (ordered ? `${n}. ` : '- ') + inner;
        });
        return `\n\n${items.join('\n')}\n\n`;
      }
      case 'li': return kids(ctx);
      case 'blockquote':
        return '\n\n' + kids(ctx).trim().split('\n').map(l => '> ' + l).join('\n') + '\n\n';
      case 'table': {
        const rows = [...node.querySelectorAll('tr')].map(tr =>
          [...tr.children].map(td => walk(td, ctx).trim().replace(/\|/g, '\\|').replace(/\n+/g, ' ')));
        if (!rows.length) return '';
        const head = rows[0];
        const sep = head.map(() => '---');
        const body = rows.slice(1);
        return '\n\n' + [head, sep, ...body].map(r => `| ${r.join(' | ')} |`).join('\n') + '\n\n';
      }
      case 'div': case 'section': case 'article': case 'main': case 'aside':
      case 'figure': case 'figcaption': case 'span': case 'body': case 'header':
        return kids(ctx);
      default:
        return kids(ctx);
    }
  }

  let md = walk(root).replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim();
  if (title && !md.startsWith('#')) md = `# ${title}\n\n${md}`;
  return md;
}

/* ================= remote fetch (kernel net layer + reader fallback) ================= */
async function fetchRemote(url, note = () => {}) {
  try {
    const { text, contentType, via } = await fetchText(url);
    return {
      text,
      isHtml: contentType.includes('html') || /^\s*(<!doctype|<html|<head|<body)/i.test(text),
      via,
    };
  } catch { /* every CORS route failed — reader renders it server-side */ }
  note('direct + relays blocked — asking reader service…');
  const md = await fetchReader(url);
  return { text: md, isHtml: false, via: 'r.jina.ai (reader)' };
}

/* ================= UI ================= */
const WELCOME = `# Welcome to Inkwell

Type markdown on the left, watch glass on the right.

## What works
- **bold**, *italic*, ~~strikethrough~~, \`inline code\`
- [links](https://example.com), images, autolinks
- lists, nested lists, > blockquotes
- tables and fenced code blocks

| feature | status |
| --- | --- |
| live preview | ✔ |
| database persistence | ✔ |
| url → markdown | ✔ |

\`\`\`js
// fetch any page as markdown:
// paste a URL up top and press "fetch → md"
console.log("the web is a markdown document in denial");
\`\`\`

> Documents live in the ZerOS Postgres database.
> Open ZeroShell and try: \`SELECT title FROM documents;\`
`;

export async function launch(win, os, args) {
  const body = win.body;
  body.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%;">
      <div style="display:flex;gap:8px;padding:8px 10px;flex-wrap:wrap;align-items:center;border-bottom:1px solid hsl(var(--hue) 40% 60%/.12);flex:0 0 auto;">
        <select class="zselect" data-mk="docs" style="max-width:170px"></select>
        <button class="zbtn ghost" data-mk="new" title="new document">new</button>
        <button class="zbtn" data-mk="save" title="save to database">save</button>
        <button class="zbtn ghost" data-mk="del" title="delete document">delete</button>
        <span style="flex:1"></span>
        <input class="zinput" data-mk="url" placeholder="https://any-page → markdown" style="width:230px" spellcheck="false">
        <button class="zbtn" data-mk="fetch">fetch → md</button>
      </div>
      <div style="flex:1;display:grid;grid-template-columns:1fr 1fr;min-height:0;">
        <textarea data-mk="src" spellcheck="false" style="resize:none;border:0;outline:none;background:hsl(var(--hue) 30% 5%/.45);color:var(--ink);padding:14px;font-family:var(--mono);font-size:12.5px;line-height:1.6;border-right:1px solid hsl(var(--hue) 40% 60%/.12);"></textarea>
        <div data-mk="prev" class="md-preview" style="overflow:auto;padding:14px 18px;"></div>
      </div>
      <div data-mk="status" style="flex:0 0 auto;padding:5px 12px;font-size:11px;color:var(--ink-mute);font-family:var(--mono);border-top:1px solid hsl(var(--hue) 40% 60%/.1);">ready</div>
    </div>`;

  injectPreviewCSS();

  const $ = s => body.querySelector(`[data-mk="${s}"]`);
  const src = $('src'), prev = $('prev'), status = $('status'), docSel = $('docs');
  let currentId = null;
  let dirty = false;

  const setStatus = m => { status.textContent = m; };

  function refresh() {
    prev.innerHTML = renderMarkdown(src.value);
    const words = (src.value.match(/\S+/g) || []).length;
    setStatus(`${words} words · ${src.value.length} chars` + (dirty ? ' · unsaved' : '') + (currentId ? ` · doc #${currentId}` : ' · draft'));
  }

  let debounce;
  src.addEventListener('input', () => {
    dirty = true;
    clearTimeout(debounce);
    debounce = setTimeout(refresh, 120);
  });
  src.addEventListener('keydown', e => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const { selectionStart: s, selectionEnd: en } = src;
      src.setRangeText('  ', s, en, 'end');
      dirty = true; refresh();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save(); }
  });

  async function refreshDocList() {
    const docs = await listDocs();
    docSel.textContent = '';
    const opt0 = document.createElement('option');
    opt0.value = ''; opt0.textContent = '— documents —';
    docSel.appendChild(opt0);
    for (const d of docs) {
      const o = document.createElement('option');
      o.value = d.id; o.textContent = d.title;
      docSel.appendChild(o);
    }
    if (currentId) docSel.value = String(currentId);
  }

  docSel.addEventListener('change', async () => {
    if (!docSel.value) return;
    const doc = await getDoc(docSel.value);
    if (doc) {
      currentId = doc.id;
      src.value = doc.content;
      dirty = false;
      refresh();
      win.setTitle('Inkwell — ' + doc.title);
    }
  });

  function titleFrom(md) {
    const m = md.match(/^#\s+(.+)/m);
    return (m ? m[1] : md.split('\n')[0] || 'untitled').slice(0, 60).trim() || 'untitled';
  }

  async function save() {
    const title = titleFrom(src.value);
    currentId = await saveDoc(currentId, title, src.value);
    dirty = false;
    await refreshDocList();
    win.setTitle('Inkwell — ' + title);
    refresh();
    os.toast(`saved "${title}" to the database`);
  }

  $('save').addEventListener('click', save);
  $('new').addEventListener('click', () => {
    currentId = null;
    src.value = '# untitled\n\n';
    dirty = true;
    docSel.value = '';
    win.setTitle('Inkwell');
    refresh();
    src.focus();
  });
  $('del').addEventListener('click', async () => {
    if (!currentId) return os.toast('nothing to delete — this is an unsaved draft');
    await deleteDoc(currentId);
    currentId = null;
    src.value = '';
    await refreshDocList();
    win.setTitle('Inkwell');
    refresh();
    os.toast('document deleted');
  });

  $('fetch').addEventListener('click', () => doFetch());
  $('url').addEventListener('keydown', e => { if (e.key === 'Enter') doFetch(); });

  async function doFetch(url = $('url').value.trim()) {
    if (!url) return;
    if (!/^https?:\/\//.test(url)) url = 'https://' + url;
    $('url').value = url;
    setStatus('fetching ' + url + ' …');
    $('fetch').disabled = true;
    try {
      const { text, isHtml, via } = await fetchRemote(url, setStatus);
      const md = isHtml ? htmlToMarkdown(text, url) : text;
      currentId = null;
      src.value = md;
      dirty = true;
      refresh();
      win.setTitle('Inkwell — fetched');
      os.toast((isHtml ? 'converted page html → markdown' : 'fetched as markdown/text') + ' · via ' + via);
    } catch (err) {
      setStatus('fetch failed: ' + err.message);
    } finally {
      $('fetch').disabled = false;
    }
  }

  /* another app (Antenna, say) sending a link to an already-open Inkwell */
  const onArgs = e => { if (e.detail?.url) doFetch(e.detail.url); };
  on('app:markdown:args', onArgs);
  win.onClose(() => off('app:markdown:args', onArgs));

  if (args?.url) {
    await doFetch(args.url);
  } else {
    src.value = WELCOME;
    refresh();
  }
  await refreshDocList();
}

/* preview typography (injected once; shared with Periscope + Antenna) */
export function injectPreviewCSS() {
  if (document.getElementById('md-preview-css')) return;
  const st = document.createElement('style');
  st.id = 'md-preview-css';
  st.textContent = `
    .md-preview { font-size: 13.5px; line-height: 1.65; color: var(--ink); }
    .md-preview h1, .md-preview h2, .md-preview h3, .md-preview h4 { margin: 1em 0 .45em; line-height: 1.25; }
    .md-preview h1 { font-size: 1.7em; border-bottom: 1px solid hsl(var(--hue) 40% 60%/.2); padding-bottom: .25em; }
    .md-preview h2 { font-size: 1.35em; }
    .md-preview h3 { font-size: 1.12em; color: var(--acc); }
    .md-preview p, .md-preview ul, .md-preview ol, .md-preview table, .md-preview blockquote { margin: .55em 0; }
    .md-preview ul, .md-preview ol { padding-left: 1.4em; }
    .md-preview a { color: var(--acc); }
    .md-preview code { font-family: var(--mono); font-size: .9em; background: hsl(var(--hue) 40% 40%/.18); padding: .1em .35em; border-radius: 4px; }
    .md-preview pre { background: hsl(var(--hue) 35% 4%/.6); border: 1px solid hsl(var(--hue) 40% 60%/.15); border-radius: 8px; padding: 10px 12px; overflow: auto; margin: .7em 0; }
    .md-preview pre code { background: none; padding: 0; font-size: 12px; line-height: 1.55; }
    .md-preview blockquote { border-left: 3px solid var(--acc); padding: .2em .9em; color: var(--ink-dim); background: hsl(var(--hue) 40% 40%/.08); border-radius: 0 6px 6px 0; }
    .md-preview table { border-collapse: collapse; width: 100%; font-size: .95em; }
    .md-preview th, .md-preview td { border: 1px solid hsl(var(--hue) 40% 60%/.2); padding: 5px 9px; text-align: left; }
    .md-preview th { background: hsl(var(--hue) 40% 40%/.15); }
    .md-preview img { max-width: 100%; border-radius: 8px; }
    .md-preview hr { border: 0; border-top: 1px solid hsl(var(--hue) 40% 60%/.25); margin: 1.2em 0; }
  `;
  document.head.appendChild(st);
}
