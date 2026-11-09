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

async function withServer(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cz-'));
  const db = openDb(':memory:');
  seed(db, { purchaseDays: 60 });
  const server = createApp(db, { uploadsDir: path.join(dir, 'uploads') }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

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
