const { test } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { openDb } = require('../server/db');
const { seed } = require('../server/seed');
const { createApp } = require('../server/app');
const { feedsFromEnv, createFeedRunner, newArrivals } = require('../server/feeds');

const json = body => ({ ok: true, status: 200, json: async () => body });
const fkProduct = (id, title, price) => ({ productBaseInfoV1: {
  productId: id, title, productBrand: 'Acme', flipkartSpecialPrice: { amount: price, currency: 'INR' }, maximumRetailPrice: { amount: price * 2 },
  productUrl: `http://dl.flipkart.com/dl/x/p/itm?pid=${id}`, imageUrls: { '400x400': `http://img.fkcdn.com/${id}.jpg` }, inStock: true,
} });

function fakeFlipkart() {
  let version = 100;
  const calls = [];
  const fetch = async (url, opts) => {
    calls.push({ url, headers: opts.headers });
    if (url.endsWith('/affiliate/api/aff1.json')) return json({ apiGroups: { affiliate: { apiListings: {
      mobiles: { availableVariants: { 'v1.1.0': { get: 'https://fk.test/feeds/aff1/category/tyy.json?sig=1', deltaGet: 'https://fk.test/deltaFeeds/aff1/category/tyy.json?sig=1' } } },
    } } } });
    if (url.startsWith('https://fk.test/feeds/')) return json({ products: [fkProduct('OLD1', 'Old phone', 9999)], nextUrl: null });
    if (url === 'https://fk.test/deltaFeeds/aff1/category/tyy.json?sig=1') return json({ version });
    if (url.includes('/fromVersion/100.json')) return json({ productInfoList: [fkProduct('OLD1', 'Old phone', 9499), fkProduct('NEW1', 'Nimbus X 5G', 12999)], nextUrl: null, version });
    throw new Error('unexpected ' + url);
  };
  return { fetch, calls, bump: () => { version = 101; } };
}

test('Flipkart: first run saves a baseline, later runs add only unseen products as new arrivals', async () => {
  const db = openDb(':memory:');
  seed(db, { purchaseDays: 5 });
  const fk = fakeFlipkart();
  const runner = createFeedRunner(db, feedsFromEnv({ FLIPKART_AFFILIATE_ID: 'aff1', FLIPKART_AFFILIATE_TOKEN: 'tok', FLIPKART_CATEGORIES: '{"mobiles":["Mobiles"]}' }, { fetch: fk.fetch }));
  assert.deepEqual(runner.status().connected, ['Flipkart']);
  assert.equal(fk.calls.length, 0);

  const first = await runner.runAll();
  assert.equal(first.results[0].ok, true, first.results[0].error);
  assert.equal(first.results[0].baseline, 1);
  assert.equal(first.results[0].catalog, 1);
  assert.equal(newArrivals(db).items.length, 0);
  // The existing range is shown in its category straight away, just not as a new arrival.
  const old = db.prepare("SELECT p.*, o.price FROM products p JOIN offers o ON o.product_id = p.id WHERE p.name = 'Old phone'").get();
  assert.equal(old.category, 'Mobiles');
  assert.equal(old.first_seen_at, null);
  assert.equal(fk.calls[0].headers['Fk-Affiliate-Token'], 'tok');

  const second = await runner.runAll();
  assert.equal(second.results[0].new, 1);
  assert.equal(second.results[0].updated, 1);
  const items = newArrivals(db).items;
  assert.equal(items.length, 1);
  assert.equal(items[0].name, 'Nimbus X 5G');
  assert.equal(items[0].category, 'Mobiles');
  assert.equal(items[0].store, 'Flipkart');
  assert.ok(items[0].url.startsWith('https://'));

  // 25 days later it is no longer a new arrival for the 20 day window.
  assert.equal(newArrivals(db, { days: 20, now: new Date(Date.now() + 25 * 86400_000) }).items.length, 0);
});

