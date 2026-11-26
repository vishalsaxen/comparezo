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
const pSel = { cat: $('p-cat'), sub: $('p-sub'), type: $('p-type') };
for (const el of Object.values(pSel)) el.addEventListener('change', () => clearErrs({ x: el }));


/* Required categories: suggestions from the name, inline errors, and checks for sheets.
   Products need a category, its sub-category, and its type where it has types.
   Deals need a category (or "Whole store"); the sub-category is optional. */
const WHOLE = 'Whole store';
const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const pathLabel = p => [p.category, p.subCategory, p.type].filter(Boolean).join(' › ');
// Every path a product (mode 'product') or deal (mode 'deal') can be filed under, for the fix-it dropdowns.
function allPaths(mode) {
  const out = mode === 'deal' ? [{ category: WHOLE }] : [];
  for (const c of tree) {
    if (mode === 'deal' || !c.subcategories.length) out.push({ category: c.name });
    for (const sb of c.subcategories) {
      if (mode === 'deal' || !sb.types.length) out.push({ category: c.name, subCategory: sb.name });
      if (mode === 'product') for (const t of sb.types) out.push({ category: c.name, subCategory: sb.name, type: t.name });
    }
  }
  return out;
}
// A category path typed in a sheet, matched without caring about capitals. Returns { path } or { error }.
function resolvePath(cat, sub, type, mode = 'product') {
  if (!String(cat || '').trim()) return { error: 'No category' };
  if (mode === 'deal' && same(cat, WHOLE)) return String(sub || '').trim() ? { error: 'A whole-store deal has no sub-category' } : { path: { category: WHOLE } };
  const c = tree.find(x => same(x.name, cat));
  if (!c) return { error: `"${cat}" is not a category` };
  if (!String(sub || '').trim()) return mode === 'deal' || !c.subcategories.length ? { path: { category: c.name } } : { error: 'Needs a sub-category' };
  const sb = c.subcategories.find(x => same(x.name, sub));
  if (!sb) return { error: `"${sub}" is not in ${c.name}` };
  if (mode === 'deal') return { path: { category: c.name, subCategory: sb.name } };
  if (!sb.types.length) return { path: { category: c.name, subCategory: sb.name } };
  const t = sb.types.find(x => same(x.name, type));
  return t ? { path: { category: c.name, subCategory: sb.name, type: t.name } } : { error: 'Needs a type' };
}
const pathOptions = (mode, ph = 'Pick a category') => `<option value="">${ph}</option>` + allPaths(mode).map(p => `<option value="${esc(JSON.stringify(p))}">${esc(pathLabel(p))}</option>`).join('');
// Put a path into a form's category selects (they cascade, so each change fills the next one).
function setSelects(sel, p) {
  sel.cat.value = p.category || '';
  sel.cat.dispatchEvent(new Event('change'));
  if (sel.sub) { sel.sub.value = p.subCategory || ''; sel.sub.dispatchEvent(new Event('change')); }
  if (sel.type && p.type) sel.type.value = p.type;
  clearErrs(sel);
}
function clearErrs(sel) { for (const el of Object.values(sel)) if (el && el.closest) { const f = el.closest('.field'); if (f) { f.classList.remove('err'); const m = f.querySelector('.msg'); if (m) m.remove(); } } }
function markErr(el, msg) {
  const f = el.closest('.field');
  f.classList.add('err');
  if (!f.querySelector('.msg')) f.insertAdjacentHTML('beforeend', `<span class="msg" role="alert">${esc(msg)}</span>`);
}
// Checks a form's category selects before saving. Marks what's missing and returns false.
function checkSelects(sel, mode, what) {
  clearErrs(sel);
  if (!sel.cat.value) { markErr(sel.cat, mode === 'deal' ? `Pick a category so this ${what} shows in the right place on Super Saver Deals, or "Whole store".` : `Pick a category so shoppers can find this ${what}.`); sel.cat.focus(); return false; }
  if (mode === 'deal') return true;
  if (!sel.sub.disabled && !sel.sub.value) { markErr(sel.sub, 'Pick a sub-category.'); sel.sub.focus(); return false; }
  if (sel.type && !sel.type.closest('.field').hidden && !sel.type.value) { markErr(sel.type, 'Pick a type.'); sel.type.focus(); return false; }
  return true;
}
// "Suggested from the name" chips: Comparezo guesses the category from the words typed (server: deal-categories.js).
function suggestFrom(input, box, sel, mode) {
  let timer, last = '';
  const run = async () => {
    const q = input.value.trim();
    if (q === last) return;
    last = q;
    if (q.length < 3 || !key) { box.hidden = true; return; }
    try {
      const list = await call('GET', `/api/admin/category-suggest?mode=${mode}&q=${encodeURIComponent(q)}`);
      if (input.value.trim() !== q) return;
      box.hidden = !list.length;
      box.innerHTML = `<span class="suggest">${CzCat.icon('wand', 'ci sm')}<span>Suggested from the ${mode === 'deal' ? 'title' : 'name'}:</span>${list.map(p =>
        `<button type="button" class="chip" data-path="${esc(JSON.stringify(p))}">${CzCat.icon((tree.find(c => c.name === p.category) || {}).icon || 'tag', 'ci sm')}${esc(pathLabel(p))}</button>`).join('')}</span>`;
      box.querySelectorAll('.chip').forEach(b => b.setAttribute('aria-pressed', String(same(JSON.parse(b.dataset.path).category, sel.cat.value) && same(JSON.parse(b.dataset.path).subCategory || '', sel.sub ? sel.sub.value : ''))));
    } catch { box.hidden = true; }
  };
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 350); });
  input.addEventListener('change', run);
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-path]'); if (!b) return;
    setSelects(sel, JSON.parse(b.dataset.path));
    box.querySelectorAll('.chip').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  });
  return { reset() { last = ''; box.hidden = true; } };
}
// Deal category selects: "Whole store" first, then the categories; the sub-category is optional.
const dealCatOptions = () => `<option value="">Pick a category</option><option value="${WHOLE}">★ Whole store (sale on everything)</option>` + opts(tree);
function dealCascade(cat, sub) {
  const fill = (want = '') => {
    const c = tree.find(x => x.name === cat.value);
    const subs = c ? c.subcategories : [];
    sub.innerHTML = subs.length ? `<option value="">Any ${esc(c.name)}</option>` + subs.map(x => `<option>${esc(x.name)}</option>`).join('') : `<option value="">${cat.value === WHOLE ? 'None (whole store)' : 'Pick a category first'}</option>`;
    sub.disabled = !subs.length;
    if (want) sub.value = want;
  };
  cat.addEventListener('change', () => fill());
  return { fill };
}

/* Store rows */
function addOfferRow(box = $('offers')) {
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
  box.appendChild(row);
  return row;
}
$('addOffer').addEventListener('click', () => addOfferRow());
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
  if (!checkSelects(pSel, 'product', 'product')) { st.className = 'err'; st.textContent = 'Pick the category first (marked above).'; return; }
  try {
    await call('POST', '/api/admin/products', body);
    st.className = 'ok'; st.textContent = 'Added. It now shows in search and its category.';
    resetForm(); pSuggest.reset(); loadList();
  } catch (err) { st.className = 'err'; st.textContent = err.message; }
});

/* List */
let added = [];
async function loadList() {
  const list = added = await call('GET', '/api/admin/products');
  $('listWrap').hidden = false;
  $('list').innerHTML = list.length ? list.map(p => `<div class="panel cat-card" data-card="${p.id}"><div class="cat-row">
      <span class="cat-name">${esc(p.name)} <span class="sub">· ${esc([p.category, p.sub_category, p.type].filter(Boolean).join(' › '))}</span><br>
      <span class="sub">${p.offers.map(o => `${esc(o.store)} ${inr(o.price)}`).join(' · ')}</span></span>
      <span class="cat-actions"><button type="button" class="btn btn-ghost small" data-edit="${p.id}">Edit</button>
        <button type="button" class="btn btn-ghost small danger" data-del="${p.id}" data-name="${esc(p.name)}">Delete</button></span>
    </div></div>`).join('') : '<p class="sub">Nothing added yet.</p>';
}

