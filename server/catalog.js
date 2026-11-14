// Hand-picked products: each one has a name, a category and the store links and prices for it.
// They come from two places:
//   - the admin page /products.html (source 'manual'), kept across restarts when Firestore is
//     connected (see firestore-sync.js), and
//   - server/catalog.json (source 'catalog'), which is saved in the code and loaded on every start.
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
  const checked = cleanOffers(b.offers);
  errors.push(...checked.errors);
  const offers = checked.offers;
  if (errors.length) return { errors };

  db.exec('BEGIN');
  try {
    const id = Number(db.prepare(`INSERT INTO products (name, category, sub_category, type, spec, image, source)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(name, b.category, subCategory, type, String(b.spec || '').trim().slice(0, 200), image || null, source).lastInsertRowid);
    insertOffers(db, id, offers);
    db.exec('COMMIT');
    return { id };
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

// Checks store offers: each needs a store, a price above ₹0 and an https:// link.
function cleanOffers(list) {
  const errors = [];
  const offers = (Array.isArray(list) ? list : []).slice(0, 12).map(o => ({
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
  return { offers, errors };
}

function insertOffers(db, productId, offers) {
  const ins = db.prepare('INSERT INTO offers (product_id, store, price, mrp, delivery_fee, url) VALUES (?, ?, ?, ?, ?, ?)');
  for (const o of offers) ins.run(productId, o.store, o.price, o.mrp, o.deliveryFee, o.url);
}

// Delete a product and its store prices. Linezo keeps the click history without the product link.
function deleteProduct(db, id) {
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE purchases SET product_id = NULL WHERE product_id = ?').run(id);
    db.prepare('DELETE FROM offers WHERE product_id = ?').run(id);
    db.prepare('DELETE FROM products WHERE id = ?').run(id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

// Load server/catalog.json, skipping products already loaded, and remove catalog products
// that were taken out of the file. Returns { added, removed, problems }.
function loadCatalog(db, file = path.join(__dirname, 'catalog.json')) {
  if (!fs.existsSync(file)) return { added: 0, removed: 0, problems: [] };
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));
  const names = new Set(list.map(item => String(item.name || '').trim()));
  let removed = 0;
  for (const p of db.prepare("SELECT id, name FROM products WHERE source = 'catalog'").all()) {
    if (!names.has(p.name)) { deleteProduct(db, p.id); removed++; }
  }
  const has = db.prepare("SELECT 1 FROM products WHERE source = 'catalog' AND name = ?");
  let added = 0;
  const problems = [];
  for (const item of list) {
    if (has.get(String(item.name || '').trim())) continue;
    const r = addProduct(db, item, 'catalog');
    if (r.errors) problems.push(`${item.name || '(no name)'}: ${r.errors.join(' ')}`);
    else added++;
  }
  return { added, removed, problems };
}

module.exports = { addProduct, deleteProduct, loadCatalog, cleanOffers, insertOffers };
