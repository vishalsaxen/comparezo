// Comparezo front end: two tabs, Comparezo (compare + sell) and Linezo (sales trends).
(() => {
const STORE_COLORS = {
  'Amazon.in': '#e08a00', 'Flipkart': '#2f6fdc', 'Meesho': '#b0307a', 'Myntra': '#e2445c',
  'JioMart': '#1f7a8c', 'Snapdeal': '#d23b3b', 'Individual seller': '#0f5a4f'
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
const catLabel = (cat, sub) => sub ? `${cat} › ${sub}` : cat;
const thumb = cat => `<div class="thumb" style="background:${catStyle(cat).c}"><svg viewBox="0 0 24 24" aria-hidden="true">${catStyle(cat).i}</svg></div>`;
const sdot = s => `<span class="sdot" style="background:${STORE_COLORS[s] || '#888'}"></span>`;
async function api(url, opts) {
  const r = await fetch(url, opts && opts.body ? { method: 'POST', ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers }, body: JSON.stringify(opts.body) } : opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || 'Request failed'), { data });
  return data;
}
let toastTimer;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3200); }

/* ---------- Tabs ---------- */
let linezoLoaded = false;
function route() {
  const tab = location.hash === '#linezo' ? 'linezo' : 'compare';
  $('view-compare').hidden = tab !== 'compare';
  $('view-linezo').hidden = tab !== 'linezo';
  $('tab-compare').setAttribute('aria-selected', tab === 'compare');
  $('tab-linezo').setAttribute('aria-selected', tab === 'linezo');
  document.title = tab === 'linezo' ? 'Linezo · Comparezo' : 'Comparezo';
  if (tab === 'linezo' && !linezoLoaded) { linezoLoaded = true; loadTrends(); }
  if (location.hash === '#sell' || location.hash === '#community') document.querySelector(location.hash)?.scrollIntoView();
}
window.addEventListener('hashchange', route);

/* ---------- Comparezo: search + compare ---------- */
const state = { q: '', cat: null, sub: null, sel: null, sort: 'eff', extras: true, products: [], detail: null };

async function loadProducts() {
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q);
  if (state.cat) p.set('category', state.cat);
  if (state.cat && state.sub) p.set('sub', state.sub);
  state.products = await api('/api/products?' + p);
  if (!state.products.some(x => x.id === state.sel)) state.sel = state.products[0]?.id ?? null;
  renderResults();
  await loadDetail();
}
function renderResults() {
  const list = state.products;
  $('results').innerHTML = `<div class="results-head"><strong>${list.length} product${list.length === 1 ? '' : 's'}</strong><span class="sub">${state.q ? 'for “' + esc(state.q) + '”' : esc(state.cat ? catLabel(state.cat, state.sub) : 'Popular today')}</span></div>` +
    (list.length ? list.map(p => `<button class="ritem" data-id="${p.id}" aria-current="${p.id === state.sel}">${thumb(p.category)}<div><div class="t">${esc(p.name)}</div><div class="sub">From <span class="from num">${inr(p.lowest)}</span> · ${p.storeCount} stores</div></div></button>`).join('')
      : '<div class="empty">No products match. Try “earbuds”, “kurta” or “cooker”.</div>');
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
    <div class="dhead">${thumb(p.category)}<div class="info"><div class="eyebrow">${esc(catLabel(p.category, p.sub_category))}</div><h2>${esc(p.name)}</h2><div class="sub">${esc(p.spec)}</div></div></div>
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
          <td>${r.buyUrl ? `<a class="btn ${isBest ? 'btn-brand' : 'btn-ghost'} go" href="${esc(r.buyUrl)}" target="_blank" rel="noopener noreferrer sponsored" data-buy-offer="${r.id}" data-store="${esc(r.store)}">Buy on ${esc(r.store)} ↗</a>` : '<span class="sub">No link yet</span>'}</td>
        </tr>`; }).join('')}
      </tbody></table></div>
    <p class="foot-note">“You pay” = listed price + delivery − coupon. Prices are sample data until store feeds are connected.</p>
    ${d.localListings.length ? `<div class="locals"><h3>Also from individual sellers in ${esc(p.category)}</h3>${d.localListings.map(l => `
      <div class="local-row"><div><strong>${esc(l.title)}</strong><div class="sub">${esc(l.seller_name)} · ${esc(l.city)} · ${esc(l.condition)}</div></div>
      <div style="display:flex;gap:10px;align-items:center"><span class="num eff">${inr(l.price)}</span><button class="btn btn-ghost go" data-contact-listing="${l.id}" aria-expanded="false">Contact seller</button></div>
      <div class="contact" id="contact-${l.id}" hidden>
        <div><strong>${esc(l.seller_name)}</strong> · ${esc(l.city)}</div>
        ${l.phone ? `<div>Call or WhatsApp: <span class="num" style="user-select:all">${esc(l.phone)}</span></div>` : '<div class="sub">This seller hasn\'t added a phone number yet.</div>'}
        <div class="sub">Agree the price and delivery directly with the seller. Pay only after you've seen the product.</div>
      </div></div>`).join('')}</div>` : ''}`;
}

