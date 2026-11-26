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
// 4. Other exact matches that Google lists only with a Google link: for stores Comparezo knows
//    (Amazon.in, Flipkart, JioMart...) the listing links to that store's own search for the product.
// Each admin search costs 1 + SERPAPI_DETAIL_LOOKUPS SerpApi searches (free plan: 250 a month),
// and repeats within SERPAPI_CACHE_HOURS cost nothing.

const { checkVariant, parseQuery, norm, isSize } = require('./variant');
const { storeSearchUrl } = require('./stores');

const API = 'https://serpapi.com/search.json';
// Google's store names → the names Comparezo already uses.
const STORE_NAMES = { 'amazon': 'Amazon.in', 'amazon in': 'Amazon.in', 'amazon.in': 'Amazon.in', 'flipkart': 'Flipkart',
  'croma': 'Croma', 'reliance digital': 'Reliance Digital', 'vijay sales': 'Vijay Sales', 'jiomart': 'JioMart', 'jiomart electronic': 'JioMart', 'jiomart electronics': 'JioMart', 'jiomart digital': 'JioMart',
  'tata cliq': 'Tata CLiQ', 'tatacliq': 'Tata CLiQ', 'snapdeal': 'Snapdeal', 'myntra': 'Myntra', 'ajio': 'Ajio',
  'nykaa': 'Nykaa', 'meesho': 'Meesho', 'poorvika': 'Poorvika', 'sangeetha mobiles': 'Sangeetha Mobiles' };

function storeName(raw) {
  const s = String(raw || '').replace(/\s*-\s*(seller|sold by).*$/i, '').replace(/^emi\s+/i, '').replace(/\s+/g, ' ').trim();
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

// When a size finds little, the size most listings were left out for: "Most listings are 256GB".
// Sizes under 32GB are RAM, not storage, so they're ignored.
function sizeSuggestion(q, query, dropped, found) {
  if (found >= 5 || query.sizes.length !== 1) return null;
  const count = {};
  for (const r of dropped) {
    if (!/^different size/.test(r.reason || '')) continue;
    const sizes = [...new Set(norm(r.title).split(' ').filter(isSize))]
      .filter(t => /tb$/.test(t) || parseInt(t, 10) >= 32).filter(t => t !== query.sizes[0]);
    for (const t of sizes) count[t] = (count[t] || 0) + 1;
  }
  const [size, n] = Object.entries(count).sort((a, b) => b[1] - a[1])[0] || [];
  if (!size || n < 2) return null;
  const re = new RegExp(`${parseInt(query.sizes[0], 10)}\\s*${query.sizes[0].replace(/^\d+/, '')}`, 'i');
  return { size, q: q.replace(re, size.toUpperCase()) };
}

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
    for (const r of listings) {
      const v = checkVariant(query, r.title);
      if (v.ok) kept.push(r); else dropped.push({ ...r, reason: v.reason });
    }

    // 2. The best few exact matches: ask for every store that sells each of them.
    // Listings Google sells through several stores first: their lookup lists the most stores.
    kept.sort((a, b) => (b.multiple_sources === true) - (a.multiple_sources === true) || price(a) - price(b));
    const tokens = [...new Set(kept.map(r => r.immersive_product_page_token).filter(Boolean))].slice(0, Math.max(0, detailLookups));
    let used = 1;
    const details_ = await Promise.all(tokens.map(async token => {
      used++;
      try {
        const d = await get({ engine: 'google_immersive_product', page_token: token, more_stores: 'true' });
        return { token, product: d.product_results || {} };
      } catch { return { token, product: {} }; }   // one failed lookup shouldn't lose the others
    }));

    const out = [], seen = new Set();
    const add = (row) => { if (!row.url || seen.has(row.url)) return; seen.add(row.url); out.push(row); };
    for (const { token, product } of details_) {
      const base = kept.find(r => r.immersive_product_page_token === token) || {};
      const image = (product.thumbnails || [])[0] || base.thumbnail || null;
      for (const s of product.stores || []) {
        const title = s.title || product.title || base.title;
        if (!checkVariant(query, title).ok) continue;
        add({ store: storeName(s.name), title, price: price(s), mrp: s.extracted_original_price || null, url: storeLink(s.link), image });
      }
    }
    // Shopping results that already carry a store's own link.
    const direct = new Set(out.map(r => r.store.toLowerCase()));
    for (const r of kept) {
      const url = storeLink(r.link);
      if (url) { add({ store: storeName(r.source), title: r.title, price: price(r), mrp: r.extracted_old_price || null, url, image: r.thumbnail || null }); direct.add(storeName(r.source).toLowerCase()); }
    }
    // The rest only have Google's link: use the store's own search, cheapest listing per store.
    let viaSearch = 0, skipped = 0;
    const noLink = [];
    for (const r of [...kept].sort((a, b) => price(a) - price(b))) {
      if (storeLink(r.link)) continue;
      const store = storeName(r.source);
      if (direct.has(store.toLowerCase())) continue;
      const url = storeSearchUrl(store, q);
      if (!url) { skipped++; noLink.push({ store, title: r.title, price: price(r) }); continue; }
      if (!seen.has(url)) viaSearch++;
      add({ store, title: r.title, price: price(r), mrp: r.extracted_old_price || null, url, image: r.thumbnail || null });
    }

    const results = out.filter(r => r.price).sort((a, b) => a.price - b.price).slice(0, limit);
    const parts = [`Used ${used} SerpApi search${used === 1 ? '' : 'es'}.`];
    if (dropped.length) parts.push(`Left out ${dropped.length} other model${dropped.length === 1 ? '' : 's'}, sizes or accessories.`);
    if (viaSearch) parts.push(`${viaSearch} link${viaSearch === 1 ? '' : 's'} open${viaSearch === 1 ? 's' : ''} the store's search, because Google gave no product link.`);
    if (skipped) parts.push(`Skipped ${skipped} listing${skipped === 1 ? '' : 's'} from stores without a product link.`);
    // What Google returned and what happened to it, so the owner can see why a store is missing.
    const details = {
      found: listings.length,
      lookups: details_.map(d => ({ stores: (d.product.stores || []).length })),
      leftOut: dropped.slice(0, 40).map(r => ({ store: storeName(r.source), title: r.title, price: price(r), reason: r.reason })),
      noLink: noLink.slice(0, 40),
    };
    console.log(`Google Shopping "${q}": ${listings.length} found, ${kept.length} kept, ${results.length} with links, lookups ${JSON.stringify(details.lookups)}, left out: ${dropped.map(r => `${storeName(r.source)}|${r.title}|${r.reason}`).join(' ;; ').slice(0, 3000)}, no link: ${noLink.map(r => `${r.store}|${r.title}`).join(' ;; ').slice(0, 1500)}`);
    const suggest = sizeSuggestion(q, query, dropped, results.length);
    if (suggest) parts.push(`Most listings are ${suggest.size.toUpperCase()}.`);
    const value = { results, note: parts.join(' '), details, ...(suggest ? { suggest: suggest.q } : {}) };
    cache.set(key, { at: now(), value });
    if (cache.size > 300) cache.delete(cache.keys().next().value);
    return value;
  }

  return { connected, findProducts };
}

module.exports = { createSerpApi, storeName, storeLink };
