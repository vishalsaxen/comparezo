// Comparezo front end. Public tabs: Comparezo (compare prices) and Super Saver Deals.
// Owner-only tabs: Seller Catalog (GiaZoNest shop products) and Linezo (your sales tracker).
// Comparezo, Super Saver Deals and Seller Catalog can be browsed by category (cat-icons.js draws the menu).
(() => {
const STORE_COLORS = {
  'Amazon.in': '#e08a00', 'Flipkart': '#2f6fdc', 'Meesho': '#b0307a', 'Myntra': '#e2445c',
  'JioMart': '#1f7a8c', 'Snapdeal': '#d23b3b', 'Ajio': '#2c4152', 'BigBasket': '#689f38', 'FirstCry': '#f2711c', 'Nykaa': '#e80071', 'Individual seller': '#0f5a4f'
};
const CATS = {
  Electronics: { c: '#2f5d8a', i: '<path d="M5 14a7 7 0 0114 0v4a2 2 0 01-2 2h-1v-6h3M5 14v4a2 2 0 002 2h1v-6H5" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/>' },
  'Fashion & Clothing': { c: '#a23e5e', i: '<path d="M9 3l3 2 3-2 5 3-2 4-2-1v12H8V9L6 10 4 6z" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/>' },
  Kitchen: { c: '#9a5b14', i: '<path d="M4 11h16v3a6 6 0 01-6 6h-4a6 6 0 01-6-6zM8 11V8a4 4 0 018 0v3" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>' },
  Home: { c: '#3d7a52', i: '<path d="M4 11l8-7 8 7v9H4zM10 20v-5h4v5" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/>' },
  Beauty: { c: '#7a4ba0', i: '<path d="M9 9h6v11H9zM10 9V5l4-2v6" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/>' },
  Mobiles: { c: '#335a6e', i: '<rect x="7" y="3" width="10" height="18" rx="2" stroke="currentColor" stroke-width="2" fill="none"/><path d="M11 18h2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' }
};

const $ = id => document.getElementById(id);
const inr = n => '₹' + Math.round(n).toLocaleString('en-IN');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Categories added at run time get a tag icon and a colour picked from their name.
const TAG_ICON = '<path d="M3 12V4h8l10 10-8 8zM7.5 8.5h.01" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round" stroke-linecap="round"/>';
const EXTRA_COLORS = ['#2f5d8a', '#9a5b14', '#3d7a52', '#7a4ba0', '#335a6e', '#8a3f2f', '#5a6b1f'];
function catStyle(cat) {
  if (CATS[cat]) return CATS[cat];
  let h = 0; for (const ch of String(cat || '')) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return { c: EXTRA_COLORS[h % EXTRA_COLORS.length], i: TAG_ICON };
}
const catLabel = (...names) => names.filter(Boolean).join(' › ');
// A product from a store feed shows the store's own photo (the feed gives its URL); sample products show a category icon.
const thumb = (cat, image) => /^https:\/\//.test(image || '')
  ? `<div class="thumb photo" style="background-image:url('${esc(image)}')" role="img" aria-label=""></div>`
  : `<div class="thumb" style="background:${catStyle(cat).c}"><svg viewBox="0 0 24 24" aria-hidden="true">${catStyle(cat).i}</svg></div>`;
const sdot = s => `<span class="sdot" style="background:${STORE_COLORS[s] || '#888'}"></span>`;
// The admin key saved by the "Add products" page. With it, product pages show a Delete button.
const adminKey = () => { try { return localStorage.getItem('cz-admin-key') || ''; } catch { return ''; } };
async function api(url, opts) {
  const r = await fetch(url, opts && opts.body ? { method: 'POST', ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers }, body: JSON.stringify(opts.body) } : opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || 'Request failed'), { data });
  return data;
}
let toastTimer;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3200); }

// Links to Cuelinks itself have no href, so the Cuelinks script on the page doesn't rewrite them
// into commission links (which sends you to cuelinks.com/broken-links). They open on click instead.
document.querySelectorAll('a[data-open]').forEach(a => {
  a.style.cursor = 'pointer'; a.style.textDecoration = 'underline';
  const go = () => window.open(a.dataset.open, '_blank', 'noopener');
  a.addEventListener('click', go);
  a.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
});
/* ---------- Tabs ---------- */
let linezoLoaded = false;
// Everyone sees Comparezo, Super Saver Deals and Seller Catalog. Linezo and Earnings are only for
// the owner: those tabs show only in a browser that has the admin key.
const TABS = { compare: 'Comparezo', deals: 'Super Saver Deals', seller: 'Seller Catalog', linezo: 'Linezo' };
const OWNER_TABS = ['linezo'];
function route() {
  const owner = !!adminKey();
  document.querySelectorAll('#tabs [data-owner]').forEach(a => { a.hidden = !owner; });
  // #deals, #deals/fashion-and-clothing/footwear, #deals/store/myntra, #seller/food, #compare/home-and-kitchen …
  let [tab, ...rest] = location.hash.slice(1).split('/');
  if (!TABS[tab] || (OWNER_TABS.includes(tab) && !owner)) { tab = 'compare'; rest = []; }
  for (const t of Object.keys(TABS)) {
    $('view-' + t).hidden = t !== tab;
    $('tab-' + t).setAttribute('aria-selected', t === tab);
  }
  document.title = tab === 'compare' ? 'Comparezo' : `${TABS[tab]} · Comparezo`;
  closeSheet();
  if (tab === 'linezo' && !linezoLoaded) { linezoLoaded = true; loadTrends(); }
  if (tab === 'deals') { pick.deals = rest; if (dealsLoaded) renderDeals(); }
  if (tab === 'deals' && dealsLoaded) offerSpin();
  if (tab === 'seller') { pick.seller = rest; if (!sellerLoaded) loadSeller(); else renderSeller(); }
  if (tab === 'compare') setCompareCategory(rest);
}
// Spin to win pops up the first time Super Saver Deals is opened in a session (see spin.js).
let dealsLoaded = null;
const offerSpin = () => { if (window.czSpin && dealsLoaded) window.czSpin.offer(dealsLoaded).catch(() => {}); };
window.addEventListener('hashchange', route);
// Log out: forget the admin key in this browser, hide Linezo and go back to Comparezo.
// To log in again, enter the key on the Add products page.
$('lzLogout').addEventListener('click', () => {
  try { localStorage.removeItem('cz-admin-key'); } catch { /* private mode */ }
  linezoLoaded = false;
  if (OWNER_TABS.includes(location.hash.slice(1).split('/')[0])) history.replaceState(null, '', '#compare');
  route();
  toast('Logged out of Linezo. Enter your admin key on Add products to log in again.');
});

