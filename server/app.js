const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { compareOffers } = require('./pricing');
const { getTrends } = require('./trends');
const cats = require('./categories');

const CONDITIONS = ['New', 'Handmade', 'Like new', 'Used, good'];
const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

function createApp(db, { uploadsDir, adminKey = '' }) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  const app = express();
  app.use(express.json({ limit: '5mb' }));
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
    let sql = 'SELECT * FROM products WHERE 1=1';
    const args = [];
    if (q) { sql += ' AND (name LIKE ? OR spec LIKE ? OR category LIKE ? OR sub_category LIKE ?)'; const like = `%${q}%`; args.push(like, like, like, like); }
    if (cat) { sql += ' AND category = ?'; args.push(cat); }
    if (sub) { sql += ' AND sub_category = ?'; args.push(sub); }
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
    // Listings in the same category, with the same sub-category first.
    const localListings = db.prepare(`SELECT * FROM listings WHERE category = ?
      ORDER BY (sub_category IS ?) DESC, created_at DESC, id DESC LIMIT 3`).all(p.category, p.sub_category);
    res.json({ product: p, ...comparison, includeExtras, localListings });
  });

  app.get('/api/listings', (_req, res) => {
    res.json(db.prepare('SELECT * FROM listings ORDER BY created_at DESC, id DESC LIMIT 60').all());
  });

  app.post('/api/listings', (req, res) => {
    const b = req.body || {};
    const errors = [];
    const title = String(b.title || '').trim().slice(0, 80);
    const city = String(b.city || '').trim().slice(0, 60);
    const seller = String(b.sellerName || '').trim().slice(0, 60);
    const price = Math.round(Number(b.price));
    if (!title) errors.push('Add a product name.');
    const subCategory = String(b.subCategory || '').trim() || null;
    const catError = cats.checkPair(db, b.category, subCategory);
    if (catError) errors.push(catError);
    if (!CONDITIONS.includes(b.condition)) errors.push('Pick a condition.');
    if (!Number.isFinite(price) || price < 1 || price > 10000000) errors.push('Set a price above ₹0.');
    if (!city) errors.push('Add your city or PIN code.');
    if (!seller) errors.push('Add your name.');

    let photo = null;
    if (b.photo) {
      const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/.exec(String(b.photo));
      if (!m) errors.push('Photo must be a JPG, PNG or WebP image.');
      else {
        const buf = Buffer.from(m[2], 'base64');
        if (buf.length > MAX_PHOTO_BYTES) errors.push('Photo must be under 3 MB.');
        else { photo = `${crypto.randomUUID()}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`; fs.writeFileSync(path.join(uploadsDir, photo), buf); }
      }
    }
    if (errors.length) return res.status(400).json({ errors });

    const r = db.prepare(`INSERT INTO listings (title, category, sub_category, condition, price, city, seller_name, phone, description, photo)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(title, b.category, subCategory, b.condition, price, city, seller,
      String(b.phone || '').slice(0, 20), String(b.description || '').slice(0, 300), photo);
    res.status(201).json(db.prepare('SELECT * FROM listings WHERE id = ?').get(Number(r.lastInsertRowid)));
  });

  // Record a purchase (or a click-through to buy). This is what feeds Linezo.
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
    if (b.listingId) {
      const l = db.prepare('SELECT * FROM listings WHERE id = ?').get(Number(b.listingId));
      if (!l) return res.status(404).json({ error: 'Listing not found' });
      db.prepare('INSERT INTO purchases (listing_id, store, category, amount, quantity) VALUES (?, ?, ?, ?, ?)').run(l.id, 'Individual seller', l.category, l.price, quantity);
      return res.status(201).json({ ok: true, store: 'Individual seller', amount: l.price });
    }
    res.status(400).json({ error: 'Send an offerId or listingId.' });
  });

  app.get('/api/trends', (req, res) => {
    const category = cats.findTop(db, req.query.category) ? req.query.category : null;
    res.json(getTrends(db, { days: req.query.days, category }));
  });

  return app;
}

module.exports = { createApp };
