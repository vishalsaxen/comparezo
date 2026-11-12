// Admin page for adding products by hand, with each store's link and price.
(() => {
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = n => '₹' + Math.round(n).toLocaleString('en-IN');
const STORES = ['Amazon.in', 'Flipkart', 'Myntra', 'Meesho', 'Ajio', 'Nykaa', 'JioMart', 'Tata CLiQ', 'Croma', 'Reliance Digital', 'BigBasket', 'Snapdeal', 'FirstCry', 'Pepperfry'];
const keyStore = {
  get() { try { return localStorage.getItem('cz-admin-key') || ''; } catch { return ''; } },
  set(v) { try { localStorage.setItem('cz-admin-key', v); } catch { /* private mode */ } },
};
let key = keyStore.get(), tree = [];

let toastTimer;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3200); }
async function call(method, url, body) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-Admin-Key': key }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error((data.errors || []).join(' ') || data.error || 'Request failed'), { status: r.status });
  return data;
}

/* Category pickers */
const opts = (list, ph) => (ph ? `<option value="">${ph}</option>` : '') + list.map(x => `<option>${esc(x.name)}</option>`).join('');
function fillSubs() {
  const c = tree.find(x => x.name === $('p-cat').value);
  const subs = c ? c.subcategories : [];
  $('p-sub').innerHTML = subs.length ? opts(subs, 'Pick a sub-category') : '<option value="">None</option>';
  $('p-sub').disabled = !subs.length;
  fillTypes();
}
function fillTypes() {
  const c = tree.find(x => x.name === $('p-cat').value);
  const s = c && c.subcategories.find(x => x.name === $('p-sub').value);
  const types = s ? s.types : [];
  $('p-type-wrap').hidden = !types.length;
  $('p-type').innerHTML = types.length ? opts(types, 'Pick a type') : '';
}
$('p-cat').addEventListener('change', fillSubs);
$('p-sub').addEventListener('change', fillTypes);

/* Store rows */
function addOfferRow() {
  const row = document.createElement('div');
  row.className = 'offer-row';
  row.innerHTML = `
    <div class="field"><label>Store</label><select data-f="store">${STORES.map(s => `<option>${s}</option>`).join('')}</select></div>
    <div class="field"><label>Price (₹)</label><input data-f="price" type="number" min="1" inputmode="numeric"></div>
    <div class="field"><label>MRP (₹)</label><input data-f="mrp" type="number" min="1" inputmode="numeric" placeholder="optional"></div>
    <div class="field"><label>Delivery (₹)</label><input data-f="deliveryFee" type="number" min="0" inputmode="numeric" placeholder="0"></div>
    <div class="field wide"><label>Product link</label><input data-f="url" placeholder="https://www.flipkart.com/…"></div>
    <button type="button" class="btn btn-ghost small danger" data-remove aria-label="Remove this store">Remove</button>`;
  // Guess the store from a pasted link.
  row.querySelector('[data-f=url]').addEventListener('change', e => {
    const host = (() => { try { return new URL(e.target.value).hostname; } catch { return ''; } })();
    const guess = { 'amazon.in': 'Amazon.in', 'flipkart.com': 'Flipkart', 'myntra.com': 'Myntra', 'meesho.com': 'Meesho', 'ajio.com': 'Ajio', 'nykaa.com': 'Nykaa', 'jiomart.com': 'JioMart', 'tatacliq.com': 'Tata CLiQ', 'croma.com': 'Croma', 'reliancedigital.in': 'Reliance Digital', 'bigbasket.com': 'BigBasket', 'snapdeal.com': 'Snapdeal', 'firstcry.com': 'FirstCry', 'pepperfry.com': 'Pepperfry' };
    const hit = Object.keys(guess).find(d => host === d || host.endsWith('.' + d));
    if (hit) row.querySelector('[data-f=store]').value = guess[hit];
  });
  $('offers').appendChild(row);
}
$('addOffer').addEventListener('click', addOfferRow);
$('offers').addEventListener('click', e => {
  if (!e.target.closest('[data-remove]')) return;
  if ($('offers').children.length > 1) e.target.closest('.offer-row').remove();
});

