// Categories for deals, and category suggestions for products and deals.
//
// - Own deals (added on /products.html) carry their category, which is required.
// - Feed deals (Admitad, Cuelinks) come with the network's own category name, like "Women Ethnic Wear".
//   Each name is mapped to a Comparezo category once and remembered in deal_category_map. A name that
//   matches a Comparezo category or sub-category exactly is used straight away. The rest wait in the
//   "Needs a category" list on /products.html, with a suggestion, until the owner confirms them.
//   A deal with no category from its network is keyed by its store ("store:ajio").
// - suggest() guesses a category from words: the category names themselves, a small keyword list,
//   and the names of products and deals already filed under each category (so it learns as you add).
const cats = require('./categories');

const STOP = new Set(['and', 'the', 'for', 'with', 'off', 'on', 'of', 'in', 'to', 'a', 'an', 'up', 'upto', 'flat', 'extra', 'all', 'new', 'buy', 'get', 'free',
  'sale', 'deal', 'deals', 'offer', 'offers', 'best', 'price', 'prices', 'rs', 'inr', 'only', 'from', 'at', 'pack', 'set', 'other', 'more', 'or', 'by', 'your', 'first', 'order']);
// Lower case words, without plural "s" and without numbers or stop words.
function words(text) {
  return String(text || '').toLowerCase().replace(/['’]/g, '').split(/[^a-zऀ-ॿ]+/)
    .filter(w => w.length > 1 && !STOP.has(w))
    .map(w => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
}

// A few words per sub-category that its name doesn't contain. "Category|Sub-category" -> words.
const KEYWORDS = {
  "Fashion & Clothing|Men's Wear": 'shirt tshirt t-shirt jeans trouser blazer jacket men mens polo track pant',
  "Fashion & Clothing|Women's Wear": 'saree sari kurti kurta lehenga dress top women womens ethnic dupatta legging gown',
  "Fashion & Clothing|Kids' Wear": 'kid kids boy boys girl girls frock',
  'Fashion & Clothing|Footwear': 'shoe shoes sneaker sandal slipper chappal heel heels running boot flip flop',
  'Fashion & Clothing|Bags & Accessories': 'bag backpack wallet handbag purse belt sunglass luggage trolley',
  'Home & Kitchen|Kitchenware': 'cooker pressure pan kadai kadhai tawa utensil cookware bottle flask tiffin knife kitchen',
  'Home & Kitchen|Home Décor': 'decor curtain cushion lamp wall clock bedsheet bedding rug carpet',
  'Home & Kitchen|Storage & Organizers': 'storage organizer organiser container rack',
  'Home & Kitchen|Cleaning Products': 'mop broom cleaner vacuum',
  'Home & Kitchen|Furniture': 'sofa chair table bed mattress wardrobe',
  'Electrical & Electronics|LED Bulbs': 'bulb led tubelight batten',
  'Electrical & Electronics|Electrical Accessories': 'switch wire extension socket ac air conditioner fan cooler inverter',
  'Electrical & Electronics|Mobile Accessories': 'earbud earbuds earphone headphone powerbank airdopes tws neckband speaker',
  'Electrical & Electronics|Small Appliances': 'mixer grinder iron kettle toaster trimmer dryer induction juicer appliance',
  'Electrical & Electronics|Electronics': 'tv television camera smartwatch electronic',
  'Beauty & Personal Care|Cosmetics': 'lipstick makeup kajal foundation nail perfume deodorant cosmetic',
  'Beauty & Personal Care|Skincare': 'facewash face cream serum sunscreen moisturiser moisturizer lotion skin',
  'Beauty & Personal Care|Hair Care': 'shampoo conditioner hair comb',
  'Beauty & Personal Care|Personal Hygiene': 'soap toothpaste toothbrush sanitary pad handwash razor',
  'Grocery & Daily Needs|Food Products': 'ghee atta rice dal oil masala spice tea coffee sugar flour honey snack candy namkeen biscuit chocolate dry fruit grocery',
  'Grocery & Daily Needs|Household Essentials': 'detergent tissue garbage dishwash',
  'Grocery & Daily Needs|Packaged Goods': 'packaged noodle juice',
  'Toys, Kids & Baby|Toys': 'toy puzzle lego doll game',
  'Toys, Kids & Baby|Baby Products': 'diaper baby wipe stroller',
  'Mobile & Computer|Mobile Phones': 'phone mobile smartphone iphone samsung redmi oneplus realme vivo oppo',
  'Mobile & Computer|Chargers & Cables': 'charger cable adapter usb',
  'Mobile & Computer|Computer Accessories': 'laptop mouse keyboard monitor pendrive ssd computer',
  'Mobile & Computer|Networking Products': 'router wifi modem',
  'Automotive|Car Accessories': 'car',
  'Automotive|Bike Accessories': 'bike helmet scooter',
  'Sports & Fitness|Sports Equipment': 'cricket bat ball football badminton racket',
  'Sports & Fitness|Fitness Products': 'dumbbell yoga mat gym protein treadmill fitness',
  'Stationery & Office|Stationery': 'notebook pen pencil diary classmate',
  'Stationery & Office|Office Supplies': 'stapler file paper office',
  'Jewellery & Accessories|Fashion Jewellery': 'earring necklace ring bangle jewellery jewelry',
  'Jewellery & Accessories|Watches': 'watch smartwatch',
  'Gifts & Lifestyle|Gifts': 'gift hamper',
  'Gifts & Lifestyle|Festival Items': 'diwali rakhi holi festival',
  'Food|Vegetarian': 'laddoo ladoo sweet mithai chikki',
  'Food|Bikaner Products': 'bhujia bikaneri',
};

// Every path in the tree: [{ category, subCategory, type, complete }]. complete = a product can be filed here.
function paths(tree) {
  const out = [];
  for (const c of tree) {
    out.push({ category: c.name, subCategory: null, type: null, complete: !c.subcategories.length });
    for (const s of c.subcategories) {
      out.push({ category: c.name, subCategory: s.name, type: null, complete: !s.types.length });
      for (const t of s.types) out.push({ category: c.name, subCategory: s.name, type: t.name, complete: true });
    }
  }
  return out;
}
const keyOf = p => [p.category, p.subCategory, p.type].filter(Boolean).join('|');

// Up to `limit` suggestions for this text. mode 'product' only offers paths a product can use
// (down to the type when there is one); mode 'deal' offers categories and sub-categories.
function suggest(db, text, { mode = 'product', limit = 3 } = {}) {
  const q = [...new Set(words(text))];
  if (!q.length) return [];
  const tree = cats.categoryTree(db);
  // What has been filed where already: word -> Map(pathKey -> count).
  const learned = new Map();
  const learn = (name, p) => {
    if (!p.category) return;
    for (const w of new Set(words(name))) {
      if (!learned.has(w)) learned.set(w, new Map());
      for (const k of [p.category, [p.category, p.subCategory].filter(Boolean).join('|'), keyOf(p)]) learned.get(w).set(k, (learned.get(w).get(k) || 0) + 1);
    }
  };
  for (const r of db.prepare('SELECT name, category, sub_category, type FROM products ORDER BY id DESC LIMIT 2000').all()) learn(r.name, { category: r.category, subCategory: r.sub_category, type: r.type });
  for (const r of db.prepare('SELECT title, category, sub_category FROM my_deals WHERE category IS NOT NULL ORDER BY id DESC LIMIT 2000').all()) learn(r.title, { category: r.category, subCategory: r.sub_category, type: null });

  const scored = [];
  for (const p of paths(tree)) {
    if (mode === 'product' && !p.complete) continue;
    if (mode === 'deal' && p.type) continue;
    const own = new Set(words(p.type || p.subCategory || p.category));
    const parents = new Set(words([p.category, p.type ? p.subCategory : ''].join(' ')));
    const kw = new Set(words(KEYWORDS[`${p.category}|${p.subCategory}`] || ''));
    let score = 0;
    for (const w of q) {
      if (own.has(w)) score += 3;
      else if (kw.has(w)) score += 3;
      else if (parents.has(w)) score += 1.5;
      const seen = learned.get(w) && learned.get(w).get(keyOf(p));
      if (seen) score += Math.min(2, seen * 0.5);
    }
    // "Other" only when nothing better fits.
    if (score > 0 && (p.subCategory === 'Other' || p.type === 'Other')) score -= 0.5;
    if (score > 0) scored.push({ ...p, score });
  }
  // A deeper path wins ties, so "Footwear" beats plain "Fashion & Clothing".
  scored.sort((a, b) => b.score - a.score || (b.subCategory ? 1 : 0) - (a.subCategory ? 1 : 0));
  return scored.slice(0, limit).map(({ category, subCategory, type }) => ({ category, subCategory, type }));
}

const norm = s => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
// A name that is exactly a Comparezo category or sub-category ("Beauty & Personal Care", "footwear").
function exactMatch(tree, name) {
  const n = norm(name);
  if (!n) return null;
  for (const c of tree) if (norm(c.name) === n) return { category: c.name, subCategory: null };
  const hits = [];
  for (const c of tree) for (const s of c.subcategories) if (s.name !== 'Other' && norm(s.name) === n) hits.push({ category: c.name, subCategory: s.name });
  return hits.length === 1 ? hits[0] : null;   // "Accessories" under two categories is not exact
}

// The key a feed deal is mapped by: its network's category, else its store.
function mapKey(deal) {
  const c = String(deal.sourceCategory || '').trim().toLowerCase();
  if (c) return c.slice(0, 120);
  const s = String(deal.store || '').trim().toLowerCase();
  return s ? `store:${s.slice(0, 80)}` : '';
}

function createDealCategories(db) {
  const getMap = db.prepare('SELECT category, sub_category FROM deal_category_map WHERE source = ? AND name = ?');
  const upsert = db.prepare(`INSERT INTO deal_category_map (source, name, category, sub_category, updated_at) VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT (source, name) DO UPDATE SET category = excluded.category, sub_category = excluded.sub_category, updated_at = excluded.updated_at`);

  // Adds { category, subCategory } to each feed deal from this source (null when not mapped yet).
  function apply(source, deals) {
    const tree = cats.categoryTree(db);
    return deals.map(d => {
      const k = mapKey(d);
      const m = k && getMap.get(source, k);
      if (m) return { ...d, category: m.category, subCategory: m.sub_category || null };
      const auto = d.sourceCategory ? exactMatch(tree, d.sourceCategory) : null;
      return { ...d, category: auto ? auto.category : null, subCategory: auto ? auto.subCategory : null };
    });
  }

  // The "Needs a category" list: feed-deal categories nobody has mapped yet, and own deals without one.
  // feeds: { admitad: [deal], cuelinks: [deal] } (already passed through apply()).
  function pending(feeds) {
    const groups = new Map();
    for (const [source, list] of Object.entries(feeds)) {
      for (const d of list) {
        if (d.category) continue;
        const k = mapKey(d);
        if (!k) continue;
        const id = `${source}|${k}`;
        if (!groups.has(id)) groups.set(id, { source, name: k, label: d.sourceCategory || d.store || k, store: d.store || '', count: 0, samples: [] });
        const g = groups.get(id);
        g.count++;
        if (g.samples.length < 3) g.samples.push(d.title);
      }
    }
    const out = [...groups.values()].sort((a, b) => b.count - a.count);
    for (const g of out) {
      const s = suggest(db, `${g.name.startsWith('store:') ? '' : g.label} ${g.samples.join(' ')}`, { mode: 'deal', limit: 1 })[0];
      g.suggestion = s ? { category: s.category, subCategory: s.subCategory } : null;
    }
    const mine = db.prepare("SELECT id, title, store FROM my_deals WHERE category IS NULL OR category = '' ORDER BY id DESC").all()
      .map(d => { const s = suggest(db, d.title, { mode: 'deal', limit: 1 })[0]; return { ...d, suggestion: s ? { category: s.category, subCategory: s.subCategory } : null }; });
    return { feeds: out, mine };
  }

  // Remember a mapping. Returns { saved } or { error }.
  function save({ source, name, category, subCategory }) {
    if (!['admitad', 'cuelinks'].includes(source)) return { error: 'Unknown deal source.' };
    const k = String(name || '').trim().toLowerCase().slice(0, 120);
    if (!k) return { error: 'Which category name is this for?' };
    const p = cats.checkDealPath(db, category, subCategory);
    if (p.error) return { error: p.error };
    upsert.run(source, k, p.category, p.subCategory);
    return { saved: { source, name: k, category: p.category, subCategory: p.subCategory } };
  }
  const list = () => db.prepare('SELECT source, name, category, sub_category AS subCategory, updated_at AS updatedAt FROM deal_category_map ORDER BY source, name').all();
  const remove = (source, name) => db.prepare('DELETE FROM deal_category_map WHERE source = ? AND name = ?').run(String(source), String(name).toLowerCase()).changes > 0;

  return { apply, pending, save, list, remove };
}

module.exports = { createDealCategories, suggest, exactMatch, mapKey, words };
