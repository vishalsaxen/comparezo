// "Find in stores" on /products.html: the owner types a product name and gets listings from
// every store Comparezo is connected to, each with its title, price, link and photo link.
// Only official partner APIs and product feeds are used (Amazon Creators API, Flipkart Affiliate
// API, Admitad product feeds). Nothing reads store web pages.
// A source is { name, find(q, { limit, matches }) } returning
// [{ store, title, price, mrp, url, image }]. A slow or broken source never holds back the others.

const STOP = new Set(['the', 'and', 'with', 'for', 'of', 'in', 'a', 'an', 'to', 'by', 'on']);
function words(s) {
  return [...new Set(String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/).filter(w => w && !STOP.has(w) && (w.length > 1 || /\d/.test(w))))];
}
// Share of the search words found in a title, 0..1. "141" matches "141", "earbud" matches "earbuds".
function score(query, title) {
  const q = words(query);
  if (!q.length) return 0;
  const t = words(title);
  const hit = q.filter(w => t.some(x => x === w || (w.length >= 3 && x.startsWith(w)))).length;
  return hit / q.length;
}
const MIN_SCORE = 0.5;

const httpsUrl = u => {
  if (typeof u !== 'string' || !u.trim()) return null;
  u = u.trim();
  if (u.startsWith('//')) u = 'https:' + u;
  if (u.startsWith('http://')) u = 'https://' + u.slice(7);
  return /^https:\/\/\S+$/.test(u) ? u : null;
};
const num = v => { const n = Number(String(v ?? '').replace(/[^\d.]/g, '')); return Number.isFinite(n) && n > 0 ? Math.round(n) : null; };

function withTimeout(promise, ms, name) {
  let t;
  return Promise.race([promise, new Promise((_, reject) => { t = setTimeout(() => reject(new Error(`${name} took too long to answer.`)), ms); })])
    .finally(() => clearTimeout(t));
}

function createStoreSearch(db, { sources = [], notConnected = {}, timeoutMs = 15000, perSource = 20 } = {}) {
  // Products already on Comparezo with a similar name, so the owner doesn't add one twice.
  function onSite(q) {
    const rows = db.prepare(`SELECT p.id, p.name, COUNT(o.id) AS storeCount, MIN(o.price) AS lowest
      FROM products p LEFT JOIN offers o ON o.product_id = p.id GROUP BY p.id`).all();
    return rows.map(p => ({ ...p, s: score(q, p.name) })).filter(p => p.s >= 0.75)
      .sort((a, b) => b.s - a.s).slice(0, 5).map(({ s, ...p }) => p);
  }

  async function search(query) {
    const q = String(query || '').trim().slice(0, 120);
    if (words(q).length === 0) return { q, error: 'Type a product name to search for.', results: [], sources: [], onSite: [] };
    const matches = title => score(q, title) >= MIN_SCORE;
    const statuses = [], all = [];
    await Promise.all(sources.map(async src => {
      try {
        const got = await withTimeout(Promise.resolve(src.find(q, { limit: perSource, matches })), timeoutMs, src.name);
        const list = (Array.isArray(got) ? got : []).slice(0, perSource);
        all.push(...list.map(r => ({ ...r, source: src.name })));
        statuses.push({ name: src.name, ok: true, count: list.length });
      } catch (e) {
        statuses.push({ name: src.name, ok: false, error: String(e && e.message || e).slice(0, 300) });
      }
    }));
    const seen = new Set();
    const results = [];
    for (const r of all) {
      const url = httpsUrl(r.url), price = num(r.price), title = String(r.title || '').replace(/\s+/g, ' ').trim().slice(0, 300);
      if (!url || !price || !title || seen.has(url)) continue;
      const s = score(q, title);
      if (s < MIN_SCORE) continue;
      seen.add(url);
      const mrp = num(r.mrp);
      results.push({
        id: results.length + 1,
        store: String(r.store || '').trim().slice(0, 40) || 'Store',
        title, price, mrp: mrp && mrp > price ? mrp : null,
        url, image: httpsUrl(r.image),
        source: r.source, match: s === 1 ? 'exact' : 'close',
      });
    }
    results.sort((a, b) => (a.match === b.match ? a.price - b.price : a.match === 'exact' ? -1 : 1));
    results.forEach((r, i) => { r.id = i + 1; });
    statuses.sort((a, b) => a.name.localeCompare(b.name));
    return { q, results, sources: statuses, notConnected, onSite: onSite(q) };
  }

  return { search, connected: sources.map(s => s.name) };
}

module.exports = { createStoreSearch, score, words };
