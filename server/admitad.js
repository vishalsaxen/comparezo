// Deals and coupons from Admitad (now part of Mitgo), for the stores the owner joined in Admitad.
// Turns on when ADMITAD_CLIENT_ID, ADMITAD_CLIENT_SECRET and ADMITAD_WEBSITE_ID are set. They stay on the server.
// Token:   POST https://api.admitad.com/token/  (Basic base64(id:secret), grant_type=client_credentials, scope=coupons_for_website)
// Coupons: GET  https://api.admitad.com/coupons/website/<website id>/?limit=&offset=   (Bearer token)
// Each coupon's goto_link is already an Admitad tracking link, so it earns commission as it is.
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
  let token = null;   // { value, until }
  let cache = null;   // { at, deals, error }

  async function getToken() {
    if (token && now() < token.until) return token.value;
    const r = await fetch(`${API}/token/`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, scope: 'coupons_for_website' }).toString(),
    });
    const body = await r.json().catch(() => null);
    if (!r.ok || !body || !body.access_token) throw new Error(`Admitad sign-in failed (${r.status}): ${(body && (body.error_description || body.error)) || 'check the client ID and secret'}`);
    token = { value: body.access_token, until: now() + Math.max(60, (Number(body.expires_in) || 3600) - 60) * 1000 };
    return token.value;
  }

  async function page(offset, limit) {
    const r = await fetch(`${API}/coupons/website/${encodeURIComponent(websiteId)}/?limit=${limit}&offset=${offset}`, { headers: { Authorization: `Bearer ${await getToken()}`, Accept: 'application/json' } });
    const body = await r.json().catch(() => null);
    if (r.status === 401) token = null;   // sign in again next time
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

  return { list, check, connected };
}

module.exports = { createAdmitad, toDeal };
