const { test } = require('node:test');
const assert = require('node:assert');
const { checkVariant } = require('../server/variant');
const { createSerpApi, storeName, storeLink } = require('../server/serpapi');
const { createStoreSearch } = require('../server/store-search');
const { openDb } = require('../server/db');
const { seed } = require('../server/seed');

test('variant check: same model and size only', () => {
  const ok = t => checkVariant('Google Pixel 11 128GB', t).ok;
  assert.ok(ok('Google Pixel 11 (Obsidian, 128 GB) (12 GB RAM)'));
  assert.ok(ok('Pixel 11 5G 128GB Porcelain'));
  assert.ok(!ok('Google Pixel 11 Pro 128GB'));
  assert.ok(!ok('Google Pixel 11a 128GB'));
  assert.ok(!ok('Google Pixel 11 256GB'));
  assert.ok(!ok('Google Pixel 10 128GB'));
  assert.ok(!ok('Tempered Glass for Google Pixel 11'));
  assert.ok(!ok('Google Pixel 11 128GB (Renewed)'));
  assert.equal(checkVariant('Google Pixel 11 128GB', 'Google Pixel 11').sizeConfirmed, false);
  assert.match(checkVariant('Google Pixel 11 128GB', 'Google Pixel 11a 128GB').reason, /different model \(11a\)/);
  // Searches without a model number or size are left alone.
  assert.ok(checkVariant('cotton kurta set', 'Cotton kurta set with dupatta, used for festivals').ok);
});

test('store names and links', () => {
  assert.equal(storeName('Amazon.in - Seller'), 'Amazon.in');
  assert.equal(storeName('Flipkart'), 'Flipkart');
  assert.equal(storeName('EMI Snapmint'), 'Snapmint');
  assert.equal(storeName('Reliance Digital'), 'Reliance Digital');
  assert.equal(storeLink('https://www.croma.com/p/123?srsltid=abc&x=1'), 'https://www.croma.com/p/123?x=1');
  assert.equal(storeLink('https://www.google.com/shopping/product/1'), null);
  assert.equal(storeLink('javascript:alert(1)'), null);
});

function fakeFetch(calls) {
  return async url => {
    const u = new URL(url);
    calls.push(Object.fromEntries(u.searchParams));
    assert.equal(u.searchParams.get('gl'), 'in');
    const engine = u.searchParams.get('engine');
    const json = engine === 'google_shopping' ? {
      shopping_results: [
        { title: 'Google Pixel 11 128GB Obsidian', source: 'Flipkart', extracted_price: 74999, immersive_product_page_token: 'T1', product_link: 'https://www.google.com/shopping/product/1', thumbnail: 'https://encrypted-tbn0.gstatic.com/a.jpg' },
        { title: 'Google Pixel 11 Pro 128GB', source: 'Flipkart', extracted_price: 104999, immersive_product_page_token: 'T2' },
        { title: 'Spigen case for Google Pixel 11', source: 'Amazon.in', extracted_price: 1499, immersive_product_page_token: 'T3' },
        { title: 'Google Pixel 11 5G 128 GB', source: 'JioMart', extracted_price: 77999, product_link: 'https://www.google.com/shopping/product/9' },
        { title: 'Google Pixel 11 128GB', source: 'JioMart', extracted_price: 78999 },
        { title: 'Google Pixel 11 128GB', source: 'Some Shop', extracted_price: 73999 },
        { title: 'Google Pixel 11 128GB', source: 'Amazon.in', extracted_price: 76999 },
      ],
      inline_shopping_results: [
        { title: 'Google Pixel 11 128 GB', source: 'Vijay Sales', extracted_price: 75490, link: 'https://www.vijaysales.com/p/pixel-11?srsltid=x' },
      ],
    } : engine === 'google_immersive_product' && u.searchParams.get('page_token') === 'T1' ? {
      product_results: {
        title: 'Google Pixel 11 128GB',
        stores: [
          { name: 'Flipkart', link: 'https://www.flipkart.com/google-pixel-11/p/itm1?srsltid=y', title: 'Google Pixel 11 (Obsidian, 128 GB)', extracted_price: 74999, extracted_original_price: 79999 },
          { name: 'Amazon.in', link: 'https://www.amazon.in/dp/B0PIXEL11', title: 'Google Pixel 11 5G 128GB', extracted_price: 76490 },
          { name: 'Croma', link: 'https://www.croma.com/p/1', title: 'Google Pixel 11 256GB', extracted_price: 86999 },
          { name: 'Google', link: 'https://www.google.com/x', extracted_price: 70000 },
        ],
      },
    } : {};
    return { ok: true, status: 200, json: async () => json };
  };
}