/* ---------- Comparezo: search + compare ---------- */
const state = { q: '', cat: null, sub: null, type: null, sel: null, sort: 'eff', extras: true, products: [], detail: null };

async function loadProducts() {
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q);
  if (state.cat) p.set('category', state.cat);
  if (state.cat && state.sub) p.set('sub', state.sub);
  if (state.sub && state.type) p.set('type', state.type);
  state.products = await api('/api/products?' + p);
  if (!state.products.some(x => x.id === state.sel)) state.sel = state.products[0]?.id ?? null;
  renderResults();
  window.czOpenGate?.();   // first load: open the shutter as soon as the list is on screen (gate.js)
  await loadDetail();
}
function renderResults() {
  const list = state.products;
  $('results').innerHTML = `<div class="results-head"><strong>${list.length} product${list.length === 1 ? '' : 's'}</strong><span class="sub">${state.q ? 'for “' + esc(state.q) + '”' : esc(state.cat ? catLabel(state.cat, state.sub, state.type) : 'Popular today')}</span></div>` +
    (list.length ? list.map(p => `<button class="ritem" data-id="${p.id}" aria-current="${p.id === state.sel}">${thumb(p.category, p.image)}<div><div class="t">${esc(p.name)}</div><div class="sub">From <span class="from num">${inr(p.lowest)}</span> · ${p.storeCount} stores</div></div></button>`).join('')
      : `<div class="empty">${state.q || state.cat ? 'No products match. Try another word or category.' : 'No products yet.'}</div>`);
}
async function loadDetail() {
  if (!state.sel) { $('detail').innerHTML = '<div class="empty">Pick a product to see prices.</div>'; return; }
  state.detail = await api(`/api/products/${state.sel}?extras=${state.extras ? 1 : 0}`);
  renderDetail();
}
function renderDetail() {
  const d = state.detail, p = d.product, best = d.cheapest;
  const rows = d.offers.slice().sort((a, b) =>
    state.sort === 'fast' ? a.delivery_days - b.delivery_days || a.effective - b.effective :
    state.sort === 'rating' ? (b.rating || 0) - (a.rating || 0) : a.effective - b.effective);
  $('detail').innerHTML = `
    <div class="dhead">${thumb(p.category, p.image)}<div class="info"><div class="eyebrow">${esc(catLabel(p.category, p.sub_category, p.type))}</div><h2>${esc(p.name)}</h2><div class="sub">${esc(p.spec)}</div></div></div>
    <div class="verdict">
      <div><div class="eyebrow">Cheapest at</div><div class="store" style="font-size:18px;margin-top:2px">${sdot(best.store)}${esc(best.store)}</div></div>
      <div class="big num">${inr(best.effective)}</div>
      <div class="msg"><strong>You save ${inr(d.savings)} vs the costliest store</strong><span class="sub">${d.includeExtras ? 'Includes delivery and available coupons.' : 'Listed price only, before delivery and coupons.'} Arrives in ${best.delivery_days} day${best.delivery_days > 1 ? 's' : ''}.</span></div>
    </div>
    <div class="toolbar">
      <span class="sub">Sort by</span>
      <div class="seg" role="group" aria-label="Sort offers">
        <button data-sort="eff" aria-pressed="${state.sort === 'eff'}">Lowest price</button>
        <button data-sort="fast" aria-pressed="${state.sort === 'fast'}">Fastest delivery</button>
        <button data-sort="rating" aria-pressed="${state.sort === 'rating'}">Top rated</button>
      </div>
      <label class="toggle"><input type="checkbox" id="extras" ${state.extras ? 'checked' : ''}> Include delivery and coupons</label>
    </div>
    <div class="tablebox"><table class="offers">
      <thead><tr><th>Store</th><th class="r">Listed price</th><th class="r">Delivery</th><th class="r">Coupon</th><th class="r">You pay</th><th>Arrives</th><th>Rating</th><th></th></tr></thead>
      <tbody>${rows.map(r => {
        const isBest = r.id === best.id;
        return `<tr class="${isBest ? 'best' : ''}">
          <td><div class="store">${sdot(r.store)}${esc(r.store)}</div>${isBest ? '<span class="tag tag-best">Cheapest</span> ' : ''}${r.delivery_days === d.fastestDays ? '<span class="tag tag-fast">Fastest</span>' : ''}</td>
          <td class="r num">${inr(r.price)}${r.mrp ? `<div class="strike">${inr(r.mrp)}</div>` : ''}</td>
          <td class="r num">${r.delivery_fee ? '+' + inr(r.delivery_fee) : '<span class="sub">Free</span>'}</td>
          <td class="r num">${r.coupon ? `<span class="minus">−${inr(r.coupon)}</span>` : '<span class="sub">None</span>'}</td>
          <td class="r num eff">${inr(r.effective)}</td>
          <td>${r.delivery_days === 1 ? 'Tomorrow' : r.delivery_days + ' days'}</td>
          <td>${r.rating ? `<span class="num">${Number(r.rating).toFixed(1)}</span> <span class="sub">/ 5</span>` : '<span class="sub">New</span>'}</td>
          <td>${r.buyUrl ? `<a class="btn ${isBest ? 'btn-brand' : 'btn-ghost'} go" href="${esc((r.buyUrl.startsWith('/api/') ? (window.CZ_API || '') : '') + r.buyUrl)}" target="_blank" rel="noopener noreferrer sponsored" data-buy-offer="${r.id}" data-store="${esc(r.store)}">Buy on ${esc(r.store)} ↗</a>` : '<span class="sub">No link yet</span>'}</td>
        </tr>`; }).join('')}
      </tbody></table></div>
    <p class="foot-note">“You pay” = listed price + delivery − coupon. Prices can change on the store; check the final price there.</p>
    ${adminKey() ? `<p class="admin-row"><button type="button" class="btn btn-ghost small danger" data-del-product="${p.id}">Delete this product</button> <span class="sub">Only you see this, because this browser has the admin key.</span></p>` : ''}`;
}

