const { seedCategories } = require('./categories');

// Sample data so the app is useful before real price feeds are connected.
// Prices are made up. Nothing here is scraped from any store.

const PRODUCTS = [
  ['Sonaura Pulse TWS Wireless Earbuds', 'Electronics', 'Bluetooth 5.3 · 40 hr playback · ENC mic · Black',
    [['Amazon.in', 1499, 3990, 0, 100, 2, 4.2], ['Flipkart', 1449, 3990, 40, 0, 3, 4.1], ['Meesho', 1389, 2999, 0, 0, 6, 3.9], ['Snapdeal', 1529, 3990, 49, 150, 5, 3.8], ['JioMart', 1599, 3990, 0, 0, 4, 4.0]]],
  ["Women's Rayon Anarkali Kurta Set", 'Fashion & Clothing', 'Kurta + pant + dupatta · Sizes S to XXL · Mustard',
    [['Meesho', 612, 1499, 0, 0, 5, 4.0], ['Myntra', 749, 2199, 0, 100, 3, 4.3], ['Flipkart', 689, 1999, 40, 0, 4, 4.1], ['Amazon.in', 719, 1999, 0, 50, 2, 4.1]], "Women's Wear"],
  ['Kitchora 5L Aluminium Pressure Cooker', 'Kitchen', 'Induction base · Inner lid · 5 year warranty',
    [['Amazon.in', 1429, 2350, 0, 0, 1, 4.4], ['Flipkart', 1399, 2350, 0, 0, 3, 4.3], ['JioMart', 1375, 2350, 60, 0, 4, 4.2], ['Meesho', 1349, 2100, 0, 0, 7, 3.9], ['Snapdeal', 1459, 2350, 0, 100, 5, 4.0]]],
  ['Nimbus 6.7" 5G Smartphone, 8GB / 128GB', 'Mobiles', '120Hz AMOLED · 5000 mAh · 50MP camera · Ocean Blue',
    [['Flipkart', 15999, 21999, 0, 1000, 2, 4.4], ['Amazon.in', 16249, 21999, 0, 1250, 1, 4.3], ['JioMart', 16499, 21999, 0, 500, 3, 4.2], ['Snapdeal', 16199, 21999, 99, 0, 6, 3.9]]],
  ['Cotton Double Bedsheet with 2 Pillow Covers', 'Home', '144 TC · 90 x 100 in · Floral print · Blue',
    [['Meesho', 459, 1299, 0, 0, 6, 3.9], ['Amazon.in', 549, 1499, 0, 0, 2, 4.1], ['Flipkart', 499, 1499, 40, 0, 4, 4.0], ['Myntra', 599, 1599, 0, 50, 4, 4.2], ['Snapdeal', 479, 1299, 49, 0, 7, 3.7]]],
  ['Vitamin C Face Serum 30ml', 'Beauty', '10% Vitamin C · Niacinamide · All skin types',
    [['Amazon.in', 449, 699, 0, 0, 1, 4.2], ['Flipkart', 459, 699, 0, 20, 3, 4.1], ['Myntra', 489, 699, 0, 50, 3, 4.3], ['Meesho', 419, 599, 0, 0, 6, 3.8], ['JioMart', 469, 699, 40, 0, 4, 4.0]]],
  ["Men's Running Shoes, Mesh Upper", 'Fashion & Clothing', 'Lightweight EVA sole · Sizes 6 to 11 · Grey/Lime',
    [['Myntra', 999, 2999, 0, 150, 3, 4.2], ['Amazon.in', 949, 2999, 0, 0, 2, 4.0], ['Flipkart', 979, 2999, 0, 0, 3, 4.1], ['Meesho', 899, 2499, 0, 0, 7, 3.8]], 'Footwear'],
  ["Men's Slim Fit Cotton Shirt", 'Fashion & Clothing', '100% cotton · Full sleeve · Sizes 38 to 44 · Sky Blue',
    [['Myntra', 699, 1799, 0, 100, 3, 4.2], ['Amazon.in', 649, 1799, 0, 0, 2, 4.1], ['Flipkart', 629, 1799, 40, 0, 3, 4.0], ['Meesho', 579, 1499, 0, 0, 6, 3.8]], "Men's Wear"],
  ["Kids' Cotton T-shirts, Pack of 3", 'Fashion & Clothing', 'Ages 2 to 10 · Round neck · Assorted prints',
    [['Meesho', 399, 999, 0, 0, 6, 3.9], ['Flipkart', 449, 1199, 0, 50, 3, 4.1], ['Amazon.in', 469, 1199, 0, 0, 2, 4.2], ['Myntra', 499, 1299, 0, 100, 3, 4.3]], "Kids' Wear"],
  ["Women's Sling Bag, Vegan Leather", 'Fashion & Clothing', 'Adjustable strap · 2 compartments · Tan',
    [['Myntra', 849, 2499, 0, 150, 3, 4.2], ['Amazon.in', 799, 2499, 0, 0, 2, 4.0], ['Meesho', 689, 1999, 0, 0, 7, 3.7], ['Flipkart', 759, 2499, 40, 0, 4, 4.0]], 'Bags & Accessories'],
  ['Stainless Steel Water Bottle 1L, Insulated', 'Kitchen', 'Hot 12 hr / Cold 24 hr · Leak-proof · Steel',
    [['Amazon.in', 529, 999, 0, 0, 1, 4.3], ['Flipkart', 549, 999, 0, 30, 3, 4.2], ['Meesho', 489, 899, 0, 0, 6, 3.9], ['JioMart', 519, 999, 40, 0, 4, 4.1]]],
  ['Smart Fitness Band with SpO2', 'Electronics', '1.1" AMOLED · 14 day battery · Water resistant',
    [['Flipkart', 1549, 3499, 0, 0, 2, 4.1], ['Amazon.in', 1599, 3499, 0, 100, 1, 4.2], ['Snapdeal', 1499, 3499, 79, 0, 5, 3.8], ['Meesho', 1529, 2999, 0, 0, 6, 3.8]]],
];

