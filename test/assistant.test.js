const { test } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { openDb } = require('../server/db');
const { seed } = require('../server/seed');
const { addProduct } = require('../server/catalog');
const { compareOffers } = require('../server/pricing');
const { createAssistant } = require('../server/assistant');
const { createApp } = require('../server/app');

const offer = (store, price, extra = {}) => ({ store, price, url: `https://www.${store.toLowerCase().replace(/\W/g, '')}.com/p/${price}`, ...extra });
function makeDb() {
  const db = openDb(':memory:');
  seed(db);
  const tea = addProduct(db, { name: 'Tata Tea Gold 1 kg', category: 'Grocery & Daily Needs', subCategory: 'Packaged Goods', offers: [offer('Amazon.in', 560), offer('BigBasket', 545), offer('Flipkart', 580)] }, 'manual').id;
  assert.ok(tea);
  const buds = addProduct(db, { name: 'Wireless earbuds', category: 'Electronics', offers: [offer('Amazon.in', 1499)] }, 'manual').id;
  return { db, tea, buds };
}

// A fake Claude: replies with the scripted steps in order and records what it was sent.
function fakeClaude(steps, sent = []) {
  let i = 0;
  return async (url, init) => {
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    sent.push({ headers: init.headers, body: JSON.parse(init.body) });
    const step = typeof steps[i] === 'function' ? steps[i](sent[sent.length - 1].body) : steps[i];
    i++;
    return { ok: true, status: 200, json: async () => ({ usage: { input_tokens: 100, output_tokens: 20 }, ...step }) };
  };
}
const toolUse = (id, name, input, text = '') => ({ stop_reason: 'tool_use', content: [...(text ? [{ type: 'text', text }] : []), { type: 'tool_use', id, name, input }] });
const done = text => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] });

test('assistant searches the catalog and shows the cheapest store with a Buy link', async () => {
  const { db, tea } = makeDb();
  const sent = [];
  let found;
  const a = createAssistant(db, {
    apiKey: 'sk-test', model: 'claude-haiku-5-5', compareOffers, buyLink: (o) => `/api/go/${o.id}`,
    fetch: fakeClaude([
      toolUse('t1', 'search_products', { query: 'tata tea gold 1 kg' }),
      body => {
        found = JSON.parse(body.messages[body.messages.length - 1].content[0].content);
        return toolUse('t2', 'show_products', { ids: [found.results[0].id] }, 'Cheapest is **BigBasket at ₹545**.');
      },
      done('Cheapest is **BigBasket at ₹545**.'),
    ], sent),
  });
  const r = await a.chat([{ role: 'user', content: 'cheapest tata tea gold 1kg?' }], { owner: true });
  assert.equal(found.results[0].name, 'Tata Tea Gold 1 kg');
  assert.deepEqual(found.results[0].cheapest, { store: 'BigBasket', price: 545, delivery_days: 3 });
  assert.equal(r.reply, 'Cheapest is **BigBasket at ₹545**.');
  assert.equal(r.products.length, 1);
  assert.equal(r.products[0].id, tea);
  assert.equal(r.products[0].store, 'BigBasket');
  assert.match(r.products[0].buyUrl, /^\/api\/go\/\d+$/);
  // The request to Claude: key, model, tools, rules.
  assert.equal(sent[0].headers['x-api-key'], 'sk-test');
  assert.equal(sent[0].body.model, 'claude-haiku-5-5');
  assert.deepEqual(sent[0].body.tools.map(t => t.name), ['search_products', 'get_product', 'show_products']);
  assert.match(sent[0].body.system, /Never state a price/);
  assert.equal(a.usageToday().messages, 1);
  assert.equal(a.usageToday().input_tokens, 300);
});