$('searchForm').addEventListener('submit', e => { e.preventDefault(); state.q = $('q').value.trim(); loadProducts(); });
// The shopping assistant's "All prices" button (assistant-widget.js): open that product on the Comparezo tab.
window.czShowProduct = (id, name) => {
  state.q = name || ''; $('q').value = state.q; state.cat = state.sub = state.type = null; state.sel = id;
  if (location.hash.slice(1).split('/')[0] !== 'compare') location.hash = '#compare';
  loadProducts().then(() => $('detail').scrollIntoView({ behavior: 'smooth', block: 'start' }));
};
let qTimer;
$('q').addEventListener('input', e => { clearTimeout(qTimer); qTimer = setTimeout(() => { state.q = e.target.value.trim(); loadProducts(); }, 250); });
$('results').addEventListener('click', e => {
  const b = e.target.closest('[data-id]'); if (!b) return;
  state.sel = Number(b.dataset.id); renderResults(); loadDetail();
  if (innerWidth < 900) $('detail').scrollIntoView({ behavior: 'smooth' });
});
$('detail').addEventListener('click', async e => {
  const s = e.target.closest('[data-sort]');
  if (s) { state.sort = s.dataset.sort; renderDetail(); return; }
  // "Buy on <store>" is a real link, so the browser opens the store in a new tab.
  // We record the click for Linezo in the background without blocking it.
  const del = e.target.closest('[data-del-product]');
  if (del) {
    if (del.dataset.confirm !== '1') { del.dataset.confirm = '1'; del.textContent = 'Click again to delete'; return; }
    try {
      await api(`/api/admin/products/${del.dataset.delProduct}`, { method: 'DELETE', headers: { 'X-Admin-Key': adminKey() } });
      toast(`Deleted ${state.detail.product.name}.`);
      state.sel = null; loadProducts();
    } catch (err) { toast(err.message === 'Request failed' ? 'Could not delete. Check the admin key on the Add products page.' : err.message); }
    return;
  }
  const a = e.target.closest('a[data-buy-offer]');
  if (a) {
    recordPurchase({ offerId: Number(a.dataset.buyOffer) });
    toast(`Opening ${a.dataset.store} in a new tab.`);
    return;
  }
});
function recordPurchase(body) {
  fetch('/api/purchases', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body), keepalive: true })
    .then(r => { if (r.ok) linezoLoaded = false; }).catch(() => {});
}
$('detail').addEventListener('change', e => { if (e.target.id === 'extras') { state.extras = e.target.checked; loadDetail(); } });

/* ---------- Comparezo: new arrivals from store feeds ---------- */
async function loadNewArrivals() {
  const [data, feeds] = await Promise.all([api('/api/new-arrivals?days=20'), api('/api/feeds')]);
  const ago = t => { const d = Math.floor((Date.now() - new Date(t.replace(' ', 'T') + 'Z')) / 86400000); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d + ' days ago'; };
  $('newNote').textContent = feeds.connected.length
    ? `New products from ${feeds.connected.join(' and ')}, dated by the store's release date or when Comparezo first saw them.`
    : 'Store feeds are not connected yet. New products from Amazon.in and Flipkart appear here once their partner API keys are added.';
  $('newGrid').innerHTML = data.items.map(p => {
    const c = catStyle(p.category);
    const img = p.image ? `<div class="img" style="background-image:url('${esc(p.image)}');background-size:contain;background-repeat:no-repeat;background-color:#fff"></div>` : `<div class="img" style="background:${c.c}"><svg viewBox="0 0 24 24" aria-hidden="true">${c.i}</svg></div>`;
    const link = p.url ? `<a class="btn" href="${esc((p.url.startsWith('/api/') ? (window.CZ_API || '') : '') + p.url)}" target="_blank" rel="noopener sponsored">View on ${esc(p.store)}</a>` : '';
    return `<article class="lcard">${img}<div class="body"><div class="price num">${inr(p.price)}</div><div class="t">${esc(p.name)}</div><div class="sub">${sdot(p.store)}${esc(p.store)} · ${ago(p.arrived_at)}</div><div class="row"><span class="sub">${esc(catLabel(p.category, p.sub_category))}</span>${link}</div></div></article>`;
  }).join('');
  // Only show the section once a store feed is connected and has something new.
  $('new').hidden = !data.items.length;
}
/* ---------- Category menus (Comparezo tab, Super Saver Deals, Seller Catalog; see cat-icons.js) ---------- */
const WHOLE = 'Whole store';
const pick = { deals: [], seller: [] };             // the #hash parts after the tab name
const menuOpen = { deals: new Set(), seller: new Set(), compare: new Set() };
const iconOf = name => (categories.find(c => c.name === name) || {}).icon || 'tag';
const catBySlug = (list, sl) => list.find(x => CzCat.slug(x) === sl) || null;
// Counts per category and sub-category: { [cat]: { n, subs: { [sub]: n } } }
function countByCat(items, cat = x => x.category, sub = x => x.subCategory) {
  const out = {};
  for (const x of items) {
    const c = cat(x); if (!c) continue;
    const o = out[c] = out[c] || { n: 0, subs: {} };
    o.n++;
    const sb = sub(x); if (sb) o.subs[sb] = (o.subs[sb] || 0) + 1;
  }
  return out;
}
// The site's categories (in their order) with counts, for a drawer.
const catRows = (counts, { onlyUsed = false } = {}) => {
  const rows = categories.map(c => ({ name: c.name, icon: c.icon, count: (counts[c.name] || {}).n || 0,
    subs: c.subcategories.map(sb => ({ name: sb.name, count: ((counts[c.name] || {}).subs || {})[sb.name] || 0 })).filter(sb => !onlyUsed || sb.count) }));
  // Categories an item uses that the site doesn't have (e.g. from GiaZoNest) still get a row.
  for (const [name, o] of Object.entries(counts)) if (name !== WHOLE && !categories.some(c => c.name === name)) rows.push({ name, icon: 'tag', count: o.n, subs: Object.entries(o.subs).map(([n, k]) => ({ name: n, count: k })) });
  return onlyUsed ? rows.filter(r => r.count) : rows;
};
const crumbHtml = parts => parts.map(([label, href], i) => (i < parts.length - 1 && href ? `<a href="${href}">${esc(label)}</a>` : `<b>${esc(label)}</b>`)).join('<span aria-hidden="true">›</span>');

