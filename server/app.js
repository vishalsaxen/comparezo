const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { compareOffers } = require('./pricing');
const { buyUrl } = require('./stores');
const { getTrends } = require('./trends');
const cats = require('./categories');
const feeds = require('./feeds');
const { addProduct } = require('./catalog');


function createApp(db, { uploadsDir, adminKey = '', cuelinksCid = '', feedRunner = feeds.createFeedRunner(db) }) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  // Cuelinks turns ordinary store links into commission-earning links when a shopper clicks them.
  // Set CUELINKS_CID (the number in the JavaScript code from the Cuelinks dashboard) to turn it on.
  app.get('/affiliate.js', (_req, res) => {
    res.type('application/javascript').set('Cache-Control', 'public, max-age=300');
    if (!/^\d{1,12}$/.test(cuelinksCid)) return res.send('// No affiliate network is set up.\n');
    res.send(`var cId = '${cuelinksCid}';
(function () {
  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://cdn0.cuelinks.com/js/cuelinksv2.js';
  document.body.appendChild(s);
}());
`);
  });
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use('/uploads', express.static(uploadsDir));

  const offersFor = db.prepare('SELECT * FROM offers WHERE product_id = ?');

  app.get('/api/categories', (_req, res) => res.json(cats.categoryTree(db)));

  // Editing categories needs the ADMIN_KEY set on the server, sent as the X-Admin-Key header.
  function requireAdmin(req, res, next) {
    if (!adminKey) return res.status(403).json({ error: 'Category editing is turned off. Set ADMIN_KEY on the server to turn it on.' });
    const sent = Buffer.from(String(req.get('x-admin-key') || ''));
    const want = Buffer.from(adminKey);
    if (sent.length !== want.length || !crypto.timingSafeEqual(sent, want)) return res.status(401).json({ error: 'Wrong admin key.' });
    next();
  }
  const edit = fn => (req, res) => {
    try { res.json(fn(req)); } catch (e) {
      if (e instanceof cats.CategoryError) return res.status(e.status).json({ error: e.message });
      throw e;
    }
  };
  app.post('/api/admin/check', requireAdmin, (_req, res) => res.json({ ok: true }));
  app.post('/api/categories', requireAdmin, edit(req => {
    const b = req.body || {};
    cats.addCategory(db, { name: b.name, parentId: b.parentId ?? null });
    return cats.categoryTree(db);
  }));
  app.patch('/api/categories/:id', requireAdmin, edit(req => {
    const b = req.body || {};
    if (b.name !== undefined) cats.renameCategory(db, req.params.id, b.name);
    if (b.move === 'up' || b.move === 'down') cats.moveCategory(db, req.params.id, b.move === 'up' ? -1 : 1);
    return cats.categoryTree(db);
  }));
  app.delete('/api/categories/:id', requireAdmin, edit(req => {
    cats.deleteCategory(db, req.params.id);
    return cats.categoryTree(db);
  }));

  // Search products; each result carries its cheapest effective price.
  app.get('/api/products', (req, res) => {
    const q = String(req.query.q || '').trim();
    const cat = cats.findTop(db, req.query.category) ? req.query.category : null;
    const sub = cat && req.query.sub ? String(req.query.sub) : null;
    const type = sub && req.query.type ? String(req.query.type) : null;
    let sql = 'SELECT * FROM products WHERE 1=1';
    const args = [];
    if (q) { sql += ' AND (name LIKE ? OR spec LIKE ? OR category LIKE ? OR sub_category LIKE ? OR type LIKE ?)'; const like = `%${q}%`; args.push(like, like, like, like, like); }
    if (cat) { sql += ' AND category = ?'; args.push(cat); }
    if (sub) { sql += ' AND sub_category = ?'; args.push(sub); }
    if (type) { sql += ' AND type = ?'; args.push(type); }
    const rows = db.prepare(sql + ' ORDER BY id').all(...args).map(p => {
      const c = compareOffers(offersFor.all(p.id));
      return { ...p, storeCount: c.offers.length, lowest: c.cheapest ? c.cheapest.effective : null };
    });
    res.json(rows);
  });

  app.get('/api/products/:id', (req, res) => {
    const p = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(req.params.id));
    if (!p) return res.status(404).json({ error: 'Product not found' });
    const includeExtras = req.query.extras !== '0';
    const comparison = compareOffers(offersFor.all(p.id), { includeExtras });
    comparison.offers.forEach(o => { o.buyUrl = buyUrl(o, p.name); });
    res.json({ product: p, ...comparison, includeExtras });
  });

  // Record a Buy click (the shopper is sent to the store). This is what Linezo tracks.
  app.post('/api/purchases', (req, res) => {
    const b = req.body || {};
    const quantity = Math.min(Math.max(parseInt(b.quantity, 10) || 1, 1), 50);
    if (b.offerId) {
      const o = db.prepare('SELECT o.*, p.category FROM offers o JOIN products p ON p.id = o.product_id WHERE o.id = ?').get(Number(b.offerId));
      if (!o) return res.status(404).json({ error: 'Offer not found' });
      const amount = Math.max(0, o.price + o.delivery_fee - o.coupon);
      db.prepare('INSERT INTO purchases (product_id, store, category, amount, quantity) VALUES (?, ?, ?, ?, ?)').run(o.product_id, o.store, o.category, amount, quantity);
      return res.status(201).json({ ok: true, store: o.store, amount });
    }
    res.status(400).json({ error: 'Send an offerId.' });
  });

  // Products the site owner adds by hand: pick a product on a store, paste its link and price.
  // With CUELINKS_CID set, those links earn commission when shoppers click through.
  const manualProducts = () => db.prepare("SELECT * FROM products WHERE source = 'manual' ORDER BY id DESC LIMIT 200").all()
    .map(p => ({ ...p, offers: offersFor.all(p.id) }));
  app.get('/api/admin/products', requireAdmin, (_req, res) => res.json(manualProducts()));
  app.post('/api/admin/products', requireAdmin, (req, res) => {
    const r = addProduct(db, req.body, 'manual');
    if (r.errors) return res.status(400).json({ errors: r.errors });
    res.status(201).json(manualProducts().find(p => p.id === r.id));
  });
  app.delete('/api/admin/products/:id', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const p = db.prepare("SELECT id FROM products WHERE id = ? AND source = 'manual'").get(id);
    if (!p) return res.status(404).json({ error: 'Product not found.' });
    db.exec('BEGIN');
    try {
      db.prepare('UPDATE purchases SET product_id = NULL WHERE product_id = ?').run(id);  // keep Linezo history
      db.prepare('DELETE FROM offers WHERE product_id = ?').run(id);
      db.prepare('DELETE FROM products WHERE id = ?').run(id);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    res.json({ ok: true });
  });

  // Products that store feeds first showed us in the last N days (default 20).
  app.get('/api/new-arrivals', (req, res) => {
    const category = cats.findTop(db, req.query.category) ? req.query.category : null;
    res.json(feeds.newArrivals(db, { days: req.query.days, store: req.query.store || null, category }));
  });
  app.get('/api/feeds', (_req, res) => res.json(feedRunner.status()));
  app.post('/api/admin/feeds/run', requireAdmin, async (_req, res) => res.json(await feedRunner.runAll()));

  app.get('/api/trends', (req, res) => {
    const category = cats.findTop(db, req.query.category) ? req.query.category : null;
    res.json(getTrends(db, { days: req.query.days, category }));
  });

  return app;
}

module.exports = { createApp };
