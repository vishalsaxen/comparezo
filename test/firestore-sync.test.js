const { test } = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../server/db');
const { seed } = require('../server/seed');
const { addProduct } = require('../server/catalog');
const { createSync, backendFromEnv } = require('../server/firestore-sync');

// An in-memory stand-in for Firestore that counts writes.
function fakeBackend() {
  const cols = new Map();
  const col = t => cols.get(t) || cols.set(t, new Map()).get(t);
  return {
    name: 'fake', writes: 0, cols,
    async loadAll(t) { return [...col(t)].map(([id, data]) => ({ id, data: structuredClone(data) })); },
    async write(t, sets, deletes) {
      for (const [id, row] of sets) col(t).set(id, structuredClone(row));
      for (const id of deletes) col(t).delete(id);
      this.writes += sets.length + deletes.length;
    },
  };
}
const product = { name: 'Classmate notebook', category: 'Electronics', offers: [{ store: 'Amazon.in', price: 120, url: 'https://www.amazon.in/dp/X1' }] };

test('products, categories and clicks survive a restart through Firestore', async () => {
  const backend = fakeBackend();

  // First server: empty Firestore, add a product and a click.
  const db1 = openDb(':memory:');
  const s1 = createSync(db1, backend, { log: { log() {}, error() {} } });
  assert.equal(await s1.restore(), 0);
  seed(db1);
  const { id } = addProduct(db1, product, 'manual');
  db1.prepare("INSERT INTO purchases (product_id, store, category, amount) VALUES (?, 'Amazon.in', 'Electronics', 120)").run(id);
  await s1.sync();
  const firstWrites = backend.writes;
  assert.ok(backend.cols.get('products').size === 1 && backend.cols.get('categories').size > 10);

  // Nothing changed, nothing written.
  assert.equal(await s1.sync(), 0);

  // Second server (a restart): fresh SQLite, restored from Firestore.
  const db2 = openDb(':memory:');
  const s2 = createSync(db2, backend, { log: { log() {}, error() {} } });
  assert.equal(await s2.restore(), firstWrites);
  seed(db2);   // categories already there, so seeding adds nothing
  assert.equal(db2.prepare('SELECT name FROM products').get().name, 'Classmate notebook');
  assert.equal(db2.prepare('SELECT COUNT(*) AS c FROM purchases').get().c, 1);
  assert.equal(db2.prepare('SELECT COUNT(*) AS c FROM categories').get().c, db1.prepare('SELECT COUNT(*) AS c FROM categories').get().c);
  assert.equal(await s2.sync(), 0, 'a restart should not rewrite everything');

  // Deleting a product removes it from Firestore too; only the changed rows are written.
  db2.prepare('UPDATE purchases SET product_id = NULL').run();
  db2.prepare('DELETE FROM offers').run();
  db2.prepare('DELETE FROM products').run();
  assert.equal(await s2.sync(), 3);
  assert.equal(backend.cols.get('products').size, 0);
});

test('Firestore is off without credentials and rejects a bad key', () => {
  assert.equal(backendFromEnv({}), null);
  assert.throws(() => backendFromEnv({ FIREBASE_SERVICE_ACCOUNT: '{not json' }), /not valid JSON/);
});