// Phone sheet: the same drawer slides in from the left.
let sheetKind = null;
function openSheet(kind) { sheetKind = kind; renderSheet(); $('catSheet').hidden = false; document.body.classList.add('sheet-open'); }
function closeSheet() { if ($('catSheet')) { $('catSheet').hidden = true; document.body.classList.remove('sheet-open'); sheetKind = null; } }
function renderSheet() { if (sheetKind) $('catSheetPanel').innerHTML = menuHtml(sheetKind, true); }
function menuHtml(kind, close = false) {
  if (kind === 'deals') return dealMenu(close);
  if (kind === 'seller') return sellerMenu(close);
  return compareMenu(close);
}
// A pick from a drawer becomes a #link, so the back button and shared links work.
function onPick(kind, p, fromSheet) {
  const tops = { deals: 'stores', seller: 'sellers' };
  if (p.top && p.top === tops[kind] && !p.val) { toggleOpen(kind, 'top:' + p.top, fromSheet); return; }
  let h = '#' + kind;
  if (p.top && p.val) h += `/${kind === 'deals' ? 'store' : 'seller'}/${CzCat.slug(p.val)}`;
  else if (p.cat) { h += '/' + CzCat.slug(p.cat) + (p.sub ? '/' + CzCat.slug(p.sub) : ''); menuOpen[kind].add('cat:' + p.cat); }
  if (location.hash === h) route(); else location.hash = h;
}
function toggleOpen(kind, id, fromSheet) {
  const o = menuOpen[kind];
  if (o.has(id)) o.delete(id); else o.add(id);
  if (fromSheet) renderSheet();
  else if (kind === 'deals') $('dealMenu').innerHTML = dealMenu();
  else if (kind === 'seller') $('scMenu').innerHTML = sellerMenu();
}
for (const [kind, el] of [['deals', 'dealMenu'], ['seller', 'scMenu']]) CzCat.bind($(el), { pick: p => onPick(kind, p, false), toggle: id => toggleOpen(kind, id, false) });
CzCat.bind($('catSheetPanel'), { pick: p => onPick(sheetKind, p, true), toggle: id => toggleOpen(sheetKind, id, true), close: closeSheet });
$('catSheet').addEventListener('click', e => { if (e.target.id === 'catSheet') closeSheet(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
document.addEventListener('click', e => { const b = e.target.closest('[data-open-menu]'); if (b) openSheet(b.dataset.openMenu); });

/* ---------- Super Saver Deals (the owner's own, then Admitad, then Cuelinks), by category ---------- */
let allDeals = [];
// Where the deals view is: { cat, sub, store } resolved from the #deals/... link.
function dealPlace() {
  const [a, b] = pick.deals;
  if (a === 'store') { const st = [...new Set(allDeals.map(d => d.store).filter(Boolean))].find(x => CzCat.slug(x) === b); return { store: st || null }; }
  const counts = countByCat(allDeals);
  const names = [...categories.map(c => c.name), ...Object.keys(counts)];
  const cat = a ? names.find(n => CzCat.slug(n) === a) || null : null;
  const subs = cat ? [...(categories.find(c => c.name === cat) || { subcategories: [] }).subcategories.map(x => x.name), ...Object.keys((counts[cat] || {}).subs || {})] : [];
  const sub = cat && b ? subs.find(n => CzCat.slug(n) === b) || null : null;
  return { cat, sub };
}
function dealMenu(close = false) {
  const at = dealPlace();
  const stores = Object.entries(allDeals.reduce((m, d) => { if (d.store) m[d.store] = (m[d.store] || 0) + 1; return m; }, {})).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
  if (at.store) menuOpen.deals.add('top:stores');
  if (at.cat) menuOpen.deals.add('cat:' + at.cat);
  return CzCat.drawer({ title: 'Category', close, open: menuOpen.deals,
    current: at.store ? { top: 'stores', val: at.store } : at.cat ? { cat: at.cat, sub: at.sub } : { top: 'all' },
    top: [{ id: 'all', label: "Today's best deals", icon: 'deals', count: allDeals.length },
      { id: 'stores', label: 'Stores', icon: 'stores', rows: stores.map(([n, k]) => ({ id: n, label: n, count: k })) }],
    cats: catRows(countByCat(allDeals)) });
}
const dealCard = d => {
  const img = d.image ? `<div class="img" style="background-image:url('${esc(d.image)}');background-size:contain;background-repeat:no-repeat;background-color:#fff"></div>` : '';
  const ends = d.endsAt ? ` · ends ${esc(fmtDay(d.endsAt.slice(0, 10)))}` : '';
  const code = d.code ? `<span class="chip" title="Coupon code">${esc(d.code)}</span>` : '<span class="sub">No code needed</span>';
  const path = d.category ? `<div class="card-path">${esc(d.category === WHOLE ? 'Whole store sale' : catLabel(d.category, d.subCategory))}</div>` : '';
  return `<article class="lcard">${img}<div class="body">${path}<div class="t">${esc(d.title)}</div><div class="sub">${d.store ? sdot(d.store) + esc(d.store) : ''}${ends}</div><div class="row">${code}<a class="btn" href="${esc((d.url.startsWith('/api/') ? (window.CZ_API || '') : '') + d.url)}" target="_blank" rel="noopener sponsored">Get deal</a></div></div></article>`;
};
function renderDeals() {
  const at = dealPlace();
  let list = allDeals, whole = [];
  if (at.store) list = allDeals.filter(d => d.store === at.store);
  else if (at.cat) {
    list = allDeals.filter(d => d.category === at.cat && (!at.sub || d.subCategory === at.sub));
    // Store-wide sales of the stores in this list also cover it, so they show underneath.
    const stores = new Set(list.map(d => d.store).filter(Boolean));
    if (at.cat !== WHOLE) whole = allDeals.filter(d => d.category === WHOLE && stores.has(d.store));
  }
  $('dealMenu').innerHTML = dealMenu();
  if (sheetKind === 'deals') renderSheet();
  $('dealCrumb').innerHTML = at.store ? crumbHtml([['All deals', '#deals'], ['Stores'], [at.store]])
    : at.cat ? crumbHtml([['All deals', '#deals'], [at.cat, '#deals/' + CzCat.slug(at.cat)], ...(at.sub ? [[at.sub]] : [])]) : '';
  $('dealHeading').textContent = at.store ? `${at.store} deals` : at.cat ? `${at.sub || at.cat} deals` : 'Number of deals now';
  // Sub-category chips under a category.
  const subs = at.cat ? Object.entries((countByCat(allDeals)[at.cat] || { subs: {} }).subs) : [];
  $('dealSubs').hidden = !subs.length;
  $('dealSubs').innerHTML = subs.length ? `<a class="chip" href="#deals/${CzCat.slug(at.cat)}" aria-pressed="${!at.sub}">All ${esc(at.cat)}</a>` +
    subs.map(([n, k]) => `<a class="chip" href="#deals/${CzCat.slug(at.cat)}/${CzCat.slug(n)}" aria-pressed="${at.sub === n}">${esc(n)} <span class="n">${k}</span></a>`).join('') : '';
  $('dealGrid').innerHTML = list.map(dealCard).join('');
  $('dealCount').textContent = list.length.toLocaleString('en-IN');
  $('dealEmpty').hidden = list.length > 0;
  $('dealEmpty').textContent = at.cat || at.store ? 'No deals here right now. Try another category.' : 'No deals right now. Check back soon.';
  $('dealWhole').hidden = !whole.length;
  $('dealWholeGrid').innerHTML = whole.map(dealCard).join('');
}
async function loadDeals() {
  const data = await api('/api/deals');
  allDeals = data.deals;
  dealsLoaded = data.deals;
  renderDeals();
  if (location.hash.startsWith('#deals')) offerSpin();
}

/* ---------- Seller Catalog: live products from the GiaZoNest shop (public; Sync now is owner only) ---------- */
let sellerLoaded = false, catalog = { items: [] };
const scState = { q: '', sort: 'new' };
async function loadSeller(refresh = false) {
  sellerLoaded = true;
  $('scSync').innerHTML = '<span class="sub">Reading GiaZoNest…</span>';
  try {
    catalog = refresh ? await api('/api/admin/seller-catalog/refresh', { method: 'POST', headers: { 'X-Admin-Key': adminKey() } }) : await api('/api/seller-catalog');
  } catch (err) { catalog = { items: catalog.items || [], error: err.message }; sellerLoaded = false; }
  renderSeller();
}
// Seller names typed in capitals ("TWISTED IMLI CANDY") read better in title case. The seller's text isn't changed.
const tidy = s => (s && s === s.toUpperCase() && /[A-Z]{3}/.test(s) ? s.toLowerCase().replace(/(^|[\s(/&-])([a-z])/g, (m, a, b) => a + b.toUpperCase()) : s);
function sellerPlace() {
  const [a, b] = pick.seller;
  if (a === 'seller') return { seller: [...new Set(catalog.items.map(x => x.seller))].find(x => CzCat.slug(x) === b) || null };
  const counts = countByCat(catalog.items);
  const cat = a ? Object.keys(counts).find(n => CzCat.slug(n) === a) || null : null;
  const sub = cat && b ? Object.keys(counts[cat].subs).find(n => CzCat.slug(n) === b) || null : null;
  return { cat, sub };
}
function sellerMenu(close = false) {
  const at = sellerPlace(), items = catalog.items;
  const sellers = Object.entries(items.reduce((m, x) => { m[x.seller] = (m[x.seller] || 0) + 1; return m; }, {})).sort((x, y) => y[1] - x[1]);
  if (at.cat) menuOpen.seller.add('cat:' + at.cat);
  if (at.seller) menuOpen.seller.add('top:sellers');
  return CzCat.drawer({ title: 'Category', close, open: menuOpen.seller, dimEmpty: false,
    current: at.seller ? { top: 'sellers', val: at.seller } : at.cat ? { cat: at.cat, sub: at.sub } : { top: 'all' },
    top: [{ id: 'all', label: 'All products', icon: 'all', count: items.length },
      { id: 'sellers', label: 'By seller', icon: 'shop', rows: sellers.map(([n, k]) => ({ id: n, label: n, count: k })) }],
    cats: catRows(countByCat(items), { onlyUsed: true }) });
}
const agoMin = iso => { const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
function renderSeller() {
  const items = catalog.items || [], at = sellerPlace();
  const sellers = new Set(items.map(x => x.seller)), cities = new Set(items.map(x => x.city).filter(Boolean));
  $('scSync').innerHTML = (catalog.syncedAt ? `<span class="live">Synced ${esc(agoMin(catalog.syncedAt))}</span>` : '')
    + `<span><b class="num">${items.length}</b> live product${items.length === 1 ? '' : 's'}</span><span><b class="num">${sellers.size}</b> seller${sellers.size === 1 ? '' : 's'}</span>`
    + (cities.size ? `<span><b class="num">${cities.size}</b> cit${cities.size === 1 ? 'y' : 'ies'}</span>` : '')
    + (adminKey() ? `<button type="button" class="btn btn-ghost small" id="scRefresh">${CzCat.icon('sync')} Sync now</button>` : '')
    + (catalog.error ? `<span class="err">${adminKey() ? `GiaZoNest could not be read: ${esc(catalog.error)}` : 'Some products may be out of date. Please check back soon.'}</span>` : '');
  $('scMenu').innerHTML = sellerMenu();
  if (sheetKind === 'seller') renderSheet();
  let list = items;
  if (at.seller) list = list.filter(x => x.seller === at.seller);
  if (at.cat) list = list.filter(x => x.category === at.cat && (!at.sub || x.subCategory === at.sub));
  const q = scState.q.toLowerCase();
  if (q) list = list.filter(x => [x.name, x.seller, x.city, x.category, x.subCategory, x.type].some(v => String(v || '').toLowerCase().includes(q)));
  const off = x => (x.price ? x.discount / x.price : 0);
  if (scState.sort === 'low') list = list.slice().sort((a, b) => a.sellingPrice - b.sellingPrice);
  if (scState.sort === 'off') list = list.slice().sort((a, b) => off(b) - off(a));
  if (scState.sort === 'sold') list = list.slice().sort((a, b) => b.sold - a.sold);
  $('scCrumb').innerHTML = crumbHtml([['Seller Catalog', '#seller'], ...(at.seller ? [[at.seller]] : at.cat ? [[at.cat, '#seller/' + CzCat.slug(at.cat)], ...(at.sub ? [[at.sub]] : [])] : [['All categories']])])
    + ` <span class="sub">· ${list.length} product${list.length === 1 ? '' : 's'}</span>`;
  const sc = Object.entries(items.reduce((m, x) => { m[x.seller] = (m[x.seller] || 0) + 1; return m; }, {}));
  $('scSellers').innerHTML = sc.length > 1 ? `<a class="chip" href="#seller" aria-pressed="${!at.seller}">All sellers</a>` + sc.map(([n, k]) => `<a class="chip" href="#seller/seller/${CzCat.slug(n)}" aria-pressed="${at.seller === n}">${CzCat.icon('shop', 'ci sm')}${esc(n)} <span class="n">${k}</span></a>`).join('') : '';
  const api0 = window.CZ_API || '';
  $('scGrid').innerHTML = list.map(x => {
    const pct = x.price && x.discount ? Math.round(x.discount * 100 / x.price) : 0;
    const fb = x.hasThumb ? `${api0}/api/seller-catalog/thumb/${encodeURIComponent(x.id)}` : '';
    return `<article class="lcard sc-card"><div class="img sc-img"><img src="${esc(x.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-fb="${esc(fb)}" data-tile="${esc(catStyle(x.category).c)}|${esc(iconOf(x.category))}">${pct ? `<span class="badge-off">${pct}% off</span>` : ''}</div>
      <div class="body"><div class="card-path">${esc(catLabel(x.category, x.subCategory, x.type))}</div><div class="t">${esc(tidy(x.name))}</div>
        <div class="price num">${inr(x.sellingPrice)}${x.discount ? ` <s class="strike">${inr(x.price)}</s>` : ''}</div>
        <div class="sub sc-seller">${CzCat.icon('shop', 'ci sm')}${esc(x.seller)}${x.city ? ' · ' + esc(x.city) : ''}</div>
        <div class="sub${x.stock <= 10 ? ' low' : ''}">${x.stock ? `${x.stock} in stock` : 'Out of stock'}${x.sold ? ` · ${x.sold} sold` : ''}</div>
        <div class="row"><a class="btn btn-brand small" href="${esc(x.url)}" target="_blank" rel="noopener">View on GiaZoNest ${CzCat.icon('ext', 'ci sm')}</a></div></div></article>`;
  }).join('');
  $('scEmpty').hidden = list.length > 0;
  $('scEmpty').textContent = items.length ? 'No products match. Try another category or word.' : catalog.error ? 'GiaZoNest could not be read just now. Try Sync now in a minute.' : 'No live products on GiaZoNest yet.';
}
// A GiaZoNest photo that isn't published yet falls back to the saved thumbnail, then to a category tile.
document.addEventListener('error', e => {
  const img = e.target;
  if (img.tagName !== 'IMG' || !img.closest('.sc-img')) return;
  if (img.dataset.fb) { const u = img.dataset.fb; img.dataset.fb = ''; img.src = u; return; }
  const [color, ic] = (img.dataset.tile || '#5b6b66|tag').split('|');
  const box = img.parentElement;
  box.classList.add('tile'); box.style.background = color;
  img.replaceWith(Object.assign(document.createElement('span'), { innerHTML: CzCat.icon(ic) }));
}, true);
$('scQ').addEventListener('input', e => { scState.q = e.target.value.trim(); renderSeller(); });
$('scSort').addEventListener('change', e => { scState.sort = e.target.value; renderSeller(); });
$('scSync').addEventListener('click', e => { if (e.target.closest('#scRefresh')) loadSeller(true); });

/* ---------- Comparezo tab: category icons under the search, and the full menu ---------- */
let compareCounts = {};
function compareMenu(close = false) {
  if (state.cat) menuOpen.compare.add('cat:' + state.cat);
  const total = Object.values(compareCounts).reduce((a, o) => a + o.n, 0);
  return CzCat.drawer({ title: 'Category', close, open: menuOpen.compare,
    current: state.cat ? { cat: state.cat, sub: state.sub } : { top: 'all' },
    top: [{ id: 'all', label: 'All products', icon: 'all', count: total }], cats: catRows(compareCounts) });
}
function renderStrip() {
  $('catStrip').innerHTML = `<button type="button" class="cs-btn" data-open-menu="compare">${CzCat.icon('all')}<span>All categories</span></button>`
    + categories.map(c => `<a class="cs-btn${(compareCounts[c.name] || {}).n ? '' : ' zero'}" href="#compare${state.cat === c.name ? '' : '/' + CzCat.slug(c.name)}" aria-pressed="${state.cat === c.name}">${CzCat.icon(c.icon)}<span>${esc(c.name)}</span></a>`).join('');
}
function setCompareCategory([a, b] = []) {
  const c = a ? categories.find(x => CzCat.slug(x.name) === a) : null;
  const sb = c && b ? c.subcategories.find(x => CzCat.slug(x.name) === b) : null;
  const cat = c ? c.name : null, sub = sb ? sb.name : null;
  if (cat === state.cat && sub === state.sub) { renderStrip(); return; }
  Object.assign(state, { cat, sub, type: null });
  renderStrip();
  if (booted) loadProducts();
}
let booted = false;
async function loadCompareCounts() {
  compareCounts = countByCat(await api('/api/products'), p => p.category, p => p.sub_category);
  renderStrip();
}
/* ---------- Linezo: trends ---------- */
const lz = { days: 30, category: '' };
async function loadTrends() {
  document.querySelectorAll('#lzRange button').forEach(b => b.setAttribute('aria-pressed', Number(b.dataset.days) === lz.days));
  const p = new URLSearchParams({ days: lz.days });
  if (lz.category) p.set('category', lz.category);
  let t;
  try { t = await api('/api/trends?' + p, { headers: { 'X-Admin-Key': adminKey() } }); }
  catch (err) {
    $('lzKpis').innerHTML = `<div class="empty">Linezo is only for the owner. ${esc(err.message)} Enter the admin key again on the <a href="/products.html">Add products</a> page.</div>`;
    linezoLoaded = false;
    return;
  }
  renderKpis(t); renderChart(t); renderBars(t); renderTop(t);
}
function delta(v) {
  if (v === null) return '<span class="sub">No earlier data</span>';
  const up = v >= 0;
  return `<span class="delta ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${Math.abs(v)}%</span> <span class="sub">vs previous ${lz.days} days</span>`;
}
function renderKpis(t) {
  const best = t.byStore[0];
  $('lzKpis').innerHTML = `
    <div class="kpi"><div class="eyebrow">Buy clicks</div><div class="v num">${t.totals.units.toLocaleString('en-IN')}</div>${delta(t.totals.unitsChangePct)}</div>
    <div class="kpi"><div class="eyebrow">Value of clicked items</div><div class="v num">${inr(t.totals.revenue)}</div>${delta(t.totals.revenueChangePct)}</div>
    <div class="kpi"><div class="eyebrow">Average item</div><div class="v num">${inr(t.totals.avgOrder)}</div><span class="sub">per click</span></div>
    <div class="kpi"><div class="eyebrow">Top store</div><div class="v" style="font-size:22px;display:flex;align-items:center">${best ? sdot(best.store) + esc(best.store) : '–'}</div><span class="sub">${best && t.totals.units ? Math.round(best.units / t.totals.units * 100) + '% of clicks' : ''}</span></div>`;
  $('lzRangeLbl').textContent = `${fmtDay(t.from)} to ${fmtDay(t.to)}${t.category ? ' · ' + t.category : ''}`;
}
function fmtDay(s) { return new Date(s + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }); }
function niceMax(v) { if (v <= 5) return 5; const p = 10 ** Math.floor(Math.log10(v)); const m = v / p; return (m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; }
function renderChart(t) {
  const W = 900, H = 280, L = 44, R = 14, T = 14, B = 30;
  const data = t.daily, max = niceMax(Math.max(1, ...data.map(d => d.units)));
  const x = i => L + (data.length === 1 ? 0 : i * (W - L - R) / (data.length - 1));
  const y = v => T + (1 - v / max) * (H - T - B);
  // 7-day moving average to show the trend through daily noise
  const avg = data.map((_, i) => { const s = data.slice(Math.max(0, i - 6), i + 1); return s.reduce((a, d) => a + d.units, 0) / s.length; });
  const line = (arr) => arr.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');
  const units = data.map(d => d.units);
  const ticks = [0, 1, 2, 3, 4, 5].map(k => (k * max) / 5);
  const step = Math.ceil(data.length / 6);
  const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Buy clicks per day, ${fmtDay(t.from)} to ${fmtDay(t.to)}">
    ${ticks.map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${Math.round(v)}</text>`).join('')}
    ${data.map((d, i) => i % step === 0 || i === data.length - 1 ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${fmtDay(d.day)}</text>` : '').join('')}
    <path d="${line(units)} L${x(data.length - 1)} ${y(0)} L${x(0)} ${y(0)}Z" fill="var(--brand-soft)"/>
    <path d="${line(units)}" fill="none" stroke="var(--brand)" stroke-width="1.5" opacity=".55"/>
    <path d="${line(avg)}" fill="none" stroke="var(--marigold)" stroke-width="3" stroke-linejoin="round"/>
    <circle cx="${x(data.length - 1)}" cy="${y(avg[avg.length - 1])}" r="5" fill="var(--marigold)"/>
    <rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent" id="lzHit"/>
  </svg><div class="tip" hidden></div>
  <div class="sub" style="display:flex;gap:16px;margin-top:6px;flex-wrap:wrap"><span><span class="sdot" style="background:var(--brand)"></span>Daily clicks</span><span><span class="sdot" style="background:var(--marigold)"></span>7-day average</span></div>`;
  $('lzChart').innerHTML = svg;
  const hit = $('lzChart').querySelector('#lzHit'), tip = $('lzChart').querySelector('.tip'), el = $('lzChart').querySelector('svg');
  hit.addEventListener('mousemove', e => {
    const rect = el.getBoundingClientRect(), sx = (e.clientX - rect.left) * W / rect.width;
    const i = Math.max(0, Math.min(data.length - 1, Math.round((sx - L) / ((W - L - R) / Math.max(1, data.length - 1)))));
    tip.hidden = false; tip.style.left = (x(i) * rect.width / W) + 'px'; tip.style.top = (y(units[i]) * rect.height / H) + 'px';
    tip.textContent = `${fmtDay(data[i].day)}: ${units[i]} clicks · ${inr(data[i].revenue)}`;
  });
  hit.addEventListener('mouseleave', () => (tip.hidden = true));
}
function bars(rows, key, label) {
  const total = rows.reduce((a, r) => a + r.units, 0) || 1, max = Math.max(1, ...rows.map(r => r.units));
  return rows.map(r => `<div class="bar-row"><div class="name">${label(r)}</div><div class="bar"><span style="width:${(r.units / max * 100).toFixed(1)}%"></span></div><div class="num r">${Math.round(r.units / total * 100)}%</div></div>`).join('') || '<p class="sub">No Buy clicks in this range yet.</p>';
}
function renderBars(t) {
  $('lzStores').innerHTML = bars(t.byStore, 'store', r => sdot(r.store) + esc(r.store));
  $('lzCats').innerHTML = bars(t.byCategory, 'category', r => esc(r.category));
}
function renderTop(t) {
  $('lzTop').innerHTML = t.topProducts.map((p, i) => `<tr><td class="num">${i + 1}</td><td><strong>${esc(p.name)}</strong></td><td>${esc(p.category)}</td><td class="r num">${p.units.toLocaleString('en-IN')}</td><td class="r num">${inr(p.revenue)}</td></tr>`).join('')
    || '<tr><td colspan="5" class="sub">No Buy clicks in this range yet.</td></tr>';
}
$('lzRange').addEventListener('click', e => { const b = e.target.closest('[data-days]'); if (b) { lz.days = Number(b.dataset.days); loadTrends(); } });
$('lzCat').addEventListener('change', e => { lz.category = e.target.value; loadTrends(); });

/* ---------- Categories (edited at run time on /categories.html) ---------- */
let categories = [];
const subsOf = name => (categories.find(c => c.name === name) || { subcategories: [] }).subcategories;
const subNames = name => subsOf(name).map(s => s.name);
const typesOf = (name, sub) => (subsOf(name).find(s => s.name === sub) || { types: [] }).types.map(t => t.name);
const opt = (v, label = v) => `<option value="${esc(v)}">${esc(label)}</option>`;
async function loadCategories(preloaded) {
  const fresh = preloaded || await api('/api/categories');
  if (JSON.stringify(fresh) === JSON.stringify(categories)) return false;
  categories = fresh;
  // Keep what the user picked if it still exists.
  if (state.cat && !categories.some(c => c.name === state.cat)) { state.cat = null; state.sub = null; }
  if (state.sub && !subNames(state.cat).includes(state.sub)) state.sub = null;
  if (state.type && !typesOf(state.cat, state.sub).includes(state.type)) state.type = null;
  const lzc = $('lzCat').value;
  $('lzCat').innerHTML = opt('', 'All categories') + categories.map(c => opt(c.name)).join('');
  if (categories.some(c => c.name === lzc)) $('lzCat').value = lzc; else lz.category = '';
  return true;
}
// Pick up category changes made elsewhere without a page reload.
window.addEventListener('focus', () => loadCategories().then(changed => { if (changed) loadProducts(); }).catch(() => {}));

/* ---------- Boot ---------- */
(async () => {
  // The gate stays down until the server is awake (gate.js); its categories answer is reused here.
  await loadCategories(await window.czReady);
  route();
  booted = true;
  await Promise.all([loadProducts(), loadCompareCounts().catch(() => {}), loadNewArrivals().catch(() => {}), loadDeals().catch(() => {})]);
  window.czOpenGate();
})().catch(err => {
  $('detail').innerHTML = `<div class="empty">Could not load data: ${esc(err.message)}. Is the server running?</div>`;
  window.czOpenGate(`The shop could not open: ${err.message}. Please refresh the page.`);
});
})();