/* Edit a product in place: the form opens under it, filled with what is saved, so you can change
   one field or all of them. Store rows keep their id, so shoppers' Buy links keep working. */
function cascade(form) {
  const [cat, sub, type, typeWrap] = ['cat', 'sub', 'type', 'type-wrap'].map(k => form.querySelector(`[data-e="${k}"]`));
  const subs = () => { const c = tree.find(x => x.name === cat.value); return c ? c.subcategories : []; };
  const types = () => { const s = subs().find(x => x.name === sub.value); return s ? s.types : []; };
  const fillTypes = (want = '') => {
    const t = types();
    typeWrap.hidden = !t.length;
    type.innerHTML = t.length ? opts(t, 'Pick a type') : '';
    if (want) type.value = want;
  };
  const fillSubs = (want = '', wantType = '') => {
    const s = subs();
    sub.innerHTML = s.length ? opts(s, 'Pick a sub-category') : '<option value="">None</option>';
    sub.disabled = !s.length;
    if (want) sub.value = want;
    fillTypes(wantType);
  };
  cat.addEventListener('change', () => fillSubs());
  sub.addEventListener('change', () => fillTypes());
  return { fillSubs };
}
function fillOfferRow(row, o) {
  const sel = row.querySelector('[data-f=store]');
  if (o.store && ![...sel.options].some(x => x.value === o.store)) sel.insertAdjacentHTML('afterbegin', `<option>${esc(o.store)}</option>`);
  sel.value = o.store || sel.value;
  row.querySelector('[data-f=price]').value = o.price ?? '';
  row.querySelector('[data-f=mrp]').value = o.mrp ?? '';
  row.querySelector('[data-f=deliveryFee]').value = o.delivery_fee || '';
  row.querySelector('[data-f=url]').value = o.url || '';
  row.insertAdjacentHTML('beforeend', `<input type="hidden" data-f="id" value="${o.id}">`);
}
function openEdit(card, p) {
  const form = document.createElement('form');
  form.className = 'sell-form edit-form';
  form.noValidate = true;
  form.innerHTML = `
    <div class="field full"><label>Product name</label><input data-e="name" maxlength="200" value="${esc(p.name)}"></div>
    <div class="field"><label>Category <span class="req" aria-hidden="true">*</span></label><select data-e="cat">${opts(tree, 'Pick a category')}</select></div>
    <div class="field"><label>Sub-category <span class="req" aria-hidden="true">*</span></label><select data-e="sub"></select></div>
    <div class="field" data-e="type-wrap" hidden><label>Type <span class="req" aria-hidden="true">*</span></label><select data-e="type"></select></div>
    <div class="field full"><label>Short details</label><input data-e="spec" maxlength="200" value="${esc(p.spec || '')}"></div>
    <div class="field full"><label>Photo link</label><input data-e="image" value="${esc(p.image || '')}" placeholder="https://…"></div>
    <div class="field full"><span class="label">Where to buy</span><div class="offer-rows" data-e="offers"></div>
      <button type="button" class="btn btn-ghost small" data-e="add">+ Add another store</button></div>
    <div class="form-actions">
      <button class="btn btn-brand" type="submit">Save changes</button>
      <button type="button" class="btn btn-ghost" data-e="cancel">Cancel</button>
      <span role="status" data-e="status"></span>
    </div>`;
  card.appendChild(form);
  const q = k => form.querySelector(`[data-e="${k}"]`);
  const cat = q('cat');
  if (p.category && ![...cat.options].some(x => x.value === p.category)) cat.insertAdjacentHTML('beforeend', `<option>${esc(p.category)}</option>`);
  cat.value = p.category || '';
  cascade(form).fillSubs(p.sub_category || '', p.type || '');
  const box = q('offers');
  for (const o of p.offers) fillOfferRow(addOfferRow(box), o);
  if (!p.offers.length) addOfferRow(box);
  q('add').addEventListener('click', () => addOfferRow(box));
  box.addEventListener('click', e => {
    if (e.target.closest('[data-remove]') && box.children.length > 1) e.target.closest('.offer-row').remove();
  });
  q('cancel').addEventListener('click', () => closeEdit(card));
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const offers = [...box.children].map(r => Object.fromEntries([...r.querySelectorAll('[data-f]')].map(i => [i.dataset.f, i.value.trim()])));
    const body = { name: q('name').value.trim(), category: cat.value, subCategory: q('sub').value, type: q('type').value,
      spec: q('spec').value.trim(), image: q('image').value.trim(), offers };
    const st = q('status');
    if (!checkSelects({ cat, sub: q('sub'), type: q('type') }, 'product', 'product')) { st.className = 'err'; st.textContent = 'Pick the category first.'; return; }
    st.className = ''; st.textContent = 'Saving…';
    try {
      const saved = await call('PATCH', `/api/admin/products/${p.id}`, body);
      toast(`Saved ${saved.name || body.name}.`);
      loadList();
    } catch (err) { st.className = 'err'; st.textContent = err.message; }
  });
  card.querySelector('[data-edit]').textContent = 'Close';
  q('name').focus();
}
function closeEdit(card) {
  const f = card.querySelector('.edit-form');
  if (f) f.remove();
  card.querySelector('[data-edit]').textContent = 'Edit';
}
$('list').addEventListener('click', async e => {
  const ed = e.target.closest('[data-edit]');
  if (ed) {
    const card = ed.closest('[data-card]');
    if (card.querySelector('.edit-form')) return closeEdit(card);
    const p = added.find(x => String(x.id) === ed.dataset.edit);
    if (p) openEdit(card, p);
    return;
  }
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
let myDeals = [];
async function loadMyDeals() {
  const list = myDeals = await call('GET', '/api/admin/my-deals');
  $('myDeals').innerHTML = list.length ? list.map(d => `<div class="panel cat-card" data-deal-card="${d.id}"><div class="cat-row">
      <span class="cat-name">${esc(d.title)} <span class="sub">${d.store ? '· ' + esc(d.store) : ''}${d.code ? ' · code ' + esc(d.code) : ''}</span>
      ${d.category ? `<span class="pill">${esc(pathLabel({ category: d.category, subCategory: d.sub_category }))}</span>` : '<span class="pill warn">Needs a category</span>'}<br>
      <span class="sub">${d.ends_at ? (d.ends_at < today() ? 'Ended ' : 'Ends ') + esc(d.ends_at) : 'No end date'} · <a href="${esc(d.url)}" target="_blank" rel="noopener">link</a></span></span>
      <span class="cat-actions"><button type="button" class="btn btn-ghost small" data-edit-deal="${d.id}">Edit</button>
        <button type="button" class="btn btn-ghost small danger" data-del-deal="${d.id}" data-name="${esc(d.title)}">Delete</button></span>
    </div></div>`).join('') : '<p class="sub">No deals added yet.</p>';
}
$('dealForm').addEventListener('submit', async e => {
  e.preventDefault();
  const v = id => $(id).value.trim();
  const st = $('dealFormStatus');
  if (!checkSelects(dSel, 'deal', 'deal')) { st.className = 'err'; st.textContent = '1 thing to fix: category.'; return; }
  try {
    await call('POST', '/api/admin/my-deals', { title: v('d-title'), store: v('d-store'), code: v('d-code'), url: v('d-url'), description: v('d-desc'), image: v('d-image'), endsAt: v('d-ends'), category: v('d-cat'), subCategory: v('d-sub') });
    st.className = 'ok'; st.textContent = 'Added. It now shows in "Number of deals now" and under its category.';
    for (const id of ['d-title', 'd-store', 'd-code', 'd-url', 'd-desc', 'd-image', 'd-ends']) $(id).value = '';
    dSuggest.reset();
    loadMyDeals();
  } catch (err) { st.className = 'err'; st.textContent = err.message; }
});
function openDealEdit(card, d) {
  const form = document.createElement('form');
  form.className = 'sell-form edit-form';
  form.noValidate = true;
  form.innerHTML = `
    <div class="field full"><label>Deal title</label><input data-e="title" maxlength="160" value="${esc(d.title)}"></div>
    <div class="field"><label>Category <span class="req" aria-hidden="true">*</span></label><select data-e="category">${dealCatOptions()}</select></div>
    <div class="field"><label>Sub-category <span class="opt">optional</span></label><select data-e="subCategory"></select></div>
    <div class="field"><label>Store</label><input data-e="store" maxlength="60" list="d-stores" value="${esc(d.store || '')}"></div>
    <div class="field"><label>Coupon code</label><input data-e="code" maxlength="40" value="${esc(d.code || '')}" placeholder="Leave empty if none"></div>
    <div class="field full"><label>Deal link</label><input data-e="url" inputmode="url" value="${esc(d.url)}"></div>
    <div class="field full"><label>Details</label><input data-e="description" maxlength="300" value="${esc(d.description || '')}"></div>
    <div class="field"><label>Photo link</label><input data-e="image" value="${esc(d.image || '')}" placeholder="https://…"></div>
    <div class="field"><label>Ends on</label><input data-e="endsAt" type="date" value="${esc(d.ends_at || '')}"></div>
    <div class="form-actions">
      <button class="btn btn-brand" type="submit">Save changes</button>
      <button type="button" class="btn btn-ghost" data-e="cancel">Cancel</button>
      <span role="status" data-e="status"></span>
    </div>`;
  card.appendChild(form);
  const q = k => form.querySelector(`[data-e="${k}"]`);
  const btn = card.querySelector('[data-edit-deal]');
  const eSel = { cat: q('category'), sub: q('subCategory') };
  if (d.category && ![...eSel.cat.options].some(o => o.value === d.category)) eSel.cat.insertAdjacentHTML('beforeend', `<option>${esc(d.category)}</option>`);
  eSel.cat.value = d.category || '';
  dealCascade(eSel.cat, eSel.sub).fill(d.sub_category || '');
  const close = () => { form.remove(); btn.textContent = 'Edit'; };
  q('cancel').addEventListener('click', close);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const body = Object.fromEntries(['title', 'store', 'code', 'url', 'description', 'image', 'endsAt', 'category', 'subCategory'].map(k => [k, q(k).value.trim()]));
    const st = q('status');
    if (!checkSelects(eSel, 'deal', 'deal')) { st.className = 'err'; st.textContent = 'Pick a category first.'; return; }
    st.className = ''; st.textContent = 'Saving…';
    try { const saved = await call('PATCH', `/api/admin/my-deals/${d.id}`, body); toast(`Saved ${saved.title}.`); loadMyDeals(); loadNeeds(); }
    catch (err) { st.className = 'err'; st.textContent = err.message; }
  });
  btn.textContent = 'Close';
  q('title').focus();
}
$('myDeals').addEventListener('click', async e => {
  const ed = e.target.closest('[data-edit-deal]');
  if (ed) {
    const card = ed.closest('[data-deal-card]');
    const open = card.querySelector('.edit-form');
    if (open) { open.remove(); ed.textContent = 'Edit'; return; }
    const d = myDeals.find(x => String(x.id) === ed.dataset.editDeal);
    if (d) openDealEdit(card, d);
    return;
  }
  const b = e.target.closest('[data-del-deal]'); if (!b) return;
  if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Click again to delete'; return; }
  try { await call('DELETE', `/api/admin/my-deals/${b.dataset.delDeal}`); toast(`Deleted ${b.dataset.name}.`); loadMyDeals(); }
  catch (err) { toast(err.message); }
});

