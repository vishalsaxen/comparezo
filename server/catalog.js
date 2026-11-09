// Hand-picked products: each one has a name, a category and the store links and prices for it.
// They come from two places:
//   - the admin page /products.html (source 'manual'), which is wiped when the free Render
//     server restarts, and
//   - server/catalog.json (source 'catalog'), which is saved in the code and loaded on every start.
// To keep products added on the admin page, use "Copy list" there and add the result to catalog.json.
const fs = require('node:fs');
const path = require('node:path');
const cats = require('./categories');

const HTTPS = /^https:\/\/\S+$/;

// Checks a product and saves it with its store offers. Returns { id } or { errors }.
function addProduct(db, b = {}, source) {
  const errors = [];
  const name = String(b.name || '').trim().slice(0, 200);
  if (!name) errors.push('Add a product name.');
  const subCategory = String(b.subCategory || '').trim() || null;
  const type = String(b.type || '').trim() || null;
  const catError = cats.checkPath(db, b.category, subCategory, type);
  if (catError) errors.push(catError);
  const image = String(b.image || '').trim();
  if (image && !HTTPS.test(image)) errors.push('The photo link must start with https://');
  const offers = (Array.isArray(b.offers) ? b.offers : []).slice(0, 12).map(o => ({
    store: String(o.store || '').trim().slice(0, 40),
    price: Math.round(Number(o.price)),
    mrp: o.mrp ? Math.round(Number(o.mrp)) : null,
    deliveryFee: Math.max(0, Math.round(Number(o.deliveryFee) || 0)),
    url: String(o.url || '').trim(),
  })).filter(o => o.store || o.url || o.price);
  if (!offers.length) errors.push('Add at least one store with a price and link.');
  offers.forEach((o, i) => {
    const n = `Store ${i + 1}`;
    if (!o.store) errors.push(`${n}: pick the store.`);
    if (!Number.isFinite(o.price) || o.price < 1 || o.price > 10000000) errors.push(`${n}: set a price above ₹0.`);
    if (o.mrp !== null && (!Number.isFinite(o.mrp) || o.mrp < 1)) errors.push(`${n}: MRP must be a number.`);
    if (!HTTPS.test(o.url)) errors.push(`${n}: paste the product link (starting with https://).`);
  });
  if (errors.length) return { errors };

  db.exec('BEGIN');
  try {
    const id = Number(db.prepare(`INSERT INTO products (name, category, sub_category, type, spec, image, source)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(name, b.category, subCategory, type, String(b.spec || '').trim().slice(0, 200), image || null, source).lastInsertRowid);
    const ins = db.prepare('INSERT INTO offers (product_id, store, price, mrp, delivery_fee, url) VALUES (?, ?, ?, ?, ?, ?)');
    for (const o of offers) ins.run(id, o.store, o.price, o.mrp, o.deliveryFee, o.url);
    db.exec('COMMIT');
    return { id };
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

// Load server/catalog.json, skipping products already loaded. Returns { added, problems }.
function loadCatalog(db, file = path.join(__dirname, 'catalog.json')) {
  if (!fs.existsSync(file)) return { added: 0, problems: [] };
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));
  const has = db.prepare("SELECT 1 FROM products WHERE source = 'catalog' AND name = ?");
  let added = 0;
  const problems = [];
  for (const item of list) {
    if (has.get(String(item.name || '').trim())) continue;
    const r = addProduct(db, item, 'catalog');
    if (r.errors) problems.push(`${item.name || '(no name)'}: ${r.errors.join(' ')}`);
    else added++;
  }
  return { added, problems };
}

module.exports = { addProduct, loadCatalog };
