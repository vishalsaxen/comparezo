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
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_offers_external ON offers(store, external_id) WHERE external_id IS NOT NULL');
  db.exec('CREATE INDEX IF NOT EXISTS idx_products_first_seen ON products(first_seen_at)');
  return db;
}

module.exports = { openDb };
