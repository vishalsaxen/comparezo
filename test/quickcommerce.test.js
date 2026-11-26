const { test } = require('node:test');
const assert = require('node:assert');
const { createQuickCommerce } = require('../server/quickcommerce');

const answer = (status, body) => async () => ({ ok: status < 400, status, json: async () => body });

test('QuickCommerce API: one grouped search, exact product, in stock, app names', async () => {
  let sent = null;
  const fetch = async (url, init) => {
    sent = { url: new URL(url), init };
    return answer(200, { status: 'success', credits_remaining: 96, data: {
      results: {
        BlinkIt: { products: [
          { name: 'Tata Tea Gold', quantity: '1 kg', offer_price: 549, mrp: 620, deeplink: 'https://blinkit.com/prn/tata-tea-gold/prid/1', images: ['https://cdn.grofers.com/a.jpg'], available: true, platform: { name: 'BlinkIt', sla: '9 mins' } },
          { name: 'Tata Tea Gold', quantity: '500 g', offer_price: 289, deeplink: 'https://blinkit.com/prn/x/prid/2', available: true },
        ] },
        Zepto: { products: [
          { name: 'Tata Tea Gold 1kg', quantity: '1 kg', offer_price: 545, mrp: 620, deeplink: 'https://www.zeptonow.com/pn/tata/pvid/3', available: false },
        ] },
        Swiggy: [
          { name: 'Tata Tea Gold Tea', quantity: '1 Kg', offer_price: '₹555', deeplink: 'https://www.swiggy.com/instamart/item/4', available: true },
        ],
      },
      failed_platforms: ['BigBasket'],
    } })();
  };
  const qc = createQuickCommerce({ apiKey: 'KEY', fetch, lat: 28.6, lon: 77.2 });
  assert.equal(qc.connected, true);
  const r = await qc.findProducts('Tata Tea Gold 1 kg');
  assert.equal(sent.url.origin + sent.url.pathname, 'https://api.quickcommerceapi.com/v1/groupsearch');
  assert.equal(sent.init.headers['X-API-Key'], 'KEY');
  assert.equal(sent.url.searchParams.get('platforms'), 'BlinkIt,Zepto,Swiggy,BigBasket');
  assert.equal(sent.url.searchParams.get('lat'), '28.6');
  assert.deepEqual(r.results.map(x => [x.store, x.price]), [['Blinkit', 549], ['Swiggy Instamart', 555]]);
  assert.equal(r.results[0].title, 'Tata Tea Gold 1 kg');
  assert.equal(r.results[0].mrp, 620);
  assert.equal(r.results[0].image, 'https://cdn.grofers.com/a.jpg');
  assert.match(r.note, /Used 3 credits, 96 left/);
  assert.match(r.note, /Left out 1/);
  assert.match(r.note, /1 out of stock/);
  assert.match(r.note, /No answer from BigBasket/);
  // The same search again uses no credits.
  const again = await qc.findProducts('tata tea gold 1 kg');
  assert.match(again.note, /no credits used/);
});

test('QuickCommerce API: DMart, JioMart and Minutes need a pincode; errors are explained', async () => {
  assert.deepEqual(createQuickCommerce({ apiKey: 'K', platforms: ['BlinkIt', 'DMart'] }).platforms, ['BlinkIt']);
  assert.deepEqual(createQuickCommerce({ apiKey: 'K', platforms: ['BlinkIt', 'DMart'], pincode: '560001' }).platforms, ['BlinkIt', 'DMart']);
  assert.equal(createQuickCommerce({ apiKey: '' }).connected, false);
  await assert.rejects(createQuickCommerce({ apiKey: 'K', fetch: answer(402, { status: 'error' }) }).findProducts('milk'), /credits are used up/);
  await assert.rejects(createQuickCommerce({ apiKey: 'K', fetch: answer(401, {}) }).findProducts('milk'), /not valid/);
});
