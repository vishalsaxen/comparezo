// Backup "Find in stores" source: Google Shopping (India) through Bright Data's SERP API.
// Free plan: 5,000 requests a month. Each search is one request.
// Turned on by BRIGHTDATA_API_KEY and BRIGHTDATA_ZONE (the name of your SERP API zone).
//
// Bright Data returns Google's shopping list: title, price, store, and sometimes the store's own
// product link. There is no store lookup like SerpApi's, so a listing without a store link opens
// the store's own search for the product (stores in stores.js), and other stores are skipped.

const { checkVariant, parseQuery } = require('./variant');
const { storeSearchUrl } = require('./stores');
const { storeName, storeLink, sizeSuggestion } = require('./serpapi');

const API = 'https://api.brightdata.com/request';

// "₹77,599.00" -> 77599
function rupees(v) {
  if (typeof v === 'number') return v > 0 ? Math.round(v) : null;
  const m = String(v || '').replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  const n = m ? Number(m[0]) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}
const httpsImage = u => (typeof u === 'string' && /^https:\/\//.test(u) ? u : null);

function createBrightData({ apiKey = '', zone = '', fetch = globalThis.fetch, cacheHours = 6, timeoutMs = 25000, now = () => Date.now() } = {}) {
  const connected = Boolean(apiKey && zone);
  const cache = new Map();

  async function shopping(q) {
    const url = `https://www.google.com/search?${new URLSearchParams({ q, tbm: 'shop', gl: 'in', hl: 'en', brd_json: '1' })}`;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ zone, url, format: 'raw' }),
        signal: ctl.signal,
      });
      const text = await r.text();
      if (r.status === 401 || r.status === 403) throw new Error('Bright Data key or zone is not valid. Check BRIGHTDATA_API_KEY and BRIGHTDATA_ZONE.');
      if (r.status === 402 || r.status === 429) throw new Error('Bright Data requests for this month are used up.');
      if (!r.ok) throw new Error(`Bright Data answered ${r.status}${text ? `: ${text.slice(0, 120)}` : ''}`);
      try { return JSON.parse(text); } catch { throw new Error('Bright Data sent a page instead of JSON. In the zone settings, turn on parsed JSON results.'); }
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('Bright Data took too long to answer.');
      throw e;
    } finally { clearTimeout(t); }
  }

  async function findProducts(q, { limit = 20 } = {}) {
    if (!connected) return [];
    const key = q.trim().toLowerCase();
    const hit = cache.get(key);
    if (hit && now() - hit.at < cacheHours * 3600_000) return { ...hit.value, note: `${hit.value.note} Saved result, no search used.` };

    const query = parseQuery(q);
    const body = await shopping(q);
    const listings = (Array.isArray(body.shopping) ? body.shopping : [])
      .map(r => ({ ...r, amount: rupees(r.price) })).filter(r => r.title && r.amount);

    const kept = [], dropped = [];
    for (const r of listings) {
      const v = checkVariant(query, r.title);
      if (v.ok) kept.push(r); else dropped.push({ ...r, source: r.shop, reason: v.reason });
    }

    const out = [], seen = new Set(), noLink = [];
    let viaSearch = 0;
    const linked = new Set();
    const add = row => { if (!row.url || seen.has(row.url)) return false; seen.add(row.url); out.push(row); return true; };
    const sorted = [...kept].sort((a, b) => a.amount - b.amount);
    // Store links first, then the store's own search for the rest (cheapest listing per store).
    for (const r of sorted) {
      const url = storeLink(r.link);
      if (url && add({ store: storeName(r.shop), title: r.title, price: r.amount, mrp: rupees(r.old_price), url, image: httpsImage(r.image) })) linked.add(storeName(r.shop).toLowerCase());
    }
    for (const r of sorted) {
      if (storeLink(r.link)) continue;
      const store = storeName(r.shop);
      if (linked.has(store.toLowerCase())) continue;
      const url = storeSearchUrl(store, q);
      if (!url) { noLink.push({ store, title: r.title, price: r.amount }); continue; }
      if (add({ store, title: r.title, price: r.amount, mrp: rupees(r.old_price), url, image: httpsImage(r.image) })) viaSearch++;
    }

    const results = out.sort((a, b) => a.price - b.price).slice(0, limit);
    const parts = ['Used 1 Bright Data request.'];
    if (dropped.length) parts.push(`Left out ${dropped.length} other model${dropped.length === 1 ? '' : 's'}, sizes or accessories.`);
    if (viaSearch) parts.push(`${viaSearch} link${viaSearch === 1 ? '' : 's'} open${viaSearch === 1 ? 's' : ''} the store's search, because Google gave no product link.`);
    if (noLink.length) parts.push(`Skipped ${noLink.length} listing${noLink.length === 1 ? '' : 's'} from stores without a product link.`);
    const suggest = sizeSuggestion(q, query, dropped, results.length);
    if (suggest) parts.push(`Most listings are ${suggest.size.toUpperCase()}.`);
    const details = {
      found: listings.length,
      leftOut: dropped.slice(0, 40).map(r => ({ store: storeName(r.shop), title: r.title, price: r.amount, reason: r.reason })),
      noLink: noLink.slice(0, 40),
    };
    console.log(`Bright Data "${q}": ${listings.length} found, ${kept.length} kept, ${results.length} with links, ${noLink.length} without a link.`);
    const value = { results, note: parts.join(' '), details, ...(suggest ? { suggest: suggest.q } : {}) };
    cache.set(key, { at: now(), value });
    if (cache.size > 300) cache.delete(cache.keys().next().value);
    return value;
  }

  return { connected, findProducts };
}

// "Google Shopping" for Find in stores: the first connected provider that answers.
// If one fails (searches used up, key wrong, down), the next is tried, and the note says so.
function createShoppingSearch(providers) {
  const on = providers.filter(p => p.api && p.api.connected);
  async function findProducts(q, opts) {
    const failed = [];
    for (const p of on) {
      try {
        const r = await p.api.findProducts(q, opts);
        const res = Array.isArray(r) ? { results: r, note: '' } : r;
        const lead = on.length > 1 ? `Through ${p.name}${failed.length ? ` (${failed.join('; ')})` : ''}.` : '';
        return { ...res, note: [lead, res.note].filter(Boolean).join(' ') };
      } catch (e) {
        failed.push(`${p.name} failed: ${e.message}`);
      }
    }
    throw new Error(failed.join(' ') || 'No Google Shopping provider is connected.');
  }
  return { connected: on.length > 0, names: on.map(p => p.name), findProducts };
}

module.exports = { createBrightData, createShoppingSearch, rupees };
