const path = require('node:path');
const { openDb } = require('./db');
const { seed } = require('./seed');
const { createApp } = require('./app');
const { loadCatalog } = require('./catalog');
const { feedsFromEnv, createFeedRunner } = require('./feeds');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

const db = openDb(path.join(DATA_DIR, 'comparezo.db'));
seed(db);
const catalog = loadCatalog(db);
if (catalog.added) console.log(`Loaded ${catalog.added} products from catalog.json.`);
for (const p of catalog.problems) console.warn(`catalog.json: ${p}`);
if (!process.env.ADMIN_KEY) console.log('ADMIN_KEY is not set, so categories cannot be edited.');

const feedRunner = createFeedRunner(db, feedsFromEnv(process.env));
const { connected, notConnected } = feedRunner.status();
console.log(connected.length ? `Store feeds connected: ${connected.join(', ')}` : 'No store feeds connected yet.');
for (const [store, why] of Object.entries(notConnected)) console.log(`  ${store}: ${why}`);
feedRunner.schedule(Number(process.env.FEED_INTERVAL_HOURS) || 6);

createApp(db, { uploadsDir: path.join(DATA_DIR, 'uploads'), adminKey: process.env.ADMIN_KEY || '', cuelinksCid: (process.env.CUELINKS_CID || '').trim(), feedRunner }).listen(PORT, () => {
  console.log(`Comparezo running at http://localhost:${PORT}`);
});
