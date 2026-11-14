// Deals and coupons from Admitad (now part of Mitgo), for the stores the owner joined in Admitad.
// Turns on when ADMITAD_CLIENT_ID, ADMITAD_CLIENT_SECRET and ADMITAD_WEBSITE_ID are set. They stay on the server.
// Token:   POST https://api.admitad.com/token/  (Basic base64(id:secret), grant_type=client_credentials, scope=coupons_for_website)
// Coupons: GET  https://api.admitad.com/coupons/website/<website id>/?limit=&offset=   (Bearer token)
// Each coupon's goto_link is already an Admitad tracking link, so it earns commission as it is.
// Links:   deeplink(url) turns a store product link into an Admitad tracking link, for stores
//          (programs) the website has joined. It signs in separately with the scopes
//          advcampaigns_for_website + deeplink_generator, so coupons keep working if those are off.
//          GET /advcampaigns/website/<website id>/?connection_status=active  -> joined stores
//          GET /deeplink/<website id>/advcampaign/<campaign id>/?ulp=<link>  -> ["https://ad.admitad.com/g/…"]
// Earnings: GET /statistics/campaigns/?website=<id>&date_start=dd.mm.yyyy&date_end=dd.mm.yyyy
//          (scope "statistics"). Each row has payment_sum_open (pending), payment_sum_approved
//          (confirmed), payment_sum_declined and currency. The field names are from Admitad's
//          "Publisher reports" docs; the scope name is not confirmed there, so check it with the real keys.
// Coupons are cached for an hour so the free server doesn't call Admitad on every visit.
const API = 'https://api.admitad.com';
const TTL_MS = 60 * 60 * 1000;

const httpsUrl = u => {
  if (typeof u !== 'string' || !u) return null;
  if (u.startsWith('//')) u = 'https:' + u;
  if (u.startsWith('http://')) u = 'https://' + u.slice(7);
  return /^https:\/\/\S+$/.test(u) ? u : null;
};

function toDeal(c) {
  const url = httpsUrl(c && c.goto_link);
  if (!url || !c.name) return null;
  const discount = c.discount ? String(c.discount) : '';
  return {
    id: `admitad-${c.id}`,
    title: String(c.name).slice(0, 160),
    description: String(c.description || '').replace(/<[^>]*>/g, '').slice(0, 300),
    store: String((c.campaign && c.campaign.name) || '').slice(0, 60),
    code: c.promocode && !/^not\s*required$/i.test(String(c.promocode).trim()) ? String(c.promocode).slice(0, 40) : null,
    image: httpsUrl(c.image),
    url,
    endsAt: c.date_end ? String(c.date_end) : null,
    discount: discount.slice(0, 20) || null,
  };
}

