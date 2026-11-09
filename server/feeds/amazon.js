// Amazon Creators API (replaced PA-API 5 in 2026). Docs:
// https://affiliate-program.amazon.com/creatorsapi/docs/en-us/api-reference/operations/search-items
// Amazon has no "uploaded since" filter, but SearchItems can sort by NewestArrivals, and some items
// carry a release date (itemInfo.productInfo.releaseDate). We run a few searches sorted by
// NewestArrivals, use the release date when it's there, and otherwise date an item by when we
// first saw it.
const { saveItem } = require('./save');

const STORE = 'Amazon.in';
const RESOURCES = ['itemInfo.title', 'itemInfo.byLineInfo', 'itemInfo.productInfo', 'images.primary.large', 'offersV2.listings.price'];

function toItem(it, s) {
  const info = it.itemInfo || {};
  const listing = ((it.offersV2 || {}).listings || [])[0] || {};
  const price = listing.price || {};
  const release = ((info.productInfo || {}).releaseDate || {}).displayValue;
  const brand = ((info.byLineInfo || {}).brand || {}).displayValue;
  return {
    store: STORE,
    externalId: it.asin,
    name: (info.title || {}).displayValue,
    category: s.category, subCategory: s.subCategory,
    spec: brand || '',
    price: (price.money || {}).amount,
    mrp: ((price.savingBasis || {}).money || {}).amount,
    url: it.detailPageURL,
    image: ((((it.images || {}).primary || {}).large) || {}).url,
    listedAt: release ? String(release).slice(0, 19).replace('T', ' ') : null,
  };
}

function createAmazonFeed({ clientId, clientSecret, partnerTag, searches, marketplace = 'www.amazon.in',
  tokenUrl = 'https://api.amazon.co.uk/auth/o2/token', apiBase = 'https://creatorsapi.amazon/catalog/v1',
  pagesPerSearch = 3, fetch = globalThis.fetch, wait = ms => new Promise(r => setTimeout(r, ms)) }) {
  let token = null, tokenExpires = 0;

  async function getToken() {
    if (token && Date.now() < tokenExpires - 60_000) return token;
    const r = await fetch(tokenUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret, scope: 'creatorsapi::default' }),
    });
    if (!r.ok) throw new Error(`Amazon sign-in failed (${r.status})`);
    const d = await r.json();
    token = d.access_token; tokenExpires = Date.now() + (Number(d.expires_in) || 3600) * 1000;
    return token;
  }

  async function search(s, page) {
    const r = await fetch(`${apiBase}/searchItems`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await getToken()}`, 'Content-Type': 'application/json', 'x-marketplace': marketplace },
      body: JSON.stringify({ partnerTag, marketplace, keywords: s.keywords, searchIndex: s.searchIndex || 'All',
        sortBy: 'NewestArrivals', itemCount: 10, itemPage: page, resources: RESOURCES }),
    });
    if (r.status === 404) return [];   // no more results
    if (!r.ok) throw new Error(`Amazon search "${s.keywords}" failed (${r.status})`);
    return (((await r.json()).searchResult || {}).items) || [];
  }

  async function run(db, { now = new Date() } = {}) {
    const summary = { store: STORE, new: 0, updated: 0, baseline: 0, searches: {} };
    for (const s of searches) {
      let added = 0;
      for (let page = 1; page <= pagesPerSearch; page++) {
        const items = await search(s, page);
        for (const it of items) {
          const res = saveItem(db, toItem(it, s), { now });
          if (res === 'new') { summary.new++; added++; } else if (res === 'updated') summary.updated++;
        }
        if (items.length < 10) break;
        await wait(1100);   // Amazon allows about one request a second
      }
      summary.searches[s.keywords] = `${added} new`;
    }
    return summary;
  }

  return { name: STORE, run };
}

module.exports = { createAmazonFeed };
