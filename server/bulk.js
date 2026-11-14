// Adds many products at once from a spreadsheet the owner uploads on /products.html.
// The page reads the sheet and sends its rows as JSON; each row is one store link for a product:
//   { row, name, image, url, price, mrp, deliveryFee, store, category, subCategory, type, spec }
// Rows with the same product name become one product with several stores, so shoppers can compare.
// A row whose product is already on the site adds its store to that product (unless the link is there).
const { addProduct, cleanOffers, insertOffers } = require('./catalog');
const cats = require('./categories');

const MAX_ROWS = 500;
const STORE_HOSTS = {
  'amazon.in': 'Amazon.in', 'amzn.in': 'Amazon.in', 'amzn.to': 'Amazon.in', 'flipkart.com': 'Flipkart', 'fkrt.it': 'Flipkart',
  'myntra.com': 'Myntra', 'meesho.com': 'Meesho', 'ajio.com': 'Ajio', 'nykaa.com': 'Nykaa', 'nykaafashion.com': 'Nykaa Fashion',
  'jiomart.com': 'JioMart', 'tatacliq.com': 'Tata CLiQ', 'croma.com': 'Croma', 'reliancedigital.in': 'Reliance Digital',
  'bigbasket.com': 'BigBasket', 'snapdeal.com': 'Snapdeal', 'firstcry.com': 'FirstCry', 'pepperfry.com': 'Pepperfry',
  'shopsy.in': 'Shopsy', 'mamaearth.in': 'Mamaearth', 'boat-lifestyle.com': 'boAt', 'lenskart.com': 'Lenskart',
};

// Store name from a product link: a known store, else the site's own name (www.example.co.in -> Example).
function storeFromUrl(url) {
  let host = '';
  try { host = new URL(url).hostname.toLowerCase().replace(/^www\.|^m\./, ''); } catch { return ''; }
  const hit = Object.keys(STORE_HOSTS).find(d => host === d || host.endsWith('.' + d));
  if (hit) return STORE_HOSTS[hit];
  const label = host.split('.').filter(p => !['com', 'in', 'co', 'net', 'org', 'shop', 'store'].includes(p)).pop() || host;
  return label ? label[0].toUpperCase() + label.slice(1) : '';
}

// "₹1,299.00" or "Rs. 1299" -> 1299
const money = v => {
  if (typeof v === 'number') return v;
  const n = Number(String(v ?? '').replace(/rs\.?|inr|₹|,|\s/gi, ''));
  return Number.isFinite(n) && String(v ?? '').trim() !== '' ? n : NaN;
};
const text = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const httpsLink = v => { const s = String(v ?? '').trim(); return s.startsWith('http://') ? 'https://' + s.slice(7) : s; };

// Category names in the sheet don't need the exact capitals: "electronics" finds "Electronics".
function matchCategory(tree, category, subCategory, type) {
  const find = (list, name) => (list || []).find(x => x.name.toLowerCase() === String(name || '').trim().toLowerCase());
  const top = find(tree, category);
  const sub = top && find(top.subcategories, subCategory);
  const t = sub && find(sub.types, type);
  return {
    category: top ? top.name : text(category, 80),
    subCategory: sub ? sub.name : text(subCategory, 80),
    type: t ? t.name : text(type, 80),
  };
}