const LISTINGS = [
  ['Hand-painted terracotta planter set (3)', 'Home', 'Handmade', 450, 'Kolkata 700019', 'Ritwik D.'],
  ['Wireless earbuds, used 2 months, box + bill', 'Electronics', 'Like new', 899, 'Pune 411038', 'Aniket P.'],
  ['Chikankari cotton kurti, size L', 'Fashion & Clothing', 'New', 650, 'Lucknow 226001', 'Fatima K.', "Women's Wear"],
  ['Handmade leather wallet, brown', 'Fashion & Clothing', 'Handmade', 520, 'Kanpur 208001', 'Imran S.', 'Leather'],
  ['Homemade mango pickle, 500g jar', 'Kitchen', 'Handmade', 280, 'Vijayawada 520010', 'Lakshmi R.'],
];

// Small deterministic random generator so the seeded history is the same every time.
function rng(seed) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

function seed(db, { purchaseDays = 120, now = new Date() } = {}) {
  seedCategories(db);
  if (db.prepare('SELECT COUNT(*) AS c FROM products').get().c > 0) return false;
  const rand = rng(42);
  const insP = db.prepare('INSERT INTO products (name, category, spec, sub_category) VALUES (?, ?, ?, ?)');
  const insO = db.prepare('INSERT INTO offers (product_id, store, price, mrp, delivery_fee, coupon, delivery_days, rating) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const insL = db.prepare('INSERT INTO listings (title, category, condition, price, city, seller_name, sub_category) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const insPu = db.prepare('INSERT INTO purchases (product_id, listing_id, store, category, amount, quantity, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');

  db.exec('BEGIN');
  try {
    const catalog = [];
    for (const [name, cat, spec, offers, sub = null] of PRODUCTS) {
      const pid = Number(insP.run(name, cat, spec, sub).lastInsertRowid);
      const offs = offers.map(o => { insO.run(pid, ...o); return { store: o[0], pay: o[1] + o[3] - o[4] }; });
      catalog.push({ pid, cat, offs, pop: 0.6 + rand() * 1.6 });
    }
    const listingIds = LISTINGS.map(l => ({ id: Number(insL.run(...l.slice(0, 6), l[6] ?? null).lastInsertRowid), cat: l[1], price: l[3] }));

    // Purchase history: weekend bumps, a gentle upward trend, and a festive-season spike in the last few weeks.
    for (let d = purchaseDays - 1; d >= 0; d--) {
      const day = new Date(now); day.setUTCHours(0, 0, 0, 0); day.setUTCDate(day.getUTCDate() - d);
      const dow = day.getUTCDay();
      const weekend = dow === 0 || dow === 6 ? 1.35 : 1;
      const growth = 1 + (purchaseDays - d) / purchaseDays * 0.5;
      const festive = d < 25 && d > 8 ? 1.6 : 1;
      for (const p of catalog) {
        const units = Math.round(p.pop * weekend * growth * festive * (0.5 + rand() * 1.2));
        for (let u = 0; u < units; u++) {
          // Most buyers pick the cheapest store, some pick others.
          const sorted = [...p.offs].sort((a, b) => a.pay - b.pay);
          const o = rand() < 0.55 ? sorted[0] : sorted[Math.floor(rand() * sorted.length)];
          const t = new Date(day.getTime() + Math.floor(rand() * 86400000));
          insPu.run(p.pid, null, o.store, p.cat, o.pay, 1, t.toISOString().replace('T', ' ').slice(0, 19));
        }
      }
      for (const l of listingIds) {
        if (rand() < 0.18) {
          const t = new Date(day.getTime() + Math.floor(rand() * 86400000));
          insPu.run(null, l.id, 'Individual seller', l.cat, l.price, 1, t.toISOString().replace('T', ' ').slice(0, 19));
        }
      }
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return true;
}

module.exports = { seed };