$('searchForm').addEventListener('submit', e => { e.preventDefault(); state.q = $('q').value.trim(); loadProducts(); });
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
  const a = e.target.closest('a[data-buy-offer]');
  if (a) {
    recordPurchase({ offerId: Number(a.dataset.buyOffer) });
    toast(`Opening ${a.dataset.store} in a new tab.`);
    return;
  }
  const c = e.target.closest('[data-contact-listing]');
  if (!c) return;
  const box = $('contact-' + c.dataset.contactListing);
  const opening = box.hidden;
  box.hidden = !opening;
  c.setAttribute('aria-expanded', opening);
  c.textContent = opening ? 'Hide contact' : 'Contact seller';
  if (opening && !c.dataset.counted) { c.dataset.counted = '1'; recordPurchase({ listingId: Number(c.dataset.contactListing) }); }
});
function recordPurchase(body) {
  fetch('/api/purchases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true })
    .then(r => { if (r.ok) linezoLoaded = false; }).catch(() => {});
}
$('detail').addEventListener('change', e => { if (e.target.id === 'extras') { state.extras = e.target.checked; loadDetail(); } });

/* ---------- Comparezo: sell ---------- */
let photo = null;
function cardHTML(l) {
  const c = catStyle(l.category);
  const img = l.photoUrl ? `<div class="img" style="background-image:url('${esc(l.photoUrl)}')"></div>` : `<div class="img" style="background:${c.c}"><svg viewBox="0 0 24 24" aria-hidden="true">${c.i}</svg></div>`;
  return `<article class="lcard">${img}<div class="body"><div class="price num">${inr(l.price || 0)}</div><div class="t">${esc(l.title || 'Your product name')}</div><div class="sub">${esc(l.city || 'Your city')} · ${esc(l.seller_name || 'You')}</div><div class="row"><span class="cond">${esc(l.condition)}</span><span class="sub">${esc(l.sub_category || l.category)}</span></div></div></article>`;
}
function readForm() {
  return { title: $('s-title').value.trim(), category: $('s-cat').value, subCategory: $('s-sub').value, condition: $('s-cond').value, price: Number($('s-price').value),
    city: $('s-city').value.trim(), sellerName: $('s-name').value.trim(), phone: $('s-phone').value.trim(), description: $('s-desc').value.trim(), photo };
}
function updatePreview() { const f = readForm(); $('preview').innerHTML = cardHTML({ ...f, seller_name: f.sellerName, sub_category: f.subCategory, photoUrl: photo }); }
async function loadListings() {
  const list = await api('/api/listings');
  $('lgrid').innerHTML = list.length ? list.map(l => cardHTML({ ...l, photoUrl: l.photo ? '/uploads/' + l.photo : null })).join('') : '<p class="sub">No listings yet. Be the first.</p>';
}
function loadPhoto(f) {
  if (!f) return;
  if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { $('sellStatus').className = 'err'; $('sellStatus').textContent = 'Photo must be a JPG, PNG or WebP image.'; return; }
  if (f.size > 3 * 1024 * 1024) { $('sellStatus').className = 'err'; $('sellStatus').textContent = 'Photo must be under 3 MB.'; return; }
  const r = new FileReader();
  r.onload = () => { photo = r.result; $('drop').querySelector('strong').textContent = 'Photo added: ' + f.name; updatePreview(); };
  r.readAsDataURL(f);
}
$('sellForm').addEventListener('input', updatePreview);
$('sellForm').addEventListener('change', updatePreview);
$('s-photo').addEventListener('change', e => loadPhoto(e.target.files[0]));
const drop = $('drop');
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => loadPhoto(e.dataTransfer.files[0]));
$('sellForm').addEventListener('submit', async e => {
  e.preventDefault();
  const status = $('sellStatus'), btn = e.submitter;
  btn.disabled = true;
  try {
    await api('/api/listings', { body: readForm() });
    status.className = 'ok'; status.textContent = 'Published. Your listing is now live under Local listings.';
    e.target.reset(); fillSubSelect(); photo = null; drop.querySelector('strong').textContent = 'Drop a photo here'; updatePreview();
    loadListings(); loadDetail();
  } catch (err) {
    status.className = 'err'; status.textContent = (err.data && err.data.errors || [err.message]).join(' ');
  }
  btn.disabled = false;
});

