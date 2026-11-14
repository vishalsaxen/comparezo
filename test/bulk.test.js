const { test } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { openDb } = require('../server/db');
const { seed } = require('../server/seed');
const { createApp } = require('../server/app');
const { addProduct } = require('../server/catalog');
const { storeFromUrl, money } = require('../server/bulk');
const { createEarnKaro } = require('../server/earnkaro');
const { createAdmitad } = require('../server/admitad');
const Sheet = require('../public/sheet');

async function withServer(fn, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cz-'));
  const db = openDb(':memory:');
  seed(db);
  assert.ok(addProduct(db, { name: 'Bedsheet', category: 'Home', offers: [{ store: 'Amazon.in', price: 549, url: 'https://www.amazon.in/dp/BED' }] }, 'manual').id);
  const server = createApp(db, { uploadsDir: path.join(dir, 'uploads'), adminKey: 'k', ...opts }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base, db); } finally { server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}
const h = { 'Content-Type': 'application/json', 'X-Admin-Key': 'k' };

test('store names and prices are read from what people type in a sheet', () => {
  assert.equal(storeFromUrl('https://www.amazon.in/dp/X'), 'Amazon.in');
  assert.equal(storeFromUrl('https://dl.flipkart.com/s/abc'), 'Flipkart');
  assert.equal(storeFromUrl('https://www.giftshop.co.in/item/1'), 'Giftshop');
  assert.equal(storeFromUrl('not a link'), '');
  assert.equal(money('₹1,299.00'), 1299);
  assert.equal(money('Rs. 499'), 499);
  assert.ok(Number.isNaN(money('')));
});