/* Upload products from Excel (sheet.js reads and writes the files) */
const COLUMNS = ['Name', 'Image', 'URL', 'Price', 'MRP', 'Delivery', 'Store', 'Category', 'Sub-category', 'Type', 'Details'];
const PRODUCT_FIELDS = {   // header text (lower case, letters only) -> field sent to the server
  name: 'name', product: 'name', productname: 'name', title: 'name', producttitle: 'name',
  image: 'image', imageurl: 'image', imagelink: 'image', photo: 'image', photolink: 'image', photourl: 'image', img: 'image', picture: 'image',
  url: 'url', link: 'url', productlink: 'url', producturl: 'url', storelink: 'url', buylink: 'url', storeurl: 'url',
  price: 'price', sellingprice: 'price', saleprice: 'price', offerprice: 'price',
  mrp: 'mrp', listprice: 'mrp', delivery: 'deliveryFee', deliveryfee: 'deliveryFee', shipping: 'deliveryFee',
  store: 'store', site: 'store', shop: 'store',
  category: 'category', subcategory: 'subCategory', type: 'type', details: 'spec', shortdetails: 'spec', spec: 'spec',
};
const isExample = name => /^example\b/i.test(String(name || '').trim());
let sheet = null;   // { fileName, header, headerRow, rows: [[…]], items: [{ row, name, … }] }

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
const stamp = () => new Date().toISOString().slice(0, 10);
const WIDTHS = [40, 40, 50, 10, 10, 10, 14, 22, 22, 18, 30];

$('dlTemplate').addEventListener('click', () => download(Sheet.writeXlsx([COLUMNS,
  ['Example: Cotton kurta, blue (rows starting with Example are skipped)', 'https://… right-click the store photo > Copy image address', 'https://www.myntra.com/…', 749, 1299, 0, 'Myntra', 'Fashion & Clothing'],
  ['Example: Cotton kurta, blue (rows starting with Example are skipped)', '', 'https://www.flipkart.com/…', 689, '', 40, 'Flipkart', 'Fashion & Clothing'],
], 'Products', WIDTHS), 'comparezo-products-template.xlsx'));

$('dlProducts').addEventListener('click', async () => {
  try {
    const list = await call('GET', '/api/admin/products');
    const rows = [COLUMNS];
    for (const p of list) for (const o of p.offers) rows.push([p.name, p.image || '', o.url || '', o.price, o.mrp || '', o.delivery_fee || '', o.store, p.category || '', p.sub_category || '', p.type || '', p.spec || '']);
    download(Sheet.writeXlsx(rows, 'Products', WIDTHS), `comparezo-products-${stamp()}.xlsx`);
  } catch (err) { toast(err.message); }
});

// Category pickers for rows that have no Category column.
function bulkSubs() {
  const c = tree.find(x => x.name === $('b-cat').value);
  const subs = c ? c.subcategories : [];
  $('b-sub').innerHTML = subs.length ? opts(subs, 'Pick a sub-category') : '<option value="">None</option>';
  $('b-sub').disabled = !subs.length;
  bulkTypes();
}
function bulkTypes() {
  const c = tree.find(x => x.name === $('b-cat').value);
  const s = c && c.subcategories.find(x => x.name === $('b-sub').value);
  const types = s ? s.types : [];
  $('b-type-wrap').hidden = !types.length;
  $('b-type').innerHTML = types.length ? opts(types, 'Pick a type') : '';
}
$('b-cat').addEventListener('change', bulkSubs);
$('b-sub').addEventListener('change', bulkTypes);