/* ---------- Linezo: trends ---------- */
const lz = { days: 30, category: '' };
async function loadTrends() {
  document.querySelectorAll('#lzRange button').forEach(b => b.setAttribute('aria-pressed', Number(b.dataset.days) === lz.days));
  const p = new URLSearchParams({ days: lz.days });
  if (lz.category) p.set('category', lz.category);
  const t = await api('/api/trends?' + p);
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
    <div class="kpi"><div class="eyebrow">Units sold</div><div class="v num">${t.totals.units.toLocaleString('en-IN')}</div>${delta(t.totals.unitsChangePct)}</div>
    <div class="kpi"><div class="eyebrow">Sales value</div><div class="v num">${inr(t.totals.revenue)}</div>${delta(t.totals.revenueChangePct)}</div>
    <div class="kpi"><div class="eyebrow">Average order</div><div class="v num">${inr(t.totals.avgOrder)}</div><span class="sub">per unit</span></div>
    <div class="kpi"><div class="eyebrow">Top store</div><div class="v" style="font-size:22px;display:flex;align-items:center">${best ? sdot(best.store) + esc(best.store) : '–'}</div><span class="sub">${best && t.totals.units ? Math.round(best.units / t.totals.units * 100) + '% of units' : ''}</span></div>`;
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
  const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Units sold per day, ${fmtDay(t.from)} to ${fmtDay(t.to)}">
    ${ticks.map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${Math.round(v)}</text>`).join('')}
    ${data.map((d, i) => i % step === 0 || i === data.length - 1 ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${fmtDay(d.day)}</text>` : '').join('')}
    <path d="${line(units)} L${x(data.length - 1)} ${y(0)} L${x(0)} ${y(0)}Z" fill="var(--brand-soft)"/>
    <path d="${line(units)}" fill="none" stroke="var(--brand)" stroke-width="1.5" opacity=".55"/>
    <path d="${line(avg)}" fill="none" stroke="var(--marigold)" stroke-width="3" stroke-linejoin="round"/>
    <circle cx="${x(data.length - 1)}" cy="${y(avg[avg.length - 1])}" r="5" fill="var(--marigold)"/>
    <rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent" id="lzHit"/>
  </svg><div class="tip" hidden></div>
  <div class="sub" style="display:flex;gap:16px;margin-top:6px;flex-wrap:wrap"><span><span class="sdot" style="background:var(--brand)"></span>Daily units</span><span><span class="sdot" style="background:var(--marigold)"></span>7-day average</span></div>`;
  $('lzChart').innerHTML = svg;
  const hit = $('lzChart').querySelector('#lzHit'), tip = $('lzChart').querySelector('.tip'), el = $('lzChart').querySelector('svg');
  hit.addEventListener('mousemove', e => {
    const rect = el.getBoundingClientRect(), sx = (e.clientX - rect.left) * W / rect.width;
    const i = Math.max(0, Math.min(data.length - 1, Math.round((sx - L) / ((W - L - R) / Math.max(1, data.length - 1)))));
    tip.hidden = false; tip.style.left = (x(i) * rect.width / W) + 'px'; tip.style.top = (y(units[i]) * rect.height / H) + 'px';
    tip.textContent = `${fmtDay(data[i].day)}: ${units[i]} units · ${inr(data[i].revenue)}`;
  });
  hit.addEventListener('mouseleave', () => (tip.hidden = true));
}
function bars(rows, key, label) {
  const total = rows.reduce((a, r) => a + r.units, 0) || 1, max = Math.max(1, ...rows.map(r => r.units));
  return rows.map(r => `<div class="bar-row"><div class="name">${label(r)}</div><div class="bar"><span style="width:${(r.units / max * 100).toFixed(1)}%"></span></div><div class="num r">${Math.round(r.units / total * 100)}%</div></div>`).join('') || '<p class="sub">No sales in this range yet.</p>';
}
function renderBars(t) {
  $('lzStores').innerHTML = bars(t.byStore, 'store', r => sdot(r.store) + esc(r.store));
  $('lzCats').innerHTML = bars(t.byCategory, 'category', r => esc(r.category));
}
function renderTop(t) {
  $('lzTop').innerHTML = t.topProducts.map((p, i) => `<tr><td class="num">${i + 1}</td><td><strong>${esc(p.name)}</strong>${p.individual ? ' <span class="tag tag-fast">Individual seller</span>' : ''}</td><td>${esc(p.category)}</td><td class="r num">${p.units.toLocaleString('en-IN')}</td><td class="r num">${inr(p.revenue)}</td></tr>`).join('')
    || '<tr><td colspan="5" class="sub">No sales in this range yet.</td></tr>';
}
$('lzRange').addEventListener('click', e => { const b = e.target.closest('[data-days]'); if (b) { lz.days = Number(b.dataset.days); loadTrends(); } });
$('lzCat').addEventListener('change', e => { lz.category = e.target.value; loadTrends(); });

/* ---------- Categories (edited at run time on /categories.html) ---------- */
let categories = [];
const subsOf = name => (categories.find(c => c.name === name) || { subcategories: [] }).subcategories.map(s => s.name);
const opt = (v, label = v) => `<option value="${esc(v)}">${esc(label)}</option>`;
function renderCatChips() {
  $('cats').innerHTML = '<span class="sub">Browse:</span>' + categories.map(c => `<button type="button" class="chip" data-cat="${esc(c.name)}" aria-pressed="${c.name === state.cat}">${esc(c.name)}</button>`).join('');
  const subs = state.cat ? subsOf(state.cat) : [];
  $('subcats').hidden = !subs.length;
  $('subcats').innerHTML = subs.length ? `<span class="sub">${esc(state.cat)}:</span>` + subs.map(s => `<button type="button" class="chip" data-sub="${esc(s)}" aria-pressed="${s === state.sub}">${esc(s)}</button>`).join('') : '';
}
function fillSubSelect(keep) {
  const subs = subsOf($('s-cat').value);
  $('s-sub').innerHTML = subs.length ? opt('', 'Select sub-category') + subs.map(s => opt(s)).join('') : opt('', 'None');
  $('s-sub').disabled = !subs.length;
  if (keep && subs.includes(keep)) $('s-sub').value = keep;
}
async function loadCategories() {
  const fresh = await api('/api/categories');
  if (JSON.stringify(fresh) === JSON.stringify(categories)) return false;
  categories = fresh;
  // Keep what the user picked if it still exists.
  if (state.cat && !categories.some(c => c.name === state.cat)) { state.cat = null; state.sub = null; }
  if (state.sub && !subsOf(state.cat).includes(state.sub)) state.sub = null;
  renderCatChips();
  const cat = $('s-cat').value, sub = $('s-sub').value;
  $('s-cat').innerHTML = categories.map(c => opt(c.name)).join('');
  if (categories.some(c => c.name === cat)) $('s-cat').value = cat;
  fillSubSelect(sub);
  const lzc = $('lzCat').value;
  $('lzCat').innerHTML = opt('', 'All categories') + categories.map(c => opt(c.name)).join('');
  if (categories.some(c => c.name === lzc)) $('lzCat').value = lzc; else lz.category = '';
  return true;
}
$('cats').addEventListener('click', e => {
  const b = e.target.closest('[data-cat]'); if (!b) return;
  state.cat = state.cat === b.dataset.cat ? null : b.dataset.cat;
  state.sub = null;
  renderCatChips();
  loadProducts();
});
$('subcats').addEventListener('click', e => {
  const b = e.target.closest('[data-sub]'); if (!b) return;
  state.sub = state.sub === b.dataset.sub ? null : b.dataset.sub;
  renderCatChips();
  loadProducts();
});
$('s-cat').addEventListener('change', () => fillSubSelect());
// Pick up category changes made elsewhere without a page reload.
window.addEventListener('focus', () => loadCategories().then(changed => { if (changed) { updatePreview(); loadProducts(); } }).catch(() => {}));

/* ---------- Boot ---------- */
(async () => {
  await loadCategories();
  updatePreview();
  route();
  await Promise.all([loadProducts(), loadListings()]);
})().catch(err => { $('detail').innerHTML = `<div class="empty">Could not load data: ${esc(err.message)}. Is the server running?</div>`; });
})();
