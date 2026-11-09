const { test } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { openDb } = require('../server/db');
const { seed } = require('../server/seed');
const { createApp } = require('../server/app');
const { compareOffers } = require('../server/pricing');

test('cheapest store uses price + delivery - coupon, ties go to faster delivery', () => {
  const r = compareOffers([
    { id: 1, store: 'A', price: 1000, delivery_fee: 0, coupon: 0, delivery_days: 2 },
    { id: 2, store: 'B', price: 950, delivery_fee: 80, coupon: 0, delivery_days: 3 },   // 1030
    { id: 3, store: 'C', price: 1050, delivery_fee: 0, coupon: 50, delivery_days: 1 },  // 1000, faster
  ]);
  assert.equal(r.cheapest.store, 'C');
  assert.equal(r.savings, 30);
  assert.equal(compareOffers(r.offers, { includeExtras: false }).cheapest.store, 'B');
});

async function withServer(fn, { adminKey = '' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cz-'));
  const db = openDb(':memory:');
  seed(db, { purchaseDays: 60 });
  const server = createApp(db, { uploadsDir: path.join(dir, 'uploads'), adminKey }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}
const post = (url, body, headers = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const send = (method, url, body, headers = {}) => fetch(url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body && JSON.stringify(body) });

test('search, compare, sell, buy, and see it in Linezo', () => withServer(async base => {
  const found = await (await fetch(`${base}/api/products?q=earbuds`)).json();
  assert.equal(found.length, 1);
  const detail = await (await fetch(`${base}/api/products/${found[0].id}`)).json();
  assert.equal(detail.cheapest.effective, found[0].lowest);
  assert.ok(detail.offers.every(o => o.effective >= detail.cheapest.effective));

  const bad = await post(`${base}/api/listings`, { title: '', price: 0 });
  assert.equal(bad.status, 400);
  const png = 'data:image/png;base64,' + Buffer.from('fake-png').toString('base64');
  const made = await post(`${base}/api/listings`, { title: 'Brass diya set', category: 'Home', condition: 'Handmade', price: 350, city: 'Moradabad', sellerName: 'Asha', photo: png });
  assert.equal(made.status, 201);
  const listing = await made.json();
  assert.ok(listing.photo);
  assert.equal((await fetch(`${base}/uploads/${listing.photo}`)).status, 200);

  const before = await (await fetch(`${base}/api/trends?days=7`)).json();
  assert.equal(before.daily.length, 7);
  assert.equal((await post(`${base}/api/purchases`, { offerId: detail.cheapest.id, quantity: 2 })).status, 201);
  assert.equal((await post(`${base}/api/purchases`, { listingId: listing.id })).status, 201);
  const after = await (await fetch(`${base}/api/trends?days=7`)).json();
  assert.equal(after.totals.units, before.totals.units + 3);
  assert.equal(after.totals.revenue, before.totals.revenue + detail.cheapest.effective * 2 + 350);
  assert.ok(after.byStore.some(s => s.store === 'Individual seller'));

  const homeOnly = await (await fetch(`${base}/api/trends?days=30&category=Home`)).json();
  assert.ok(homeOnly.byCategory.every(c => c.category === 'Home'));
}));

test('Fashion & Clothing has the giazonest sub-categories, and sellers must pick one', () => withServer(async base => {
  const tree = await (await fetch(`${base}/api/categories`)).json();
  const fashion = tree.find(c => c.name === 'Fashion & Clothing');
  assert.deepEqual(fashion.subcategories.map(s => s.name), ["Men's Wear", "Women's Wear", "Kids' Wear", 'Footwear', 'Bags & Accessories', 'Leather', 'Other']);

  const footwear = await (await fetch(`${base}/api/products?category=${encodeURIComponent('Fashion & Clothing')}&sub=Footwear`)).json();
  assert.ok(footwear.length >= 1 && footwear.every(p => p.sub_category === 'Footwear'));

  const listing = { title: 'Silk saree', category: 'Fashion & Clothing', condition: 'New', price: 1200, city: 'Varanasi', sellerName: 'Meera' };
  assert.equal((await post(`${base}/api/listings`, listing)).status, 400);
  assert.equal((await post(`${base}/api/listings`, { ...listing, subCategory: 'Gadgets' })).status, 400);
  const ok = await post(`${base}/api/listings`, { ...listing, subCategory: "Women's Wear" });
  assert.equal(ok.status, 201);
  assert.equal((await ok.json()).sub_category, "Women's Wear");
  assert.equal((await post(`${base}/api/listings`, { ...listing, category: 'Home', subCategory: "Women's Wear" })).status, 400);
}));

test('categories can be edited while the app runs, only with the admin key', () => withServer(async base => {
  const H = { 'X-Admin-Key': 'secret-key' };
  assert.equal((await post(`${base}/api/categories`, { name: 'Jewellery' })).status, 401);
  assert.equal((await post(`${base}/api/categories`, { name: 'Jewellery' }, { 'X-Admin-Key': 'nope' })).status, 401);

  let tree = await (await post(`${base}/api/categories`, { name: 'Jewellery & Accessories' }, H)).json();
  const jewel = tree.find(c => c.name === 'Jewellery & Accessories');
  assert.ok(jewel);
  assert.equal((await post(`${base}/api/categories`, { name: 'jewellery & accessories' }, H)).status, 409);
  tree = await (await post(`${base}/api/categories`, { name: 'Watches', parentId: jewel.id }, H)).json();
  const watches = tree.find(c => c.id === jewel.id).subcategories[0];
  assert.equal(watches.name, 'Watches');
  assert.equal((await post(`${base}/api/categories`, { name: 'Too deep', parentId: watches.id }, H)).status, 400);

  // New sub-categories sort before "Other", and can be used straight away.
  const fashion = tree.find(c => c.name === 'Fashion & Clothing');
  tree = await (await post(`${base}/api/categories`, { name: 'Ethnic Wear', parentId: fashion.id }, H)).json();
  const subs = tree.find(c => c.id === fashion.id).subcategories.map(s => s.name);
  assert.equal(subs.at(-1), 'Other');
  assert.equal(subs.at(-2), 'Ethnic Wear');
  const made = await post(`${base}/api/listings`, { title: 'Lehenga', category: 'Fashion & Clothing', subCategory: 'Ethnic Wear', condition: 'New', price: 2500, city: 'Jaipur', sellerName: 'Neha' });
  assert.equal(made.status, 201);

  // Move up
  const ethnic = tree.find(c => c.id === fashion.id).subcategories.find(s => s.name === 'Ethnic Wear');
  tree = await (await send('PATCH', `${base}/api/categories/${ethnic.id}`, { move: 'up' }, H)).json();
  assert.equal(tree.find(c => c.id === fashion.id).subcategories.at(-3).name, 'Ethnic Wear');

  // Rename carries over to products and listings
  const womens = tree.find(c => c.id === fashion.id).subcategories.find(s => s.name === "Women's Wear");
  await send('PATCH', `${base}/api/categories/${womens.id}`, { name: 'Womenswear' }, H);
  const ws = await (await fetch(`${base}/api/products?category=${encodeURIComponent('Fashion & Clothing')}&sub=Womenswear`)).json();
  assert.ok(ws.length >= 1);
  tree = await (await send('PATCH', `${base}/api/categories/${fashion.id}`, { name: 'Fashion' }, H)).json();
  const renamed = await (await fetch(`${base}/api/products?category=Fashion`)).json();
  assert.ok(renamed.length >= 4);

  // Delete is refused while in use, allowed when empty
  assert.equal((await send('DELETE', `${base}/api/categories/${ethnic.id}`, null, H)).status, 409);
  assert.equal((await send('DELETE', `${base}/api/categories/${watches.id}`, null, H)).status, 200);
  tree = await (await send('DELETE', `${base}/api/categories/${jewel.id}`, null, H)).json();
  assert.ok(!tree.some(c => c.name === 'Jewellery & Accessories'));
}, { adminKey: 'secret-key' }));

test('category editing is off when no admin key is set', () => withServer(async base => {
  assert.equal((await post(`${base}/api/categories`, { name: 'Toys' }, { 'X-Admin-Key': '' })).status, 403);
}));

test('older databases get sub-category columns and "Fashion" becomes "Fashion & Clothing"', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cz-'));
  const file = path.join(dir, 'old.db');
  const { DatabaseSync } = require('node:sqlite');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, spec TEXT NOT NULL DEFAULT '');
    CREATE TABLE listings (id INTEGER PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL, condition TEXT NOT NULL, price INTEGER NOT NULL, city TEXT NOT NULL, seller_name TEXT NOT NULL, phone TEXT, description TEXT, photo TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    INSERT INTO products (name, category) VALUES ('Kurta', 'Fashion');`);
  old.close();
  const db = openDb(file);
  seed(db);
  assert.equal(db.prepare('SELECT category FROM products').get().category, 'Fashion & Clothing');
  assert.ok(db.prepare('PRAGMA table_info(listings)').all().some(c => c.name === 'sub_category'));
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
