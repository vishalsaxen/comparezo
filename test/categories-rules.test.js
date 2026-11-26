const { test } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { openDb } = require('../server/db');
const { seed } = require('../server/seed');
const { createApp } = require('../server/app');
const { createAdmitad } = require('../server/admitad');
const { createDeals } = require('../server/deals');
const { createGiaZoNest, shortCode } = require('../server/giazonest');
const { suggest, exactMatch } = require('../server/deal-categories');
const cats = require('../server/categories');
const { TABLES } = require('../server/firestore-sync');

async function withServer(fn, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cz-'));
  const db = openDb(':memory:');
  seed(db);
  const server = createApp(db, { uploadsDir: path.join(dir, 'uploads'), adminKey: 'k', giazonest: createGiaZoNest({ fetch: async () => { throw new Error('offline'); } }), ...opts }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const H = { 'Content-Type': 'application/json', 'X-Admin-Key': 'k' };
  const call = async (method, url, body) => { const r = await fetch(base + url, { method, headers: H, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };
  try { await fn({ base, call, db }); } finally { server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}

// Firestore REST shapes, as GiaZoNest's project returns them.
const S = v => ({ stringValue: v }), I = v => ({ integerValue: String(v) });
const gzDoc = (id, f) => ({ document: { name: `projects/giazonest/databases/(default)/documents/products/${id}`, fields: f } });
function fakeFirestore({ fail = false } = {}) {
  const calls = [];
  const fetch = async (url, opts = {}) => {
    calls.push([opts.method || 'GET', url]);
    if (fail) return { ok: false, status: 503, json: async () => ({ error: { message: 'down' } }) };
    if (url.includes(':runQuery')) {
      const q = JSON.parse(opts.body).structuredQuery;
      assert.deepEqual(q.where.fieldFilter, { field: { fieldPath: 'live' }, op: 'EQUAL', value: { booleanValue: true } });
      return { ok: true, status: 200, json: async () => [
        gzDoc('p1', { name: S('A2 Gir Cow Ghee 500ml'), category: S('Grocery & Daily Needs'), subCategory: S('Food Products'), type: { nullValue: null },
          price: I(1399), discount: I(400), stock: I(81), sold: I(2), sellerId: S('s1'), sellerName: S('Elite Harvest'), live: { booleanValue: true },
          thumb: S('data:image/jpeg;base64,' + Buffer.from('jpegbytes').toString('base64')), details: { mapValue: { fields: { brand: S('Elite'), empty: S('') } } },
          updatedAt: { timestampValue: '2026-11-01T10:00:00Z' } }),
        gzDoc('p2', { name: S('Lloyd air conditioner'), category: S('Electrical & Electronics'), subCategory: S('Electrical Accessories'),
          price: { doubleValue: 32000 }, discount: I(0), stock: I(10), sellerId: S('s2'), sellerName: S('Vaishnavi Enterprises'), live: { booleanValue: true },
          updatedAt: { timestampValue: '2026-11-20T10:00:00Z' } }),
        { readTime: '2026-11-26T00:00:00Z' },   // Firestore ends with a document-less entry
      ] };
    }
    if (url.includes('/sellerListings')) return { ok: true, status: 200, json: async () => ({ documents: [
      { name: '.../sellerListings/s1', fields: { city: S('Pune'), state: S('Maharashtra'), phone7: S('8087381') } },
    ] }) };
    throw new Error('unexpected ' + url);
  };
  return { fetch, calls };
}

test('Seller Catalog reads live GiaZoNest products (read-only) with city, price after discount and links', async () => {
  let t = 0;
  const ff = fakeFirestore();
  const gz = createGiaZoNest({ fetch: ff.fetch, now: () => t });
  const r = await gz.list();
  assert.equal(r.error, null);
  assert.deepEqual(r.items.map(x => x.name), ['Lloyd air conditioner', 'A2 Gir Cow Ghee 500ml']);   // newest first
  const ghee = r.items[1];
  assert.deepEqual([ghee.sellingPrice, ghee.price, ghee.discount, ghee.stock, ghee.sold, ghee.city, ghee.state], [999, 1399, 400, 81, 2, 'Pune', 'Maharashtra']);
  assert.deepEqual([ghee.category, ghee.subCategory, ghee.type], ['Grocery & Daily Needs', 'Food Products', null]);
  assert.deepEqual(ghee.details, { brand: 'Elite' });
  assert.equal(ghee.url, `https://vishalsaxen.github.io/giazonest/shop.html?d=${shortCode('p1')}`);
  assert.equal(ghee.image, `https://vishalsaxen.github.io/giazonest/img/${shortCode('p1')}.jpg`);
  assert.equal(ghee.hasThumb, true);
  assert.equal(r.items[0].city, '');   // seller not in the public list
  assert.ok(!('phone7' in ghee) && !JSON.stringify(r).includes('8087381'));   // no seller contact details
  assert.equal(gz.thumb('p1').data.toString(), 'jpegbytes');
  assert.ok(ff.calls.every(([m]) => m === 'GET' || m === 'POST') && ff.calls.every(([, u]) => !/:commit|:batchWrite|:delete/.test(u)));
  // Cached for 30 minutes, then read again.
  const n = ff.calls.length;
  await gz.list(); assert.equal(ff.calls.length, n);
  t = 31 * 60 * 1000; await gz.list(); assert.ok(ff.calls.length > n);
  // The same short code GiaZoNest's shop uses (public/share-link.js there).
  assert.equal(shortCode('02RKwlhHVMh39D6bIifY'), 'MIPwwgYm');
});

test('Seller Catalog keeps the last good list when GiaZoNest is down, and the API serves it', async () => {
  let fail = false;
  const ok = fakeFirestore(), bad = fakeFirestore({ fail: true });
  const gz = createGiaZoNest({ fetch: (...a) => (fail ? bad : ok).fetch(...a) });
  await withServer(async ({ base, call }) => {
    let r = await (await fetch(`${base}/api/seller-catalog`)).json();
    assert.equal(r.items.length, 2);
    const img = await fetch(`${base}/api/seller-catalog/thumb/p1`);
    assert.equal(img.headers.get('content-type'), 'image/jpeg');
    assert.equal((await fetch(`${base}/api/seller-catalog/thumb/p2`)).status, 404);
    fail = true;
    assert.equal((await call('POST', '/api/admin/seller-catalog/refresh')).status, 200);
    r = await (await fetch(`${base}/api/seller-catalog`)).json();
    assert.equal(r.items.length, 2);
    assert.match(r.error, /503/);
    assert.equal((await fetch(`${base}/api/admin/seller-catalog/refresh`, { method: 'POST' })).status, 401);
  }, { giazonest: gz });
});

test('category suggestions come from names, keywords and what is already filed', () => {
  const db = openDb(':memory:');
  seed(db);
  const top = (q, mode) => { const s = suggest(db, q, { mode })[0]; return s && [s.category, s.subCategory, s.type].filter(Boolean).join(' › '); };
  assert.equal(top('A2 Gir Cow Ghee, Bilona method, 500 ml'), 'Grocery & Daily Needs › Food Products');
  assert.equal(top('Flat 40% off on running shoes', 'deal'), 'Fashion & Clothing › Footwear');
  assert.equal(top('boAt Airdopes 141 earbuds'), 'Electrical & Electronics › Mobile Accessories');
  assert.equal(top('Classmate notebook pack of 6'), 'Stationery & Office › Stationery');
  assert.deepEqual(suggest(db, '40% off'), []);
  // Product mode only offers paths a product can be saved under (down to the type when there is one).
  for (const s of suggest(db, 'music guitar classes', { limit: 5 })) assert.equal(cats.checkPath(db, s.category, s.subCategory, s.type), null);
  // It learns: a made-up word filed once is suggested next time.
  db.prepare("INSERT INTO products (name, category, sub_category) VALUES ('Zorbo widget', 'Home & Kitchen', 'Furniture')").run();
  assert.equal(top('zorbo deluxe'), 'Home & Kitchen › Furniture');
  // Exact names map feed categories straight away; vague ones don't.
  const tree = cats.categoryTree(db);
  assert.deepEqual(exactMatch(tree, 'beauty and personal care'), { category: 'Beauty & Personal Care', subCategory: null });
  assert.deepEqual(exactMatch(tree, 'FOOTWEAR'), { category: 'Fashion & Clothing', subCategory: 'Footwear' });
  assert.equal(exactMatch(tree, 'Women Ethnic Wear'), null);
});

test('feed deals get categories from a remembered mapping; new names wait in "Needs a category"', async () => {
  const admitad = createAdmitad({ clientId: 'id', clientSecret: 's', websiteId: '1', fetch: async url => {
    if (url.endsWith('/token/')) return { ok: true, status: 200, json: async () => ({ access_token: 't', expires_in: 1e6 }) };
    return { ok: true, status: 200, json: async () => ({ results: [
      { id: 1, name: 'Extra 150 off', status: 'active', goto_link: 'https://ad.admitad.com/g/1/', campaign: { name: 'Nykaa' }, categories: [{ id: 9, name: 'Beauty & Personal Care' }] },
      { id: 2, name: 'Upto 70% off on ethnic wear', status: 'active', goto_link: 'https://ad.admitad.com/g/2/', campaign: { name: 'Ajio' }, categories: [{ id: 3, name: 'Women Ethnic Wear' }] },
      { id: 3, name: 'Kurtas from 399', status: 'active', goto_link: 'https://ad.admitad.com/g/3/', campaign: { name: 'Ajio' }, categories: [{ id: 3, name: 'Women Ethnic Wear' }] },
    ], _meta: { count: 3 } }) };
  } });
  const deals = createDeals({ apiKey: 'c', fetch: async () => ({ ok: true, status: 200, json: async () => ({ offers: [{ id: 7, title: 'Big Saving Days', url: 'https://www.flipkart.com/sale', store: 'Flipkart' }] }) }) });
  await withServer(async ({ base, call, db }) => {
    let pub = (await (await fetch(`${base}/api/deals`)).json()).deals;
    const cat = id => { const d = pub.find(x => x.id === id); return [d.category, d.subCategory]; };
    assert.deepEqual(cat('admitad-1'), ['Beauty & Personal Care', null]);   // exact name: no question asked
    assert.deepEqual(cat('admitad-2'), [null, null]);
    assert.deepEqual(cat('7'), [null, null]);

    let p = (await call('GET', '/api/admin/deal-categories')).body;
    assert.deepEqual(p.feeds.map(g => [g.source, g.name, g.count]), [['admitad', 'women ethnic wear', 2], ['cuelinks', 'store:flipkart', 1]]);
    assert.deepEqual(p.feeds[0].suggestion, { category: 'Fashion & Clothing', subCategory: "Women's Wear" });
    assert.deepEqual(p.feeds[0].samples, ['Upto 70% off on ethnic wear', 'Kurtas from 399']);

    assert.equal((await call('POST', '/api/admin/deal-categories', { source: 'admitad', name: 'Women Ethnic Wear', category: 'Nope' })).status, 400);
    assert.equal((await call('POST', '/api/admin/deal-categories', { source: 'admitad', name: 'Women Ethnic Wear', category: 'fashion & clothing', subCategory: "women's wear" })).status, 200);
    assert.equal((await call('POST', '/api/admin/deal-categories', { source: 'cuelinks', name: 'store:flipkart', category: 'whole store' })).status, 200);
    pub = (await (await fetch(`${base}/api/deals`)).json()).deals;
    assert.deepEqual(cat('admitad-3'), ['Fashion & Clothing', "Women's Wear"]);
    assert.deepEqual(cat('7'), ['Whole store', null]);
    p = (await call('GET', '/api/admin/deal-categories')).body;
    assert.deepEqual([p.feeds.length, p.mapped.length], [0, 2]);
    assert.ok(TABLES.some(([t]) => t === 'deal_category_map'));   // kept in Firestore

    // Renaming a category carries over to mappings and deals; a category in use by a deal can't be deleted.
    const fashion = cats.categoryTree(db).find(c => c.name === 'Fashion & Clothing');
    const womens = fashion.subcategories.find(s => s.name === "Women's Wear");
    await call('PATCH', `/api/categories/${womens.id}`, { name: 'Womenswear' });
    pub = (await (await fetch(`${base}/api/deals`)).json()).deals;
    assert.deepEqual(cat('admitad-3'), ['Fashion & Clothing', 'Womenswear']);
    await call('POST', '/api/admin/my-deals', { title: 'Shoes sale', url: 'https://www.myntra.com/s', category: 'Fashion & Clothing', subCategory: 'Footwear' });
    const footwear = fashion.subcategories.find(s => s.name === 'Footwear');
    assert.equal((await call('DELETE', `/api/categories/${footwear.id}`)).status, 409);

    // Old own deals without a category are listed too.
    db.prepare("INSERT INTO my_deals (title, url) VALUES ('Old cooker deal', 'https://x.in/a')").run();
    p = (await call('GET', '/api/admin/deal-categories')).body;
    assert.deepEqual(p.mine.map(d => [d.title, d.suggestion && d.suggestion.subCategory]), [['Old cooker deal', 'Kitchenware']]);
    // Editing it needs a category now.
    const id = p.mine[0].id;
    assert.equal((await call('PATCH', `/api/admin/my-deals/${id}`, { title: 'Cooker deal' })).status, 400);
    assert.equal((await call('PATCH', `/api/admin/my-deals/${id}`, { category: 'Home & Kitchen', subCategory: 'Kitchenware' })).body.sub_category, 'Kitchenware');
    assert.equal((await call('GET', '/api/admin/category-suggest?q=pressure+cooker')).body[0].subCategory, 'Kitchenware');
  }, { admitad, deals });
});

test('top-level categories have menu icons the owner can change', async () => {
  await withServer(async ({ call }) => {
    let tree = (await call('GET', '/api/categories')).body;
    assert.equal(tree.find(c => c.name === 'Food').icon, 'food');
    assert.equal(tree.find(c => c.name === 'Doctors').icon, 'doctor');
    const food = tree.find(c => c.name === 'Food');
    tree = (await call('PATCH', `/api/categories/${food.id}`, { icon: 'gifts' })).body;
    assert.equal(tree.find(c => c.name === 'Food').icon, 'gifts');
    assert.equal((await call('PATCH', `/api/categories/${food.id}`, { icon: '<script>' })).status, 400);
    assert.equal((await call('PATCH', `/api/categories/${food.subcategories[0].id}`, { icon: 'food' })).status, 400);
    tree = (await call('POST', '/api/categories', { name: 'Pets' })).body;
    assert.equal(tree.find(c => c.name === 'Pets').icon, 'tag');
  });
});