function parseSheet(rows, FIELD_OF = PRODUCT_FIELDS, skip = x => isExample(x.name)) {
  const norm = h => String(h || '').toLowerCase().replace(/[^a-z]/g, '');
  const key = FIELD_OF === PRODUCT_FIELDS ? 'name' : 'title';
  const headerRow = rows.slice(0, 10).findIndex(r => r.some(h => FIELD_OF[norm(h)] === key) && r.some(h => FIELD_OF[norm(h)] === 'url'));
  if (headerRow < 0) throw new Error(`Could not find the header row. The first row needs at least "${key === 'name' ? 'Name' : 'Title'}" and "URL" columns. Download the template to see the layout.`);
  const header = rows[headerRow];
  const fields = header.map(h => FIELD_OF[norm(h)] || null);
  const items = [];
  rows.slice(headerRow + 1).forEach((r, i) => {
    if (!r.some(v => String(v).trim())) return;
    const item = { row: headerRow + i + 2 };
    fields.forEach((f, ci) => { if (f && !item[f]) item[f] = String(r[ci] ?? '').trim(); });
    if (!skip(item)) items.push(item);
  });
  return { header, headerRow, rows, items };
}

// Each row's category: its own Category columns, else the one picked above the file box.
function rowCategory(x, mode = 'product') {
  if (x.fix) return { path: x.fix };
  if (String(x.category || '').trim()) return resolvePath(x.category, x.subCategory, x.type, mode);
  const d = mode === 'deal' ? { cat: $('db-cat').value, sub: $('db-sub').value } : { cat: $('b-cat').value, sub: $('b-sub').value, type: $('b-type').value };
  if (!d.cat) return { error: 'No category' };
  const r = resolvePath(d.cat, d.sub, d.type, mode);
  return r.error ? { error: `${r.error} (picked above)` } : { path: r.path, fromDefault: true };
}
// The preview's category column: ready, or a dropdown to fix it right there.
function catCell(x, i, mode) {
  const r = rowCategory(x, mode);
  if (r.path) return `<td>${esc(pathLabel(r.path))}${r.fromDefault ? ' <span class="sub">(picked above)</span>' : ''}</td><td><span class="pill good">Ready</span></td>`;
  return `<td><select data-fix="${i}" aria-label="Category for row ${x.row}">${pathOptions(mode)}</select></td><td><span class="pill warn">${esc(r.error)}</span></td>`;
}
function showPreview() {
  const items = sheet.items;
  const names = new Set(items.map(x => (x.name || '').toLowerCase()).filter(Boolean));
  const usable = items.filter(x => x.name && x.url && x.price);
  const missing = items.length - usable.length;
  // A product is the rows with the same name; the first row with a category gives it its category.
  const lead = new Map();
  for (const x of usable) { const k = x.name.toLowerCase(); if (!lead.has(k) || (!String(lead.get(k).category || '').trim() && String(x.category || '').trim())) lead.set(k, x); }
  const leads = [...lead.values()];
  const bad = leads.filter(x => !rowCategory(x).path);
  const shown = [...bad, ...leads.filter(x => !bad.includes(x)).slice(0, Math.max(0, 8 - bad.length))];
  $('bulkPreview').hidden = false;
  $('bulkPreview').innerHTML = `<p class="sub"><strong>${esc(sheet.fileName)}</strong>: ${items.length} row${items.length === 1 ? '' : 's'} for ${names.size} product${names.size === 1 ? '' : 's'}.`
    + (missing ? ` ${missing} row${missing === 1 ? ' is' : 's are'} missing a name, URL or price and will be skipped.` : '')
    + (bad.length ? ` <strong class="err">${bad.length} product${bad.length === 1 ? ' needs' : 's need'} a category</strong>: pick it in the table, or set "Category for rows without one" above.` : ' Every product has a category.') + '</p>'
    + `<div class="tablebox"><table class="bulk-table"><thead><tr><th>Row</th><th></th><th>Name</th><th>Price</th><th>Store / link</th><th>Comparezo category</th><th></th></tr></thead><tbody>`
    + shown.map(x => `<tr class="${bad.includes(x) ? 'bad-row' : ''}"><td>${x.row}</td><td>${/^https:\/\//.test(x.image || '') ? `<img src="${esc(x.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}</td>
        <td>${esc(x.name || '—')}</td><td>${esc(x.price || '—')}</td><td>${esc(x.store || '')} <span class="sub">${esc((x.url || '—').slice(0, 50))}</span></td>${catCell(x, items.indexOf(x), 'product')}</tr>`).join('')
    + `</tbody></table></div>${leads.length > shown.length ? `<p class="sub">…and ${leads.length - shown.length} more products, all with a category.</p>` : ''}`;
  $('bulkAdd').disabled = !usable.length || bad.length > 0;
  $('bulkAdd').title = bad.length ? 'Every product needs a category first.' : '';
  $('bulkLinks').disabled = !items.some(x => x.url);
}
$('bulkPreview').addEventListener('change', e => {
  const sel = e.target.closest('[data-fix]'); if (!sel || !sheet) return;
  const x = sheet.items[Number(sel.dataset.fix)];
  x.fix = sel.value ? JSON.parse(sel.value) : null;
  // Rows of the same product share it.
  for (const y of sheet.items) if (y !== x && (y.name || '').toLowerCase() === (x.name || '').toLowerCase()) y.fix = x.fix;
  showPreview();
});
for (const id of ['b-cat', 'b-sub', 'b-type']) $(id).addEventListener('change', () => { if (sheet) showPreview(); });

$('bulkFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  const st = $('bulkStatus');
  sheet = null; $('bulkPreview').hidden = $('bulkProblems').hidden = true;
  $('bulkAdd').disabled = $('bulkLinks').disabled = true;
  st.className = ''; st.textContent = '';
  if (!file) return;
  try {
    sheet = { fileName: file.name, ...parseSheet(await Sheet.readSheet(file)) };
    if (!sheet.items.length) throw new Error('The sheet has a header row but no products under it.');
    if (sheet.items.length > 500) throw new Error(`Upload at most 500 rows at a time. This sheet has ${sheet.items.length}; split it into smaller sheets.`);
    showPreview();
  } catch (err) { sheet = null; st.className = 'err'; st.textContent = err.message; }
});

$('bulkForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!sheet) return;
  const st = $('bulkStatus');
  st.className = ''; st.textContent = 'Adding…'; $('bulkAdd').disabled = true;
  try {
    const rows = sheet.items.map(({ fix, ...x }) => (fix ? { ...x, category: fix.category, subCategory: fix.subCategory || '', type: fix.type || '' } : x));
    const r = await call('POST', '/api/admin/products/bulk', { rows, defaults: { category: $('b-cat').value, subCategory: $('b-sub').value, type: $('b-type').value } });
    const parts = [];
    if (r.added) parts.push(`Added ${r.added} new product${r.added === 1 ? '' : 's'}`);
    if (r.updated) parts.push(`added stores to ${r.updated} product${r.updated === 1 ? '' : 's'} already on the site`);
    if (r.skipped) parts.push(`skipped ${r.skipped} link${r.skipped === 1 ? '' : 's'} that were already there`);
    st.className = r.added || r.updated ? 'ok' : 'err';
    st.textContent = (parts.join(', ') || 'Nothing was added') + '.' + (r.problems.length ? ` ${r.problems.length} row${r.problems.length === 1 ? ' needs' : 's need'} fixing, see below.` : '');
    $('bulkProblems').hidden = !r.problems.length;
    $('bulkProblems').innerHTML = r.problems.length ? `<span class="label">Rows not added</span><ul class="bulk-problems">${r.problems.slice(0, 100).map(p => `<li>Row ${p.row}${p.name ? ` (${esc(p.name)})` : ''}: ${esc(p.error)}</li>`).join('')}</ul>` : '';
    if (r.added || r.updated) loadList();
  } catch (err) { st.className = 'err'; st.textContent = err.message; }
  finally { $('bulkAdd').disabled = false; }
});

// The same sheet back, with an "Affiliate link" column filled in by EarnKaro or Admitad.
$('bulkLinks').addEventListener('click', async () => {
  if (!sheet) return;
  const st = $('bulkStatus'), btn = $('bulkLinks');
  const urlCol = sheet.header.findIndex(h => PRODUCT_FIELDS[String(h || '').toLowerCase().replace(/[^a-z]/g, '')] === 'url');
  const body = sheet.rows.slice(sheet.headerRow + 1);
  const urls = [...new Set(body.map(r => String(r[urlCol] ?? '').trim()).filter(u => /^https?:\/\//.test(u)))];
  const done = new Map();
  btn.disabled = true; st.className = '';
  try {
    for (let i = 0; i < urls.length; i += 25) {
      st.textContent = `Making links… ${i} of ${urls.length}`;
      const r = await call('POST', '/api/admin/affiliate-links', { urls: urls.slice(i, i + 25).map(u => u.replace(/^http:\/\//, 'https://')) });
      if (!r.earnkaro && !r.admitad) throw new Error('Neither EarnKaro nor Admitad is set up on the server (EARNKARO_API_KEY, ADMITAD_*).');
      r.results.forEach((x, j) => done.set(urls[i + j], x));
    }
    const width = Math.max(sheet.header.length, ...body.map(r => r.length));
    const pad = r => Array.from({ length: width }, (_, i) => r[i] ?? '');
    const out = [[...pad(sheet.header), 'Affiliate link', 'Via', 'Note'],
      ...body.map(r => { const x = done.get(String(r[urlCol] ?? '').trim()); return [...pad(r), x && x.link || '', x && x.via || '', x ? x.note || '' : '']; })];
    download(Sheet.writeXlsx(out, 'Affiliate links', [...Array(width).fill(24), 50, 10, 40]), sheet.fileName.replace(/\.(xlsx|csv|tsv|txt)$/i, '') + '-affiliate-links.xlsx');
    const made = [...done.values()].filter(x => x.link).length;
    st.className = made ? 'ok' : 'err';
    st.textContent = `Made ${made} of ${urls.length} affiliate link${urls.length === 1 ? '' : 's'}. The file is in your downloads.` + (made < urls.length ? ' The Note column says why the others were not made.' : '');
  } catch (err) { st.className = 'err'; st.textContent = err.message; }
  finally { btn.disabled = false; }
});


/* Upload deals from Excel */
const DEAL_COLUMNS = ['Title', 'Category', 'Sub-category', 'Store', 'Coupon code', 'URL', 'Details', 'Image', 'Ends on'];
const DEAL_WIDTHS = [40, 22, 20, 14, 16, 50, 40, 40, 12];
const DEAL_FIELDS = {
  title: 'title', deal: 'title', dealtitle: 'title', name: 'title', offer: 'title',
  store: 'store', site: 'store', shop: 'store',
  code: 'code', coupon: 'code', couponcode: 'code', promocode: 'code', promo: 'code',
  url: 'url', link: 'url', deallink: 'url', dealurl: 'url', storelink: 'url',
  details: 'description', description: 'description', terms: 'description',
  image: 'image', imageurl: 'image', photo: 'image', photolink: 'image', img: 'image',
  category: 'category', subcategory: 'subCategory',
  endson: 'endsAt', ends: 'endsAt', enddate: 'endsAt', expiry: 'endsAt', expires: 'endsAt', expirydate: 'endsAt', validtill: 'endsAt', validuntil: 'endsAt',
};
let dealSheet = null;

$('dlDealTemplate').addEventListener('click', () => download(Sheet.writeXlsx([DEAL_COLUMNS,
  ['Example: Flat 40% off on running shoes (rows starting with Example are skipped)', 'Fashion & Clothing', 'Footwear', 'Myntra', 'RUN40', 'https://www.myntra.com/…', 'Min. order ₹999', '', '2026-12-31'],
  ['Example: Sitewide extra 10% off', 'Whole store', '', 'Ajio', 'AJIO10', 'https://www.ajio.com/…', '', '', ''],
], 'Deals', DEAL_WIDTHS), 'comparezo-deals-template.xlsx'));

$('dlDeals').addEventListener('click', async () => {
  try {
    const list = await call('GET', '/api/admin/my-deals');
    download(Sheet.writeXlsx([DEAL_COLUMNS, ...list.map(d => [d.title, d.category || '', d.sub_category || '', d.store || '', d.code || '', d.url, d.description || '', d.image || '', d.ends_at || ''])], 'Deals', DEAL_WIDTHS), `comparezo-deals-${stamp()}.xlsx`);
  } catch (err) { toast(err.message); }
});

$('dealFile').addEventListener('change', async e => {
  const file = e.target.files[0], st = $('dealBulkStatus');
  dealSheet = null; $('dealPreview').hidden = $('dealProblems').hidden = true; $('dealBulkAdd').disabled = true;
  st.className = ''; st.textContent = '';
  if (!file) return;
  try {
    dealSheet = { fileName: file.name, ...parseSheet(await Sheet.readSheet(file), DEAL_FIELDS, x => isExample(x.title)) };
    const items = dealSheet.items;
    if (!items.length) throw new Error('The sheet has a header row but no deals under it.');
    if (items.length > 500) throw new Error(`Upload at most 500 deals at a time. This sheet has ${items.length}; split it into smaller sheets.`);
    showDealPreview();
  } catch (err) { dealSheet = null; st.className = 'err'; st.textContent = err.message; }
});

function showDealPreview() {
  const items = dealSheet.items, file = dealSheet.fileName;
  const usable = items.filter(x => x.title && x.url);
  const missing = items.length - usable.length;
  const bad = usable.filter(x => !rowCategory(x, 'deal').path);
  const shown = [...bad, ...usable.filter(x => !bad.includes(x)).slice(0, Math.max(0, 8 - bad.length))];
  $('dealPreview').hidden = false;
  $('dealPreview').innerHTML = `<p class="sub"><strong>${esc(file)}</strong>: ${items.length} deal${items.length === 1 ? '' : 's'}.`
    + (missing ? ` ${missing} ${missing === 1 ? 'is' : 'are'} missing a title or URL and will be skipped.` : '')
    + (bad.length ? ` <strong class="err">${bad.length} deal${bad.length === 1 ? ' needs' : 's need'} a category</strong>: pick it in the table, or set "Category for rows without one" above.` : ' Every deal has a category.') + '</p>'
    + `<div class="tablebox"><table class="bulk-table"><thead><tr><th>Row</th><th>Title</th><th>Store</th><th>Code</th><th>Ends</th><th>Comparezo category</th><th></th></tr></thead><tbody>`
    + shown.map(x => `<tr class="${bad.includes(x) ? 'bad-row' : ''}"><td>${x.row}</td><td>${esc(x.title || '—')}</td><td>${esc(x.store || '')}</td><td>${esc(x.code || '')}</td><td>${esc(x.endsAt || '')}</td>${catCell(x, items.indexOf(x), 'deal')}</tr>`).join('')
    + `</tbody></table></div>${usable.length > shown.length ? `<p class="sub">…and ${usable.length - shown.length} more, all with a category.</p>` : ''}`;
  $('dealBulkAdd').disabled = !usable.length || bad.length > 0;
}
$('dealPreview').addEventListener('change', e => {
  const sel = e.target.closest('[data-fix]'); if (!sel || !dealSheet) return;
  dealSheet.items[Number(sel.dataset.fix)].fix = sel.value ? JSON.parse(sel.value) : null;
  showDealPreview();
});
for (const id of ['db-cat', 'db-sub']) $(id).addEventListener('change', () => { if (dealSheet) showDealPreview(); });
$('dealBulkForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!dealSheet) return;
  const st = $('dealBulkStatus');
  st.className = ''; st.textContent = 'Adding…'; $('dealBulkAdd').disabled = true;
  try {
    const rows = dealSheet.items.map(({ fix, ...x }) => (fix ? { ...x, category: fix.category, subCategory: fix.subCategory || '' } : x));
    const r = await call('POST', '/api/admin/my-deals/bulk', { rows, defaults: { category: $('db-cat').value, subCategory: $('db-sub').value } });
    st.className = r.added ? 'ok' : 'err';
    st.textContent = (r.added ? `Added ${r.added} deal${r.added === 1 ? '' : 's'}` : 'No new deals were added')
      + (r.skipped ? `, skipped ${r.skipped} already saved` : '') + '.'
      + (r.problems.length ? ` ${r.problems.length} row${r.problems.length === 1 ? ' needs' : 's need'} fixing, see below.` : '');
    $('dealProblems').hidden = !r.problems.length;
    $('dealProblems').innerHTML = r.problems.length ? `<span class="label">Rows not added</span><ul class="bulk-problems">${r.problems.slice(0, 100).map(p => `<li>Row ${p.row}${p.name ? ` (${esc(p.name)})` : ''}: ${esc(p.error)}</li>`).join('')}</ul>` : '';
    if (r.added) { loadMyDeals(); loadNeeds(); }
  } catch (err) { st.className = 'err'; st.textContent = err.message; }
  finally { $('dealBulkAdd').disabled = false; }
});

/* Find in stores: search connected stores by name, tick listings, add them as one product. */
const STORE_COLORS = { 'Amazon.in': '#e08a00', 'Flipkart': '#2f6fdc', 'Meesho': '#b0307a', 'Myntra': '#e2445c', 'JioMart': '#1f7a8c', 'Snapdeal': '#d23b3b', 'Ajio': '#2c4152', 'BigBasket': '#689f38', 'FirstCry': '#f2711c', 'Nykaa': '#e80071', 'Croma': '#159a8c', 'Reliance Digital': '#c8102e', 'Tata CLiQ': '#8a2be2' };
const colorOf = s => STORE_COLORS[s] || '#6b7d78';
const sdot = s => `<span class="sdot" style="background:${colorOf(s)}"></span>`;
const BOX = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/></svg>';
const TICK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>';
const img = (url, alt = '') => url ? `<img src="${esc(url)}" alt="${esc(alt)}" loading="lazy" referrerpolicy="no-referrer" data-fallback>` : BOX;
// A store photo that fails to load is swapped for the plain box drawing.
document.addEventListener('error', e => { const t = e.target; if (t.tagName === 'IMG' && t.hasAttribute('data-fallback')) t.outerHTML = BOX; }, true);

const find = { results: [], store: 'all', sort: 'match', picked: new Set(), photo: null, nameEdited: false };

function reviewSubs() {
  const c = tree.find(x => x.name === $('r-cat').value);
  const subs = c ? c.subcategories : [];
  $('r-sub').innerHTML = subs.length ? opts(subs, 'Pick a sub-category') : '<option value="">None</option>';
  $('r-sub').disabled = !subs.length;
  reviewTypes();
}
function reviewTypes() {
  const c = tree.find(x => x.name === $('r-cat').value);
  const s = c && c.subcategories.find(x => x.name === $('r-sub').value);
  const types = s ? s.types : [];
  $('r-type-wrap').hidden = !types.length;
  $('r-type').innerHTML = types.length ? opts(types, 'Pick a type') : '';
}
$('r-cat').addEventListener('change', reviewSubs);
$('r-sub').addEventListener('change', reviewTypes);
const rSel = { cat: $('r-cat'), sub: $('r-sub'), type: $('r-type') };
for (const el of Object.values(rSel)) el.addEventListener('change', () => clearErrs({ x: el }));

$('findForm').addEventListener('submit', async e => {
  e.preventDefault();
  const q = $('findQ').value.trim();
  if (!q) { $('findQ').focus(); return; }
  $('findBtn').disabled = true; $('findBtn').textContent = 'Searching…';
  $('findSummary').textContent = 'Asking the connected stores. This can take a few seconds.';
  try {
    const r = await call('GET', `/api/admin/store-search?q=${encodeURIComponent(q)}`);
    Object.assign(find, { searched: true, results: r.results || [], store: 'all', picked: new Set(), photo: null, nameEdited: false });
    (r.results || []).filter(x => x.match === 'exact').forEach(x => { if (![...find.picked].some(id => find.results[id - 1].store === x.store)) find.picked.add(x.id); });
    $('findSummary').textContent = r.error || `${find.results.length} listing${find.results.length === 1 ? '' : 's'} from ${new Set(find.results.map(x => x.store)).size} store${new Set(find.results.map(x => x.store)).size === 1 ? '' : 's'}`;
    $('findOnSite').hidden = !(r.onSite && r.onSite.length);
    $('findOnSite').innerHTML = (r.onSite || []).length ? `<div class="onsite">Already on Comparezo: ${r.onSite.map(p => `<strong>${esc(p.name)}</strong> (${p.storeCount} store${p.storeCount === 1 ? '' : 's'}${p.lowest ? ', from ' + inr(p.lowest) : ''})`).join(', ')}. Check it isn't the same product before adding.</div>` : '';
    renderSources(r);
    renderFind();
  } catch (err) { $('findSummary').textContent = err.message; }
  finally { $('findBtn').disabled = false; $('findBtn').textContent = 'Search stores'; }
});

