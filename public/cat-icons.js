// Category menu: outline icons and the drawer (icon, name, count, + to open sub-categories).
// Used on the Comparezo tab, Super Saver Deals and Seller Catalog (index.html), and for the icon
// picker on /categories.html. The icon names match ICONS in server/categories.js.
(() => {
const P = {
  fashion: '<path d="M8 3 3 6l2 5 2-1v11h10V10l2 1 2-5-5-3a3 3 0 0 1-6 0z"/>',
  home: '<path d="m3 11 9-7 9 7M5 10v10h14V10M10 20v-6h4v6"/>',
  kitchen: '<path d="M4 10h16v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4zM2 10h2M20 10h2M9.5 7c0-1.2 1-1.2 1-2.6M13.5 7c0-1.2 1-1.2 1-2.6"/>',
  electrical: '<path d="M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0zM12 17v5"/>',
  headphones: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="7" rx="1.5"/><rect x="17" y="14" width="4" height="7" rx="1.5"/>',
  glass: '<path d="M7 3h10l-.8 6a4.2 4.2 0 0 1-8.4 0zM12 13.2V21M8 21h8"/>',
  beauty: '<path d="M9 11h6v10H9zM10 11V6l4-3v8"/>',
  grocery: '<path d="M3 9h18l-2 11H5zM8 9l3-6M16 9l-3-6M9 13v4M15 13v4"/>',
  crafts: '<path d="M9 3h6M10 3v3c-3 1-5 4-5 8a7 7 0 0 0 14 0c0-4-2-7-5-8V3"/><path d="M6 13h12"/>',
  toys: '<circle cx="12" cy="10" r="4"/><circle cx="8" cy="6" r="1.6"/><circle cx="16" cy="6" r="1.6"/><path d="M6.5 21c0-3.4 2.4-6 5.5-6s5.5 2.6 5.5 6z"/>',
  mobile: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  auto: '<path d="M3 16v-3l2-5h14l2 5v3zM3 16v3h3v-3M18 16v3h3v-3M7 13h.01M17 13h.01"/>',
  sports: '<path d="M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12"/>',
  stationery: '<path d="M4 20l1-5L16 4l4 4L9 19zM14 6l4 4"/>',
  jewel: '<path d="M6 3h12l3 6-9 12L3 9zM3 9h18M9 3l3 6 3-6"/>',
  gifts: '<rect x="3" y="8" width="18" height="4" rx="1"/><rect x="5" y="12" width="14" height="9"/><path d="M12 8v13M12 8C10 4 6.5 4 7 6.5 7.4 8 12 8 12 8s4.6 0 5-1.5C17.5 4 14 4 12 8"/>',
  food: '<path d="M3 11h18a9 9 0 0 1-18 0zM8 7.5c0-2 2-2 2-4.5M13 7.5c0-2 2-2 2-4.5"/>',
  school: '<path d="m2 9 10-5 10 5-10 5zM6 11v5c3 2 9 2 12 0v-5M22 9v6"/>',
  estate: '<path d="M4 21V8l8-5 8 5v13M9 21v-5h6v5M8 11h2M14 11h2"/>',
  civil: '<path d="M3 18h18M5 18v-3a7 7 0 0 1 14 0v3M10 8.4V5h4v3.4"/>',
  paint: '<path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 1.5-2s0-2 1.5-2H18a3 3 0 0 0 3-3c0-6-4-11-9-11z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7" r="1"/>',
  doctor: '<path d="M6 3v6a4 4 0 0 0 8 0V3M10 13v3a5 5 0 0 0 10 0v-2"/><circle cx="20" cy="12" r="2"/>',
  other: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8zM7.5 8.5h.01"/>',
  // Interface icons
  deals: '<circle cx="12" cy="9" r="6"/><path d="M8.6 13.8 7 22l5-3 5 3-1.6-8.2"/><path d="m9.8 9 1.5 1.5 3-3"/>',
  stores: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M8.5 11l1.5 1.5 3-3M8.5 16h7"/>',
  shop: '<path d="M3 9l2-5h14l2 5M4 9v11h16V9M3 9h18M9 20v-6h6v6"/>',
  all: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>', search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  sync: '<path d="M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4"/>',
  wand: '<path d="m4 20 10-10M14 4v3M12.5 5.5h3M19 9v3M17.5 10.5h3M18 3v1.5"/>',
  check: '<path d="m5 12 4.5 4.5L19 7"/>',
};
// Icons the owner can pick for a category on /categories.html.
const PICKABLE = ['fashion', 'home', 'kitchen', 'electrical', 'headphones', 'glass', 'beauty', 'grocery', 'crafts', 'toys', 'mobile', 'auto', 'sports',
  'stationery', 'jewel', 'gifts', 'food', 'school', 'estate', 'civil', 'paint', 'doctor', 'other', 'tag'];
const icon = (name, cls = 'ci') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || P.tag}</svg>`;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// "Women's Wear" -> "womens-wear", "Fashion & Clothing" -> "fashion-and-clothing" (for shareable #links).
const slug = s => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// The drawer. opts:
//   title      heading ("Category")
//   top        rows above the categories: [{ id, label, icon, count, rows: [{ id, label, count }] }]
//   cats       [{ name, icon, count, subs: [{ name, count }] }]
//   current    { top } or { cat, sub } (the selected row)
//   open       Set of open row ids ("cat:<name>", "top:<id>")
//   dimEmpty   grey out rows with a count of 0
//   close      show a close button (the phone sheet)
function drawer({ title = 'Category', top = [], cats = [], current = {}, open = new Set(), dimEmpty = true, close = false }) {
  const ct = n => (n == null ? '' : `<span class="cm-ct">${Number(n).toLocaleString('en-IN')}</span>`);
  const pm = (id, has) => (has ? `<span class="cm-pm" data-cm-toggle="${esc(id)}" role="button" aria-label="Show or hide">${icon(open.has(id) ? 'minus' : 'plus')}</span>` : '');
  const row = (attrs, ic, label, count, extra = '', cls = '') => `<li><button type="button" class="cm-row ${cls}${dimEmpty && count === 0 ? ' zero' : ''}" ${attrs}>${ic ? `<span class="cm-ic">${icon(ic)}</span>` : '<span class="cm-dot"></span>'}<span class="cm-nm">${esc(label)}</span>${ct(count)}${extra}</button>`;
  const html = [];
  for (const t of top) {
    const id = `top:${t.id}`, has = !!(t.rows && t.rows.length);
    html.push(row(`data-cm-top="${esc(t.id)}" ${!t.rows && current.top === t.id ? 'aria-current="true"' : ''} aria-expanded="${has ? open.has(id) : 'false'}"`, t.icon, t.label, t.count, pm(id, has), 'strong'));
    if (has && open.has(id)) html.push(`<ul class="cm-subs">${t.rows.map(r => row(`data-cm-top="${esc(t.id)}" data-cm-val="${esc(r.id)}" ${current.top === t.id && current.val === r.id ? 'aria-current="true"' : ''}`, null, r.label, r.count)).join('')}</ul>`);
    html.push('</li>');
  }
  for (const c of cats) {
    const id = `cat:${c.name}`, has = !!(c.subs && c.subs.length);
    const here = current.cat === c.name && !current.sub;
    html.push(row(`data-cm-cat="${esc(c.name)}" ${here ? 'aria-current="true"' : ''} aria-expanded="${has ? open.has(id) : 'false'}"`, c.icon || 'tag', c.name, c.count, pm(id, has)));
    if (has && open.has(id)) html.push(`<ul class="cm-subs">${c.subs.map(s => row(`data-cm-cat="${esc(c.name)}" data-cm-sub="${esc(s.name)}" ${current.cat === c.name && current.sub === s.name ? 'aria-current="true"' : ''}`, null, s.name, s.count)).join('')}</ul>`);
    html.push('</li>');
  }
  return `<nav class="cat-menu" aria-label="${esc(title)}"><div class="cm-head"><span>${esc(title)}</span>${close ? `<button type="button" class="cm-close" data-cm-close aria-label="Close">${icon('x')}</button>` : ''}</div><ul>${html.join('')}</ul></nav>`;
}

// Click handling for a drawer inside `el`. on.pick({ top, val } | { cat, sub }), on.toggle(id).
function bind(el, on) {
  el.addEventListener('click', e => {
    const t = e.target.closest('[data-cm-toggle]');
    if (t && el.contains(t)) { e.preventDefault(); e.stopPropagation(); on.toggle(t.dataset.cmToggle); return; }
    if (e.target.closest('[data-cm-close]')) { on.close && on.close(); return; }
    const b = e.target.closest('.cm-row');
    if (!b || !el.contains(b)) return;
    if (b.dataset.cmTop) on.pick({ top: b.dataset.cmTop, val: b.dataset.cmVal || null });
    else on.pick({ cat: b.dataset.cmCat, sub: b.dataset.cmSub || null });
  });
}

window.CzCat = { icon, drawer, bind, slug, esc, PICKABLE };
})();
