// Flipkart Affiliate API (https://affiliate.flipkart.com/api-docs/).
// Flipkart doesn't publish when a product was uploaded. Its Delta Feed does list every product
// added or changed since a version number, so we:
//   1. on the first run for a category, note the current version and remember the existing
//      catalogue as "baseline" (not new);
//   2. on later runs, ask for changes since the saved version. A product id we have never seen
//      before is a new arrival, dated the moment we first saw it.
const { saveItem, markBaseline, getState, setState } = require('./save');

const LISTING = id => `https://affiliate-api.flipkart.net/affiliate/api/${encodeURIComponent(id)}.json`;
const STORE = 'Flipkart';

function productsOf(page) {
  return (page.productInfoList || page.products || []).map(p => p.productBaseInfoV1 || p).filter(Boolean);
}
const https = u => (u ? String(u).replace(/^http:\/\//, 'https://') : null);

function toItem(p, [category, subCategory]) {
  const img = p.imageUrls || {};
  return {
    store: STORE,
    externalId: p.productId,
    name: p.title,
    category, subCategory,
    spec: [p.productBrand, p.attributes && p.attributes.color, p.attributes && p.attributes.size].filter(Boolean).join(' · '),
    price: (p.flipkartSpecialPrice || p.flipkartSellingPrice || {}).amount,
    mrp: (p.maximumRetailPrice || {}).amount,
    url: https(p.productUrl),
    image: https(img['400x400'] || img['200x200'] || img['800x800'] || Object.values(img)[0]),
    listedAt: null,
  };
}

function createFlipkartFeed({ affiliateId, token, categories, fetch = globalThis.fetch, maxBaselinePages = 200, maxDeltaPages = 100 }) {
  const headers = { 'Fk-Affiliate-Id': affiliateId, 'Fk-Affiliate-Token': token, Accept: 'application/json' };
  async function get(url) {
    const r = await fetch(url, { headers });
    if (!r.ok) throw new Error(`Flipkart ${r.status} for ${url.split('?')[0]}`);
    return r.json();
  }

  async function run(db, { now = new Date() } = {}) {
    const listing = await get(LISTING(affiliateId));
    const apis = ((listing.apiGroups || {}).affiliate || {}).apiListings || {};
    const summary = { store: STORE, new: 0, updated: 0, baseline: 0, categories: {}, availableCategories: Object.keys(apis) };

    for (const [key, target] of Object.entries(categories)) {
      const entry = apis[key];
      if (!entry) { summary.categories[key] = 'not offered by Flipkart for this account'; continue; }
      const variants = entry.availableVariants || {};
      const v = variants['v1.1.0'] || Object.values(variants)[0];
      if (!v || !v.deltaGet) { summary.categories[key] = 'no delta feed'; continue; }

      const latest = (await get(v.deltaGet)).version;
      const stateKey = `flipkart:${key}`;
      const saved = getState(db, stateKey);

      if (!saved) {
        // First time: the whole current catalogue is the baseline.
        let url = v.get, pages = 0, count = 0;
        while (url && pages++ < maxBaselinePages) {
          const page = await get(url);
          const ids = productsOf(page).map(p => p.productId).filter(Boolean);
          markBaseline(db, STORE, ids);
          count += ids.length;
          url = page.nextUrl || null;
        }
        setState(db, stateKey, { version: latest });
        summary.baseline += count;
        summary.categories[key] = `baseline of ${count} products saved`;
        continue;
      }

      let url = v.deltaGet.replace(/\/category\/([^/?]+)\.json/, `/category/$1/fromVersion/${saved.version}.json`);
      let pages = 0, added = 0;
      while (url && pages++ < maxDeltaPages) {
        const page = await get(url);
        for (const p of productsOf(page)) {
          if (p.inStock === false || p.isAvailable === false) continue;
          const r = saveItem(db, toItem(p, target), { now });
          if (r === 'new') { summary.new++; added++; } else if (r === 'updated') summary.updated++;
        }
        url = page.nextUrl || null;
      }
      setState(db, stateKey, { version: latest });
      summary.categories[key] = `${added} new`;
    }
    return summary;
  }

  return { name: STORE, run };
}

module.exports = { createFlipkartFeed };
