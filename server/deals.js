// Deals and coupons from the Cuelinks Publisher API (https://developers.cuelinks.com/docs).
// Turns on when CUELINKS_API_KEY is set. The key is sent as "Authorization: Token <key>" and never
// leaves the server. Offers are cached for an hour so the free server doesn't call Cuelinks on every visit.
// Cuelinks doesn't publish its offer fields in detail, so the mapping below accepts the common names.
const BASE = 'https://developers.cuelinks.com/pub_api/v3';
const TTL_MS = 60 * 60 * 1000;

const pick = (o, ...keys) => { for (const k of keys) { const v = k.split('.').reduce((a, p) => (a == null ? a : a[p]), o); if (v != null && v !== '') return v; } return null; };
const https = u => (typeof u === 'string' && /^https:\/\//.test(u) ? u : null);

function listOf(body) {
  if (Array.isArray(body)) return body;
  for (const k of ['offers', 'data', 'results', 'items']) {
    if (Array.isArray(body && body[k])) return body[k];
    if (body && body[k] && Array.isArray(body[k].offers)) return body[k].offers;
  }
  return [];
}

// Cuelinks offer links are linksredirect.com/?cid=…&url=<store page>. Those redirects showed
// "this link is broken" for shoppers, so we link to the store page itself. The Cuelinks script on
// the page (CUELINKS_CID) turns it into a commission link when it is clicked, like the Buy buttons.
function storeUrl(u) {
  try {
    const x = new URL(u);
    if (/(^|\.)linksredirect\.com$/.test(x.hostname)) {
      // The store link may come encoded, or raw with its own & parameters (then it runs to the end).
      const m = x.search.match(/[?&]url=(https?:\/\/.*)$/);
      return https(m ? m[1] : x.searchParams.get('url')) || u;
    }
  } catch { /* not a URL */ }
  return u;
}

function toDeal(o) {
  const tracked = https(pick(o, 'affiliate_url', 'tracking_url', 'tracking_link', 'url', 'link', 'offer_url', 'landing_url'));
  const url = tracked && https(storeUrl(tracked));
  const title = pick(o, 'title', 'name', 'offer_title', 'description');
  if (!url || !title) return null;
  const ends = pick(o, 'end_date', 'ends_at', 'expiry_date', 'expires_at', 'valid_till', 'end_at');
  return {
    id: String(pick(o, 'id', 'offer_id') ?? url),
    title: String(title).slice(0, 160),
    description: String(pick(o, 'description', 'details', 'terms') || '').slice(0, 300),
    store: String(pick(o, 'campaign.name', 'campaign_name', 'store', 'store_name', 'merchant', 'merchant_name', 'advertiser') || '').slice(0, 60),
    code: pick(o, 'coupon_code', 'code', 'promo_code') ? String(pick(o, 'coupon_code', 'code', 'promo_code')).slice(0, 40) : null,
    image: https(pick(o, 'image_url', 'image', 'banner_url', 'campaign.image_url', 'campaign.logo_url', 'logo_url')),
    url,
    endsAt: ends ? String(ends) : null,
  };
}

function createDeals({ apiKey = '', fetch = globalThis.fetch, now = () => Date.now(), perPage = 50, maxPages = 60 } = {}) {
  let cache = null;   // { at, deals, error }
  const headers = { Authorization: `Token ${apiKey}`, Accept: 'application/json' };

  async function get(path) {
    const r = await fetch(BASE + path, { headers });
    const body = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`Cuelinks ${r.status}: ${(body && body.error) || 'request failed'}`);
    return body;
  }

  async function list({ refresh = false } = {}) {
    if (!apiKey) return { connected: false, deals: [] };
    if (!refresh && cache && now() - cache.at < TTL_MS) return { connected: true, deals: cache.deals, error: cache.error };
    try {
      // Read every page Cuelinks has. Stop on an empty page, a page with nothing new (some APIs
      // repeat the last page), the last page named in meta, or maxPages as a safety limit.
      const today = new Date(now()).toISOString().slice(0, 10);
      const seen = new Set(), deals = [];
      for (let page = 1; page <= maxPages; page++) {
        const body = await get(`/offers?per_page=${perPage}&page=${page}`);
        const raw = listOf(body);
        let fresh = 0;
        for (const d of raw.map(toDeal)) {
          if (!d || seen.has(d.id)) continue;
          seen.add(d.id); fresh++;
          if (!(d.endsAt && d.endsAt.slice(0, 10) < today)) deals.push(d);
        }
        const meta = (body && (body.meta || body.pagination)) || {};
        const last = Number(meta.total_pages || meta.last_page || meta.pages);
        if (!raw.length || !fresh || (last && page >= last) || meta.next_page === null) break;
      }
      cache = { at: now(), deals };
    } catch (e) {
      // Keep showing the last good list if Cuelinks is down; try again in 5 minutes.
      cache = { at: now() - TTL_MS + 5 * 60 * 1000, deals: cache ? cache.deals : [], error: e.message };
    }
    return { connected: true, deals: cache.deals, error: cache.error };
  }

  // For the admin: checks the key and shows what Cuelinks sends back, so the field mapping can be checked.
  async function check() {
    if (!apiKey) return { connected: false, error: 'CUELINKS_API_KEY is not set on the server.' };
    try {
      const ping = await get('/ping');
      const body = await get('/offers?per_page=3');
      const raw = listOf(body);
      return { connected: true, ping, offerFields: raw[0] ? Object.keys(raw[0]) : [], sample: raw.slice(0, 2), mapped: raw.slice(0, 2).map(toDeal) };
    } catch (e) { return { connected: true, error: e.message }; }
  }

  // Money earned, for the Earnings page, from GET /reports/earnings (documented at
  // developers.cuelinks.com/docs/reference/reports/earnings). One row per month with pending,
  // validated, payable, claimed and rejected, plus totals; amounts come as strings.
  // We show validated + payable as "confirmed" and claimed as "paid". Needs the read:reports scope.
  let earned = null;   // { at, result }
  async function earnings({ month, refresh = false } = {}) {
    if (!apiKey) return { connected: false };
    if (!refresh && earned && now() - earned.at < TTL_MS) return earned.result;
    let result;
    try {
      const end = new Date(now());
      const start = new Date(Date.UTC(end.getUTCFullYear() - 2, end.getUTCMonth() + 1, 1));   // 24 months, the API's limit
      const body = await get(`/reports/earnings?start_date=${start.toISOString().slice(0, 10)}&end_date=${end.toISOString().slice(0, 10)}&per_page=100`);
      const n = v => Math.round((Number(v) || 0) * 100) / 100;
      const fig = r => r ? { pending: n(r.pending), confirmed: n(Number(r.validated || 0) + Number(r.payable || 0)), paid: n(r.claimed) } : { pending: 0, confirmed: 0, paid: 0 };
      const rows = Array.isArray(body && body.data) ? body.data : [];
      const want = month || end.toISOString().slice(0, 7);
      result = { connected: true, figures: { currency: String((body && body.totals && body.totals.currency) || (body && body.meta && body.meta.currency) || 'INR'),
        thisMonth: fig(rows.find(r => r.month === want)), total: fig(body && body.totals) }, note: 'Total covers the last 24 months.' };
    } catch (e) { result = { connected: true, error: e.message }; }
    earned = { at: result.error ? now() - TTL_MS + 5 * 60 * 1000 : now(), result };
    return result;
  }

  return { list, check, earnings, connected: !!apiKey };
}

module.exports = { createDeals, toDeal, listOf };
