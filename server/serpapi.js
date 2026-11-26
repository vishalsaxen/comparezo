// "Find in stores" source: Google Shopping (India) through SerpApi (serpapi.com).
// One search returns listings from many Indian stores at once (Amazon.in, Flipkart, Croma,
// Reliance Digital, Vijay Sales, JioMart...). SerpApi reads Google's results; it doesn't read
// the store websites themselves.
//
// Steps for a search such as "Google Pixel 11 128GB":
// 1. google_shopping: Google Shopping results for India.
// 2. Keep only the exact product (variant.js): no Pro/11a/XL, no other storage, no cases or renewed.
// 3. google_immersive_product for the best few of those: every store selling it, each with its
//    price and its own product link, so Buy goes straight to the store (and earns commission).
// Each admin search costs 1 + SERPAPI_DETAIL_LOOKUPS SerpApi searches (free plan: 250 a month),
// and repeats within SERPAPI_CACHE_HOURS cost nothing.

const { checkVariant, parseQuery } = require('./variant');

const API = 'https://serpapi.com/search.json';
// Google's store names → the names Comparezo already uses.
const STORE_NAMES = { 'amazon': 'Amazon.in', 'amazon in': 'Amazon.in', 'amazon.in': 'Amazon.in', 'flipkart': 'Flipkart',
  'croma': 'Croma', 'reliance digital': 'Reliance Digital', 'vijay sales': 'Vijay Sales', 'jiomart': 'JioMart',
  'tata cliq': 'Tata CLiQ', 'tatacliq': 'Tata CLiQ', 'snapdeal': 'Snapdeal', 'myntra': 'Myntra', 'ajio': 'Ajio',
  'nykaa': 'Nykaa', 'meesho': 'Meesho', 'poorvika': 'Poorvika', 'sangeetha mobiles': 'Sangeetha Mobiles' };

function storeName(raw) {
  const s = String(raw || '').replace(/\s*-\s*(seller|sold by).*$/i, '').replace(/\s+/g, ' ').trim();
  return STORE_NAMES[s.toLowerCase()] || STORE_NAMES[s.toLowerCase().replace(/\.(in|com)$/, '')] || s || 'Store';
}

// A store's own product link, without Google's tracking bits. Google links are not store links.
function storeLink(u) {
  try {
    const x = new URL(u);
    if (x.protocol !== 'https:' && x.protocol !== 'http:') return null;
    if (/(^|\.)google\.[a-z.]+$/.test(x.hostname) || /(^|\.)serpapi\.com$/.test(x.hostname)) return null;
    ['srsltid', 'utm_source', 'utm_medium', 'utm_campaign', 'gclid'].forEach(k => x.searchParams.delete(k));
    x.protocol = 'https:';
    return x.toString();
  } catch { return null; }
}

const price = r => (typeof r.extracted_price === 'number' && r.extracted_price > 0 ? r.extracted_price : null);

function createSerpApi({ apiKey = '', fetch = globalThis.fetch, detailLookups = 2, cacheHours = 6, timeoutMs = 20000, now = () => Date.now() } = {}) {
  const connected = Boolean(apiKey);
  const cache = new Map();

  async function get(params) {
    const qs = new URLSearchParams({ gl: 'in', hl: 'en', google_domain: 'google.co.in', ...params, api_key: apiKey });
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(`${API}?${qs}`, { signal: ctl.signal });
      const body = await r.json().catch(() => ({}));
      if (r.status === 401 || /invalid api key/i.test(body.error || '')) throw new Error('SerpApi key is not valid. Check SERPAPI_KEY.');
      if (r.status === 429 || /run out of searches|plan.*limit/i.test(body.error || '')) throw new Error('SerpApi searches for this month are used up.');
      // "Google hasn't returned any results" is an empty answer, not a failure.
      if (body.error && !/hasn't returned any results/i.test(body.error)) throw new Error(`SerpApi: ${body.error}`);
      if (!r.ok && !body.error) throw new Error(`SerpApi answered ${r.status}`);
      return body;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('SerpApi took too long to answer.');
      throw e;
    } finally { clearTimeout(t); }
  }

  async function findProducts(q, { limit = 20 } = {}) {
    if (!connected) return [];
    const key = q.trim().toLowerCase();
    const hit = cache.get(key);
    if (hit && now() - hit.at < cacheHours * 3600_000) return { ...hit.value, note: `${hit.value.note} Saved result, no search used.` };

    const query = parseQuery(q);
    const body = await get({ engine: 'google_shopping', q, location: 'India' });
    const listings = [
      ...(body.shopping_results || []),
      ...(body.inline_shopping_results || []),
      ...(body.categorized_shopping_results || []).flatMap(c => c.shopping_results || []),
    ].filter(r => r && r.title && price(r));

    const kept = [], dropped = [];
    for (const r of listings) (checkVariant(query, r.title).ok ? kept : dropped).push(r);

    // 2. The best few exact matches: ask for every store that sells each of them.
    const tokens = [...new Set(kept.map(r => r.immersive_product_page_token).filter(Boolean))].slice(0, Math.max(0, detailLookups));
    let used = 1;
    const details = await Promise.all(tokens.map(async token => {
      used++;
      try {
        const d = await get({ engine: 'google_immersive_product', page_token: token, more_stores: 'true' });
        return { token, product: d.product_results || {} };
      } catch { return { token, product: {} }; }   // one failed lookup shouldn't lose the others
    }));

    const out = [], seen = new Set();
    const add = (row) => { if (!row.url || seen.has(row.url)) return; seen.add(row.url); out.push(row); };
    for (const { token, product } of details) {
      const base = kept.find(r => r.immersive_product_page_token === token) || {};
      const image = (product.thumbnails || [])[0] || base.thumbnail || null;
      for (const s of product.stores || []) {
        const title = s.title || product.title || base.title;
        if (!checkVariant(query, title).ok) continue;
        add({ store: storeName(s.name), title, price: price(s), mrp: s.extracted_original_price || null, url: storeLink(s.link), image });
      }
    }
    // Shopping results that already carry a store's own link.
    for (const r of kept) add({ store: storeName(r.source), title: r.title, price: price(r), mrp: r.extracted_old_price || null, url: storeLink(r.link), image: r.thumbnail || null });

    const withoutLink = kept.filter(r => !storeLink(r.link)).length;
    const results = out.filter(r => r.price).sort((a, b) => a.price - b.price).slice(0, limit);
    const parts = [`Used ${used} SerpApi search${used === 1 ? '' : 'es'}.`];
    if (dropped.length) parts.push(`Left out ${dropped.length} other model${dropped.length === 1 ? '' : 's'}, sizes or accessories.`);
    if (!results.length && withoutLink) parts.push('Google listed this product only with links to Google, not to the stores.');
    const value = { results, note: parts.join(' ') };
    cache.set(key, { at: now(), value });
    if (cache.size > 300) cache.delete(cache.keys().next().value);
    return value;
  }

  return { connected, findProducts };
}

module.exports = { createSerpApi, storeName, storeLink };