function resetForm() {
  for (const id of ['p-name', 'p-spec', 'p-image']) $(id).value = '';
  $('offers').innerHTML = ''; addOfferRow();
}

$('productForm').addEventListener('submit', async e => {
  e.preventDefault();
  const offers = [...$('offers').children].map(r => Object.fromEntries([...r.querySelectorAll('[data-f]')].map(i => [i.dataset.f, i.value.trim()])));
  const body = { name: $('p-name').value.trim(), category: $('p-cat').value, subCategory: $('p-sub').value, type: $('p-type').value,
    spec: $('p-spec').value.trim(), image: $('p-image').value.trim(), offers };
  const st = $('formStatus');
  try {
    await call('POST', '/api/admin/products', body);
    st.className = 'ok'; st.textContent = 'Added. It now shows in search and its category.';
    resetForm(); loadList();
  } catch (err) { st.className = 'err'; st.textContent = err.message; }
});

/* List */
let added = [];
async function loadList() {
  const list = added = await call('GET', '/api/admin/products');
  $('listWrap').hidden = false;
  $('list').innerHTML = list.length ? list.map(p => `<div class="panel cat-card"><div class="cat-row">
      <span class="cat-name">${esc(p.name)} <span class="sub">· ${esc([p.category, p.sub_category, p.type].filter(Boolean).join(' › '))}</span><br>
      <span class="sub">${p.offers.map(o => `${esc(o.store)} ${inr(o.price)}`).join(' · ')}</span></span>
      <span class="cat-actions"><button type="button" class="btn btn-ghost small danger" data-del="${p.id}" data-name="${esc(p.name)}">Delete</button></span>
    </div></div>`).join('') : '<p class="sub">Nothing added yet.</p>';
}
$('list').addEventListener('click', async e => {
  const b = e.target.closest('[data-del]'); if (!b) return;
  if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Click again to delete'; return; }
  try { await call('DELETE', `/api/admin/products/${b.dataset.del}`); toast(`Deleted ${b.dataset.name}.`); loadList(); }
  catch (err) { toast(err.message); }
});

// The same shape as server/catalog.json, so the list can be saved in the code.
$('copyList').addEventListener('click', async () => {
  const json = JSON.stringify(added.map(p => ({
    name: p.name, category: p.category, subCategory: p.sub_category || undefined, type: p.type || undefined,
    spec: p.spec || undefined, image: p.image || undefined,
    offers: p.offers.map(o => ({ store: o.store, price: o.price, mrp: o.mrp || undefined, deliveryFee: o.delivery_fee || undefined, url: o.url })),
  })), null, 2);
  try { await navigator.clipboard.writeText(json); $('copyStatus').textContent = `Copied ${added.length} product${added.length === 1 ? '' : 's'}.`; }
  catch { $('copyStatus').textContent = 'Could not copy. Select and copy the text below.'; $('list').insertAdjacentHTML('afterbegin', `<textarea class="copy-box" readonly>${esc(json)}</textarea>`); }
});