test('SerpApi source: exact product, store links, few searches, cached', async () => {
  const calls = [];
  let t = 0;
  const s = createSerpApi({ apiKey: 'k', fetch: fakeFetch(calls), detailLookups: 2, now: () => t });
  assert.equal(s.connected, true);
  const r = await s.findProducts('Google Pixel 11 128GB');
  // JioMart has only a Google link, so it opens JioMart's search; Amazon.in already has its own link; Some Shop has none.
  assert.deepEqual(r.results.map(x => [x.store, x.price]), [['Flipkart', 74999], ['Vijay Sales', 75490], ['Amazon.in', 76490], ['JioMart', 77999]]);
  assert.equal(r.results[3].url, 'https://www.jiomart.com/search/Google%20Pixel%2011%20128GB');
  assert.match(r.note, /1 link opens the store's search/);
  assert.match(r.note, /Skipped 1 listing/);
  assert.deepEqual(r.details.leftOut.map(x => x.reason), ['different model (pro)', 'accessory or not new']);
  assert.deepEqual(r.details.noLink.map(x => x.store), ['Some Shop']);
  assert.equal(r.details.found, 8);
  assert.equal(r.results[0].url, 'https://www.flipkart.com/google-pixel-11/p/itm1');
  assert.equal(r.results[0].mrp, 79999);
  assert.equal(r.results[0].image, 'https://encrypted-tbn0.gstatic.com/a.jpg');
  assert.equal(r.results[1].url, 'https://www.vijaysales.com/p/pixel-11');
  // Only the exact match was looked up: 1 shopping search + 1 detail lookup.
  assert.deepEqual(calls.map(c => c.engine), ['google_shopping', 'google_immersive_product']);
  assert.match(r.note, /Used 2 SerpApi searches/);
  assert.match(r.note, /Left out 2/);
  const again = await s.findProducts('google pixel 11 128gb');
  assert.equal(calls.length, 2);
  assert.match(again.note, /no search used/);
  t = 7 * 3600_000;
  await s.findProducts('Google Pixel 11 128GB');
  assert.equal(calls.length, 4);
});

test('SerpApi errors are explained; no key means not connected', async () => {
  const bad = createSerpApi({ apiKey: 'k', fetch: async () => ({ ok: false, status: 401, json: async () => ({ error: 'Invalid API key.' }) }) });
  await assert.rejects(bad.findProducts('pixel 11'), /not valid/);
  const empty = createSerpApi({ apiKey: 'k', fetch: async () => ({ ok: true, status: 200, json: async () => ({ error: "Google hasn't returned any results for this query." }) }) });
  assert.deepEqual((await empty.findProducts('zzzz 999')).results, []);
  assert.equal(createSerpApi().connected, false);
});

test('Find in stores: other models are shown as not the same product', async () => {
  const db = openDb(':memory:');
  seed(db);
  const s = createStoreSearch(db, { sources: [{ name: 'X', find: async () => [
    { store: 'Flipkart', title: 'Google Pixel 11 (Obsidian, 128 GB)', price: 74999, url: 'https://www.flipkart.com/p/1' },
    { store: 'Flipkart', title: 'Google Pixel 11 Pro 128GB', price: 104999, url: 'https://www.flipkart.com/p/2' },
    { store: 'Snapmint', title: 'Google Pixel 11 (Hibiscus)', price: 77599, url: 'https://snapmint.com/p/1' },
  ] }] });
  const r = await s.search('Google Pixel 11 128GB');
  assert.deepEqual(r.results.map(x => [x.price, x.match]), [[74999, 'exact'], [77599, 'close'], [104999, 'close']]);
  assert.match(r.results[1].why, /size not stated/);
  assert.match(r.results[2].why, /different model \(pro\)/);
});
