const { test } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { openDb } = require('../server/db');
const { createApp } = require('../server/app');
const { createAdmitad } = require('../server/admitad');
const { createDeals } = require('../server/deals');
const { TABLES } = require('../server/firestore-sync');

const BROWSER = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36';

async function withServer(fn, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cz-'));
  const db = openDb(':memory:');
  let changes = 0;
  const server = createApp(db, { uploadsDir: path.join(dir, 'uploads'), adminKey: 'k', onChange: () => changes++, ...opts }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const go = (url, { ua = BROWSER, ip = '1.1.1.1' } = {}) => fetch(base + url, { redirect: 'manual', headers: { 'User-Agent': ua, 'X-Forwarded-For': ip } });
  const admin = async url => (await fetch(base + url, { headers: { 'X-Admin-Key': 'k' } })).json();
  try { await fn({ base, go, admin, db, changes: () => changes }); } finally { server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}

function fakeAdmitad() {
  return createAdmitad({ clientId: 'id', clientSecret: 'sec', websiteId: '42', fetch: async url => {
    if (url.endsWith('/token/')) return { ok: true, status: 200, json: async () => ({ access_token: 'tok', expires_in: 604800 }) };
    if (url.includes('/statistics/sub_ids/')) return { ok: true, status: 200, json: async () => ({ results: [
      { subid: 'deals-admitad-1', payment_sum_open: '12.5', payment_sum_approved: 40, currency: 'INR' },
      { subid: 'deals-my-1', payment_sum_open: 3, payment_sum_approved: 0, currency: 'INR' },
      { subid: 'buy-something', payment_sum_open: 99, payment_sum_approved: 99, currency: 'INR' },
    ] }) };
    return { ok: true, status: 200, json: async () => ({ results: [
      { id: 1, name: 'Flat 30% off', status: 'active', goto_link: 'https://ad.admitad.com/g/abc/', campaign: { name: 'Myntra' } },
    ], _meta: { count: 1 } }) };
  } });
}

test('Super Saver Deals: every Get deal link is counted, bots and double clicks are not, and the owner sees clicks and earnings', async () => {
  const deals = createDeals({ apiKey: 'c', fetch: async () => ({ ok: true, status: 200, json: async () => ({ offers: [{ id: 7, title: 'Ajio sale', url: 'https://www.ajio.com/sale', store: 'Ajio' }] }) }) });
  await withServer(async ({ base, go, admin, db, changes }) => {
    const h = { 'Content-Type': 'application/json', 'X-Admin-Key': 'k' };
    await fetch(`${base}/api/admin/my-deals`, { method: 'POST', headers: h, body: JSON.stringify({ title: '40% off shoes', store: 'Myntra', url: 'https://ad.admitad.com/g/own/' }) });
    const pub = await (await fetch(`${base}/api/deals`)).json();
    assert.deepEqual(pub.deals.map(d => d.url), ['/api/go/deal/1', '/api/go/admitad/1', '/api/go/cuelinks/7']);

    // Each link sends the shopper on, with the deal's sub ID where the network takes one.
    let r = await go('/api/go/admitad/1');
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), 'https://ad.admitad.com/g/abc/?subid=deals-admitad-1');
    r = await go('/api/go/deal/1', { ip: '2.2.2.2' });
    assert.equal(r.headers.get('location'), 'https://ad.admitad.com/g/own/?subid=deals-my-1');
    r = await go('/api/go/cuelinks/7');
    assert.equal(r.headers.get('location'), 'https://linksredirect.com/?cid=335585&source=linkkit&url=' + encodeURIComponent('https://www.ajio.com/sale') + '&subid=deals-cuelinks-7');

    await go('/api/go/admitad/1');                                  // same shopper again within 30 s: not counted
    await go('/api/go/admitad/1', { ip: '3.3.3.3' });               // another shopper: counted
    await go('/api/go/admitad/1', { ip: '4.4.4.4', ua: 'WhatsApp/2.23' });   // link preview: not counted
    assert.equal((await go('/api/go/admitad/999')).status, 404);
    assert.ok(changes() >= 4);   // each counted click is saved to Firestore

    assert.equal((await fetch(`${base}/api/admin/deal-stats`)).status, 401);
    const s = await admin('/api/admin/deal-stats?days=7');
    assert.equal(s.days, 7);
    assert.deepEqual(s.totals, { today: 4, last7: 4, last30: 4, allTime: 4 });
    assert.equal(s.perDay.length, 7);
    assert.equal(s.perDay[6].clicks, 4);
    assert.deepEqual(s.deals.map(d => [d.deal, d.network, d.title, d.store, d.clicks, d.live]), [
      ['admitad-1', 'Admitad', 'Flat 30% off', 'Myntra', 2, true],
      ['cuelinks-7', 'Cuelinks', 'Ajio sale', 'Ajio', 1, true],
      ['my-1', 'Your deal', '40% off shoes', 'Myntra', 1, true],
    ]);
    // Earnings per deal come from the Admitad sub-ID report; other sub IDs are left out.
    assert.deepEqual(s.deals[0].earned, { pending: 12.5, confirmed: 40, currency: 'INR', network: 'Admitad' });
    assert.equal(s.deals[1].earned, null);
    assert.deepEqual(s.earnings.admitad, { connected: true, error: null, currency: 'INR', pending: 15.5, confirmed: 40, deals: 2 });
    assert.equal(s.earnings.cuelinks.connected, true);

    // A deleted deal keeps its clicks and name.
    await fetch(`${base}/api/admin/my-deals/1`, { method: 'DELETE', headers: h });
    const after = await admin('/api/admin/deal-stats');
    const mine = after.deals.find(d => d.deal === 'my-1');
    assert.deepEqual([mine.title, mine.live, mine.allTime], ['40% off shoes', false, 1]);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM deal_clicks').get().n, 3);
  }, { admitad: fakeAdmitad(), deals, cuelinksCid: '335585' });
  assert.ok(TABLES.some(([t]) => t === 'deal_clicks'));   // kept in Firestore
});

test('Super Saver Deals: own deals are counted even with no affiliate network connected', async () => {
  await withServer(async ({ base, go, admin }) => {
    const h = { 'Content-Type': 'application/json', 'X-Admin-Key': 'k' };
    await fetch(`${base}/api/admin/my-deals`, { method: 'POST', headers: h, body: JSON.stringify({ title: 'Sale', url: 'https://www.myntra.com/sale' }) });
    const pub = await (await fetch(`${base}/api/deals`)).json();
    assert.equal(pub.deals[0].url, '/api/go/deal/1');
    assert.equal((await go('/api/go/deal/1')).headers.get('location'), 'https://www.myntra.com/sale');
    const s = await admin('/api/admin/deal-stats');
    assert.equal(s.totals.allTime, 1);
    assert.deepEqual(s.earnings.admitad, { connected: false, error: null, currency: 'INR', pending: 0, confirmed: 0, deals: 0 });
  });
});
