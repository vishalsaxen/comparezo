const { test } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { openDb } = require('../server/db');
const { seed } = require('../server/seed');
const { createApp } = require('../server/app');
const { createSpins, indiaDay } = require('../server/spin');

const DEALS = [1, 2, 3, 4, 5].map(i => ({ id: `admitad-${i}`, title: `Deal ${i}`, store: 'Myntra', code: i === 2 ? 'SAVE2' : null, url: `https://example.com/${i}` }));
const fakeDeals = { list: async () => ({ connected: true, deals: DEALS }), check: async () => ({}) };
// Tokens look like "ok:+919876543210"; anything else is rejected, like an expired Firebase token.
const phoneAuth = { connected: true, async verify(t) { const m = /^ok:(\+91\d{10})$/.exec(t); if (!m) throw new Error('bad'); return { uid: 'u-' + m[1], phone: m[1] }; } };

async function withServer(fn, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cz-'));
  const db = openDb(':memory:');
  seed(db);
  const server = createApp(db, { uploadsDir: path.join(dir, 'u'), adminKey: 'k', deals: fakeDeals, ...opts }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base, db); } finally { server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}
const post = (base, body, token) => fetch(base + '/api/spin', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });

test('spin is off until the server has Firebase credentials', async () => {
  await withServer(async base => {
    assert.deepEqual(await (await fetch(base + '/api/spin/config')).json(), { enabled: false, firebase: null });
    assert.equal((await post(base, { consent: true, deals: ['admitad-1'] }, 'ok:+919876543210')).status, 503);
  });
});

test('a verified number spins once a day, wins one of the wheel deals, and is saved', async () => {
  const web = { apiKey: 'AIza-test', authDomain: 'comparezo.firebaseapp.com', projectId: 'comparezo', appId: '1:2:web:3' };
  await withServer(async (base, db) => {
    assert.deepEqual(await (await fetch(base + '/api/spin/config')).json(), { enabled: true, firebase: web });
    const wheel = ['admitad-1', 'admitad-2', 'admitad-3', 'admitad-4'];
    assert.equal((await post(base, { consent: true, deals: wheel })).status, 401, 'no token');
    assert.equal((await post(base, { consent: true, deals: wheel }, 'nope')).status, 401, 'bad token');
    assert.equal((await post(base, { deals: wheel }, 'ok:+919876543210')).status, 400, 'no consent');
    assert.equal((await post(base, { consent: true, deals: ['gone'] }, 'ok:+919876543210')).status, 400, 'unknown deals');

    const r = await post(base, { consent: true, deals: wheel }, 'ok:+919876543210');
    assert.equal(r.status, 200);
    const won = await r.json();
    assert.equal(won.already, false);
    assert.ok(won.index >= 0 && won.index < 4);
    assert.equal(won.deal.id, wheel[won.index]);

    const again = await (await post(base, { consent: true, deals: wheel }, 'ok:+919876543210')).json();
    assert.equal(again.already, true);
    assert.equal(again.deal.id, won.deal.id);

    const row = db.prepare('SELECT * FROM spin_players').get();
    assert.equal(row.phone, '+919876543210');
    assert.equal(row.spins, 1);
    assert.equal(row.last_deal_id, won.deal.id);

    assert.equal((await fetch(base + '/api/admin/spin-players')).status, 401);
    const list = await (await fetch(base + '/api/admin/spin-players', { headers: { 'X-Admin-Key': 'k' } })).json();
    assert.equal(list.length, 1);
  }, { phoneAuth, firebaseWebConfig: web });
});

test('spins reset at midnight India time', () => {
  const db = openDb(':memory:');
  let now = new Date('2026-11-15T18:00:00Z');   // 23:30 IST on the 15th
  const spins = createSpins(db, { random: () => 0, now: () => now });
  const deals = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }];
  assert.equal(spins.spin({ phone: '+91', uid: 'u', deals }).already, false);
  now = new Date('2026-11-15T18:20:00Z');       // 23:50 IST, same day
  assert.equal(spins.spin({ phone: '+91', uid: 'u', deals }).already, true);
  now = new Date('2026-11-15T18:40:00Z');       // 00:10 IST on the 16th
  assert.equal(indiaDay(now), '2026-11-16');
  assert.equal(spins.spin({ phone: '+91', uid: 'u', deals }).already, false);
  assert.equal(db.prepare('SELECT spins FROM spin_players').get().spins, 2);
});
