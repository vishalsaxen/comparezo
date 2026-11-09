// Store feeds. Each feed turns on only when its credentials are set as environment variables.
// Nothing here scrapes store websites: only the stores' official partner APIs are used.
const { createFlipkartFeed } = require('./flipkart');
const { createAmazonFeed } = require('./amazon');
const { getState, setState } = require('./save');

// Flipkart feed category → [Comparezo category, sub-category]. Flipkart's exact category keys for an
// account are listed in GET /api/feeds after the first run (availableCategories). Override with
// FLIPKART_CATEGORIES as JSON, e.g. {"mobiles":["Mobiles"],"womens_clothing":["Fashion & Clothing","Women's Wear"]}.
const FLIPKART_CATEGORIES = {
  mobiles: ['Mobiles'],
  mens_clothing: ['Fashion & Clothing', "Men's Wear"],
  womens_clothing: ['Fashion & Clothing', "Women's Wear"],
  kids_clothing: ['Fashion & Clothing', "Kids' Wear"],
  footwear: ['Fashion & Clothing', 'Footwear'],
  bags_wallets_belts: ['Fashion & Clothing', 'Bags & Accessories'],
  audio_video: ['Electronics'],
  kitchen_appliances: ['Kitchen'],
  home_furnishing: ['Home'],
  beauty_and_personal_care: ['Beauty'],
};

// Amazon searches, run sorted by newest arrivals. Override with AMAZON_SEARCHES as JSON.
const AMAZON_SEARCHES = [
  { keywords: 'kurta set women', searchIndex: 'Fashion', category: 'Fashion & Clothing', subCategory: "Women's Wear" },
  { keywords: 'men shirt', searchIndex: 'Fashion', category: 'Fashion & Clothing', subCategory: "Men's Wear" },
  { keywords: 'running shoes', searchIndex: 'Shoes', category: 'Fashion & Clothing', subCategory: 'Footwear' },
  { keywords: 'wireless earbuds', searchIndex: 'Electronics', category: 'Electronics' },
  { keywords: '5G smartphone', searchIndex: 'Electronics', category: 'Mobiles' },
  { keywords: 'pressure cooker', searchIndex: 'HomeAndKitchen', category: 'Kitchen' },
  { keywords: 'bedsheet', searchIndex: 'HomeAndKitchen', category: 'Home' },
  { keywords: 'face serum', searchIndex: 'Beauty', category: 'Beauty' },
];

function jsonEnv(env, name, fallback) {
  if (!env[name]) return fallback;
  try { return JSON.parse(env[name]); } catch { console.warn(`${name} is not valid JSON, using the default.`); return fallback; }
}

// Builds the feeds whose credentials are present. Stores without an official API (Meesho) are listed as unavailable.
function feedsFromEnv(env = process.env, { fetch } = {}) {
  const feeds = [];
  const missing = {};
  if (env.FLIPKART_AFFILIATE_ID && env.FLIPKART_AFFILIATE_TOKEN) {
    const categories = Object.fromEntries(Object.entries(jsonEnv(env, 'FLIPKART_CATEGORIES', FLIPKART_CATEGORIES)).map(([k, v]) => [k, Array.isArray(v) ? v : [v]]));
    feeds.push(createFlipkartFeed({ affiliateId: env.FLIPKART_AFFILIATE_ID, token: env.FLIPKART_AFFILIATE_TOKEN, categories, fetch }));
  } else missing.Flipkart = 'Set FLIPKART_AFFILIATE_ID and FLIPKART_AFFILIATE_TOKEN (from affiliate.flipkart.com).';
  if (env.AMAZON_CREATORS_CLIENT_ID && env.AMAZON_CREATORS_CLIENT_SECRET && env.AMAZON_PARTNER_TAG) {
    feeds.push(createAmazonFeed({
      clientId: env.AMAZON_CREATORS_CLIENT_ID, clientSecret: env.AMAZON_CREATORS_CLIENT_SECRET, partnerTag: env.AMAZON_PARTNER_TAG,
      searches: jsonEnv(env, 'AMAZON_SEARCHES', AMAZON_SEARCHES),
      ...(env.AMAZON_TOKEN_URL && { tokenUrl: env.AMAZON_TOKEN_URL }),
      ...(env.AMAZON_API_BASE && { apiBase: env.AMAZON_API_BASE }),
      ...(env.AMAZON_MARKETPLACE && { marketplace: env.AMAZON_MARKETPLACE }),
      ...(fetch && { fetch }),
    }));
  } else missing['Amazon.in'] = 'Set AMAZON_CREATORS_CLIENT_ID, AMAZON_CREATORS_CLIENT_SECRET and AMAZON_PARTNER_TAG (from Amazon Associates India, Creators API).';
  missing.Meesho = 'Meesho has no public product or affiliate API, so it cannot be connected without scraping.';
  return { feeds, missing };
}

function createFeedRunner(db, { feeds = [], missing = {} } = {}) {
  let running = null;

  async function runAll({ now = new Date() } = {}) {
    if (running) return running;
    running = (async () => {
      const results = [];
      for (const f of feeds) {
        try { results.push({ ok: true, ...(await f.run(db, { now })) }); }
        catch (e) { results.push({ ok: false, store: f.name, error: e.message }); }
      }
      const last = { at: now.toISOString(), results };
      setState(db, 'last_run', last);
      return last;
    })();
    try { return await running; } finally { running = null; }
  }

  function status() {
    return { connected: feeds.map(f => f.name), notConnected: missing, lastRun: getState(db, 'last_run') };
  }

  function schedule(hours) {
    if (!feeds.length || !(hours > 0)) return null;
    const tick = () => runAll().then(r => console.log('Store feeds:', JSON.stringify(r.results)), e => console.error('Store feeds failed:', e));
    setTimeout(tick, 10_000).unref();
    return setInterval(tick, hours * 3600_000).unref();
  }

  return { runAll, status, schedule };
}

// Products from store feeds that arrived in the last `days` days, newest first.
// Uses the store's release date when the feed gave one, otherwise the time we first saw the product.
function newArrivals(db, { days = 20, store = null, category = null, limit = 60, now = new Date() } = {}) {
  const d = Math.min(Math.max(parseInt(days, 10) || 20, 1), 90);
  const since = new Date(now.getTime() - d * 86400_000).toISOString().replace('T', ' ').slice(0, 19);
  let sql = `SELECT p.*, COALESCE(p.listed_at, p.first_seen_at) AS arrived_at, o.price, o.mrp, o.url, o.store
    FROM products p JOIN offers o ON o.product_id = p.id AND o.external_id IS NOT NULL
    WHERE p.first_seen_at IS NOT NULL AND COALESCE(p.listed_at, p.first_seen_at) >= ?`;
  const args = [since];
  if (store) { sql += ' AND o.store = ?'; args.push(String(store)); }
  if (category) { sql += ' AND p.category = ?'; args.push(String(category)); }
  sql += ' ORDER BY arrived_at DESC, p.id DESC LIMIT ?';
  args.push(Math.min(Math.max(parseInt(limit, 10) || 60, 1), 200));
  return { days: d, since, items: db.prepare(sql).all(...args) };
}

module.exports = { feedsFromEnv, createFeedRunner, newArrivals, FLIPKART_CATEGORIES, AMAZON_SEARCHES };
