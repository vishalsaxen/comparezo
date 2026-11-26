// "Find in stores" source: QuickCommerce API (quickcommerceapi.com).
// Live prices from quick-commerce apps (Blinkit, Zepto, Swiggy Instamart, BigBasket...) and
// other Indian stores, for one location. Each search asks several apps at once (/v1/groupsearch)
// and costs 1 credit per app that answers. Failed apps and errors cost nothing.
//
// Settings:
//   QCOM_API_KEY    the key from quickcommerceapi.com/dashboard (turns this on)
//   QCOM_PLATFORMS  apps to search, comma-separated, as the API spells them
//                   (default BlinkIt,Zepto,Swiggy,BigBasket: 4 credits a search)
//   QCOM_LAT, QCOM_LON  the location prices are for (default: Bengaluru)
//   QCOM_PINCODE    needed only for DMart, JioMart and Minutes

const { checkVariant, parseQuery } = require('./variant');
const { sizeSuggestion, storeLink } = require('./serpapi');

const API = 'https://api.quickcommerceapi.com/v1/groupsearch';
// The API's platform names → the store names shoppers know.
const NAMES = { BlinkIt: 'Blinkit', Zepto: 'Zepto', Swiggy: 'Swiggy Instamart', BigBasket: 'BigBasket', DMart: 'DMart',
  JioMart: 'JioMart', Minutes: 'Flipkart Minutes', Amazon: 'Amazon.in', Nykaa: 'Nykaa', Myntra: 'Myntra',
  Flipkart: 'Flipkart', Meesho: 'Meesho', Ajio: 'Ajio', MyntraNow: 'Myntra Now', Tira: 'Tira', FirstCry: 'FirstCry' };
const NEEDS_PINCODE = ['DMart', 'JioMart', 'Minutes'];

const num = v => { const n = Number(String(v ?? '').replace(/[^\d.]/g, '')); return Number.isFinite(n) && n > 0 ? Math.round(n) : null; };

// The products for one app, whichever shape the grouped answer uses.
function productsOf(v) {
  if (Array.isArray(v)) return v;
  if (!v || typeof v !== 'object') return [];
  return v.products || (v.data && v.data.products) || [];
}

function createQuickCommerce({ apiKey = '', platforms = ['BlinkIt', 'Zepto', 'Swiggy', 'BigBasket'], lat = 12.9716, lon = 77.5946, pincode = '',
  fetch = globalThis.fetch, cacheHours = 6, timeoutMs = 25000, now = () => Date.now() } = {}) {
  // DMart, JioMart and Minutes only work with a pincode.
  const apps = platforms.filter(p => pincode || !NEEDS_PINCODE.includes(p));
  const connected = Boolean(apiKey && apps.length);
  const cache = new Map();

  async function findProducts(q, { limit = 20 } = {}) {
    if (!connected) return [];
    const key = q.trim().toLowerCase();
    const hit = cache.get(key);
    if (hit && now() - hit.at < cacheHours * 3600_000) return { ...hit.value, note: `${hit.value.note} Saved result, no credits used.` };

    const params = new URLSearchParams({ q, lat: String(lat), lon: String(lon), platforms: apps.join(',') });
    if (pincode) params.set('pincode', pincode);
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    let body;
    try {
      const r = await fetch(`${API}?${params}`, { headers: { 'X-API-Key': apiKey }, signal: ctl.signal });
      body = await r.json().catch(() => ({}));
      if (r.status === 401) throw new Error('QuickCommerce API key is not valid. Check QCOM_API_KEY.');
      if (r.status === 402) throw new Error('QuickCommerce API credits are used up. Top up at quickcommerceapi.com/dashboard.');
      if (r.status === 429) throw new Error('QuickCommerce API is busy (too many searches a minute). Try again shortly.');
      if (!r.ok || body.status === 'error') throw new Error(`QuickCommerce API: ${body.message || body.error || `answered ${r.status}`}`);
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('QuickCommerce API took too long to answer.');
      throw e;
    } finally { clearTimeout(t); }

    const data = body.data || {};
    const grouped = data.results || {};
    const failed = (data.failed_platforms || []).map(p => NAMES[typeof p === 'string' ? p : p.platform || p.name] || p).filter(x => typeof x === 'string');
    const query = parseQuery(q);
    const listings = [];
    for (const [platform, value] of Object.entries(grouped)) {
      for (const p of productsOf(value)) {
        const name = String(p.name || '').trim();
        const size = String(p.quantity || '').trim();
        // "Tata Tea Gold" + "1 kg" → "Tata Tea Gold 1 kg", so sizes can be checked.
        const title = size && !name.toLowerCase().replace(/\s/g, '').includes(size.toLowerCase().replace(/\s/g, '')) ? `${name} ${size}` : name;
        const platformName = (p.platform && p.platform.name) || platform;
        listings.push({ store: NAMES[platformName] || platformName, title, price: num(p.offer_price ?? p.price), mrp: num(p.mrp),
          url: storeLink(p.deeplink || p.url), image: (Array.isArray(p.images) ? p.images[0] : p.image) || null,
          available: p.available !== false, eta: p.platform && p.platform.sla });
      }
    }

    const kept = [], dropped = [];
    let outOfStock = 0;
    for (const l of listings) {
      if (!l.title || !l.price || !l.url) continue;
      if (!l.available) { outOfStock++; continue; }
      const v = checkVariant(query, l.title);
      if (v.ok) kept.push(l); else dropped.push({ ...l, reason: v.reason });
    }
    const results = kept.sort((a, b) => a.price - b.price).slice(0, limit)
      .map(({ store, title, price, mrp, url, image }) => ({ store, title, price, mrp: mrp && mrp > price ? mrp : null, url, image: image && /^https:\/\//.test(image) ? image : null }));

    const answered = Object.keys(grouped).length;
    const parts = [`Used ${answered} credit${answered === 1 ? '' : 's'}${body.credits_remaining != null ? `, ${body.credits_remaining} left` : ''}.`];
    if (dropped.length) parts.push(`Left out ${dropped.length} other model${dropped.length === 1 ? '' : 's'}, sizes or products.`);
    if (outOfStock) parts.push(`${outOfStock} out of stock.`);
    if (failed.length) parts.push(`No answer from ${failed.join(', ')}.`);
    const suggest = sizeSuggestion(q, query, dropped, results.length);
    if (suggest) parts.push(`Most listings are ${suggest.size.toUpperCase()}.`);
    console.log(`QuickCommerce "${q}": ${listings.length} found on ${answered} apps, ${kept.length} kept, ${outOfStock} out of stock${failed.length ? `, failed: ${failed.join(', ')}` : ''}.`);
    const value = { results, note: parts.join(' '),
      details: { found: listings.length, leftOut: dropped.slice(0, 40).map(({ store, title, price, reason }) => ({ store, title, price, reason })), noLink: [] },
      ...(suggest ? { suggest: suggest.q } : {}) };
    cache.set(key, { at: now(), value });
    if (cache.size > 300) cache.delete(cache.keys().next().value);
    return value;
  }

  return { connected, platforms: apps, findProducts };
}

module.exports = { createQuickCommerce, NAMES };
