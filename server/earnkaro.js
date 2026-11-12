// EarnKaro turns ordinary store links (Flipkart, Myntra, Ajio, Amazon…) into commission-earning
// links. Turns on when EARNKARO_API_KEY is set; the key stays on the server.
// API: POST https://ekaro-api.affiliaters.in/api/converter/public
//      Authorization: Bearer <key>, body {"deal": "<text with links>", "convert_option": "convert_only"}
// EarnKaro doesn't document its reply in detail, so we take the first https link in it that
// differs from the one we sent. Converted links are remembered, so each one is converted once.
const ENDPOINT = 'https://ekaro-api.affiliaters.in/api/converter/public';

function firstNewLink(body, original) {
  const strings = [];
  (function walk(v) {
    if (typeof v === 'string') strings.push(v);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  })(body);
  const text = strings.join(' ').replace(/\\\//g, '/');
  const links = text.match(/https:\/\/[^\s"'<>\\]+/g) || [];
  return links.find(l => l !== original && !l.startsWith(ENDPOINT)) || null;
}

function createEarnKaro({ apiKey = '', fetch = globalThis.fetch, timeoutMs = 5000 } = {}) {
  const cache = new Map();   // store URL -> EarnKaro link

  async function convert(url) {
    if (!apiKey || !/^https:\/\//.test(url || '')) return url;
    if (cache.has(url)) return cache.get(url);
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(ENDPOINT, {
        method: 'POST', signal: ctl.signal,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ deal: url, convert_option: 'convert_only' }),
      });
      const body = await r.json().catch(() => null);
      const link = r.ok ? firstNewLink(body, url) : null;
      if (link) { cache.set(url, link); return link; }
      return url;   // store not supported, or EarnKaro is down: send the shopper to the store anyway
    } catch { return url; } finally { clearTimeout(t); }
  }

  return { convert, connected: !!apiKey };
}

module.exports = { createEarnKaro, firstNewLink };