/* My deals */
const STORE_HOSTS = { 'amazon.in': 'Amazon.in', 'flipkart.com': 'Flipkart', 'myntra.com': 'Myntra', 'meesho.com': 'Meesho', 'ajio.com': 'Ajio', 'nykaa.com': 'Nykaa', 'jiomart.com': 'JioMart', 'tatacliq.com': 'Tata CLiQ', 'croma.com': 'Croma', 'reliancedigital.in': 'Reliance Digital', 'bigbasket.com': 'BigBasket', 'snapdeal.com': 'Snapdeal', 'firstcry.com': 'FirstCry', 'pepperfry.com': 'Pepperfry' };
$('d-stores').innerHTML = STORES.map(s => `<option value="${esc(s)}">`).join('');
$('d-url').addEventListener('change', e => {
  if ($('d-store').value.trim()) return;
  const host = (() => { try { return new URL(e.target.value).hostname; } catch { return ''; } })();
  const hit = Object.keys(STORE_HOSTS).find(d => host === d || host.endsWith('.' + d));
  if (hit) $('d-store').value = STORE_HOSTS[hit];
});
const today = () => new Date().toISOString().slice(0, 10);
async function loadMyDeals() {
  const list = await call('GET', '/api/admin/my-deals');
  $('myDeals').innerHTML = list.length ? list.map(d => `<div class="panel cat-card"><div class="cat-row">
      <span class="cat-name">${esc(d.title)} <span class="sub">${d.store ? '· ' + esc(d.store) : ''}${d.code ? ' · code ' + esc(d.code) : ''}</span><br>
      <span class="sub">${d.ends_at ? (d.ends_at < today() ? 'Ended ' : 'Ends ') + esc(d.ends_at) : 'No end date'} · <a href="${esc(d.url)}" target="_blank" rel="noopener">link</a></span></span>
      <span class="cat-actions"><button type="button" class="btn btn-ghost small danger" data-del-deal="${d.id}" data-name="${esc(d.title)}">Delete</button></span>
    </div></div>`).join('') : '<p class="sub">No deals added yet.</p>';
}
$('dealForm').addEventListener('submit', async e => {
  e.preventDefault();
  const v = id => $(id).value.trim();
  const st = $('dealFormStatus');
  try {
    await call('POST', '/api/admin/my-deals', { title: v('d-title'), store: v('d-store'), code: v('d-code'), url: v('d-url'), description: v('d-desc'), image: v('d-image'), endsAt: v('d-ends') });
    st.className = 'ok'; st.textContent = 'Added. It now shows in "Number of deals now".';
    for (const id of ['d-title', 'd-store', 'd-code', 'd-url', 'd-desc', 'd-image', 'd-ends']) $(id).value = '';
    loadMyDeals();
  } catch (err) { st.className = 'err'; st.textContent = err.message; }
});
$('myDeals').addEventListener('click', async e => {
  const b = e.target.closest('[data-del-deal]'); if (!b) return;
  if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Click again to delete'; return; }
  try { await call('DELETE', `/api/admin/my-deals/${b.dataset.delDeal}`); toast(`Deleted ${b.dataset.name}.`); loadMyDeals(); }
  catch (err) { toast(err.message); }
});

/* Unlock */
async function unlock() {
  try {
    await call('POST', '/api/admin/check');
    keyStore.set(key);
    $('keyForm').hidden = true; $('productForm').hidden = false;
    loadList(); loadMyDeals();
  } catch (err) {
    $('keyStatus').className = 'err';
    $('keyStatus').textContent = err.status === 403 ? 'Adding products is turned off. Set ADMIN_KEY on the server first.' : 'That key is not right.';
  }
}
$('checkDeals').addEventListener('click', async () => {
  $('dealsStatus').textContent = 'Asking Cuelinks…';
  try {
    const r = await call('GET', '/api/admin/deals/check');
    $('dealsStatus').textContent = r.error ? r.error : `Connected. ${r.mapped ? r.mapped.filter(Boolean).length : 0} of ${(r.sample || []).length} sample offers read correctly.`;
    $('dealsOut').textContent = JSON.stringify({ offerFields: r.offerFields, mapped: r.mapped, sample: r.sample }, null, 2);
    $('dealsOut').hidden = false;
  } catch (err) { $('dealsStatus').textContent = err.message; }
});
$('keyForm').addEventListener('submit', e => { e.preventDefault(); key = $('adminKey').value; unlock(); });

(async () => {
  tree = await (await fetch('/api/categories')).json();
  $('p-cat').innerHTML = opts(tree, 'Pick a category');
  fillSubs(); resetForm();
  if (key) unlock();
})();
})();
