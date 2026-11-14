const { test } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { openDb } = require('../server/db');
const { seed } = require('../server/seed');
const { createApp } = require('../server/app');
const { addProduct } = require('../server/catalog');
const { createStoreSearch, score } = require('../server/store-search');
const { createAdmitad, feedParser } = require('../server/admitad');

test('match score: share of search words in the title', () => {
  assert.equal(score('boAt Airdopes 141', 'boAt Airdopes 141 TWS Earbuds (Black)'), 1);
  assert.equal(score('boat airdopes 141', 'boAt Airdopes 131 Earbuds'), 2 / 3);
  assert.equal(score('Nescafé classic', 'NESCAFE Classic Coffee 200 g'), 1);
  assert.equal(score('earbud', 'Wireless earbuds'), 1);
  assert.equal(score('the', 'anything'), 0);
});

test('store search merges sources, drops bad rows, survives a broken source, and flags products already on the site', async () => {
  const db = openDb(':memory:');
  seed(db);
  assert.ok(addProduct(db, { name: 'boAt Airdopes 141', category: 'Electronics', offers: [{ store: 'Amazon.in', price: 1199, url: 'https://www.amazon.in/dp/X' }] }, 'manual').id);
  const s = createStoreSearch(db, {
    timeoutMs: 200,
    notConnected: { Meesho: 'No API.' },
    sources: [
      { name: 'Admitad', find: async () => [
        { store: 'Croma', title: 'boAt Airdopes 141 TWS Earbuds', price: '1,199', mrp: 4490, url: 'https://ad.admitad.com/g/1/', image: '//img.croma.com/1.png' },
        { store: 'Croma', title: 'boAt Airdopes 141 TWS Earbuds', price: 1199, url: 'https://ad.admitad.com/g/1/' },   // same link again
        { store: 'Croma', title: 'boAt Rockerz 450 headphones', price: 1499, url: 'https://ad.admitad.com/g/2/' },   // doesn't match
        { store: 'Croma', title: 'boAt Airdopes 141 no price', price: 0, url: 'https://ad.admitad.com/g/3/' },
      ] },
      { name: 'Amazon.in', find: async () => [
        { store: 'Amazon.in', title: 'boAt Airdopes 141 Bluetooth Earbuds', price: 1149, mrp: 1000, url: 'http://www.amazon.in/dp/B1', image: 'ftp://x' },
        { store: 'Amazon.in', title: 'boAt Airdopes 131 Earbuds', price: 899, url: 'https://www.amazon.in/dp/B2' },
      ] },
      { name: 'Flipkart', find: async () => { throw new Error('Flipkart 401'); } },
      { name: 'Slow', find: () => new Promise(() => {}) },
    ],
  });
  const r = await s.search('boAt Airdopes 141');
  assert.deepEqual(r.results.map(x => [x.store, x.price, x.match]), [['Amazon.in', 1149, 'exact'], ['Croma', 1199, 'exact'], ['Amazon.in', 899, 'close']]);
  assert.deepEqual(r.results.map(x => x.id), [1, 2, 3]);
  const amazon = r.results[0];
  assert.equal(amazon.url, 'https://www.amazon.in/dp/B1');   // upgraded to https
  assert.equal(amazon.image, null);                            // not an https photo link
  assert.equal(amazon.mrp, null);                              // MRP below the price is ignored
  assert.equal(r.results[1].image, 'https://img.croma.com/1.png');
  assert.equal(r.results[1].mrp, 4490);
  assert.deepEqual(r.sources.map(x => [x.name, x.ok]), [['Admitad', true], ['Amazon.in', true], ['Flipkart', false], ['Slow', false]]);
  assert.match(r.sources.find(x => x.name === 'Flipkart').error, /401/);
  assert.deepEqual(r.onSite.map(p => p.name), ['boAt Airdopes 141']);
  assert.deepEqual(r.notConnected, { Meesho: 'No API.' });
  assert.match((await s.search('  ')).error, /Type a product name/);
});

