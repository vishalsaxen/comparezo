const { test } = require('node:test');
const assert = require('node:assert');
const { createBrightData, createShoppingSearch, rupees } = require('../server/brightdata');

const reply = (status, body) => async () => ({ ok: status < 400, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });

test('rupee prices are read from text', () => {
  assert.equal(rupees('₹77,599.00'), 77599);
  assert.equal(rupees('Rs. 549'), 549);
  assert.equal(rupees(''), null);
});

test('Bright Data: one request, exact product only, store links or store search', async () => {
  let sent = null;
  const fetch = async (url, init) => {
    sent = { url, init, body: JSON.parse(init.body) };
    return reply(200, { shopping: [
      { title: 'Tata Tea Gold 1kg', price: '₹549.00', shop: 'Amazon.in', link: 'https://www.amazon.in/dp/B0TEA?srsltid=x', image: 'https://m.media-amazon.com/a.jpg' },
      { title: 'Tata Tea Gold 1 kg Pack', price: '₹555', shop: 'Flipkart' },
      { title: 'Tata Tea Gold 500 g', price: '₹280', shop: 'BigBasket' },
      { title: 'Tata Tea Gold 1 Kg', price: '₹560', shop: 'Local Kirana', image: 'data:image/png;base64,xx' },
    ] })();
  };
  const b = createBrightData({ apiKey: 'K', zone: 'serp_api1', fetch });
  assert.equal(b.connected, true);
  const r = await b.findProducts('Tata Tea Gold 1 kg');
  assert.equal(sent.url, 'https://api.brightdata.com/request');
  assert.equal(sent.init.headers.Authorization, 'Bearer K');
  assert.equal(sent.body.zone, 'serp_api1');
  assert.match(sent.body.url, /tbm=shop/);
  assert.match(sent.body.url, /gl=in/);
  assert.deepEqual(r.results.map(x => [x.store, x.price]), [['Amazon.in', 549], ['Flipkart', 555]]);
  assert.equal(r.results[0].url, 'https://www.amazon.in/dp/B0TEA');
  assert.equal(r.results[0].image, 'https://m.media-amazon.com/a.jpg');
  assert.match(r.results[1].url, /^https:\/\/www\.flipkart\.com\/search\?q=/);
  assert.match(r.note, /Used 1 Bright Data request/);
  assert.match(r.note, /Left out 1/);
  assert.match(r.note, /Skipped 1 listing/);
  assert.deepEqual(r.details.noLink.map(x => x.store), ['Local Kirana']);
  assert.equal(createBrightData({ apiKey: 'K' }).connected, false);   // zone is needed too
});

test('Bright Data errors are explained', async () => {
  await assert.rejects(createBrightData({ apiKey: 'K', zone: 'z', fetch: reply(401, 'bad') }).findProducts('tea 1 kg'), /not valid/);
  await assert.rejects(createBrightData({ apiKey: 'K', zone: 'z', fetch: reply(200, '<html></html>') }).findProducts('tea 1 kg'), /parsed JSON/);
});

test('Google Shopping uses SerpApi first and Bright Data when SerpApi fails', async () => {
  const serpapi = { connected: true, findProducts: async () => { throw new Error('SerpApi searches for this month are used up.'); } };
  const brightdata = { connected: true, findProducts: async () => ({ results: [{ store: 'Amazon.in', title: 't', price: 1, url: 'https://www.amazon.in/dp/X' }], note: 'Used 1 Bright Data request.' }) };
  const s = createShoppingSearch([{ name: 'SerpApi', api: serpapi }, { name: 'Bright Data', api: brightdata }]);
  const r = await s.findProducts('x');
  assert.equal(r.results.length, 1);
  assert.match(r.note, /^Through Bright Data \(SerpApi failed: SerpApi searches for this month are used up\.\)\. Used 1 Bright Data request\./);

  const ok = createShoppingSearch([{ name: 'SerpApi', api: { connected: true, findProducts: async () => ({ results: [], note: 'Used 1 SerpApi search.' }) } }, { name: 'Bright Data', api: brightdata }]);
  assert.match((await ok.findProducts('x')).note, /^Through SerpApi\. Used 1 SerpApi search\./);

  const only = createShoppingSearch([{ name: 'SerpApi', api: { connected: false } }, { name: 'Bright Data', api: brightdata }]);
  assert.deepEqual(only.names, ['Bright Data']);
  assert.match((await only.findProducts('x')).note, /^Used 1 Bright Data request\./);   // one provider: no "Through"

  const both = createShoppingSearch([{ name: 'SerpApi', api: serpapi }, { name: 'Bright Data', api: { connected: true, findProducts: async () => { throw new Error('down'); } } }]);
  await assert.rejects(both.findProducts('x'), /SerpApi failed.*Bright Data failed: down/);
  assert.equal(createShoppingSearch([]).connected, false);
});