// "What Google Shopping found": every listing that was left out, and why.
function detailsHtml(d) {
  if (!d || !((d.leftOut || []).length || (d.noLink || []).length)) return '';
  const row = x => `<li>${esc(x.store)}: ${esc(x.title)}${x.price ? ` (${inr(x.price)})` : ''}${x.reason ? ` <span class="sub">— ${esc(x.reason)}</span>` : ''}</li>`;
  return `<details style="margin-top:4px"><summary class="sub" style="cursor:pointer">Show what was left out (${(d.leftOut || []).length + (d.noLink || []).length})</summary>
    ${(d.leftOut || []).length ? `<div class="sub" style="margin-top:6px">Not the same product</div><ul class="src-list">${d.leftOut.map(row).join('')}</ul>` : ''}
    ${(d.noLink || []).length ? `<div class="sub" style="margin-top:6px">Same product, but Google gave no store link</div><ul class="src-list">${d.noLink.map(row).join('')}</ul>` : ''}
  </details>`;
}

function renderSources(r) {
  const searched = (r.sources || []).map(s => `<li><strong>${esc(s.name)}</strong>: ${s.ok
    ? `${s.count} found${s.note ? ` <span class="sub">(${esc(s.note)})</span>` : ''}${detailsHtml(s.details)}`
    : `<span class="err">${esc(s.error)}</span>`}</li>`);
  const off = Object.entries(r.notConnected || {}).map(([k, v]) => `<li><strong>${esc(k)}</strong>: ${esc(v)}</li>`);
  $('findSources').hidden = !searched.length && !off.length;
  $('findSources').innerHTML = `<div class="src-box">
    <div><strong>Searched</strong>${searched.length ? `<ul class="src-list">${searched.join('')}</ul>` : '<p class="sub" style="margin:2px 0 0">No store search is connected yet, so nothing can be found by name.</p>'}</div>
    ${off.length ? `<div><strong>Not searched</strong><ul class="src-list">${off.join('')}</ul></div>` : ''}
  </div>`;
}

