const path = require('node:path');
const { openDb } = require('./db');
const { seed } = require('./seed');
const { createApp, DEFAULT_ORIGINS } = require('./app');
const { createDeals } = require('./deals');
const { createEarnKaro } = require('./earnkaro');
const { createAdmitad } = require('./admitad');
const { createSerpApi } = require('./serpapi');
const { createBrightData } = require('./brightdata');
const { createQuickCommerce } = require('./quickcommerce');
const { createPartnerize } = require('./partnerize');
const { createAffAlliances } = require('./affalliances');
const { createInrDeals } = require('./inrdeals');
const { createLinkRouting } = require('./link-routing');
const { loadCatalog } = require('./catalog');
const { createGiaZoNest } = require('./giazonest');
const { feedsFromEnv, createFeedRunner } = require('./feeds');
const { createSync, backendFromEnv } = require('./firestore-sync');
const { phoneAuthFromEnv, webConfigFromEnv } = require('./spin');

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

  console.log(process.env.CUELINKS_API_KEY ? 'Cuelinks deals: connected.' : 'Cuelinks deals: set CUELINKS_API_KEY to show deals.');
  console.log(process.env.ADMITAD_CLIENT_ID && process.env.ADMITAD_CLIENT_SECRET && process.env.ADMITAD_WEBSITE_ID ? 'Admitad deals: connected.' : 'Admitad deals: set ADMITAD_CLIENT_ID, ADMITAD_CLIENT_SECRET and ADMITAD_WEBSITE_ID to show deals.');
  console.log(process.env.PARTNERIZE_APP_KEY && process.env.PARTNERIZE_API_KEY && process.env.PARTNERIZE_PUBLISHER_ID ? 'Partnerize earnings: connected.' : 'Partnerize earnings: set PARTNERIZE_APP_KEY, PARTNERIZE_API_KEY and PARTNERIZE_PUBLISHER_ID to read them.');
  console.log(process.env.ANTHROPIC_API_KEY ? `Shopping assistant: connected (${process.env.ASSISTANT_MODEL || 'claude-haiku-5-5'}). Turn it on for shoppers on /assistant.html.` : 'Shopping assistant: set ANTHROPIC_API_KEY to use it.');
  console.log(process.env.QCOM_API_KEY ? `Quick commerce (QuickCommerce API): connected, searching ${process.env.QCOM_PLATFORMS || 'BlinkIt,Zepto,Swiggy,BigBasket'}.` : 'Quick commerce: set QCOM_API_KEY to search Blinkit, Zepto, Swiggy Instamart and BigBasket.');
  console.log(process.env.BRIGHTDATA_API_KEY && process.env.BRIGHTDATA_ZONE ? 'Google Shopping backup (Bright Data): connected.' : 'Google Shopping backup: set BRIGHTDATA_API_KEY and BRIGHTDATA_ZONE to use Bright Data when SerpApi is used up.');
  console.log(process.env.SERPAPI_KEY ? 'Google Shopping search (SerpApi): connected.' : 'Google Shopping search: set SERPAPI_KEY to find products across Indian stores on the Add products page.');
  console.log(process.env.EARNKARO_API_KEY ? 'EarnKaro: Buy links earn commission.' : 'EarnKaro: set EARNKARO_API_KEY to turn Buy links into commission links.');
  console.log(process.env.AFFALLIANCES_LINKS ? 'Aff Alliances: tracking links set.' : 'Aff Alliances: set AFFALLIANCES_LINKS to your tracking links (store domain=link) to use them on Buy.');
  console.log(process.env.INRDEALS_LINKS ? 'INRDeals: links set.' : 'INRDeals: set INRDEALS_LINKS to one linkinr.com link per store to use them on Buy.');
  createApp(db, {
    uploadsDir: path.join(DATA_DIR, 'uploads'),
    adminKey: process.env.ADMIN_KEY || '',
    cuelinksCid: (process.env.CUELINKS_CID || '').trim(),
    feedRunner,
    earnkaro: createEarnKaro({ apiKey: (process.env.EARNKARO_API_KEY || '').trim() }),
    serpapi: createSerpApi({ apiKey: (process.env.SERPAPI_KEY || '').trim(), detailLookups: Number(process.env.SERPAPI_DETAIL_LOOKUPS ?? 2), cacheHours: Number(process.env.SERPAPI_CACHE_HOURS || 6) }),
    brightdata: createBrightData({ apiKey: (process.env.BRIGHTDATA_API_KEY || '').trim(), zone: (process.env.BRIGHTDATA_ZONE || '').trim(), cacheHours: Number(process.env.SERPAPI_CACHE_HOURS || 6) }),
    shoppingOrder: (process.env.SHOPPING_ORDER || 'serpapi,brightdata').split(',').map(x => x.trim().toLowerCase()).filter(Boolean),
    quickcommerce: createQuickCommerce({
      apiKey: (process.env.QCOM_API_KEY || '').trim(),
      platforms: (process.env.QCOM_PLATFORMS || 'BlinkIt,Zepto,Swiggy,BigBasket').split(',').map(x => x.trim()).filter(Boolean),
      lat: Number(process.env.QCOM_LAT || 12.9716), lon: Number(process.env.QCOM_LON || 77.5946),
      pincode: (process.env.QCOM_PINCODE || '').trim(),
      cacheHours: Number(process.env.SERPAPI_CACHE_HOURS || 6),
    }),
    assistantOptions: { apiKey: (process.env.ANTHROPIC_API_KEY || '').trim(), model: (process.env.ASSISTANT_MODEL || 'claude-haiku-5-5').trim() },
    admitad: createAdmitad({ clientId: (process.env.ADMITAD_CLIENT_ID || '').trim(), clientSecret: (process.env.ADMITAD_CLIENT_SECRET || '').trim(), websiteId: (process.env.ADMITAD_WEBSITE_ID || '').trim() }),
    partnerize: createPartnerize({ appKey: (process.env.PARTNERIZE_APP_KEY || '').trim(), apiKey: (process.env.PARTNERIZE_API_KEY || '').trim(), publisherId: (process.env.PARTNERIZE_PUBLISHER_ID || '').trim() }),
    affalliances: createAffAlliances({ links: process.env.AFFALLIANCES_LINKS || '' }),
    inrdeals: createInrDeals({ links: process.env.INRDEALS_LINKS || '' }),
    linkRouting: createLinkRouting({ cuelinksSkip: process.env.CUELINKS_SKIP || '', redirectHosts: process.env.AFFILIATE_REDIRECT_HOSTS || '' }),
    cuelinksPageScript: /^(on|1|true|yes)$/i.test((process.env.CUELINKS_PAGE_SCRIPT || '').trim()),
    deals: createDeals({ apiKey: (process.env.CUELINKS_API_KEY || '').trim() }),
    // Seller Catalog reads the live products of the GiaZoNest shop (read-only). Defaults to Vishal's shop.
    giazonest: createGiaZoNest({ projectId: (process.env.GIAZONEST_PROJECT || 'giazonest').trim(), site: (process.env.GIAZONEST_SITE || 'https://vishalsaxen.github.io/giazonest/').trim() }),
    phoneAuth: phoneAuthFromEnv(process.env),
    firebaseWebConfig: webConfigFromEnv(process.env),
    onChange: store ? () => store.later() : null,
    // Extra front-end addresses allowed to call the API, comma separated (e.g. a custom domain).
    corsOrigins: [...DEFAULT_ORIGINS, ...(process.env.CORS_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean)],
  }).listen(PORT, () => {
    console.log(`Comparezo running at http://localhost:${PORT}`);
  });
}

main().catch(e => { console.error(e); process.exit(1); });
