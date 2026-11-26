// Seller Catalog: products from Vishal's GiaZoNest shop (github.com/vishalsaxen/giazonest).
//
// GiaZoNest keeps its products in its own Firebase project ("giazonest"), collection `products`.
// Its security rules let anyone read a product once it is `live` (approved, and its seller's KYC
// is verified); that is how shop.html shows products to guests. Comparezo reads those through the
// public Firestore REST API, the same way, and never writes anything to GiaZoNest.
//
//   products        where live == true   -> name, category, subCategory, type, price, discount, stock, sold, thumb…
//   sellerListings  (public, no contacts) -> the seller's city and state
//
// The list is cached for 30 minutes. Photos: GiaZoNest publishes each live product's cover photo at
// <site>/img/<code>.jpg (scripts/export-photos.mjs there); the small `thumb` saved on the product
// is served from /api/seller-catalog/thumb/<id> as a fallback for products not published yet.
const DEFAULT_SITE = 'https://vishalsaxen.github.io/giazonest/';
const TTL_MS = 30 * 60 * 1000;

// GiaZoNest's short product code (public/share-link.js there): cyrb53 written as 8 base-62 characters.
// A product's link is shop.html?d=<code>.
const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
function shortCode(id) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < id.length; i++) { const c = id.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  let n = 4294967296 * (2097151 & h2) + (h1 >>> 0), out = '';
  for (let i = 0; i < 8; i++) { out = B62[n % 62] + out; n = Math.floor(n / 62); }
  return out;
}

// Firestore REST values -> plain values.
function plain(v) {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, plain(x)]));
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(plain);
  return null;
}
const fieldsOf = doc => Object.fromEntries(Object.entries((doc && doc.fields) || {}).map(([k, v]) => [k, plain(v)]));
const idOf = doc => String(doc.name || '').split('/').pop();
const str = (v, n) => String(v ?? '').trim().slice(0, n);
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);

// One GiaZoNest product as Comparezo shows it. Shown price = price − discount, like the GiaZoNest shop.
function toItem(id, f, seller, site) {
  const price = Math.max(0, num(f.price)), discount = Math.min(price, Math.max(0, num(f.discount)));
  const code = shortCode(id);
  const details = f.details && typeof f.details === 'object' ? Object.fromEntries(Object.entries(f.details).filter(([, v]) => v != null && String(v).trim()).map(([k, v]) => [k, str(v, 120)])) : {};
  return {
    id, code,
    name: str(f.name, 200),
    category: str(f.category, 80) || null,
    subCategory: str(f.subCategory, 80) || null,
    type: str(f.type, 80) || null,
    price, discount, sellingPrice: Math.round((price - discount) * 100) / 100,
    stock: Math.max(0, Math.floor(num(f.stock))),
    sold: Math.max(0, Math.floor(num(f.sold))),
    description: str(f.description, 500),
    details,
    seller: str(f.sellerName, 120) || (seller && str(seller.name, 120)) || 'GiaZoNest seller',
    sellerId: str(f.sellerId, 80),
    city: seller ? str(seller.city, 60) : '',
    state: seller ? str(seller.state, 60) : '',
    image: new URL(`img/${code}.jpg`, site).href,
    hasThumb: typeof f.thumb === 'string' && f.thumb.startsWith('data:image/'),
    url: new URL(`shop.html?d=${code}`, site).href,
    updatedAt: f.updatedAt || f.createdAt || null,
  };
}

function createGiaZoNest({ projectId = 'giazonest', site = DEFAULT_SITE, apiKey = '', fetch = globalThis.fetch, now = () => Date.now(), ttlMs = TTL_MS } = {}) {
  const base = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents`;
  const withKey = u => (apiKey ? `${u}${u.includes('?') ? '&' : '?'}key=${encodeURIComponent(apiKey)}` : u);
  let cache = null;   // { at, items, thumbs: Map(id -> data URI), error }
  let running = null;

  async function json(url, opts) {
    const r = await fetch(withKey(url), opts);
    const body = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`GiaZoNest ${r.status}: ${(body && body.error && body.error.message) || 'request failed'}`);
    return body;
  }
  async function liveProducts() {
    const body = await json(`${base}:runQuery`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'products' }], where: { fieldFilter: { field: { fieldPath: 'live' }, op: 'EQUAL', value: { booleanValue: true } } }, limit: 1000 } }) });
    return (Array.isArray(body) ? body : []).filter(x => x && x.document).map(x => x.document);
  }
  async function sellers() {
    const out = new Map();
    let token = '';
    for (let i = 0; i < 20; i++) {
      const body = await json(`${base}/sellerListings?pageSize=300${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`);
      for (const d of (body && body.documents) || []) out.set(idOf(d), fieldsOf(d));
      token = body && body.nextPageToken;
      if (!token) break;
    }
    return out;
  }

  async function load() {
    // The seller list only adds the city, so the products still show if it can't be read.
    const [docs, who] = await Promise.all([liveProducts(), sellers().catch(() => new Map())]);
    const thumbs = new Map();
    const items = docs.map(d => {
      const id = idOf(d), f = fieldsOf(d);
      if (f.live !== true) return null;   // belt and braces: the query already asks for live only
      if (typeof f.thumb === 'string' && f.thumb.startsWith('data:image/')) thumbs.set(id, f.thumb);
      return toItem(id, f, who.get(String(f.sellerId || '')), site);
    }).filter(x => x && x.name);
    items.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) || a.name.localeCompare(b.name));
    return { items, thumbs };
  }

  // { connected, items, syncedAt, error }. Keeps the last good list if GiaZoNest can't be reached.
  async function list({ refresh = false } = {}) {
    if (!refresh && cache && now() - cache.at < ttlMs) return view();
    if (!running) running = (async () => {
      try { cache = { at: now(), ...(await load()), error: null }; }
      catch (e) { cache = { at: now() - ttlMs + 5 * 60 * 1000, items: cache ? cache.items : [], thumbs: cache ? cache.thumbs : new Map(), syncedAt: cache && cache.syncedAt, error: e.message }; }
      if (!cache.error) cache.syncedAt = new Date(cache.at).toISOString();
    })().finally(() => { running = null; });
    await running;
    return view();
  }
  const view = () => ({ connected: true, source: 'GiaZoNest', site, items: cache.items, syncedAt: cache.syncedAt || null, error: cache.error || null });

  // The small cover photo saved on the product, as { type, data } bytes, or null.
  function thumb(id) {
    const uri = cache && cache.thumbs.get(String(id));
    const m = uri && uri.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
    return m ? { type: m[1], data: Buffer.from(m[2], 'base64') } : null;
  }

  return { list, thumb, site };
}

module.exports = { createGiaZoNest, shortCode, toItem, plain };
