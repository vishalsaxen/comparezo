// Saves items from any store feed. Every feed returns items in this shape:
// { store, externalId, name, category, subCategory, spec, price, mrp, url, image, listedAt }
// listedAt is the store's own release date when the feed gives one, otherwise null.
const cats = require('../categories');

// Feeds name categories their own way; make sure we only write a category/sub-category pair the app knows.
function fitCategory(db, category, subCategory) {
  const top = cats.findTop(db, category);
  if (!top) return null;
  const subs = db.prepare('SELECT name FROM categories WHERE parent_id = ?').all(top.id).map(s => s.name);
  if (!subs.length) return { category: top.name, subCategory: null };
  if (subs.includes(subCategory)) return { category: top.name, subCategory };
  return { category: top.name, subCategory: subs.includes('Other') ? 'Other' : subs[0] };
}

function getState(db, key) {
  const r = db.prepare('SELECT value FROM feed_state WHERE key = ?').get(key);
  return r ? JSON.parse(r.value) : null;
}
function setState(db, key, value) {
  db.prepare(`INSERT INTO feed_state (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(key, JSON.stringify(value));
}

// Remember ids without creating products, for a store's existing catalogue (so it isn't counted as new).
function markBaseline(db, store, externalIds) {
  const ins = db.prepare('INSERT OR IGNORE INTO feed_seen (store, external_id, baseline) VALUES (?, ?, 1)');
  for (const id of externalIds) ins.run(store, String(id));
}

// Returns 'new', 'updated' or 'skipped'.
function saveItem(db, item, { now = new Date() } = {}) {
  const store = item.store, ext = String(item.externalId || '');
  const price = Math.round(Number(item.price));
  if (!ext || !item.name || !Number.isFinite(price) || price <= 0) return 'skipped';
  const mrp = Number.isFinite(Number(item.mrp)) && item.mrp ? Math.round(Number(item.mrp)) : null;
  const url = /^https:\/\//.test(item.url || '') ? item.url : null;

  const offer = db.prepare('SELECT id FROM offers WHERE store = ? AND external_id = ?').get(store, ext);
  if (offer) {
    db.prepare("UPDATE offers SET price = ?, mrp = ?, url = COALESCE(?, url), updated_at = datetime('now') WHERE id = ?").run(price, mrp, url, offer.id);
    return 'updated';
  }
  const seen = db.prepare('SELECT * FROM feed_seen WHERE store = ? AND external_id = ?').get(store, ext);
  if (seen && seen.baseline) return 'skipped';   // part of the store's catalogue before we started watching

  const fit = fitCategory(db, item.category, item.subCategory);
  if (!fit) return 'skipped';
  const firstSeen = seen ? seen.first_seen_at : now.toISOString().replace('T', ' ').slice(0, 19);
  db.exec('BEGIN');
  try {
    if (!seen) db.prepare('INSERT INTO feed_seen (store, external_id, first_seen_at) VALUES (?, ?, ?)').run(store, ext, firstSeen);
    const pid = Number(db.prepare(`INSERT INTO products (name, category, sub_category, spec, image, source, first_seen_at, listed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(String(item.name).slice(0, 200), fit.category, fit.subCategory, String(item.spec || '').slice(0, 200),
      /^https:\/\//.test(item.image || '') ? item.image : null, store, firstSeen, item.listedAt || null).lastInsertRowid);
    db.prepare('INSERT INTO offers (product_id, store, price, mrp, url, external_id) VALUES (?, ?, ?, ?, ?, ?)').run(pid, store, price, mrp, url, ext);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return 'new';
}

module.exports = { saveItem, markBaseline, getState, setState, fitCategory };