test('Amazon: newest-arrival searches use the release date when given', async () => {
  const db = openDb(':memory:');
  seed(db, { purchaseDays: 5 });
  const old = new Date(Date.now() - 40 * 86400_000).toISOString();
  const fresh = new Date(Date.now() - 3 * 86400_000).toISOString();
  const bodies = [];
  const fetch = async (url, opts) => {
    if (url.includes('/auth/o2/token')) return json({ access_token: 'T', expires_in: 3600 });
    bodies.push({ url, headers: opts.headers, body: JSON.parse(opts.body) });
    return json({ searchResult: { items: [
      { asin: 'B0NEW', detailPageURL: 'https://www.amazon.in/dp/B0NEW', itemInfo: { title: { displayValue: 'Fresh kurta' }, productInfo: { releaseDate: { displayValue: fresh } } }, offersV2: { listings: [{ price: { money: { amount: 699 } } }] } },
      { asin: 'B0OLD', detailPageURL: 'https://www.amazon.in/dp/B0OLD', itemInfo: { title: { displayValue: 'Older kurta' }, productInfo: { releaseDate: { displayValue: old } } }, offersV2: { listings: [{ price: { money: { amount: 599 } } }] } },
    ] } });
  };
  const env = { AMAZON_CREATORS_CLIENT_ID: 'id', AMAZON_CREATORS_CLIENT_SECRET: 's', AMAZON_PARTNER_TAG: 'cz-21',
    AMAZON_SEARCHES: JSON.stringify([{ keywords: 'kurta', searchIndex: 'Fashion', category: 'Fashion & Clothing', subCategory: "Women's Wear" }]) };
  const runner = createFeedRunner(db, feedsFromEnv(env, { fetch }));
  const r = await runner.runAll();
  assert.equal(r.results[0].ok, true, r.results[0].error);
  assert.equal(r.results[0].new, 2);
  assert.equal(bodies[0].body.sortBy, 'NewestArrivals');
  assert.equal(bodies[0].body.marketplace, 'www.amazon.in');
  assert.equal(bodies[0].headers.Authorization, 'Bearer T');
  const items = newArrivals(db, { days: 20 }).items;
  assert.deepEqual(items.map(i => i.name), ['Fresh kurta']);
  assert.equal(items[0].sub_category, "Women's Wear");

  // A second run updates prices and doesn't duplicate products.
  const again = await runner.runAll();
  assert.equal(again.results[0].new, 0);
  assert.equal(again.results[0].updated, 2);
});

test('API: new arrivals, feed status, and running feeds needs the admin key', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cz-'));
  const db = openDb(':memory:');
  seed(db, { purchaseDays: 5 });
  const fk = fakeFlipkart();
  const feedRunner = createFeedRunner(db, feedsFromEnv({ FLIPKART_AFFILIATE_ID: 'aff1', FLIPKART_AFFILIATE_TOKEN: 'tok', FLIPKART_CATEGORIES: '{"mobiles":"Mobiles"}' }, { fetch: fk.fetch }));
  const server = createApp(db, { uploadsDir: path.join(dir, 'u'), adminKey: 'k', feedRunner }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const status = await (await fetch(`${base}/api/feeds`)).json();
    assert.deepEqual(status.connected, ['Flipkart']);
    assert.ok(status.notConnected.Meesho);
    assert.equal((await fetch(`${base}/api/admin/feeds/run`, { method: 'POST' })).status, 401);
    const run = p => fetch(`${base}/api/admin/feeds/run`, { method: 'POST', headers: { 'X-Admin-Key': 'k' } }).then(r => r.json());
    await run(); await run();
    const na = await (await fetch(`${base}/api/new-arrivals?days=20&category=Mobiles`)).json();
    assert.equal(na.days, 20);
    assert.equal(na.items.length, 1);
    // Feed products show up in normal search with a real store link.
    const found = await (await fetch(`${base}/api/products?q=Nimbus X`)).json();
    const detail = await (await fetch(`${base}/api/products/${found[0].id}`)).json();
    assert.match(detail.offers[0].buyUrl, /^https:\/\/dl\.flipkart\.com/);
  } finally { server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