test('assistant settings: off for shoppers by default, limits, live search only when allowed', async () => {
  const { db } = makeDb();
  let liveCalls = 0;
  const a = createAssistant(db, {
    apiKey: 'k', compareOffers, buyLink: () => null,
    liveSearch: async q => { liveCalls++; return { results: [{ store: 'Blinkit', title: q, price: 539, url: 'https://blinkit.com/prn/x/prid/1', match: 'exact' }] }; },
    linkFor: async u => u + '?aff=1',
    fetch: fakeClaude([
      toolUse('a', 'search_stores', { query: 'Tata Tea Gold 1 kg' }),
      toolUse('b', 'show_products', { refs: ['L1'] }),
      done('Blinkit has it for ₹539 right now.'),
    ]),
  });
  assert.equal(a.settings().enabled, false);
  assert.equal((await a.chat([{ role: 'user', content: 'hi' }])).status, 403);   // shoppers: off
  assert.deepEqual(a.saveSettings({ dailyLimit: -1 }).errors.length, 1);
  a.saveSettings({ enabled: true, liveSearch: true, liveLimit: 5, greeting: 'Namaste!' });
  assert.equal(a.settings().greeting, 'Namaste!');
  const r = await a.chat([{ role: 'user', content: 'tata tea gold 1 kg on blinkit?' }]);
  assert.equal(liveCalls, 1);
  assert.deepEqual(r.live, [{ store: 'Blinkit', title: 'Tata Tea Gold 1 kg', price: 539, buyUrl: 'https://blinkit.com/prn/x/prid/1?aff=1' }]);
  assert.equal(a.usageToday().live_searches, 1);
  // Daily limit reached → shoppers are told to come back; the owner can still try it.
  a.saveSettings({ dailyLimit: 1 });
  assert.equal((await a.chat([{ role: 'user', content: 'again' }])).status, 429);
});

test('assistant search finds products by some words when not all match, and respects a budget', () => {
  const { db } = makeDb();
  const a = createAssistant(db, { apiKey: 'k', compareOffers, buyLink: () => null });
  assert.equal(a.searchProducts({ query: 'tata gold tea' }).results[0].name, 'Tata Tea Gold 1 kg');
  const loose = a.searchProducts({ query: 'tata premium' });
  assert.equal(loose.results[0].name, 'Tata Tea Gold 1 kg');
  assert.match(loose.note, /some of them/);
  assert.equal(a.searchProducts({ query: 'earbuds', max_price: 1000 }).results.length, 0);
  assert.equal(a.getProduct({ id: 9999 }).error, 'No product with that id.');
});

test('assistant routes: public config, shopper and owner chat, admin settings', async () => {
  const { db } = makeDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cz-'));
  const server = createApp(db, { uploadsDir: path.join(dir, 'uploads'), adminKey: 'secret',
    assistantOptions: { apiKey: 'k', fetch: async () => ({ ok: true, status: 200, json: async () => done('Hello!') }) } }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (url, body, key) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { 'X-Admin-Key': key } : {}) }, body: JSON.stringify(body) });
  try {
    assert.deepEqual(await (await fetch(base + '/api/assistant/config')).json(), { enabled: false, greeting: "Hi! Tell me what you want to buy and I'll find the cheapest store on Comparezo." });
    const msg = { messages: [{ role: 'user', content: 'hi' }] };
    assert.equal((await post('/api/assistant/chat', msg)).status, 403);                  // off for shoppers
    const owner = await post('/api/assistant/chat', msg, 'secret');
    assert.equal(owner.status, 200);
    assert.equal((await owner.json()).reply, 'Hello!');
    assert.equal((await fetch(base + '/api/admin/assistant')).status, 401);
    const patch = await fetch(base + '/api/admin/assistant', { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-Admin-Key': 'secret' }, body: JSON.stringify({ enabled: true }) });
    assert.equal(patch.status, 200);
    assert.equal((await (await fetch(base + '/api/assistant/config')).json()).enabled, true);
    assert.equal((await post('/api/assistant/chat', msg)).status, 200);                  // on for shoppers
    const admin = await (await fetch(base + '/api/admin/assistant', { headers: { 'X-Admin-Key': 'secret' } })).json();
    assert.equal(admin.connected, true);
    assert.equal(admin.today.messages, 2);
  } finally { server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
