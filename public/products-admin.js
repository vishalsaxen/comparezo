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

function showPreview() {
  const items = sheet.items;
  const names = new Set(items.map(x => (x.name || '').toLowerCase()).filter(Boolean));
  const hasCat = items.some(x => x.category);
  const missing = items.filter(x => !x.name || !x.url || !x.price).length;
  $('bulkPreview').hidden = false;
  $('bulkPreview').innerHTML = `<p class="sub"><strong>${esc(sheet.fileName)}</strong>: ${items.length} row${items.length === 1 ? '' : 's'} for ${names.size} product${names.size === 1 ? '' : 's'}.`
    + (missing ? ` ${missing} row${missing === 1 ? ' is' : 's are'} missing a name, URL or price and will be skipped.` : '')
    + (hasCat ? ' Rows without a Category use the one picked above.' : ' The sheet has no Category column, so every product goes in the category picked above.') + '</p>'
    + `<div class="tablebox"><table class="bulk-table"><thead><tr><th>Row</th><th></th><th>Name</th><th>Price</th><th>Store / link</th></tr></thead><tbody>`
    + items.slice(0, 8).map(x => `<tr><td>${x.row}</td><td>${/^https:\/\//.test(x.image || '') ? `<img src="${esc(x.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}</td>
        <td>${esc(x.name || '—')}</td><td>${esc(x.price || '—')}</td><td>${esc(x.store || '')} <span class="sub">${esc((x.url || '—').slice(0, 60))}</span></td></tr>`).join('')
    + `</tbody></table></div>${items.length > 8 ? `<p class="sub">…and ${items.length - 8} more.</p>` : ''}`;
  $('bulkAdd').disabled = !items.length;
  $('bulkLinks').disabled = !items.some(x => x.url);
}

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
    const r = await call('POST', '/api/admin/products/bulk', { rows: sheet.items, defaults: { category: $('b-cat').value, subCategory: $('b-sub').value, type: $('b-type').value } });
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
const DEAL_COLUMNS = ['Title', 'Store', 'Coupon code', 'URL', 'Details', 'Image', 'Ends on'];
const DEAL_WIDTHS = [40, 14, 16, 50, 40, 40, 12];
const DEAL_FIELDS = {
  title: 'title', deal: 'title', dealtitle: 'title', name: 'title', offer: 'title',
  store: 'store', site: 'store', shop: 'store',
  code: 'code', coupon: 'code', couponcode: 'code', promocode: 'code', promo: 'code',
  url: 'url', link: 'url', deallink: 'url', dealurl: 'url', storelink: 'url',
  details: 'description', description: 'description', terms: 'description',
  image: 'image', imageurl: 'image', photo: 'image', photolink: 'image', img: 'image',
  endson: 'endsAt', ends: 'endsAt', enddate: 'endsAt', expiry: 'endsAt', expires: 'endsAt', expirydate: 'endsAt', validtill: 'endsAt', validuntil: 'endsAt',
};
let dealSheet = null;

$('dlDealTemplate').addEventListener('click', () => download(Sheet.writeXlsx([DEAL_COLUMNS,
  ['Example: Flat 40% off on running shoes (rows starting with Example are skipped)', 'Myntra', 'RUN40', 'https://www.myntra.com/…', 'Min. order ₹999', '', '2026-12-31'],
], 'Deals', DEAL_WIDTHS), 'comparezo-deals-template.xlsx'));

$('dlDeals').addEventListener('click', async () => {
  try {
    const list = await call('GET', '/api/admin/my-deals');
    download(Sheet.writeXlsx([DEAL_COLUMNS, ...list.map(d => [d.title, d.store || '', d.code || '', d.url, d.description || '', d.image || '', d.ends_at || ''])], 'Deals', DEAL_WIDTHS), `comparezo-deals-${stamp()}.xlsx`);
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
    const missing = items.filter(x => !x.title || !x.url).length;
    $('dealPreview').hidden = false;
    $('dealPreview').innerHTML = `<p class="sub"><strong>${esc(file.name)}</strong>: ${items.length} deal${items.length === 1 ? '' : 's'}.`
      + (missing ? ` ${missing} ${missing === 1 ? 'is' : 'are'} missing a title or URL and will be skipped.` : '') + '</p>'
      + `<div class="tablebox"><table class="bulk-table"><thead><tr><th>Row</th><th>Title</th><th>Store</th><th>Code</th><th>Ends</th><th>Link</th></tr></thead><tbody>`
      + items.slice(0, 8).map(x => `<tr><td>${x.row}</td><td>${esc(x.title || '—')}</td><td>${esc(x.store || '')}</td><td>${esc(x.code || '')}</td><td>${esc(x.endsAt || '')}</td><td><span class="sub">${esc((x.url || '—').slice(0, 60))}</span></td></tr>`).join('')
      + `</tbody></table></div>${items.length > 8 ? `<p class="sub">…and ${items.length - 8} more.</p>` : ''}`;
    $('dealBulkAdd').disabled = false;
  } catch (err) { dealSheet = null; st.className = 'err'; st.textContent = err.message; }
});

$('dealBulkForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!dealSheet) return;
  const st = $('dealBulkStatus');
  st.className = ''; st.textContent = 'Adding…'; $('dealBulkAdd').disabled = true;
  try {
    const r = await call('POST', '/api/admin/my-deals/bulk', { rows: dealSheet.items });
    st.className = r.added ? 'ok' : 'err';
    st.textContent = (r.added ? `Added ${r.added} deal${r.added === 1 ? '' : 's'}` : 'No new deals were added')
      + (r.skipped ? `, skipped ${r.skipped} already saved` : '') + '.'
      + (r.problems.length ? ` ${r.problems.length} row${r.problems.length === 1 ? ' needs' : 's need'} fixing, see below.` : '');
    $('dealProblems').hidden = !r.problems.length;
    $('dealProblems').innerHTML = r.problems.length ? `<span class="label">Rows not added</span><ul class="bulk-problems">${r.problems.slice(0, 100).map(p => `<li>Row ${p.row}${p.name ? ` (${esc(p.name)})` : ''}: ${esc(p.error)}</li>`).join('')}</ul>` : '';
    if (r.added) loadMyDeals();
  } catch (err) { st.className = 'err'; st.textContent = err.message; }
  finally { $('dealBulkAdd').disabled = false; }
});

/* Unlock */
async function unlock() {
  try {
    await call('POST', '/api/admin/check');
    keyStore.set(key);
    $('keyForm').hidden = true; $('productForm').hidden = false; $('bulkWrap').hidden = false;
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
  fillSubs(); bulkSubs(); resetForm();
  if (key) unlock();
})();
})();
