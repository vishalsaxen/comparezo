const path = require('node:path');
const { openDb } = require('./db');
const { seed } = require('./seed');
const { createApp } = require('./app');
const { feedsFromEnv, createFeedRunner } = require('./feeds');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

const db = openDb(path.join(DATA_DIR, 'comparezo.db'));
if (seed(db)) console.log('Seeded sample products, listings and purchase history.');
if (!process.env.ADMIN_KEY) console.log('ADMIN_KEY is not set, so categories cannot be edited.');

const feedRunner = createFeedRunner(db, feedsFromEnv(process.env));
const { connected, notConnected } = feedRunner.status();
console.log(connected.length ? `Store feeds connected: ${connected.join(', ')}` : 'No store feeds connected yet.');
for (const [store, why] of Object.entries(notConnected)) console.log(`  ${store}: ${why}`);
feedRunner.schedule(Number(process.env.FEED_INTERVAL_HOURS) || 6);

createApp(db, { uploadsDir: path.join(DATA_DIR, 'uploads'), adminKey: process.env.ADMIN_KEY || '', feedRunner }).listen(PORT, () => {
  console.log(`Comparezo running at http://localhost:${PORT}`);
});
