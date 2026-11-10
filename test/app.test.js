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

const { addProduct } = require('../server/catalog');
const offer = (store, price, extra = {}) => ({ store, price, url: `https://www.${store.toLowerCase().replace(/\W/g, '')}.com/p/${price}`, ...extra });
const SAMPLE = [
  { name: 'Wireless earbuds', category: 'Electronics', offers: [offer('Amazon.in', 1499), offer('Flipkart', 1449, { deliveryFee: 40 }), offer('Meesho', 1399)] },
  { name: 'Running shoes', category: 'Fashion & Clothing', subCategory: 'Footwear', offers: [offer('Myntra', 999), offer('Amazon.in', 949)] },
  { name: 'Cotton kurta', category: 'Fashion & Clothing', subCategory: "Women's Wear", offers: [offer('Myntra', 749), offer('Flipkart', 689)] },
  { name: 'Bedsheet', category: 'Home', offers: [offer('Amazon.in', 549)] },
];

async function withServer(fn, { adminKey = '', deals } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cz-'));
  const db = openDb(':memory:');
  seed(db);
  // A few products, added the way the admin page adds them.
  for (const p of SAMPLE) assert.ok(addProduct(db, p, 'manual').id);
  const server = createApp(db, { uploadsDir: path.join(dir, 'uploads'), adminKey, ...(deals ? { deals } : {}) }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}
const post = (url, body, headers = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const send = (method, url, body, headers = {}) => fetch(url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body && JSON.stringify(body) });

test('search, compare, click Buy, and see it in Linezo', () => withServer(async base => {
  const A = { headers: { 'X-Admin-Key': 'k' } };
  assert.equal((await fetch(`${base}/api/trends?days=7`)).status, 401);   // shoppers can't see Linezo
  const found = await (await fetch(`${base}/api/products?q=earbuds`)).json();
  assert.equal(found.length, 1);
  const detail = await (await fetch(`${base}/api/products/${found[0].id}`)).json();
  assert.equal(detail.cheapest.store, 'Meesho');
  assert.equal(detail.cheapest.effective, found[0].lowest);
  assert.ok(detail.offers.every(o => o.effective >= detail.cheapest.effective));
  assert.equal(detail.localListings, undefined);

  const before = await (await fetch(`${base}/api/trends?days=7`, A)).json();
  assert.equal(before.daily.length, 7);
  assert.equal(before.totals.units, 0);   // no sample history any more
  assert.equal((await post(`${base}/api/purchases`, { offerId: detail.cheapest.id, quantity: 2 })).status, 201);
  assert.equal((await post(`${base}/api/purchases`, { listingId: 1 })).status, 400);
  const after = await (await fetch(`${base}/api/trends?days=7`, A)).json();
  assert.equal(after.totals.units, 2);
  assert.equal(after.totals.revenue, detail.cheapest.effective * 2);
  assert.deepEqual(after.byStore.map(s => s.store), ['Meesho']);
  assert.equal(after.topProducts[0].name, 'Wireless earbuds');

  const homeOnly = await (await fetch(`${base}/api/trends?days=30&category=Home`, A)).json();
  assert.equal(homeOnly.totals.units, 0);
  assert.equal((await fetch(`${base}/api/listings`)).status, 404);
}, { adminKey: 'k' }));

test('Fashion & Clothing has the giazonest sub-categories, and products must pick one', () => withServer(async base => {
  const tree = await (await fetch(`${base}/api/categories`)).json();
  const fashion = tree.find(c => c.name === 'Fashion & Clothing');
  assert.deepEqual(fashion.subcategories.map(s => s.name), ["Men's Wear", "Women's Wear", "Kids' Wear", 'Footwear', 'Bags & Accessories', 'Leather', 'Other']);

  const footwear = await (await fetch(`${base}/api/products?category=${encodeURIComponent('Fashion & Clothing')}&sub=Footwear`)).json();
  assert.deepEqual(footwear.map(p => p.name), ['Running shoes']);

  const H = { 'X-Admin-Key': 'k' };
  const p = { name: 'Silk saree', category: 'Fashion & Clothing', offers: [offer('Myntra', 1200)] };
  assert.equal((await post(`${base}/api/admin/products`, p, H)).status, 400);
  assert.equal((await post(`${base}/api/admin/products`, { ...p, subCategory: 'Gadgets' }, H)).status, 400);
  const ok = await post(`${base}/api/admin/products`, { ...p, subCategory: "Women's Wear" }, H);
  assert.equal(ok.status, 201);
  assert.equal((await ok.json()).sub_category, "Women's Wear");
  assert.equal((await post(`${base}/api/admin/products`, { ...p, category: 'Home', subCategory: "Women's Wear" }, H)).status, 400);
}, { adminKey: 'k' }));

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
  const made = await post(`${base}/api/admin/products`, { name: 'Lehenga', category: 'Fashion & Clothing', subCategory: 'Ethnic Wear', offers: [offer('Myntra', 2500)] }, H);
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
  assert.equal(renamed.length, 3);

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

test('three levels: products pick a type when the sub-category has types, and admins can edit types', () => withServer(async base => {
  const H = { 'X-Admin-Key': 'k' };
  const tree = await (await fetch(`${base}/api/categories`)).json();
  const school = tree.find(c => c.name === 'School & Education');
  const music = school.subcategories.find(s => s.name === 'Music');
  const l = { name: 'Sitar', category: 'School & Education', subCategory: 'Music', offers: [offer('Amazon.in', 8000)] };
  const add = body => post(`${base}/api/admin/products`, body, H);
  assert.equal((await add(l)).status, 400);
  assert.equal((await add({ ...l, type: 'Banjo' })).status, 400);
  const made = await add({ ...l, type: 'Sitar' });
  assert.equal(made.status, 201);
  assert.equal((await made.json()).type, 'Sitar');
  // A sub-category without types takes no type.
  assert.equal((await add({ ...l, subCategory: 'Other', type: 'Sitar' })).status, 400);

  let t = await (await post(`${base}/api/categories`, { name: 'Santoor', parentId: music.id }, H)).json();
  const santoor = t.find(c => c.id === school.id).subcategories.find(s => s.id === music.id).types.find(x => x.name === 'Santoor');
  assert.ok(santoor);
  assert.equal((await post(`${base}/api/categories`, { name: 'Too deep', parentId: santoor.id }, H)).status, 400);

  const sitar = music.types.find(x => x.name === 'Sitar');
  await send('PATCH', `${base}/api/categories/${sitar.id}`, { name: 'Sitar (Classical)' }, H);
  const mine = await (await fetch(`${base}/api/admin/products`, { headers: H })).json();
  assert.equal(mine.find(x => x.name === 'Sitar').type, 'Sitar (Classical)');
  assert.equal((await send('DELETE', `${base}/api/categories/${music.id}`, null, H)).status, 409);
  assert.equal((await send('DELETE', `${base}/api/categories/${santoor.id}`, null, H)).status, 200);
}, { adminKey: 'k' }));

test('affiliate.js loads Cuelinks only when a numeric CUELINKS_CID is set', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cz-'));
  const run = async cid => {
    const server = createApp(openDb(':memory:'), { uploadsDir: path.join(dir, 'u'), cuelinksCid: cid }).listen(0);
    try { return await (await fetch(`http://127.0.0.1:${server.address().port}/affiliate.js`)).text(); } finally { server.close(); }
  };
  try {
    assert.match(await run('123456'), /var cId = '123456'[\s\S]*cdn0\.cuelinks\.com\/js\/cuelinksv2\.js/);
    assert.doesNotMatch(await run(''), /cuelinks/);
    assert.doesNotMatch(await run("1';alert(1)//"), /alert/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('admin can add, list and delete products; catalog.json loads on start', async () => {
  const { loadCatalog } = require('../server/catalog');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cz-'));
  const db = openDb(':memory:');
  seed(db);
  const server = createApp(db, { uploadsDir: path.join(dir, 'u'), adminKey: 'k' }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const H = { 'X-Admin-Key': 'k' };
  const product = { name: 'Spiral notebook A4', category: 'Stationery & Office', subCategory: 'Stationery', spec: '200 pages',
    offers: [{ store: 'Flipkart', price: 120, mrp: 150, url: 'https://www.flipkart.com/x/p/itm1' }, { store: 'Amazon.in', price: 115, url: 'https://www.amazon.in/dp/B01' }] };
  try {
    assert.equal((await post(`${base}/api/admin/products`, product)).status, 401);
    const bad = await post(`${base}/api/admin/products`, { name: 'x', category: 'Stationery & Office', offers: [{ store: 'Flipkart', price: 0, url: 'http://x' }] }, H);
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).errors.length, 3);   // sub-category, price, link

    const made = await post(`${base}/api/admin/products`, product, H);
    assert.equal(made.status, 201);
    const p = await made.json();
    assert.equal(p.offers.length, 2);
    const found = await (await fetch(`${base}/api/products?q=Spiral`)).json();
    assert.equal(found[0].lowest, 115);
    const detail = await (await fetch(`${base}/api/products/${p.id}`)).json();
    assert.equal(detail.offers.find(o => o.store === 'Flipkart').buyUrl, 'https://www.flipkart.com/x/p/itm1');
    assert.equal((await (await fetch(`${base}/api/admin/products`, { headers: H })).json()).length, 1);

    await post(`${base}/api/purchases`, { offerId: detail.cheapest.id });
    assert.equal((await send('DELETE', `${base}/api/admin/products/${p.id}`, null, H)).status, 200);
    assert.equal((await (await fetch(`${base}/api/products?q=Spiral`)).json()).length, 0);
    // Products from catalog.json can be deleted too.
    const cat = addProduct(db, { ...product, name: 'From catalog' }, 'catalog');
    assert.equal((await send('DELETE', `${base}/api/admin/products/${cat.id}`, null, H)).status, 200);
    assert.equal((await send('DELETE', `${base}/api/admin/products/${cat.id}`, null, H)).status, 404);
    assert.equal((await (await fetch(`${base}/api/products?q=catalog`)).json()).length, 0);

    const file = path.join(dir, 'catalog.json');
    fs.writeFileSync(file, JSON.stringify([product, { name: 'Broken', category: 'Nope', offers: [] }]));
    const first = loadCatalog(db, file);
    assert.equal(first.added, 1);
    assert.equal(first.problems.length, 1);
    assert.equal(loadCatalog(db, file).added, 0);   // not added twice
    fs.writeFileSync(file, '[]');
    assert.equal(loadCatalog(db, file).removed, 1);   // taken out of the file, so taken off the site
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM products WHERE source = 'catalog'").get().c, 0);
  } finally { server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the real catalog.json is valid', () => {
  const { loadCatalog } = require('../server/catalog');
  const db = openDb(':memory:');
  seed(db);
  const r = loadCatalog(db);
  assert.deepEqual(r.problems, []);
});

test('the Firebase-hosted front end can call the API (CORS), other sites cannot', () => withServer(async base => {
  const pre = await fetch(`${base}/api/admin/products`, { method: 'OPTIONS', headers: { Origin: 'https://comparezo.web.app', 'Access-Control-Request-Method': 'DELETE', 'Access-Control-Request-Headers': 'x-admin-key' } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), 'https://comparezo.web.app');
  assert.match(pre.headers.get('access-control-allow-headers'), /X-Admin-Key/);
  const other = await fetch(`${base}/api/categories`, { headers: { Origin: 'https://evil.example' } });
  assert.equal(other.headers.get('access-control-allow-origin'), null);
  // Buy clicks arrive as text/plain JSON.
  const [p] = await (await fetch(`${base}/api/products?q=earbuds`)).json();
  const d = await (await fetch(`${base}/api/products/${p.id}`)).json();
  const r = await fetch(`${base}/api/purchases`, { method: 'POST', headers: { 'Content-Type': 'text/plain', Origin: 'https://comparezo.web.app' }, body: JSON.stringify({ offerId: d.cheapest.id }) });
  assert.equal(r.status, 201);
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://comparezo.web.app');
}));

const { createDeals } = require('../server/deals');
test('Cuelinks deals: sent with the token, mapped, expired ones dropped, cached, and hidden without a key', async () => {
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url, auth: opts.headers.Authorization });
    if (url.endsWith('/ping')) return { ok: true, status: 200, json: async () => ({ publisher: { id: 1 } }) };
    return { ok: true, status: 200, json: async () => ({ offers: [
      { id: 7, title: 'Flat 20% off shoes', coupon_code: 'RUN20', campaign: { name: 'Myntra' }, affiliate_url: 'https://linksredirect.com/?cid=1&source=api&url=https%3A%2F%2Fwww.myntra.com%2Fshoes%3Fx%3D1%26y%3D2', end_date: '2099-01-01' },
      { id: 8, title: 'Old sale', url: 'https://linksredirect.com/?a=2', end_date: '2001-01-01' },
      { id: 9, title: 'No link' },
      { id: 10, title: 'Raw link', url: 'https://linksredirect.com/?cid=1&source=api&url=https://www.airindia.com/?ai_pc=W&utm_medium=affiliate' },
    ] }) };
  };
  const deals = createDeals({ apiKey: 'secret', fetch: fakeFetch });
  const r = await deals.list();
  assert.equal(calls[0].auth, 'Token secret');
  assert.match(calls[0].url, /^https:\/\/developers\.cuelinks\.com\/pub_api\/v3\/offers/);
  assert.deepEqual(r.deals.map(d => [d.title, d.store, d.code, d.url]), [['Flat 20% off shoes', 'Myntra', 'RUN20', 'https://www.myntra.com/shoes?x=1&y=2'], ['Raw link', '', null, 'https://www.airindia.com/?ai_pc=W&utm_medium=affiliate']]);
  await deals.list();
  assert.equal(calls.length, 1);   // cached
  assert.deepEqual(await createDeals({ apiKey: '' }).list(), { connected: false, deals: [] });

  await withServer(async base => {
    const pub = await (await fetch(`${base}/api/deals`)).json();
    assert.equal(pub.deals.length, 2);
    assert.ok(!JSON.stringify(pub).includes('secret'));
    assert.equal((await fetch(`${base}/api/admin/deals/check`)).status, 401);
    const chk = await (await fetch(`${base}/api/admin/deals/check`, { headers: { 'X-Admin-Key': 'k' } })).json();
    assert.ok(chk.offerFields.includes('coupon_code'));
  }, { adminKey: 'k', deals });
});
