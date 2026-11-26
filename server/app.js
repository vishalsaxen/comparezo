const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { compareOffers } = require('./pricing');
const { buyUrl } = require('./stores');
const { getTrends } = require('./trends');
const cats = require('./categories');
const feeds = require('./feeds');
const { addProduct, updateProduct, deleteProduct } = require('./catalog');
const { createDeals } = require('./deals');
const { createEarnKaro } = require('./earnkaro');
const { createAdmitad } = require('./admitad');
const { createPartnerize } = require('./partnerize');
const { createAffAlliances } = require('./affalliances');
const { createInrDeals } = require('./inrdeals');
const { createEarnings } = require('./earnings');
const { importRows, storeFromUrl, checkDeal, httpsLink } = require('./bulk');
const { createStoreSearch } = require('./store-search');
const { createSerpApi } = require('./serpapi');
const { createBrightData, createShoppingSearch } = require('./brightdata');
const { createQuickCommerce } = require('./quickcommerce');
const { createPhoneAuth, createSpins } = require('./spin');
const { createDealClicks, subidFor } = require('./deal-clicks');
const { createLinkRouting } = require('./link-routing');
const { createGiaZoNest } = require('./giazonest');
const { createDealCategories, suggest } = require('./deal-categories');


// Admitad tracking links (from Admitad product feeds and deeplinks) already carry the commission.
const isAdmitadLink = u => { try { return /(^|\.)admitad\.com$/.test(new URL(u).hostname); } catch { return false; } };
// Admitad tracking links take a subid, which comes back in Admitad's sub-ID report.
const withSubid = (u, subid) => { if (!subid) return u; try { const x = new URL(u); x.searchParams.set('subid', subid); return x.toString(); } catch { return u; } };

// Where the static front end is hosted (Firebase Hosting for the "comparezo" project).
const DEFAULT_ORIGINS = ['https://comparezo.web.app', 'https://comparezo.firebaseapp.com', 'https://comparezo.giazonest.com'];

