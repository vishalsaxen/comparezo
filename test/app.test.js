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

  let tree = await (await post(`${base}/api/categories`, { name: 'Musical Instruments' }, H)).json();
  const jewel = tree.find(c => c.name === 'Musical Instruments');
  assert.ok(jewel);
  assert.equal((await post(`${base}/api/categories`, { name: 'musical instruments' }, H)).status, 409);
  tree = await (await post(`${base}/api/categories`, { name: 'Watches', parentId: jewel.id }, H)).json();
  const watches = tree.find(c => c.id === jewel.id).subcategories[0];
  assert.equal(watches.name, 'Watches');
  assert.equal((await post(`${base}/api/categories`, { name: 'Smart Watches', parentId: watches.id }, H)).status, 200);  // a type under a sub-category

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
  assert.ok(!tree.some(c => c.name === 'Musical Instruments'));
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

test('Buy links go to the store: feed URL first, else the store search', () => {
  const { buyUrl } = require('../server/stores');
  assert.equal(buyUrl({ store: 'Amazon.in', url: 'https://www.amazon.in/dp/X1' }, 'Earbuds'), 'https://www.amazon.in/dp/X1');
  assert.equal(buyUrl({ store: 'Flipkart' }, 'Smart Band'), 'https://www.flipkart.com/search?q=Smart%20Band');
  assert.equal(buyUrl({ store: 'Myntra' }, "Men's Running Shoes"), 'https://www.myntra.com/men-s-running-shoes');
  assert.equal(buyUrl({ store: 'Unknown shop' }, 'x'), null);
  assert.equal(buyUrl({ store: 'Meesho', url: 'javascript:alert(1)' }, 'Kurta'), 'https://www.meesho.com/search?q=Kurta');
});

test('GiaZoNest categories, sub-categories and types are imported once, and deletions stick', () => {
  const { categoryTree, deleteCategory, seedCategories } = require('../server/categories');
  const db = openDb(':memory:');
  seed(db, { purchaseDays: 7 });
  const tree = categoryTree(db);
  // 6 Comparezo starters + 21 GiaZoNest categories, sharing "Fashion & Clothing".
  assert.equal(tree.length, 26);
  const school = tree.find(c => c.name === 'School & Education');
  const music = school.subcategories.find(s => s.name === 'Music');
  assert.ok(music.types.some(t => t.name === 'Sitar'));
  assert.equal(school.subcategories.at(-1).name, 'Other');
  assert.equal(tree.reduce((n, c) => n + c.subcategories.reduce((m, s) => m + s.types.length, 0), 0), 117);
  assert.equal(tree.find(c => c.name === 'Fashion & Clothing').subcategories.length, 7);

  deleteCategory(db, tree.find(c => c.name === 'Doctors').id);
  assert.equal(seedCategories(db), false);
  assert.ok(!categoryTree(db).some(c => c.name === 'Doctors'));
});

test('a database seeded before category sets existed gets only the new set', () => {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO categories (name, parent_id, position) VALUES ('Fashion & Clothing', NULL, 0)").run();
  require('../server/categories').seedCategories(db);
  const names = require('../server/categories').categoryTree(db).map(c => c.name);
  assert.ok(names.includes('Real Estate'));
  assert.ok(!names.includes('Electronics'));
});

test('three levels: sellers pick a type when the sub-category has types, and admins can edit types', () => withServer(async base => {
  const H = { 'X-Admin-Key': 'k' };
  const tree = await (await fetch(`${base}/api/categories`)).json();
  const school = tree.find(c => c.name === 'School & Education');
  const music = school.subcategories.find(s => s.name === 'Music');
  const l = { title: 'Sitar lessons', category: 'School & Education', subCategory: 'Music', condition: 'New', price: 800, city: 'Pune', sellerName: 'Ravi' };
  assert.equal((await post(`${base}/api/listings`, l)).status, 400);
  assert.equal((await post(`${base}/api/listings`, { ...l, type: 'Banjo' })).status, 400);
  const made = await post(`${base}/api/listings`, { ...l, type: 'Sitar' });
  assert.equal(made.status, 201);
  assert.equal((await made.json()).type, 'Sitar');
  // A sub-category without types takes no type.
  assert.equal((await post(`${base}/api/listings`, { ...l, subCategory: 'Other', type: 'Sitar' })).status, 400);

  let t = await (await post(`${base}/api/categories`, { name: 'Santoor', parentId: music.id }, H)).json();
  const santoor = t.find(c => c.id === school.id).subcategories.find(s => s.id === music.id).types.find(x => x.name === 'Santoor');
  assert.ok(santoor);
  assert.equal((await post(`${base}/api/categories`, { name: 'Too deep', parentId: santoor.id }, H)).status, 400);

  const sitar = music.types.find(x => x.name === 'Sitar');
  await send('PATCH', `${base}/api/categories/${sitar.id}`, { name: 'Sitar (Classical)' }, H);
  const listings = await (await fetch(`${base}/api/listings`)).json();
  assert.equal(listings.find(x => x.title === 'Sitar lessons').type, 'Sitar (Classical)');
  assert.equal((await send('DELETE', `${base}/api/categories/${music.id}`, null, H)).status, 409);
  assert.equal((await send('DELETE', `${base}/api/categories/${santoor.id}`, null, H)).status, 200);
}, { adminKey: 'k' }));