test('owner uploads a sheet: rows with the same name become one product, bad rows are reported', async () => {
  await withServer(async (base, db) => {
    const post = body => fetch(`${base}/api/admin/products/bulk`, { method: 'POST', headers: h, body: JSON.stringify(body) });
    assert.equal((await fetch(`${base}/api/admin/products/bulk`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"rows":[]}' })).status, 401);
    assert.equal((await post({ rows: [] })).status, 400);
    const r = await (await post({
      defaults: { category: 'Electronics' },
      rows: [
        { row: 2, name: 'Boat Airdopes 141', image: 'https://img.example.com/a.jpg', url: 'https://www.amazon.in/dp/B1', price: '₹1,299' },
        { row: 3, name: 'boat airdopes 141', url: 'https://www.flipkart.com/p/B1', price: 1249, mrp: '4,490' },
        { row: 4, name: 'Cotton kurta', url: 'http://www.myntra.com/k/1', price: 749, category: 'fashion & clothing', subCategory: "women's wear" },
        { row: 5, name: 'No price', url: 'https://www.ajio.com/x' },
        { row: 6, name: 'Bedsheet', url: 'https://www.flipkart.com/bed', price: 499, image: 'https://img.example.com/bed.jpg' },
        { row: 7, name: 'Bedsheet', url: 'https://www.amazon.in/dp/BED', price: 549 },
        { row: 8, name: '', url: 'https://www.amazon.in/dp/Z', price: 10 },
      ],
    })).json();
    assert.deepEqual({ added: r.added, updated: r.updated, stores: r.stores, skipped: r.skipped }, { added: 2, updated: 1, stores: 4, skipped: 1 });
    assert.deepEqual(r.problems.map(p => p.row), [5, 8]);
    assert.match(r.problems[0].error, /price/);

    const products = await (await fetch(`${base}/api/admin/products`, { headers: h })).json();
    const buds = products.find(p => p.name === 'Boat Airdopes 141');
    assert.equal(buds.category, 'Electronics');
    assert.equal(buds.image, 'https://img.example.com/a.jpg');
    assert.deepEqual(buds.offers.map(o => [o.store, o.price, o.mrp]).sort(), [['Amazon.in', 1299, null], ['Flipkart', 1249, 4490]]);
    const kurta = products.find(p => p.name === 'Cotton kurta');
    assert.deepEqual([kurta.category, kurta.sub_category, kurta.offers[0].url, kurta.offers[0].store], ['Fashion & Clothing', "Women's Wear", 'https://www.myntra.com/k/1', 'Myntra']);
    const bed = products.find(p => p.name === 'Bedsheet');
    assert.equal(bed.offers.length, 2);
    assert.equal(bed.image, 'https://img.example.com/bed.jpg');   // filled in, as it had none

    // Uploading the same sheet again adds nothing new.
    const again = await (await post({ defaults: { category: 'Electronics' }, rows: [{ name: 'Boat Airdopes 141', url: 'https://www.amazon.in/dp/B1', price: 1299 }] })).json();
    assert.deepEqual([again.added, again.updated, again.skipped], [0, 0, 1]);
    // No category anywhere: the row is reported.
    const nocat = await (await post({ rows: [{ row: 2, name: 'Pen', url: 'https://www.amazon.in/dp/P', price: 10 }] })).json();
    assert.equal(nocat.added, 0);
    assert.match(nocat.problems[0].error, /category/i);
  });
});

test('affiliate links: EarnKaro first, then Admitad for joined stores, with a note when neither can', async () => {
  const earnkaro = createEarnKaro({ apiKey: 'ek', fetch: async (_u, o) => {
    const deal = JSON.parse(o.body).deal;
    return { ok: true, status: 200, json: async () => (deal.includes('flipkart') ? { data: 'https://ekaro.in/enkr1' } : { data: deal }) };
  } });
  const calls = [];
  const admitad = createAdmitad({ clientId: 'id', clientSecret: 'sec', websiteId: '42', fetch: async (url, o = {}) => {
    calls.push({ url, body: o.body });
    if (url.endsWith('/token/')) return { ok: true, status: 200, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
    if (url.includes('/advcampaigns/')) return { ok: true, status: 200, json: async () => ({ results: [{ id: 7, name: 'Ajio', site_url: 'https://www.ajio.com/' }] }) };
    if (url.includes('/deeplink/42/advcampaign/7/')) return { ok: true, status: 200, json: async () => ['https://ad.admitad.com/g/xyz/?ulp=' + encodeURIComponent('https://www.ajio.com/p/1')] };
    return { ok: false, status: 404, json: async () => ({}) };
  } });
  await withServer(async base => {
    const r = await (await fetch(`${base}/api/admin/affiliate-links`, { method: 'POST', headers: h, body: JSON.stringify({ urls: ['https://www.flipkart.com/p/1', 'https://www.ajio.com/p/1', 'https://www.nykaa.com/p/1', 'ftp://x'] }) })).json();
    assert.deepEqual(r.results.map(x => [x.via, x.link && x.link.slice(0, 26)]), [['EarnKaro', 'https://ekaro.in/enkr1'], ['Admitad', 'https://ad.admitad.com/g/x'], [null, null], [null, null]]);
    assert.match(r.results[2].note, /not joined/);
    assert.match(calls[0].body, /scope=advcampaigns_for_website\+deeplink_generator/);
  }, { earnkaro, admitad });
});

test('sheet.js writes an .xlsx and reads it back, and reads CSV', async () => {
  const blob = Sheet.writeXlsx([['Name', 'URL', 'Price'], ['Kurta & "dupatta" <set>', 'https://x.com/?a=1&b=2', 749], ['नोटबुक', '', '']]);
  const rows = await Sheet.readXlsx(await blob.arrayBuffer());
  assert.deepEqual(rows, [['Name', 'URL', 'Price'], ['Kurta & "dupatta" <set>', 'https://x.com/?a=1&b=2', '749'], ['नोटबुक']]);
  assert.deepEqual(Sheet.readCsv('﻿Name,URL\r\n"Pen, blue","https://a.com"\n'), [['Name', 'URL'], ['Pen, blue', 'https://a.com']]);
  assert.deepEqual(Sheet.readCsv('Name;Price\nPen;10'), [['Name', 'Price'], ['Pen', '10']]);
});
