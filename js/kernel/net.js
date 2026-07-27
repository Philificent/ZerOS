/**
 * ZerOS kernel — network layer.
 *
 * A static page can't read cross-origin responses unless the server
 * opts in (CORS), so fetching "any URL" needs help. Strategy:
 *   1. try the URL directly (fast path — many APIs/feeds allow CORS)
 *   2. race several public CORS relays; first good body wins,
 *      instead of the old serial walk that could stall ~30s
 *   3. (callers may fall back to fetchReader — r.jina.ai renders the
 *      page server-side and returns markdown with open CORS)
 */

const RELAYS = [
  u => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
  u => 'https://corsproxy.io/?url=' + encodeURIComponent(u),
  u => 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u),
];

async function grab(u, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(u, { redirect: 'follow', signal: ctl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    return { text, contentType: res.headers.get('content-type') || '' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch a URL as text, direct first, then racing the CORS relays.
 * Returns { text, contentType, via }. Throws if every route fails.
 */
export async function fetchText(url, { directTimeout = 5000, relayTimeout = 12000 } = {}) {
  try {
    return { ...(await grab(url, directTimeout)), via: 'direct' };
  } catch { /* CORS wall or network — relay time */ }

  try {
    return await Promise.any(RELAYS.map(async make => {
      const relayed = make(url);
      const r = await grab(relayed, relayTimeout);
      if (!r.text.trim()) throw new Error('empty body');
      return { ...r, via: new URL(relayed).host };
    }));
  } catch {
    throw new Error(`unreachable — tried direct + ${RELAYS.length} CORS relays`);
  }
}

/** Server-side page → markdown (r.jina.ai, CORS-open). Slow but sturdy. */
export async function fetchReader(url) {
  const { text } = await grab('https://r.jina.ai/' + url, 25000);
  return text;
}