test('Admitad product search reads joined stores\' CSV feeds as a stream', async () => {
  const csv = [
    'id;name;price;oldprice;currencyId;picture;url;available',
    '1;"boAt Airdopes 141; Black";1199.00;4490;INR;https://img.croma.com/a.png;https://ad.admitad.com/g/a/;true',
    '2;boAt Airdopes 141 White;1249;;INR;http://img.croma.com/b.png,https://img.croma.com/b2.png;https://ad.admitad.com/g/b/;false',
    '3;boAt Airdopes 141 in dollars;15;;USD;;https://ad.admitad.com/g/c/;true',
    '4;"Sony ""WH"" headphones";9999;;INR;;https://ad.admitad.com/g/d/;true',
    '5;boAt Airdopes 141 Blue;1299;;INR;;https://ad.admitad.com/g/e/;true',
  ].join('\r\n') + '\r\n';
  const calls = [];
  const fakeFetch = async (url, opts = {}) => {
    calls.push(url);
    if (url.endsWith('/token/')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }));
    if (url.includes('/advcampaigns/website/42/')) return new Response(JSON.stringify({ results: [
      { id: 7, name: 'Croma IN', site_url: 'https://www.croma.com/', feeds_info: [{ name: 'main', csv_link: 'https://export.admitad.com/feed.csv?code=x' }] },
      { id: 8, name: 'NoFeed', site_url: 'https://nofeed.in/' },
    ] }));
    if (url.startsWith('https://export.admitad.com/feed.csv')) {
      // Send the file in small pieces, split mid-line, like a real download.
      const enc = new TextEncoder().encode(csv);
      const body = new ReadableStream({ start(c) { for (let i = 0; i < enc.length; i += 17) c.enqueue(enc.slice(i, i + 17)); c.close(); } });
      return new Response(body);
    }
    return new Response('{}', { status: 404 });
  };
  const admitad = createAdmitad({ clientId: 'id', clientSecret: 's', websiteId: '42', fetch: fakeFetch });
  const found = await admitad.findProducts('boat airdopes 141', { limit: 10, matches: t => /airdopes 141/i.test(t) });
  assert.deepEqual(found.map(f => [f.store, f.title, f.price, f.mrp, f.image]), [
    ['Croma', 'boAt Airdopes 141; Black', 1199, 4490, 'https://img.croma.com/a.png'],
    ['Croma', 'boAt Airdopes 141 Blue', 1299, null, null],
  ]);
  const one = await admitad.findProducts('boat airdopes 141', { limit: 1, matches: () => true });
  assert.equal(one.length, 1);
  assert.equal(await createAdmitad({}).findProducts('x').then(r => r.length), 0);

  // The parser keeps quoted separators and line breaks inside a value.
  const p = feedParser();
  const rows = [...p.push('name,price\n"Kettle, 1.5 L'), ...p.push('\nsteel",999\n')];
  assert.deepEqual(rows, [{ name: 'Kettle, 1.5 L\nsteel', price: '999' }]);
});

test('GET /api/admin/store-search needs the admin key; Admitad links skip EarnKaro on Buy', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cz-'));
  const db = openDb(':memory:');
  seed(db);
  const id = addProduct(db, { name: 'Kettle', category: 'Electronics', offers: [{ store: 'Croma', price: 999, url: 'https://ad.admitad.com/g/k/' }, { store: 'Flipkart', price: 1099, url: 'https://www.flipkart.com/k' }] }, 'manual').id;
  const storeSearch = { search: async q => ({ q, results: [{ id: 1, store: 'Croma', title: q, price: 1, url: 'https://x.in/' }], sources: [] }) };
  const earnkaro = { connected: true, convert: async u => `https://ekaro.in/?u=${encodeURIComponent(u)}` };
  const server = createApp(db, { uploadsDir: path.join(dir, 'u'), adminKey: 'k', storeSearch, earnkaro }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/api/admin/store-search?q=kettle`)).status, 401);
    const r = await (await fetch(`${base}/api/admin/store-search?q=kettle`, { headers: { 'X-Admin-Key': 'k' } })).json();
    assert.equal(r.results[0].title, 'kettle');
    const offers = db.prepare('SELECT id, store FROM offers WHERE product_id = ?').all(id);
    const go = async store => (await fetch(`${base}/api/go/${offers.find(o => o.store === store).id}`, { redirect: 'manual' })).headers.get('location');
    assert.equal(await go('Croma'), 'https://ad.admitad.com/g/k/');
    assert.match(await go('Flipkart'), /^https:\/\/ekaro\.in\//);
  } finally { server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the default store search lists what is not connected', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cz-'));
  const db = openDb(':memory:');
  seed(db);
  const server = createApp(db, { uploadsDir: path.join(dir, 'u'), adminKey: 'k' }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const r = await (await fetch(`${base}/api/admin/store-search?q=kettle`, { headers: { 'X-Admin-Key': 'k' } })).json();
    assert.deepEqual(r.results, []);
    assert.ok(r.notConnected.Admitad && r.notConnected.EarnKaro);
  } finally { server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Admitad 404 (no approved ad space or joined stores) becomes a friendly note, not an error', async () => {
  const fakeFetch = async url => url.endsWith('/token/')
    ? new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }))
    : new Response(JSON.stringify({ detail: 'Not Found' }), { status: 404 });
  const admitad = createAdmitad({ clientId: 'id', clientSecret: 's', websiteId: '42', fetch: fakeFetch });
  const db = openDb(':memory:');
  seed(db);
  const r = await createStoreSearch(db, { sources: [{ name: 'Admitad', find: admitad.findProducts }] }).search('kettle');
  assert.deepEqual(r.sources.map(s => [s.name, s.ok, s.count]), [['Admitad', true, 0]]);
  assert.match(r.sources[0].note, /ad space is approved/);

  // Other failures are still shown as errors.
  const broken = createAdmitad({ clientId: 'id', clientSecret: 's', websiteId: '42', fetch: async () => new Response('{}', { status: 500 }) });
  const r2 = await createStoreSearch(db, { sources: [{ name: 'Admitad', find: broken.findProducts }] }).search('kettle');
  assert.equal(r2.sources[0].ok, false);
});
