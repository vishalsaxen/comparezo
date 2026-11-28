// SQLite database using Node's built-in driver (Node 22.13+), so there is nothing native to compile.
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  spec TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS offers (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  store TEXT NOT NULL,
  price INTEGER NOT NULL,        -- rupees
  mrp INTEGER,
  delivery_fee INTEGER NOT NULL DEFAULT 0,
  coupon INTEGER NOT NULL DEFAULT 0,
  delivery_days INTEGER NOT NULL DEFAULT 3,
  rating REAL,
  url TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  condition TEXT NOT NULL,
  price INTEGER NOT NULL,
  city TEXT NOT NULL,
  seller_name TEXT NOT NULL,
  phone TEXT,
  description TEXT,
  photo TEXT,                     -- file name in /uploads
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY,
  product_id INTEGER REFERENCES products(id),
  listing_id INTEGER REFERENCES listings(id),
  store TEXT NOT NULL,
  category TEXT NOT NULL,
  amount INTEGER NOT NULL,        -- rupees actually paid
  quantity INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,  -- NULL for a top-level category
  position INTEGER NOT NULL DEFAULT 0
);
-- Which starting category sets were added (see server/categories.js). Created here too so a restore from Firestore can fill it.
CREATE TABLE IF NOT EXISTS category_sets (name TEXT PRIMARY KEY, added_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_name ON categories(COALESCE(parent_id, 0), name COLLATE NOCASE);
-- Every store product id a feed has ever shown us, with the time we first saw it.
-- This is how "new arrivals" works: stores don't publish upload dates, so we track first sight.
CREATE TABLE IF NOT EXISTS feed_seen (
  store TEXT NOT NULL,
  external_id TEXT NOT NULL,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  baseline INTEGER NOT NULL DEFAULT 0,   -- 1 = already in the store before we started watching
  PRIMARY KEY (store, external_id)
);
CREATE TABLE IF NOT EXISTS feed_state (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Deals and coupons the owner adds by hand on /products.html (for example from the EarnKaro app).
CREATE TABLE IF NOT EXISTS my_deals (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  store TEXT NOT NULL DEFAULT '',
  code TEXT,
  url TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image TEXT,
  ends_at TEXT,                   -- YYYY-MM-DD, last day the deal works
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Earnings the owner types in on /earnings.html, per affiliate network and month (see earnings.js).
CREATE TABLE IF NOT EXISTS earnings_manual (
  network TEXT NOT NULL,
  month TEXT NOT NULL,            -- YYYY-MM
  pending REAL NOT NULL DEFAULT 0,
  confirmed REAL NOT NULL DEFAULT 0,
  paid REAL NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (network, month)
);
-- Shoppers who verified their mobile number (Firebase phone OTP) to play Spin to win on Super Saver Deals.
CREATE TABLE IF NOT EXISTS spin_players (
  phone TEXT PRIMARY KEY,         -- +91XXXXXXXXXX, as verified by Firebase
  uid TEXT NOT NULL,              -- Firebase Auth user id
  consent_at TEXT NOT NULL,       -- when they agreed to the consent line
  first_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_day TEXT NOT NULL,         -- YYYY-MM-DD (India time) of the last spin, one spin a day
  spins INTEGER NOT NULL DEFAULT 1,
  last_deal_id TEXT,
  last_deal_title TEXT
);
-- Clicks on Super Saver Deals, one row per deal per day (India time). See deal-clicks.js.
CREATE TABLE IF NOT EXISTS deal_clicks (
  deal TEXT NOT NULL,             -- my-12 (own deal), admitad-345, cuelinks-678
  day TEXT NOT NULL,              -- YYYY-MM-DD, India time
  clicks INTEGER NOT NULL DEFAULT 0,
  title TEXT,                     -- the deal's title and store when it was clicked, so old deals still have a name
  store TEXT,
  last_at TEXT,
  PRIMARY KEY (deal, day)
);
-- Feed deals (Admitad, Cuelinks) come with the network's own category name. The owner maps each
-- name to a Comparezo category once, on /products.html ("Needs a category"), and it is remembered here.
CREATE TABLE IF NOT EXISTS deal_category_map (
  source TEXT NOT NULL,           -- admitad, cuelinks
  name TEXT NOT NULL,             -- the network's category, lower case; "store:<name>" when a deal has none
  category TEXT NOT NULL,         -- a Comparezo category, or "Whole store"
  sub_category TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (source, name)
);
-- Shopping assistant (Admin → Assistant): its settings, and messages and costs per day.
CREATE TABLE IF NOT EXISTS assistant_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS assistant_usage (
  day TEXT PRIMARY KEY,           -- YYYY-MM-DD, India time
  messages INTEGER NOT NULL DEFAULT 0,
  live_searches INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_offers_product ON offers(product_id);
CREATE INDEX IF NOT EXISTS idx_purchases_time ON purchases(created_at);
`;

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  // Older databases were created before sub-categories existed.
  for (const table of ['products', 'listings']) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
    if (!cols.includes('sub_category')) db.exec(`ALTER TABLE ${table} ADD COLUMN sub_category TEXT`);
    if (!cols.includes('type')) db.exec(`ALTER TABLE ${table} ADD COLUMN type TEXT`);  // sub-sub-category
  }
  // Columns for products that come from store feeds.
  const addCols = (table, defs) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
    for (const [name, type] of defs) if (!cols.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  };
  addCols('products', [['image', 'TEXT'], ['source', 'TEXT'], ['first_seen_at', 'TEXT'], ['listed_at', 'TEXT']]);
  addCols('offers', [['external_id', 'TEXT']]);
  addCols('categories', [['icon', 'TEXT']]);                                     // menu icon (top-level only)
  addCols('my_deals', [['category', 'TEXT'], ['sub_category', 'TEXT']]);         // required for new deals
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_offers_external ON offers(store, external_id) WHERE external_id IS NOT NULL');
  db.exec('CREATE INDEX IF NOT EXISTS idx_products_first_seen ON products(first_seen_at)');
  return db;
}

module.exports = { openDb };
