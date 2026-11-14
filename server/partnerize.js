// Earnings from Partnerize (console.partnerize.com), for the Earnings page.
// Turns on when PARTNERIZE_APP_KEY, PARTNERIZE_API_KEY and PARTNERIZE_PUBLISHER_ID are set; they stay on the server.
// Where to find them in the Partnerize console: Settings > Your account (User application key and
// User API key), and Settings > Partner details or "View access rights" (Publisher ID).
//
// API (api-docs.partnerize.com/partner): HTTP Basic auth, username = user application key,
// password = user API key.
//   GET https://api.partnerize.com/reporting/report_publisher/publisher/<publisher id>/conversion.json
//       ?start_date=YYYY-MM-DD HH:MM:SS&end_date=…&limit=300
// Each conversion has conversion_data.currency and conversion_data.conversion_value with
// conversion_status (pending / approved / rejected) and publisher_commission. More pages come from
// hypermedia.pagination.next_page. The path comes from an example in the docs and the response
// shape is not confirmed with real keys yet.
// Paid-out money (self-bills / Payments) is not read: the docs don't give that endpoint's path.
const API = 'https://api.partnerize.com';
const TTL_MS = 60 * 60 * 1000;

function createPartnerize({ appKey = '', apiKey = '', publisherId = '', fetch = globalThis.fetch, now = () => Date.now(), maxPages = 30 } = {}) {
  const connected = !!(appKey && apiKey && publisherId);
  const auth = 'Basic ' + Buffer.from(`${appKey}:${apiKey}`).toString('base64');
  let cache = null;   // { at, result }

  async function get(url) {
    const r = await fetch(url, { headers: { Authorization: auth, Accept: 'application/json' } });
    const body = await r.json().catch(() => null);
    if (!r.ok) {
      const msg = body && (body.error && (body.error.message || body.error)) || (body && body.message) || 'request failed';
      throw new Error(`Partnerize ${r.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg).slice(0, 200)}`);
    }
    return body || {};
  }

  // Sums publisher commission by currency and status for conversions between two dates.
  async function sums(from, to) {
    const q = new URLSearchParams({ start_date: `${from} 00:00:00`, end_date: `${to} 23:59:59`, limit: '300' });
    let url = `${API}/reporting/report_publisher/publisher/${encodeURIComponent(publisherId)}/conversion.json?${q}`;
    const by = {};
    for (let p = 0; p < maxPages && url; p++) {
      const body = await get(url);
      for (const c of Array.isArray(body.conversions) ? body.conversions : []) {
        const d = (c && c.conversion_data) || c || {};
        const v = d.conversion_value || {};
        const cur = String(d.currency || 'INR').toUpperCase();
        const s = by[cur] || (by[cur] = { pending: 0, confirmed: 0, paid: null });
        const amount = Number(v.publisher_commission) || 0;
        if (v.conversion_status === 'pending') s.pending += amount;
        else if (v.conversion_status === 'approved') s.confirmed += amount;
      }
      const next = body.hypermedia && body.hypermedia.pagination && body.hypermedia.pagination.next_page;
      url = typeof next === 'string' && next ? (next.startsWith('http') ? next : API + next) : null;
      if (url && !url.startsWith(API + '/')) url = null;   // only follow links back to the Partnerize API
    }
    return by;
  }

  async function earnings({ month, refresh = false } = {}) {
    if (!connected) return { connected: false };
    if (!refresh && cache && now() - cache.at < TTL_MS) return cache.result;
    let result;
    try {
      const today = new Date(now()).toISOString().slice(0, 10);
      const m = month || today.slice(0, 7);
      const [mon, all] = await Promise.all([sums(`${m}-01`, today), sums('2020-01-01', today)]);
      const currencies = [...new Set([...Object.keys(all), ...Object.keys(mon)])];
      const currency = currencies.includes('INR') || !currencies.length ? 'INR' : currencies[0];
      const empty = { pending: 0, confirmed: 0, paid: null };
      const round = s => ({ pending: Math.round(s.pending * 100) / 100, confirmed: Math.round(s.confirmed * 100) / 100, paid: null });
      result = { connected: true, figures: { currency, thisMonth: round(mon[currency] || empty), total: round(all[currency] || empty) },
        note: 'Paid-out amounts are on the Partnerize Payments page.' + (currencies.length > 1 ? ` Also earned in ${currencies.filter(c => c !== currency).join(', ')}, not shown.` : '') };
    } catch (e) { result = { connected: true, error: e.message }; }
    cache = { at: result.error ? now() - TTL_MS + 5 * 60 * 1000 : now(), result };
    return result;
  }

  return { earnings, connected };
}

module.exports = { createPartnerize };