function createAdmitad({ clientId = '', clientSecret = '', websiteId = '', fetch = globalThis.fetch, now = () => Date.now(), perPage = 500, maxPages = 10 } = {}) {
  const connected = !!(clientId && clientSecret && websiteId);
  const tokens = {};   // scope -> { value, until }
  let cache = null;   // { at, deals, error }

  async function getToken(scope = 'coupons_for_website') {
    const token = tokens[scope];
    if (token && now() < token.until) return token.value;
    const r = await fetch(`${API}/token/`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, scope }).toString(),
    });
    const body = await r.json().catch(() => null);
    if (!r.ok || !body || !body.access_token) throw new Error(`Admitad sign-in failed (${r.status}): ${(body && (body.error_description || body.error)) || 'check the client ID and secret'}`);
    tokens[scope] = { value: body.access_token, until: now() + Math.max(60, (Number(body.expires_in) || 3600) - 60) * 1000 };
    return tokens[scope].value;
  }

  async function page(offset, limit) {
    const r = await fetch(`${API}/coupons/website/${encodeURIComponent(websiteId)}/?limit=${limit}&offset=${offset}`, { headers: { Authorization: `Bearer ${await getToken()}`, Accept: 'application/json' } });
    const body = await r.json().catch(() => null);
    if (r.status === 401) delete tokens.coupons_for_website;   // sign in again next time
    if (!r.ok) throw new Error(`Admitad ${r.status}: ${(body && (body.error_description || body.error || body.detail)) || 'request failed'}`);
    return body || {};
  }

  async function list({ refresh = false } = {}) {
    if (!connected) return { connected: false, deals: [] };
    if (!refresh && cache && now() - cache.at < TTL_MS) return { connected: true, deals: cache.deals, error: cache.error };
    try {
      const today = new Date(now()).toISOString().slice(0, 10);
      const seen = new Set(), deals = [];
      for (let p = 0; p < maxPages; p++) {
        const body = await page(p * perPage, perPage);
        const raw = Array.isArray(body.results) ? body.results : [];
        for (const d of raw.filter(c => !c.status || c.status === 'active').map(toDeal)) {
          if (!d || seen.has(d.id)) continue;
          seen.add(d.id);
          if (!(d.endsAt && d.endsAt.slice(0, 10) < today)) deals.push(d);
        }
        const count = Number(body._meta && body._meta.count);
        if (raw.length < perPage || (count && (p + 1) * perPage >= count)) break;
      }
      cache = { at: now(), deals };
    } catch (e) {
      // Keep showing the last good list if Admitad is down; try again in 5 minutes.
      cache = { at: now() - TTL_MS + 5 * 60 * 1000, deals: cache ? cache.deals : [], error: e.message };
    }
    return { connected: true, deals: cache.deals, error: cache.error };
  }

  // For the admin: checks the keys and shows what Admitad sends back.
  async function check() {
    if (!connected) return { connected: false, error: 'Set ADMITAD_CLIENT_ID, ADMITAD_CLIENT_SECRET and ADMITAD_WEBSITE_ID on the server.' };
    try {
      const body = await page(0, 3);
      const raw = Array.isArray(body.results) ? body.results : [];
      return { connected: true, total: body._meta ? body._meta.count : null, sample: raw.slice(0, 2), mapped: raw.slice(0, 2).map(toDeal) };
    } catch (e) { return { connected: true, error: e.message }; }
  }

  // Product links through Admitad, for stores the website has joined.
  const LINK_SCOPE = 'advcampaigns_for_website deeplink_generator';
  let joined = null;   // { at, list: [{ id, name, host }], error }
  const hostOf = u => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
  async function get(path) {
    const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${await getToken(LINK_SCOPE)}`, Accept: 'application/json' } });
    const body = await r.json().catch(() => null);
    if (r.status === 401) delete tokens[LINK_SCOPE];
    if (!r.ok) throw new Error(`Admitad ${r.status}: ${(body && (body.error_description || body.error || body.detail)) || 'request failed'}`);
    return body;
  }
  async function joinedStores() {
    if (joined && now() - joined.at < TTL_MS) return joined;
    try {
      const body = await get(`/advcampaigns/website/${encodeURIComponent(websiteId)}/?connection_status=active&limit=500`);
      const list = (Array.isArray(body && body.results) ? body.results : [])
        .map(c => ({ id: c.id, name: String(c.name || ''), host: hostOf(httpsUrl(c.site_url) || '') })).filter(c => c.id && c.host);
      joined = { at: now(), list };
    } catch (e) { joined = { at: now() - TTL_MS + 5 * 60 * 1000, list: joined ? joined.list : [], error: e.message }; }
    return joined;
  }
  // Returns { link, store } or { error }.
  async function deeplink(url) {
    if (!connected) return { error: 'Admitad is not set up.' };
    const host = hostOf(url);
    const { list, error } = await joinedStores();
    const c = list.find(x => host === x.host || host.endsWith('.' + x.host) || x.host.endsWith('.' + host));
    if (!c) return { error: error || 'Your Admitad website has not joined this store.' };
    try {
      const body = await get(`/deeplink/${encodeURIComponent(websiteId)}/advcampaign/${c.id}/?ulp=${encodeURIComponent(url)}`);
      const link = (JSON.stringify(body || '').replace(/\\\//g, '/').match(/https:\/\/[^\s"'<>\\]+/g) || []).find(l => l !== url);
      return link ? { link, store: c.name } : { error: 'Admitad sent no link back.' };
    } catch (e) { return { error: e.message }; }
  }

  // Money earned, for the Earnings page: this month and since 2020, summed over every store.
  const STATS_SCOPE = 'statistics';
  let stats = null;   // { at, result }
  const ddmmyyyy = d => `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`;
  async function sums(from, to) {
    const token = await getToken(STATS_SCOPE);
    const q = new URLSearchParams({ website: websiteId, date_start: ddmmyyyy(from), date_end: ddmmyyyy(to), limit: '500' });
    const r = await fetch(`${API}/statistics/campaigns/?${q}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    const body = await r.json().catch(() => null);
    if (r.status === 401) delete tokens[STATS_SCOPE];
    if (!r.ok) throw new Error(`Admitad statistics ${r.status}: ${(body && (body.error_description || body.error || body.detail)) || 'request failed'}`);
    const byCurrency = {};
    for (const row of Array.isArray(body && body.results) ? body.results : []) {
      const c = String(row.currency || 'INR').toUpperCase();
      const s = byCurrency[c] || (byCurrency[c] = { pending: 0, confirmed: 0, paid: null });
      s.pending += Number(row.payment_sum_open) || 0;
      s.confirmed += Number(row.payment_sum_approved) || 0;
    }
    return byCurrency;
  }
  async function earnings({ month, refresh = false } = {}) {
    if (!connected) return { connected: false };
    if (!refresh && stats && now() - stats.at < TTL_MS) return stats.result;
    let result;
    try {
      const today = new Date(now());
      const [y, m] = (month || today.toISOString().slice(0, 7)).split('-').map(Number);
      const [mon, all] = await Promise.all([sums(new Date(Date.UTC(y, m - 1, 1)), today), sums(new Date(Date.UTC(2020, 0, 1)), today)]);
      const currencies = [...new Set([...Object.keys(all), ...Object.keys(mon)])];
      const currency = currencies.includes('INR') || !currencies.length ? 'INR' : currencies[0];
      const empty = { pending: 0, confirmed: 0, paid: null };
      const round = s => ({ pending: Math.round(s.pending * 100) / 100, confirmed: Math.round(s.confirmed * 100) / 100, paid: null });
      result = { connected: true, figures: { currency, thisMonth: round(mon[currency] || empty), total: round(all[currency] || empty) },
        note: 'Paid-out amounts are not in this report; see your Admitad balance.' + (currencies.length > 1 ? ` Also earned in ${currencies.filter(c => c !== currency).join(', ')}, not shown.` : '') };
    } catch (e) { result = { connected: true, error: e.message }; }
    stats = { at: result.error ? now() - TTL_MS + 5 * 60 * 1000 : now(), result };
    return result;
  }

  return { list, check, deeplink, earnings, connected };
}

module.exports = { createAdmitad, toDeal };
