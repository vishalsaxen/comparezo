const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { compareOffers } = require('./pricing');
const { buyUrl } = require('./stores');
const { getTrends } = require('./trends');
const cats = require('./categories');
const feeds = require('./feeds');
const { addProduct, deleteProduct } = require('./catalog');
const { createDeals } = require('./deals');
const { createEarnKaro } = require('./earnkaro');
const { createAdmitad } = require('./admitad');
const { importRows, storeFromUrl, checkDeal, httpsLink } = require('./bulk');


// Where the static front end is hosted (Firebase Hosting for the "comparezo" project).
const DEFAULT_ORIGINS = ['https://comparezo.web.app', 'https://comparezo.firebaseapp.com', 'https://comparezo.giazonest.com'];

function createApp(db, { uploadsDir, adminKey = '', cuelinksCid = '', feedRunner = feeds.createFeedRunner(db), deals = createDeals(), earnkaro = createEarnKaro(), admitad = createAdmitad(), onChange = null, corsOrigins = DEFAULT_ORIGINS }) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  const app = express();
  // The front end can also be served from Firebase Hosting, which calls this API from another address.
  const allowed = new Set(corsOrigins);
  app.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin && allowed.has(origin)) {
      res.set({ 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE', 'Access-Control-Max-Age': '600' });
      if (req.method === 'OPTIONS') return res.sendStatus(204);
    }
    next();
  });
  // Buy clicks are sent as text/plain so the browser needs no CORS preflight; the body is still JSON.
  app.use(express.json({ limit: '5mb', type: ['application/json', 'text/plain'] }));
  // Tell the caller after every request that changed data, so it can be saved (see firestore-sync.js).
  if (onChange) app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') res.on('finish', () => { if (res.statusCode < 400) onChange(); });
    next();
  });
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
    if (!adminKey) return res.status(403).json({ error: 'Admin tools are turned off. Set ADMIN_KEY on the server to turn them on.' });
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
    // With EarnKaro on, Buy goes through /api/go/<offer>, which swaps in the commission link.
    comparison.offers.forEach(o => { const u = buyUrl(o, p.name); o.buyUrl = u && earnkaro.connected ? `/api/go/${o.id}` : u; });
    res.json({ product: p, ...comparison, includeExtras });
  });

  // Sends a shopper to the store through their EarnKaro commission link (or the plain link).
  app.get('/api/go/:offerId', async (req, res) => {
    const o = db.prepare('SELECT o.*, p.name AS product_name FROM offers o JOIN products p ON p.id = o.product_id WHERE o.id = ?').get(Number(req.params.offerId));
    const url = o && buyUrl(o, o.product_name);
    if (!url) return res.status(404).type('text/plain').send('This store link is no longer available.');
    res.set('Cache-Control', 'no-store').redirect(302, await earnkaro.convert(url));
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
  // Lists and deletes every product (added on the admin page, from catalog.json, or from a store feed).
  const manualProducts = () => db.prepare('SELECT * FROM products ORDER BY id DESC LIMIT 500').all()
    .map(p => ({ ...p, offers: offersFor.all(p.id) }));
  app.get('/api/admin/products', requireAdmin, (_req, res) => res.json(manualProducts()));
  app.post('/api/admin/products', requireAdmin, (req, res) => {
    const r = addProduct(db, req.body, 'manual');
    if (r.errors) return res.status(400).json({ errors: r.errors });
    res.status(201).json(manualProducts().find(p => p.id === r.id));
  });
  // Many products at once, from the spreadsheet the owner uploads (see bulk.js).
  app.post('/api/admin/products/bulk', requireAdmin, (req, res) => {
    const b = req.body || {};
    const r = importRows(db, b.rows, b.defaults || {});
    if (r.error) return res.status(400).json({ error: r.error });
    res.json(r);
  });

  // Turns store product links into commission links: EarnKaro first, then Admitad for stores
  // the Admitad website has joined. Used to fill the "Affiliate link" column of a sheet.
  app.post('/api/admin/affiliate-links', requireAdmin, async (req, res) => {
    const urls = Array.isArray(req.body && req.body.urls) ? req.body.urls.slice(0, 25).map(u => String(u || '').trim()) : [];
    const one = async url => {
      if (!/^https:\/\/\S+$/.test(url)) return { url, link: null, via: null, note: 'Not an https:// link.' };
      if (earnkaro.connected) {
        const link = await earnkaro.convert(url);
        if (link && link !== url) return { url, link, via: 'EarnKaro' };
      }
      if (admitad.connected && admitad.deeplink) {
        const r = await admitad.deeplink(url);
        if (r.link) return { url, link: r.link, via: 'Admitad' };
        return { url, link: null, via: null, note: (earnkaro.connected ? 'EarnKaro could not convert it. ' : '') + `Admitad: ${r.error}` };
      }
      return { url, link: null, via: null, note: earnkaro.connected ? 'EarnKaro could not convert it.' : 'Set EARNKARO_API_KEY or the ADMITAD_* keys on the server.' };
    };
    const results = [];
    for (let i = 0; i < urls.length; i += 5) results.push(...await Promise.all(urls.slice(i, i + 5).map(one)));
    res.json({ earnkaro: earnkaro.connected, admitad: !!admitad.connected, results });
  });
  app.delete('/api/admin/products/:id', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const p = db.prepare('SELECT id FROM products WHERE id = ?').get(id);
    if (!p) return res.status(404).json({ error: 'Product not found.' });
    deleteProduct(db, id);   // keeps Linezo history
    res.json({ ok: true });
  });

  // Products that store feeds first showed us in the last N days (default 20).
  app.get('/api/new-arrivals', (req, res) => {
    const category = cats.findTop(db, req.query.category) ? req.query.category : null;
    res.json(feeds.newArrivals(db, { days: req.query.days, store: req.query.store || null, category }));
  });
  app.get('/api/feeds', (_req, res) => res.json(feedRunner.status()));
  app.post('/api/admin/feeds/run', requireAdmin, async (_req, res) => res.json(await feedRunner.runAll()));

  // Deals and coupons: the owner's own (added on /products.html), Admitad (ADMITAD_* keys) and Cuelinks (CUELINKS_API_KEY).
  // Expired own deals are hidden. With EarnKaro on, their links go through /api/go/deal/<id>.
  const today = () => new Date().toISOString().slice(0, 10);
  const myDealRows = () => db.prepare('SELECT * FROM my_deals ORDER BY id DESC').all();
  const myDeal = d => ({ id: `my-${d.id}`, title: d.title, description: d.description, store: d.store, code: d.code || null,
    image: d.image || null, url: earnkaro.connected ? `/api/go/deal/${d.id}` : d.url, endsAt: d.ends_at || null, own: true });
  // Order: the owner's own deals, then Admitad, then Cuelinks.
  app.get('/api/deals', async (_req, res) => {
    const [ad, r] = await Promise.all([admitad.list(), deals.list()]);
    const mine = myDealRows().filter(d => !d.ends_at || d.ends_at >= today()).map(myDeal);
    res.json({ connected: r.connected || ad.connected || mine.length > 0, deals: [...mine, ...ad.deals, ...r.deals] });
  });
  app.get('/api/admin/admitad/check', requireAdmin, async (_req, res) => res.json(await admitad.check()));
  app.get('/api/go/deal/:id', async (req, res) => {
    const d = db.prepare('SELECT url FROM my_deals WHERE id = ?').get(Number(req.params.id));
    if (!d) return res.status(404).type('text/plain').send('This deal is no longer available.');
    res.set('Cache-Control', 'no-store').redirect(302, await earnkaro.convert(d.url));
  });
  app.get('/api/admin/my-deals', requireAdmin, (_req, res) => res.json(myDealRows()));
  const insertDeal = db.prepare('INSERT INTO my_deals (title, store, code, url, description, image, ends_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  app.post('/api/admin/my-deals', requireAdmin, (req, res) => {
    const r = checkDeal(req.body);
    if (r.errors) return res.status(400).json({ errors: r.errors });
    const d = r.deal;
    const id = Number(insertDeal.run(d.title, d.store, d.code, d.url, d.description, d.image, d.endsAt).lastInsertRowid);
    res.status(201).json(db.prepare('SELECT * FROM my_deals WHERE id = ?').get(id));
  });
  // Many deals at once, from the spreadsheet the owner uploads. A deal with the same link and
  // coupon code as one already saved is skipped, so the same sheet can be uploaded twice.
  app.post('/api/admin/my-deals/bulk', requireAdmin, (req, res) => {
    const rows = Array.isArray(req.body && req.body.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ error: 'The sheet has no deal rows.' });
    if (rows.length > 500) return res.status(400).json({ error: `Upload at most 500 deals at a time. This sheet has ${rows.length}.` });
    const have = new Set(myDealRows().map(d => `${d.url}|${d.code || ''}`));
    let added = 0, skipped = 0;
    const problems = [];
    db.exec('BEGIN');
    try {
      rows.forEach((row, i) => {
        const url = httpsLink(row.url), image = httpsLink(row.image);
        const r = checkDeal({ ...row, url, image, store: row.store || storeFromUrl(url) });
        const rowNo = Number(row.row) || i + 2;
        if (r.errors) return problems.push({ row: rowNo, name: String(row.title || '').slice(0, 80), error: r.errors.join(' ') });
        const d = r.deal, k = `${d.url}|${d.code || ''}`;
        if (have.has(k)) { skipped++; return; }
        have.add(k);
        insertDeal.run(d.title, d.store, d.code, d.url, d.description, d.image, d.endsAt);
        added++;
      });
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    res.json({ added, skipped, problems });
  });
  app.delete('/api/admin/my-deals/:id', requireAdmin, (req, res) => {
    const r = db.prepare('DELETE FROM my_deals WHERE id = ?').run(Number(req.params.id));
    if (!r.changes) return res.status(404).json({ error: 'Deal not found.' });
    res.json({ ok: true });
  });
  app.get('/api/admin/deals/check', requireAdmin, async (_req, res) => res.json(await deals.check()));
  app.post('/api/admin/deals/refresh', requireAdmin, async (_req, res) => res.json(await deals.list({ refresh: true })));

  // Linezo is the owner's sales tracker, so it needs the admin key too.
  app.get('/api/trends', requireAdmin, (req, res) => {
    const category = cats.findTop(db, req.query.category) ? req.query.category : null;
    res.json(getTrends(db, { days: req.query.days, category }));
  });

  return app;
}

module.exports = { createApp, DEFAULT_ORIGINS };
