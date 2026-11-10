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

function toDeal(o) {
  const url = https(pick(o, 'affiliate_url', 'tracking_url', 'tracking_link', 'url', 'link', 'offer_url', 'landing_url'));
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

function createDeals({ apiKey = '', fetch = globalThis.fetch, now = () => Date.now(), perPage = 50 } = {}) {
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
      const body = await get(`/offers?per_page=${perPage}`);
      const today = new Date(now()).toISOString().slice(0, 10);
      const deals = listOf(body).map(toDeal).filter(d => d && !(d.endsAt && d.endsAt.slice(0, 10) < today));
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

  return { list, check, connected: !!apiKey };
}

module.exports = { createDeals, toDeal, listOf };
