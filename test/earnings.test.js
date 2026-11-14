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

const NOW = Date.UTC(2026, 10, 14, 9, 0, 0);   // 14 Nov 2026

async function withServer(fn, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cz-'));
  const db = openDb(':memory:');
  const server = createApp(db, { uploadsDir: path.join(dir, 'uploads'), adminKey: 'k', ...opts }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'X-Admin-Key': 'k' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json() };
  };
  try { await fn(call, base, db); } finally { server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}

test('Earnings: owner only, typed-in entries are saved, replaced, summed and deleted', async () => {
  await withServer(async (call, base, db) => {
    assert.equal((await fetch(`${base}/api/admin/earnings`)).status, 401);
    let r = await call('GET', '/api/admin/earnings');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.networks.map(n => n.id), ['earnkaro', 'admitad', 'cuelinks', 'extrape', 'partnerize']);
    assert.ok(r.body.networks.every(n => n.figures === null && n.dashboard.startsWith('https://')));

    assert.equal((await call('POST', '/api/admin/earnings', { network: 'nope', month: '2026-11' })).status, 400);
    assert.equal((await call('POST', '/api/admin/earnings', { network: 'extrape', month: '2026-13' })).status, 400);
    assert.equal((await call('POST', '/api/admin/earnings', { network: 'extrape', month: '2026-11', pending: -5 })).status, 400);

    const month = r.body.month;
    await call('POST', '/api/admin/earnings', { network: 'extrape', month, pending: '100', confirmed: 50.5 });
    await call('POST', '/api/admin/earnings', { network: 'extrape', month, pending: 120, confirmed: 60, note: 'app' });   // replaces
    await call('POST', '/api/admin/earnings', { network: 'extrape', month: '2026-01', confirmed: 40, paid: 300 });
    await call('POST', '/api/admin/earnings', { network: 'earnkaro', month, pending: 10 });
    r = await call('GET', '/api/admin/earnings');
    const ex = r.body.networks.find(n => n.id === 'extrape');
    assert.equal(ex.source, 'manual');
    assert.deepEqual(ex.figures.thisMonth, { pending: 120, confirmed: 60, paid: 0 });
    assert.deepEqual(ex.figures.total, { pending: 120, confirmed: 100, paid: 300 });
    assert.equal(ex.entries.length, 2);
    assert.deepEqual(r.body.totals.thisMonth, { pending: 130, confirmed: 60, paid: 0 });

    assert.equal((await call('DELETE', '/api/admin/earnings/extrape/2026-01')).status, 200);
    assert.equal((await call('DELETE', '/api/admin/earnings/extrape/2026-01')).status, 404);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM earnings_manual').get().n, 2);
  });
  assert.ok(TABLES.some(([t]) => t === 'earnings_manual'));   // kept in Firestore
});

test('Earnings: Admitad statistics and Cuelinks earnings report are read and mapped', async () => {
  const calls = [];
  const admitadFetch = async (url, opts = {}) => {
    calls.push({ url, body: opts.body });
    if (url.endsWith('/token/')) return { ok: true, status: 200, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
    const monthly = url.includes('date_start=01.11.2026');
    return { ok: true, status: 200, json: async () => ({ results: monthly
      ? [{ payment_sum_open: '12.5', payment_sum_approved: '7', currency: 'INR' }]
      : [{ payment_sum_open: '12.5', payment_sum_approved: '7', currency: 'INR' }, { payment_sum_open: 3, payment_sum_approved: '100', currency: 'INR' }] }) };
  };
  const cueFetch = async url => {
    calls.push({ url });
    return { ok: true, status: 200, json: async () => ({
      data: [{ month: '2026-11', pending: '50', validated: '20', payable: '5', claimed: '0', rejected: '1', total: '76', currency: 'INR' },
             { month: '2026-10', pending: '0', validated: '100', payable: '0', claimed: '300', rejected: '0', total: '400', currency: 'INR' }],
      totals: { pending: '50', validated: '120', payable: '5', claimed: '300', rejected: '1', total: '476', currency: 'INR' } }) };
  };
  const admitad = createAdmitad({ clientId: 'id', clientSecret: 'sec', websiteId: '42', fetch: admitadFetch, now: () => NOW });
  const deals = createDeals({ apiKey: 'ck', fetch: cueFetch, now: () => NOW });
  await withServer(async call => {
    const r = await call('GET', '/api/admin/earnings');
    const ad = r.body.networks.find(n => n.id === 'admitad');
    assert.equal(ad.source, 'api');
    assert.deepEqual(ad.figures.thisMonth, { pending: 12.5, confirmed: 7, paid: null });
    assert.deepEqual(ad.figures.total, { pending: 15.5, confirmed: 107, paid: null });
    const cue = r.body.networks.find(n => n.id === 'cuelinks');
    assert.deepEqual(cue.figures.thisMonth, { pending: 50, confirmed: 25, paid: 0 });
    assert.deepEqual(cue.figures.total, { pending: 50, confirmed: 125, paid: 300 });
    assert.ok(calls.some(c => /scope=statistics/.test(c.body || '')));
    assert.ok(calls.some(c => /\/statistics\/campaigns\/\?website=42&date_start=01\.11\.2026&date_end=14\.11\.2026/.test(c.url)));
    assert.ok(calls.some(c => /\/reports\/earnings\?start_date=2024-12-01&end_date=2026-11-14/.test(c.url)));
    assert.ok(!JSON.stringify(r.body).includes('sec'));
  }, { admitad, deals });
});

test('Earnings: a failing API falls back to typed-in numbers and shows the error', async () => {
  const admitad = createAdmitad({ clientId: 'id', clientSecret: 'sec', websiteId: '42', now: () => NOW,
    fetch: async () => ({ ok: false, status: 400, json: async () => ({ error: 'invalid_scope' }) }) });
  await withServer(async call => {
    const month = (await call('GET', '/api/admin/earnings')).body.month;
    await call('POST', '/api/admin/earnings', { network: 'admitad', month, confirmed: 9 });
    const ad = (await call('GET', '/api/admin/earnings?refresh=1')).body.networks.find(n => n.id === 'admitad');
    assert.equal(ad.connected, true);
    assert.match(ad.apiError, /invalid_scope/);
    assert.equal(ad.source, 'manual');
    assert.equal(ad.figures.thisMonth.confirmed, 9);
  }, { admitad });
});