function renderFind() {
  const counts = {};
  find.results.forEach(r => { counts[r.store] = (counts[r.store] || 0) + 1; });
  $('findBar').hidden = !find.results.length;
  $('findChips').innerHTML = `<button type="button" class="chip" data-s="all" aria-pressed="${find.store === 'all'}">All stores<span class="n">${find.results.length}</span></button>` +
    Object.keys(counts).sort().map(s => `<button type="button" class="chip" data-s="${esc(s)}" aria-pressed="${find.store === s}">${sdot(s)}${esc(s)}<span class="n">${counts[s]}</span></button>`).join('');
  let rows = find.results.filter(r => find.store === 'all' || r.store === find.store);
  rows = rows.slice().sort(find.sort === 'price' ? (a, b) => a.price - b.price : (a, b) => a.id - b.id);
  $('findResults').innerHTML = rows.length ? rows.map(r => {
    const on = find.picked.has(r.id);
    const off = r.mrp ? Math.round((1 - r.price / r.mrp) * 100) : 0;
    return `<label class="rcard${on ? ' sel' : ''}" data-id="${r.id}">
      <input type="checkbox" ${on ? 'checked' : ''} aria-label="Select ${esc(r.store)}: ${esc(r.title)}">
      <span class="pick">${TICK}</span>
      <div class="rimg">${img(r.image, r.title)}</div>
      <div class="rbody">
        <div class="rstore"><span style="display:flex;align-items:center">${sdot(r.store)}${esc(r.store)}</span><span class="match ${r.match}">${r.match === 'exact' ? 'Same product' : r.why ? esc(r.why[0].toUpperCase() + r.why.slice(1)) : 'Similar'}</span></div>
        <div class="rtitle" title="${esc(r.title)}">${esc(r.title)}</div>
        <div class="rprice"><span class="p">${inr(r.price)}</span>${r.mrp ? `<span class="strike">${inr(r.mrp)}</span><span class="off">${off}% off</span>` : ''}</div>
        <div class="links">
          <b>URL</b><code title="${esc(r.url)}">${esc(r.url.replace('https://', ''))}</code><a href="${esc(r.url)}" target="_blank" rel="noopener">Open</a>
          <b>Image</b>${r.image ? `<code title="${esc(r.image)}">${esc(r.image.replace('https://', ''))}</code><a href="${esc(r.image)}" target="_blank" rel="noopener">View</a>` : '<code>none</code><span></span>'}
        </div>
        <div><span class="pill brand">From ${esc(r.source)}</span></div>
      </div>
    </label>`;
  }).join('') : (find.searched ? '<div class="empty-state" style="grid-column:1/-1">No listings found in the connected stores. Check the spelling, or add the product in step 2 by pasting store links.</div>' : '');
  renderTray(); renderReview();
}