function importRows(db, rows, defaults = {}) {
  if (!Array.isArray(rows) || !rows.length) return { error: 'The sheet has no product rows.' };
  if (rows.length > MAX_ROWS) return { error: `Upload at most ${MAX_ROWS} rows at a time. This sheet has ${rows.length}.` };
  const tree = cats.categoryTree(db);
  const problems = [];
  const groups = new Map();   // lower-case name -> { name, rows: [] }
  rows.forEach((r, i) => {
    const rowNo = Number(r && r.row) || i + 2;
    const name = text(r && r.name, 200);
    if (!name) { if (r && (r.url || r.price)) problems.push({ row: rowNo, error: 'No product name.' }); return; }
    const k = name.toLowerCase();
    if (!groups.has(k)) groups.set(k, { name, rows: [] });
    groups.get(k).rows.push({ ...r, row: rowNo });
  });

  const existing = db.prepare('SELECT * FROM products WHERE lower(name) = ? ORDER BY id LIMIT 1');
  const existingUrls = db.prepare('SELECT url FROM offers WHERE product_id = ?');
  const setImage = db.prepare("UPDATE products SET image = ? WHERE id = ? AND (image IS NULL OR image = '')");
  let added = 0, updated = 0, stores = 0, skipped = 0;

  for (const [k, g] of groups) {
    const offers = [];
    for (const r of g.rows) {
      const url = httpsLink(r.url);
      offers.push({ row: r.row, store: text(r.store, 40) || storeFromUrl(url), price: money(r.price), mrp: money(r.mrp) || null, deliveryFee: money(r.deliveryFee) || 0, url });
    }
    // Check each row on its own, so one bad row doesn't hold back the others.
    const good = offers.filter(o => {
      const { errors } = cleanOffers([o]);
      if (errors.length) problems.push({ row: o.row, name: g.name, error: errors.map(e => e.replace(/^Store 1: /, '')).join(' ') });
      return !errors.length;
    });
    if (!good.length) continue;
    const first = g.rows.find(r => text(r.image, 2000)) || g.rows[0];
    const image = httpsLink(first.image);
    const catRow = g.rows.find(r => text(r.category, 80));
    const path = catRow ? matchCategory(tree, catRow.category, catRow.subCategory, catRow.type)
      : matchCategory(tree, defaults.category, defaults.subCategory, defaults.type);

    const p = existing.get(k);
    if (p) {
      const have = new Set(existingUrls.all(p.id).map(o => o.url));
      const fresh = cleanOffers(good.filter(o => !have.has(o.url) && have.add(o.url))).offers;
      skipped += good.length - fresh.length;
      if (!fresh.length) continue;
      insertOffers(db, p.id, fresh);
      if (/^https:\/\/\S+$/.test(image)) setImage.run(image, p.id);
      updated++; stores += fresh.length;
      continue;
    }
    // A product can list up to 12 stores; the same link twice counts once.
    const seen = new Set();
    const unique = good.filter(o => !seen.has(o.url) && seen.add(o.url)).slice(0, 12);
    skipped += good.length - unique.length;
    const r = addProduct(db, { name: g.name, image, spec: first.spec, ...path, offers: unique }, 'manual');
    if (r.errors) { problems.push({ row: g.rows[0].row, name: g.name, error: r.errors.join(' ') }); continue; }
    added++; stores += unique.length;
  }
  problems.sort((a, b) => a.row - b.row);
  return { added, updated, stores, skipped, problems };
}

// End dates as people type them in Excel: 2026-12-31, 31/12/2026, 31-12-26, or Excel's own day
// number (days since 1899-12-30) when the cell is formatted as a date. Returns YYYY-MM-DD, '' or null if unreadable.
function dateOf(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  let y, m, d, t;
  if ((t = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/))) [, y, m, d] = t;
  else if ((t = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/))) { [, d, m, y] = t; if (y.length === 2) y = '20' + y; }
  else if (/^\d{5}(\.\d+)?$/.test(s)) return new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 864e5).toISOString().slice(0, 10);
  else return null;
  const date = new Date(Date.UTC(+y, +m - 1, +d));
  if (date.getUTCMonth() !== +m - 1 || date.getUTCDate() !== +d) return null;
  return date.toISOString().slice(0, 10);
}

// Checks one deal (from the Add deal form or a sheet row). Returns { deal } or { errors }.
function checkDeal(b = {}) {
  const str = (v, n) => String(v ?? '').trim().slice(0, n);
  const title = str(b.title, 160), url = str(b.url, 2000), image = str(b.image, 2000);
  const endsAt = dateOf(b.endsAt);
  const errors = [];
  if (!title) errors.push('Give the deal a title.');
  if (!/^https:\/\/\S+$/.test(url)) errors.push('Paste the deal link, starting with https://.');
  if (image && !/^https:\/\/\S+$/.test(image)) errors.push('The photo link must start with https://.');
  if (endsAt === null) errors.push('Write the end date as YYYY-MM-DD or DD/MM/YYYY.');
  if (errors.length) return { errors };
  return { deal: { title, url, image: image || null, endsAt: endsAt || null, store: str(b.store, 60), code: str(b.code, 40) || null, description: str(b.description, 300) } };
}

module.exports = { importRows, storeFromUrl, money, dateOf, checkDeal, httpsLink, MAX_ROWS };