function createApp(db, { uploadsDir, adminKey = '', cuelinksCid = '', feedRunner = feeds.createFeedRunner(db), deals = createDeals(), earnkaro = createEarnKaro(), admitad = createAdmitad(), partnerize = createPartnerize(), affalliances = createAffAlliances(), inrdeals = createInrDeals(), linkRouting = createLinkRouting(), giazonest = createGiaZoNest(), cuelinksPageScript = false, storeSearch = null, serpapi = createSerpApi(), brightdata = createBrightData(), shoppingOrder = ['serpapi', 'brightdata'], quickcommerce = createQuickCommerce(), phoneAuth = createPhoneAuth(), firebaseWebConfig = null, onChange = null, corsOrigins = DEFAULT_ORIGINS }) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  const app = express();
  // The front end can also be served from Firebase Hosting, which calls this API from another address.
  const allowed = new Set(corsOrigins);
  app.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin && allowed.has(origin)) {
      res.set({ 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE', 'Access-Control-Max-Age': '600' });
      if (req.method === 'OPTIONS') return res.sendStatus(204);
    }
    next();
  });
  // A store link -> the link that earns commission: Admitad links as they are, then EarnKaro,
  // then an Aff Alliances tracking link for stores set in AFFALLIANCES_LINKS, then an INRDeals link for stores
  // set in INRDEALS_LINKS, then Cuelinks, else the plain link.
  // Stores Cuelinks doesn't pay for (Amazon, Cashify, Alonge; see link-routing.js) never get a Cuelinks
  // link: after EarnKaro, Aff Alliances and INRDeals they try an Admitad deeplink, else the plain link.
  // Comparezo's own links and links that already are affiliate redirects (bit.ly, linksredirect…) are kept as they are.
  // Cuelinks tracking link for a store page: linksredirect.com with the channel id (CUELINKS_CID).
  // Built on the server because the Cuelinks page script did not rewrite clicks on the live site.
  const cuelinksOn = /^\d{1,12}$/.test(cuelinksCid);
  // A sub ID (subid=deals-<id>) is added to deal links so the Cuelinks reports can show which deal earned.
  const cuelinksLink = (url, subid) => `https://linksredirect.com/?cid=${cuelinksCid}&source=linkkit&url=${encodeURIComponent(url)}${subid ? `&subid=${encodeURIComponent(subid)}` : ''}`;
  const viaGo = earnkaro.connected || affalliances.connected || inrdeals.connected || cuelinksOn;
  async function commissionLink(url, subid = null) {
    if (isAdmitadLink(url)) return withSubid(url, subid);
    if (linkRouting.isOwnSite(url) || linkRouting.isRedirect(url)) return url;
    const ek = await earnkaro.convert(url);
    if (ek && ek !== url) return ek;
    const aa = affalliances.convert(url);
    if (aa) return aa;
    const inr = inrdeals.convert(url);
    if (inr) return inr;
    if (linkRouting.cuelinksPays(url)) return cuelinksOn ? cuelinksLink(url, subid) : url;
    if (admitad.connected && admitad.deeplink) {
      const r = await admitad.deeplink(url).catch(() => ({}));
      if (r && r.link) return withSubid(r.link, subid);
    }
    return url;
  }
  // Buy clicks are sent as text/plain so the browser needs no CORS preflight; the body is still JSON.
  app.use(express.json({ limit: '5mb', type: ['application/json', 'text/plain'] }));
  // Tell the caller after every request that changed data, so it can be saved (see firestore-sync.js).
  if (onChange) app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') res.on('finish', () => { if (res.statusCode < 400) onChange(); });
    next();
  });
  // The Cuelinks page script (cuelinksv2.js) is off by default. Every Buy and deal link already goes through
  // /api/go, which builds the Cuelinks link on the server, so the script added nothing. It did count clicks
  // on our own links (comparezo.onrender.com/api/go/…) and on Amazon as "unmonetized traffic" in Cuelinks.
  // Set CUELINKS_PAGE_SCRIPT=on (with CUELINKS_CID) to load it again.
  app.get('/affiliate.js', (_req, res) => {
    res.type('application/javascript').set('Cache-Control', 'public, max-age=300');
    if (!/^\d{1,12}$/.test(cuelinksCid)) return res.send('// No affiliate network is set up.\n');
    if (!cuelinksPageScript) return res.send('// Affiliate links are built on the server (/api/go), so no page script is needed.\n');
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
    if (b.icon !== undefined) cats.setIcon(db, req.params.id, String(b.icon));
    return cats.categoryTree(db);
  }));
  app.delete('/api/categories/:id', requireAdmin, edit(req => {
    cats.deleteCategory(db, req.params.id);
    return cats.categoryTree(db);
  }));
  // Category suggestions from a product name or deal title (see deal-categories.js).
  app.get('/api/admin/category-suggest', requireAdmin, (req, res) => {
    res.json(suggest(db, String(req.query.q || '').slice(0, 300), { mode: req.query.mode === 'deal' ? 'deal' : 'product', limit: 3 }));
  });

  // Seller Catalog: live products from the GiaZoNest shop (see giazonest.js). Read-only; GiaZoNest
  // already shows the same products to anyone on its shop page.
  app.get('/api/seller-catalog', async (_req, res) => res.json(await giazonest.list()));
  app.post('/api/admin/seller-catalog/refresh', requireAdmin, async (_req, res) => res.json(await giazonest.list({ refresh: true })));
  app.get('/api/seller-catalog/thumb/:id', async (req, res) => {
    await giazonest.list();
    const t = giazonest.thumb(req.params.id);
    if (!t) return res.status(404).type('text/plain').send('No photo.');
    res.set({ 'Content-Type': t.type, 'Cache-Control': 'public, max-age=1800' }).send(t.data);
  });

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
    // With EarnKaro or Aff Alliances on, Buy goes through /api/go/<offer>, which swaps in the commission link.
    comparison.offers.forEach(o => { const u = buyUrl(o, p.name); o.buyUrl = u && viaGo ? `/api/go/${o.id}` : u; });
    res.json({ product: p, ...comparison, includeExtras });
  });

  // Sends a shopper to the store through a commission link (EarnKaro, Aff Alliances) or the plain link.
  app.get('/api/go/:offerId', async (req, res) => {
    const o = db.prepare('SELECT o.*, p.name AS product_name FROM offers o JOIN products p ON p.id = o.product_id WHERE o.id = ?').get(Number(req.params.offerId));
    const url = o && buyUrl(o, o.product_name);
    if (!url) return res.status(404).type('text/plain').send('This store link is no longer available.');
    // Links that came from an Admitad feed already earn commission, so they are not sent to EarnKaro.
    res.set('Cache-Control', 'no-store').redirect(302, await commissionLink(url));
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
      const aa = affalliances.convert(url);
      if (aa) return { url, link: aa, via: 'Aff Alliances' };
      const inr = inrdeals.convert(url);
      if (inr) return { url, link: inr, via: 'INRDeals' };
      if (admitad.connected && admitad.deeplink) {
        const r = await admitad.deeplink(url);
        if (r.link) return { url, link: r.link, via: 'Admitad' };
        return { url, link: null, via: null, note: (earnkaro.connected ? 'EarnKaro could not convert it. ' : '') + `Admitad: ${r.error}` };
      }
      return { url, link: null, via: null, note: earnkaro.connected ? 'EarnKaro could not convert it.' : 'Set EARNKARO_API_KEY, AFFALLIANCES_LINKS, INRDEALS_LINKS or the ADMITAD_* keys on the server.' };
    };
    const results = [];
    for (let i = 0; i < urls.length; i += 5) results.push(...await Promise.all(urls.slice(i, i + 5).map(one)));
    res.json({ earnkaro: earnkaro.connected, affalliances: affalliances.connected, inrdeals: inrdeals.connected, admitad: !!admitad.connected, results });
  });
  // "Find in stores": search every connected store's official API or product feed by name.
  if (!storeSearch) {
    const status = feedRunner.status ? feedRunner.status() : { notConnected: {} };
    const sources = [...(feedRunner.searchers ? feedRunner.searchers() : [])];
    const notConnected = { ...(status.notConnected || {}) };
    if (admitad.connected && admitad.findProducts) sources.push({ name: 'Admitad', find: admitad.findProducts });
    else notConnected.Admitad = 'Set ADMITAD_CLIENT_ID, ADMITAD_CLIENT_SECRET and ADMITAD_WEBSITE_ID to search the product feeds of stores you joined in Admitad.';
    // Google Shopping through SerpApi, with Bright Data as the backup (order set by SHOPPING_ORDER).
    const providers = { serpapi: { name: 'SerpApi', api: serpapi }, brightdata: { name: 'Bright Data', api: brightdata } };
    const shopping = createShoppingSearch(shoppingOrder.map(k => providers[k]).filter(Boolean));
    if (shopping.connected) sources.push({ name: 'Google Shopping', find: shopping.findProducts });
    else notConnected['Google Shopping'] = 'Set SERPAPI_KEY (from serpapi.com), or BRIGHTDATA_API_KEY and BRIGHTDATA_ZONE (from brightdata.com), to search Google Shopping India: Amazon.in, Flipkart, Croma, Reliance Digital and more in one search.';
    // Blinkit, Zepto, Swiggy Instamart, BigBasket... live prices for one location (QuickCommerce API).
    if (quickcommerce.connected) sources.push({ name: 'Quick commerce', find: quickcommerce.findProducts });
    else notConnected['Quick commerce'] = 'Set QCOM_API_KEY (from quickcommerceapi.com) to search Blinkit, Zepto, Swiggy Instamart and BigBasket. Each search uses 1 credit per app.';
    notConnected.EarnKaro = 'EarnKaro only turns links into commission links. It has no product search, so stores you reach through EarnKaro are added by pasting their link.';
    storeSearch = createStoreSearch(db, { sources, notConnected });
  }
  app.get('/api/admin/store-search', requireAdmin, async (req, res) => res.json(await storeSearch.search(req.query.q)));
  // Edit a product: send only the fields to change, or all of them (see updateProduct in catalog.js).
  app.patch('/api/admin/products/:id', requireAdmin, (req, res) => {
    const r = updateProduct(db, Number(req.params.id), req.body || {});
    if (r.notFound) return res.status(404).json({ error: 'Product not found.' });
    if (r.errors) return res.status(400).json({ errors: r.errors });
    res.json(manualProducts().find(p => p.id === r.id) || { id: r.id });
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
    const r = feeds.newArrivals(db, { days: req.query.days, store: req.query.store || null, category });
    // Like Buy, "View on store" goes through /api/go so the shopper gets the commission link.
    if (viaGo) r.items.forEach(p => { if (p.url && p.offer_id) p.url = `/api/go/${p.offer_id}`; });
    res.json(r);
  });
  app.get('/api/feeds', (_req, res) => res.json(feedRunner.status()));
  app.post('/api/admin/feeds/run', requireAdmin, async (_req, res) => res.json(await feedRunner.runAll()));

  // Deals and coupons: the owner's own (added on /products.html), Admitad (ADMITAD_* keys) and Cuelinks (CUELINKS_API_KEY).
  // Expired own deals are hidden. Every deal link goes through our server (/api/go/deal|admitad|cuelinks/<id>),
  // which counts the click (deal-clicks.js) and sends the shopper on with the commission link.
  const today = () => new Date().toISOString().slice(0, 10);
  const myDealRows = () => db.prepare('SELECT * FROM my_deals ORDER BY id DESC').all();
  const myDeal = d => ({ id: `my-${d.id}`, title: d.title, description: d.description, store: d.store, code: d.code || null,
    image: d.image || null, url: `/api/go/deal/${d.id}`, endsAt: d.ends_at || null, own: true,
    category: d.category || null, subCategory: d.sub_category || null });
  const dealCats = createDealCategories(db);
  const admitadDeal = d => ({ ...d, url: `/api/go/admitad/${encodeURIComponent(String(d.id).replace(/^admitad-/, ''))}` });
  const cuelinksDeal = d => ({ ...d, url: `/api/go/cuelinks/${encodeURIComponent(d.id)}` });
  // Order: the owner's own deals, then Admitad, then Cuelinks.
  async function allDeals() {
    const [ad, r] = await Promise.all([admitad.list(), deals.list()]);
    const mine = myDealRows().filter(d => !d.ends_at || d.ends_at >= today()).map(myDeal);
    // Feed deals get their Comparezo category from the remembered mapping (deal-categories.js).
    return { connected: r.connected || ad.connected || mine.length > 0,
      deals: [...mine, ...dealCats.apply('admitad', ad.deals).map(admitadDeal), ...dealCats.apply('cuelinks', r.deals).map(cuelinksDeal)] };
  }
  const dealClicks = createDealClicks(db, { onClick: onChange });
  app.get('/api/deals', async (_req, res) => res.json(await allDeals()));

  // Spin to win (see spin.js). The page asks /api/spin/config whether it is switched on, the shopper
  // verifies their number with a Firebase phone OTP, and POST /api/spin checks the Firebase ID token,
  // saves the number and picks which of the wheel's deals they win.
  const spins = createSpins(db);
  app.get('/api/spin/config', (_req, res) => res.json({ enabled: !!phoneAuth.connected, firebase: firebaseWebConfig }));
  app.post('/api/spin', async (req, res) => {
    if (!phoneAuth.connected) return res.status(503).json({ error: 'Spin to win is not switched on yet.' });
    const token = (String(req.get('authorization') || '').match(/^Bearer\s+(\S+)$/) || [])[1];
    if (!token) return res.status(401).json({ error: 'Please verify your mobile number first.' });
    let who;
    try { who = await phoneAuth.verify(token); } catch { return res.status(401).json({ error: 'Your verification expired. Please verify your number again.' }); }
    if (!who.phone) return res.status(401).json({ error: 'Please verify your mobile number first.' });
    if (req.body?.consent !== true) return res.status(400).json({ error: 'Please agree to the consent line to play.' });
    const ids = Array.isArray(req.body?.deals) ? [...new Set(req.body.deals.map(String))].slice(0, 4) : [];
    const { deals: live } = await allDeals();
    const onWheel = ids.map(id => live.find(d => d.id === id)).filter(Boolean);
    if (!onWheel.length) return res.status(400).json({ error: 'These deals have changed. Close the wheel and open Super Saver Deals again.' });
    const r = spins.spin({ phone: who.phone, uid: who.uid, deals: onWheel });
    const deal = live.find(d => d.id === r.dealId) || null;
    res.json({ already: r.already, index: ids.indexOf(r.dealId), deal });
  });
  app.get('/api/admin/spin-players', requireAdmin, (_req, res) => res.json(spins.list()));
  app.get('/api/admin/admitad/check', requireAdmin, async (_req, res) => res.json(await admitad.check()));
  const gone = res => res.status(404).type('text/plain').send('This deal is no longer available.');
  app.get('/api/go/deal/:id', async (req, res) => {
    const d = db.prepare('SELECT id, title, store, url FROM my_deals WHERE id = ?').get(Number(req.params.id));
    if (!d) return gone(res);
    const deal = `my-${d.id}`;
    dealClicks.record(req, { deal, title: d.title, store: d.store });
    res.set('Cache-Control', 'no-store').redirect(302, await commissionLink(d.url, subidFor(deal)));
  });
  app.get('/api/go/admitad/:id', async (req, res) => {
    const deal = `admitad-${req.params.id}`;
    const d = (await admitad.list()).deals.find(x => x.id === deal);
    if (!d) return gone(res);
    dealClicks.record(req, { deal, title: d.title, store: d.store });
    res.set('Cache-Control', 'no-store').redirect(302, withSubid(d.url, subidFor(deal)));
  });
  app.get('/api/go/cuelinks/:id', async (req, res) => {
    const d = (await deals.list()).deals.find(x => x.id === req.params.id);
    if (!d) return gone(res);
    const deal = `cuelinks-${d.id}`;
    dealClicks.record(req, { deal, title: d.title, store: d.store });
    res.set('Cache-Control', 'no-store').redirect(302, cuelinksOn ? cuelinksLink(d.url, subidFor(deal)) : d.url);
  });
  // Owner only: clicks on Super Saver Deals, and what each deal earned where a network reports sub IDs.
  app.get('/api/admin/deal-stats', requireAdmin, async (req, res) => {
    const refresh = req.query.refresh === '1';
    const [{ deals: live }, sub] = await Promise.all([allDeals(), admitad.subidEarnings ? admitad.subidEarnings({ refresh }) : { connected: false, bySubid: {} }]);
    const earned = Object.fromEntries(Object.entries(sub.bySubid || {}).filter(([k]) => k.startsWith('deals-')));
    // Clicks are kept as my-<id>, admitad-<id> and cuelinks-<id>; Cuelinks deal ids come without a prefix.
    const keyed = live.map(d => (d.url.startsWith('/api/go/cuelinks/') ? { ...d, id: `cuelinks-${d.id}` } : d));
    const r = dealClicks.report({ days: req.query.days, live: keyed, earned });
    const sumBy = (key, cur) => Object.values(earned).filter(e => e.currency === cur).reduce((a, e) => a + e[key], 0);
    res.json({ ...r,
      earnings: {
        admitad: { connected: !!sub.connected, error: sub.error || null, currency: 'INR',
          pending: Math.round(sumBy('pending', 'INR') * 100) / 100, confirmed: Math.round(sumBy('confirmed', 'INR') * 100) / 100,
          deals: Object.keys(earned).length },
        cuelinks: { connected: cuelinksOn },
        earnkaro: { connected: !!earnkaro.connected },
      } });
  });
  app.get('/api/admin/my-deals', requireAdmin, (_req, res) => res.json(myDealRows()));
  const insertDeal = db.prepare('INSERT INTO my_deals (title, store, code, url, description, image, ends_at, category, sub_category) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const addDeal = d => Number(insertDeal.run(d.title, d.store, d.code, d.url, d.description, d.image, d.endsAt, d.category, d.subCategory).lastInsertRowid);
  app.post('/api/admin/my-deals', requireAdmin, (req, res) => {
    const r = checkDeal(req.body, db);
    if (r.errors) return res.status(400).json({ errors: r.errors });
    const id = addDeal(r.deal);
    res.status(201).json(db.prepare('SELECT * FROM my_deals WHERE id = ?').get(id));
  });
  // Many deals at once, from the spreadsheet the owner uploads. A deal with the same link and
  // coupon code as one already saved is skipped, so the same sheet can be uploaded twice.
  app.post('/api/admin/my-deals/bulk', requireAdmin, (req, res) => {
    const rows = Array.isArray(req.body && req.body.rows) ? req.body.rows : [];
    const defaults = (req.body && req.body.defaults) || {};
    if (!rows.length) return res.status(400).json({ error: 'The sheet has no deal rows.' });
    if (rows.length > 500) return res.status(400).json({ error: `Upload at most 500 deals at a time. This sheet has ${rows.length}.` });
    const have = new Set(myDealRows().map(d => `${d.url}|${d.code || ''}`));
    let added = 0, skipped = 0;
    const problems = [];
    db.exec('BEGIN');
    try {
      rows.forEach((row, i) => {
        const url = httpsLink(row.url), image = httpsLink(row.image);
        // Rows without a category use the one picked above the file box.
        const cat = String(row.category || '').trim() ? { category: row.category, subCategory: row.subCategory } : { category: defaults.category, subCategory: defaults.subCategory };
        const r = checkDeal({ ...row, ...cat, url, image, store: row.store || storeFromUrl(url) }, db);
        const rowNo = Number(row.row) || i + 2;
        if (r.errors) return problems.push({ row: rowNo, name: String(row.title || '').slice(0, 80), error: r.errors.join(' ') });
        const d = r.deal, k = `${d.url}|${d.code || ''}`;
        if (have.has(k)) { skipped++; return; }
        have.add(k);
        addDeal(d);
        added++;
      });
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    res.json({ added, skipped, problems });
  });
  // Edit a deal: fields not sent keep their saved value.
  app.patch('/api/admin/my-deals/:id', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const old = db.prepare('SELECT * FROM my_deals WHERE id = ?').get(id);
    if (!old) return res.status(404).json({ error: 'Deal not found.' });
    const b = req.body || {};
    const pick = (k, saved) => (Object.prototype.hasOwnProperty.call(b, k) ? b[k] : saved);
    // A new category without a sub-category clears the old sub-category.
    const catChanged = Object.prototype.hasOwnProperty.call(b, 'category') && b.category !== old.category;
    const r = checkDeal({ title: pick('title', old.title), store: pick('store', old.store), code: pick('code', old.code), url: pick('url', old.url),
      description: pick('description', old.description), image: pick('image', old.image), endsAt: pick('endsAt', old.ends_at),
      category: pick('category', old.category), subCategory: pick('subCategory', catChanged ? null : old.sub_category) }, db);
    if (r.errors) return res.status(400).json({ errors: r.errors });
    const d = r.deal;
    db.prepare('UPDATE my_deals SET title = ?, store = ?, code = ?, url = ?, description = ?, image = ?, ends_at = ?, category = ?, sub_category = ? WHERE id = ?')
      .run(d.title, d.store, d.code, d.url, d.description, d.image, d.endsAt, d.category, d.subCategory, id);
    res.json(db.prepare('SELECT * FROM my_deals WHERE id = ?').get(id));
  });
  app.delete('/api/admin/my-deals/:id', requireAdmin, (req, res) => {
    const r = db.prepare('DELETE FROM my_deals WHERE id = ?').run(Number(req.params.id));
    if (!r.changes) return res.status(404).json({ error: 'Deal not found.' });
    res.json({ ok: true });
  });
  // "Needs a category": feed-deal categories not mapped yet, and own deals without a category.
  app.get('/api/admin/deal-categories', requireAdmin, async (_req, res) => {
    const [ad, r] = await Promise.all([admitad.list(), deals.list()]);
    res.json({ ...dealCats.pending({ admitad: dealCats.apply('admitad', ad.deals), cuelinks: dealCats.apply('cuelinks', r.deals) }), mapped: dealCats.list() });
  });
  app.post('/api/admin/deal-categories', requireAdmin, (req, res) => {
    const r = dealCats.save(req.body || {});
    if (r.error) return res.status(400).json({ error: r.error });
    res.json(r.saved);
  });
  app.delete('/api/admin/deal-categories/:source/:name', requireAdmin, (req, res) => {
    if (!dealCats.remove(req.params.source, req.params.name)) return res.status(404).json({ error: 'Mapping not found.' });
    res.json({ ok: true });
  });
  app.get('/api/admin/deals/check', requireAdmin, async (_req, res) => res.json(await deals.check()));
  app.post('/api/admin/deals/refresh', requireAdmin, async (_req, res) => res.json(await deals.list({ refresh: true })));

  // Earnings page: money earned per affiliate network (see earnings.js). Owner only.
  const earnings = createEarnings(db, { sources: { admitad, cuelinks: deals, partnerize }, connected: { earnkaro: !!earnkaro.connected, affalliances: !!affalliances.connected, inrdeals: !!inrdeals.connected } });
  app.get('/api/admin/earnings', requireAdmin, async (req, res) => res.json(await earnings.report({ refresh: req.query.refresh === '1' })));
  app.post('/api/admin/earnings', requireAdmin, (req, res) => {
    const r = earnings.save(req.body);
    if (r.errors) return res.status(400).json({ errors: r.errors });
    res.json(r.entry);
  });
  app.delete('/api/admin/earnings/:network/:month', requireAdmin, (req, res) => {
    if (!earnings.remove(req.params.network, req.params.month)) return res.status(404).json({ error: 'Entry not found.' });
    res.json({ ok: true });
  });

  // Linezo is the owner's sales tracker, so it needs the admin key too.
  app.get('/api/trends', requireAdmin, (req, res) => {
    const category = cats.findTop(db, req.query.category) ? req.query.category : null;
    res.json(getTrends(db, { days: req.query.days, category }));
  });

  return app;
}

module.exports = { createApp, DEFAULT_ORIGINS };