const picked = () => find.results.filter(r => find.picked.has(r.id)).sort((a, b) => a.price - b.price);
function renderTray() {
  const p = picked();
  $('findTray').hidden = !p.length;
  if (!p.length) return;
  $('findStack').innerHTML = p.slice(0, 5).map(r => `<span style="background:${colorOf(r.store)}">${esc(r.store[0])}</span>`).join('');
  $('findTrayTxt').innerHTML = `<strong>${p.length} listing${p.length > 1 ? 's' : ''} selected</strong><br>Cheapest ${inr(p[0].price)} at ${esc(p[0].store)}`;
}

// A short product name from the store titles: the shortest exact-match title, cut at the first comma or bracket.
function suggestName(p) {
  const exact = p.filter(r => r.match === 'exact');
  const t = (exact.length ? exact : p).map(r => r.title.split(/\s*[,(|]\s*|\s+-\s+/)[0].trim()).sort((a, b) => a.length - b.length)[0] || '';
  return t.length >= 6 ? t : (p[0] ? p[0].title.slice(0, 120) : '');
}

function renderReview() {
  const p = picked(), extra = $('r-offers').children.length;
  $('reviewWrap').hidden = !find.searched && !extra;
  $('reviewCount').textContent = p.length + extra ? `${p.length + extra} store${p.length + extra > 1 ? 's' : ''}` : 'Nothing selected yet';
  if (!find.nameEdited) { const v = p.length ? suggestName(p) : ''; if ($('r-name').value !== v) { $('r-name').value = v; $('r-name').dispatchEvent(new Event('change')); } }
  if (!p.some(r => r.id === find.photo)) find.photo = (p.find(r => r.image) || {}).id || null;
  const withPhoto = p.filter(r => r.image);
  $('photoPick').innerHTML = withPhoto.length ? withPhoto.map(r => `<label title="${esc(r.store)} photo"><input type="radio" name="r-photo" value="${r.id}" ${r.id === find.photo ? 'checked' : ''}><span></span>${img(r.image)}</label>`).join('')
    : '<span class="hint">No photo from the selected stores. You can add one later.</span>';
  $('selRows').innerHTML = p.map((r, i) => `<tr class="${i === 0 ? 'best' : ''}">
      <td><div class="store">${sdot(r.store)}${esc(r.store)}</div>${i === 0 ? '<span class="tag tag-best">Cheapest</span>' : ''}</td>
      <td class="r num" style="font-weight:600">${inr(r.price)}</td>
      <td><code title="${esc(r.url)}">${esc(r.url.replace('https://', ''))}</code></td>
      <td class="r"><button type="button" class="btn btn-ghost small danger" data-unpick="${r.id}">Remove</button></td>
    </tr>`).join('') || '<tr><td colspan="4" class="sub">Tick listings in step 1, or add a store by link below.</td></tr>';
  const ph = p.find(r => r.id === find.photo);
  $('r-preview').innerHTML = p.length ? `<article class="lcard">
      <div class="img">${img(ph && ph.image)}</div>
      <div class="body"><div class="sub">From</div><div class="price num">${inr(p[0].price)}</div><div class="t">${esc($('r-name').value)}</div>
      <div class="sub">${sdot(p[0].store)}Cheapest at ${esc(p[0].store)}</div>
      <div class="row"><span class="sub">Compare ${p.length + extra} store${p.length + extra > 1 ? 's' : ''}</span><span class="btn">Compare</span></div></div></article>`
    : '<div class="empty-state">Your product card appears here.</div>';
}

$('findChips').addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; find.store = b.dataset.s; renderFind(); });
$('findSort').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  find.sort = b.dataset.sort;
  $('findSort').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  renderFind();
});
$('findResults').addEventListener('change', e => {
  const c = e.target.closest('.rcard'); if (!c) return;
  const id = Number(c.dataset.id);
  if (e.target.checked) find.picked.add(id); else find.picked.delete(id);
  renderFind();
});
$('selRows').addEventListener('click', e => { const b = e.target.closest('[data-unpick]'); if (!b) return; find.picked.delete(Number(b.dataset.unpick)); renderFind(); });
$('photoPick').addEventListener('change', e => { find.photo = Number(e.target.value); renderReview(); });
$('r-name').addEventListener('input', () => { find.nameEdited = true; renderReview(); });
$('findClear').addEventListener('click', () => { find.picked.clear(); renderFind(); });
$('r-addOffer').addEventListener('click', () => { addOfferRow($('r-offers')); renderReview(); });
$('r-offers').addEventListener('click', e => { if (!e.target.closest('[data-remove]')) return; e.target.closest('.offer-row').remove(); renderReview(); });

$('reviewForm').addEventListener('submit', async e => {
  e.preventDefault();
  const p = picked();
  const extra = [...$('r-offers').children].map(r => Object.fromEntries([...r.querySelectorAll('[data-f]')].map(i => [i.dataset.f, i.value.trim()])));
  const photo = p.find(r => r.id === find.photo);
  const body = { name: $('r-name').value.trim(), category: $('r-cat').value, subCategory: $('r-sub').value, type: $('r-type').value,
    spec: $('r-spec').value.trim(), image: photo ? photo.image : '',
    offers: [...p.map(r => ({ store: r.store, price: r.price, mrp: r.mrp || undefined, url: r.url })), ...extra] };
  const st = $('r-status');
  if (!checkSelects(rSel, 'product', 'product')) { st.className = 'err'; st.textContent = 'Pick the category first (marked above).'; return; }
  try {
    await call('POST', '/api/admin/products', body);
    st.className = 'ok'; st.textContent = `Added "${body.name}" with ${body.offers.length} store${body.offers.length > 1 ? 's' : ''}. Shoppers now see it under Comparezo.`;
    toast('Product added.');
    Object.assign(find, { picked: new Set(), nameEdited: false });
    $('r-offers').innerHTML = ''; $('r-spec').value = '';
    renderFind(); loadList();
  } catch (err) { st.className = 'err'; st.textContent = err.message; }
});

