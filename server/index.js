const path = require('node:path');
const { openDb } = require('./db');
const { seed } = require('./seed');
const { createApp } = require('./app');
const { loadCatalog } = require('./catalog');
const { feedsFromEnv, createFeedRunner } = require('./feeds');
const { createSync, backendFromEnv } = require('./firestore-sync');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

async function main() {
  const db = openDb(path.join(DATA_DIR, 'comparezo.db'));

  // With Firebase set up, data is kept in Firestore and copied into SQLite on start.
  let store = null;
  try {
    const backend = backendFromEnv(process.env);
    if (backend) {
      store = createSync(db, backend);
      const n = await store.restore();
      console.log(`Firestore: restored ${n} rows from ${store.name}.`);
    } else {
      console.log('FIREBASE_SERVICE_ACCOUNT is not set, so data is lost when the server restarts.');
    }
  } catch (e) {
    // Don't save anything if we couldn't read Firestore first, or we would overwrite good data.
    console.error('Firestore could not be read, so saving is turned off until this is fixed:', e.message);
    store = null;
  }

  seed(db);
  const catalog = loadCatalog(db);
  if (catalog.added) console.log(`Loaded ${catalog.added} products from catalog.json.`);
  if (catalog.removed) console.log(`Removed ${catalog.removed} products that are no longer in catalog.json.`);
  for (const p of catalog.problems) console.warn(`catalog.json: ${p}`);
  if (!process.env.ADMIN_KEY) console.log('ADMIN_KEY is not set, so categories cannot be edited.');

  if (store) {
    await store.sync();   // first run: uploads everything; later runs: only what seed/catalog added
    setInterval(() => store.sync(), 5 * 60_000).unref();   // catches changes made outside a request, like feed runs
    const flush = async () => { await store.sync(); process.exit(0); };
    process.once('SIGTERM', flush);
    process.once('SIGINT', flush);
  }

  const feedRunner = createFeedRunner(db, feedsFromEnv(process.env));
  const { connected, notConnected } = feedRunner.status();
  console.log(connected.length ? `Store feeds connected: ${connected.join(', ')}` : 'No store feeds connected yet.');
  for (const [store, why] of Object.entries(notConnected)) console.log(`  ${store}: ${why}`);
  feedRunner.schedule(Number(process.env.FEED_INTERVAL_HOURS) || 6);

  createApp(db, {
    uploadsDir: path.join(DATA_DIR, 'uploads'),
    adminKey: process.env.ADMIN_KEY || '',
    cuelinksCid: (process.env.CUELINKS_CID || '').trim(),
    feedRunner,
    onChange: store ? () => store.later() : null,
  }).listen(PORT, () => {
    console.log(`Comparezo running at http://localhost:${PORT}`);
  });
}

main().catch(e => { console.error(e); process.exit(1); });