/* Needs a category: feed-deal category names to map once, and own deals saved before categories were required. */
let needs = { feeds: [], mine: [], mapped: [] };
async function loadNeeds() {
  try { needs = await call('GET', '/api/admin/deal-categories'); } catch (err) { $('needs').innerHTML = `<p class="sub err">${esc(err.message)}</p>`; return; }
  renderNeeds();
}
const NET = { admitad: 'Admitad', cuelinks: 'Cuelinks' };
function renderNeeds() {
  const { feeds, mine, mapped } = needs;
  const withSugg = feeds.filter(g => g.suggestion).length + mine.filter(d => d.suggestion).length;
  const row = (attrs, title, from, sugg) => `<div class="needs-row" ${attrs}>
      <div><div class="t">${esc(title)}</div><div class="sub">${from}</div></div>
      <div class="needs-pick"><select aria-label="Comparezo category">${pathOptions('deal', 'Pick a category')}</select></div>
      <div class="needs-act"><button type="button" class="btn btn-brand small" data-confirm>Save</button></div>
    </div>`.replace('<select', `<select data-sugg="${sugg ? esc(JSON.stringify({ category: sugg.category, subCategory: sugg.subCategory || undefined })) : ''}"`);
  const total = feeds.length + mine.length;
  $('needs').innerHTML = (total ? `<div class="panel needs-panel"><div class="needs-bar"><strong>${total} waiting</strong>
      <span class="sub">${feeds.length ? `${feeds.reduce((a, g) => a + g.count, 0)} feed deal${feeds.reduce((a, g) => a + g.count, 0) === 1 ? '' : 's'} under ${feeds.length} name${feeds.length === 1 ? '' : 's'}` : ''}${feeds.length && mine.length ? ' · ' : ''}${mine.length ? `${mine.length} of your deal${mine.length === 1 ? '' : 's'}` : ''}</span>
      ${withSugg ? `<button type="button" class="btn btn-ghost small" id="needsAll">${CzCat.icon('check', 'ci sm')} Save all suggestions</button>` : ''}</div>`
      + feeds.map(g => row(`data-source="${esc(g.source)}" data-name="${esc(g.name)}"`, g.name.startsWith('store:') ? `All ${g.store || g.label} deals` : g.label,
        `${NET[g.source]} · ${g.name.startsWith('store:') ? 'no category from the network, so mapped by store' : `their category "${esc(g.label)}"`} · ${g.count} deal${g.count === 1 ? '' : 's'}, e.g. “${esc(g.samples[0] || '')}”`, g.suggestion)).join('')
      + mine.map(d => row(`data-mine="${d.id}"`, d.title, `Your deal${d.store ? ' · ' + esc(d.store) : ''} · saved before categories were required`, d.suggestion)).join('')
      + '</div>' : '<p class="sub ok-note">Nothing waiting. Every deal has a category.</p>')
    + (mapped.length ? `<details class="needs-mapped"><summary>Remembered names (${mapped.length})</summary><ul>${mapped.map(m => `<li><span>${NET[m.source] || esc(m.source)} “${esc(m.name.replace(/^store:/, 'store '))}” → <strong>${esc(pathLabel(m))}</strong></span> <button type="button" class="btn btn-ghost small danger" data-unmap="${esc(m.source)}|${esc(m.name)}">Forget</button></li>`).join('')}</ul></details>` : '');
  $('needs').querySelectorAll('select[data-sugg]').forEach(sel => {
    if (!sel.dataset.sugg) return;
    const want = JSON.parse(sel.dataset.sugg);
    const o = [...sel.options].find(x => { if (!x.value) return false; const p = JSON.parse(x.value); return p.category === want.category && (p.subCategory || '') === (want.subCategory || ''); });
    if (o) { sel.value = o.value; sel.closest('.needs-row').classList.add('suggested'); }
  });
}
async function saveNeed(rowEl) {
  const sel = rowEl.querySelector('select');
  if (!sel.value) { sel.focus(); toast('Pick a category first.'); return false; }
  const p = JSON.parse(sel.value);
  if (rowEl.dataset.mine) await call('PATCH', `/api/admin/my-deals/${rowEl.dataset.mine}`, { category: p.category, subCategory: p.subCategory || '' });
  else await call('POST', '/api/admin/deal-categories', { source: rowEl.dataset.source, name: rowEl.dataset.name, category: p.category, subCategory: p.subCategory || '' });
  return true;
}
$('needs').addEventListener('click', async e => {
  try {
    const one = e.target.closest('[data-confirm]');
    if (one) { if (await saveNeed(one.closest('.needs-row'))) { toast('Saved. Deals with that name now show under it.'); await loadNeeds(); loadMyDeals(); } return; }
    if (e.target.closest('#needsAll')) {
      let n = 0;
      for (const r of [...$('needs').querySelectorAll('.needs-row.suggested')]) if (r.querySelector('select').value && await saveNeed(r)) n++;
      toast(`Saved ${n} suggestion${n === 1 ? '' : 's'}.`); await loadNeeds(); loadMyDeals(); return;
    }
    const un = e.target.closest('[data-unmap]');
    if (un) { const [src, ...rest] = un.dataset.unmap.split('|'); await call('DELETE', `/api/admin/deal-categories/${encodeURIComponent(src)}/${encodeURIComponent(rest.join('|'))}`); loadNeeds(); }
  } catch (err) { toast(err.message); }
});
$('needs').addEventListener('change', e => { const r = e.target.closest('.needs-row'); if (r) r.classList.remove('suggested'); });

const dSel = { cat: $('d-cat'), sub: $('d-sub') };
for (const el of Object.values(dSel)) el.addEventListener('change', () => clearErrs({ x: el }));
const pSuggest = suggestFrom($('p-name'), $('p-suggest'), pSel, 'product');
const rSuggest = suggestFrom($('r-name'), $('r-suggest'), rSel, 'product');
const dSuggest = suggestFrom($('d-title'), $('d-suggest'), dSel, 'deal');
void rSuggest;

/* Unlock */
async function unlock() {
  try {
    await call('POST', '/api/admin/check');
    keyStore.set(key);
    $('keyForm').hidden = true; $('productForm').hidden = false; $('bulkWrap').hidden = false; $('findWrap').hidden = false;
    loadList(); loadMyDeals(); loadNeeds();
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
$('checkAdmitad').addEventListener('click', async () => {
  $('admitadStatus').textContent = 'Asking Admitad…';
  try {
    const r = await call('GET', '/api/admin/admitad/check');
    $('admitadStatus').textContent = r.error ? r.error : `Connected. ${r.total ?? 0} coupons for your website; ${r.mapped ? r.mapped.filter(Boolean).length : 0} of ${(r.sample || []).length} samples read correctly.`;
    $('admitadOut').textContent = JSON.stringify({ mapped: r.mapped, sample: r.sample }, null, 2);
    $('admitadOut').hidden = !r.sample;
  } catch (err) { $('admitadStatus').textContent = err.message; }
});
$('keyForm').addEventListener('submit', e => { e.preventDefault(); key = $('adminKey').value; unlock(); });

(async () => {
  tree = await (await fetch('/api/categories')).json();
  $('p-cat').innerHTML = opts(tree, 'Pick a category');
  $('b-cat').innerHTML = opts(tree, 'Pick a category');
  $('r-cat').innerHTML = opts(tree, 'Pick a category');
  $('d-cat').innerHTML = dealCatOptions(); dealCascade($('d-cat'), $('d-sub')).fill();
  $('db-cat').innerHTML = dealCatOptions(); dealCascade($('db-cat'), $('db-sub')).fill();
  fillSubs(); bulkSubs(); reviewSubs(); resetForm();
  if (key) unlock();
})();
})();
