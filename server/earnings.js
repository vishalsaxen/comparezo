// The owner's Earnings page (/earnings.html): one row per affiliate network, with its status, a
// link to its dashboard and the money earned. Figures come from the network's API where it has
// one we can call; everything else is typed in by the owner and saved (earnings_manual table,
// kept in Firestore like the rest of the data).
//
// Which networks can report earnings automatically:
//   Admitad   yes: GET /statistics/campaigns/ (payment_sum_open / payment_sum_approved), see admitad.js.
//             Needs the "statistics" scope on the Admitad app; unverified until run with the real keys.
//   Cuelinks  yes: GET /pub_api/v3/reports/earnings (pending / validated / payable / claimed), see deals.js.
//             Keys are off on Render until the new account is approved.
//   EarnKaro  no: its API only converts links. Type the numbers from the EarnKaro app.
//   ExtraPe   no API at all. Type the numbers in.
//   Partnerize yes: conversion report API, see partnerize.js (PARTNERIZE_* keys). Unverified with real keys.
//
// Amounts: pending = waiting for the store to confirm, confirmed = approved but not paid out yet,
// paid = already paid to you. Months are YYYY-MM.

const NETWORKS = [
  { id: 'earnkaro', name: 'EarnKaro', dashboard: 'https://earnkaro.com/', how: 'EarnKaro has no earnings API, so type the numbers from the EarnKaro app or website.' },
  { id: 'admitad', name: 'Admitad', dashboard: 'https://store.admitad.com/', how: 'Read from the Admitad statistics API.' },
  { id: 'cuelinks', name: 'Cuelinks', dashboard: 'https://www.cuelinks.com/dashboard', how: 'Read from the Cuelinks earnings report API.' },
  { id: 'extrape', name: 'ExtraPe', dashboard: 'https://www.extrape.com/my-earnings', how: 'ExtraPe has no API, so copy the numbers from My Earnings and type them in.' },
  { id: 'partnerize', name: 'Partnerize', dashboard: 'https://console.partnerize.com/payments/payments', how: 'Read from the Partnerize conversion report API.' },
];
const IDS = new Set(NETWORKS.map(n => n.id));

const money = v => {
  if (v === '' || v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n < 1e9 ? Math.round(n * 100) / 100 : NaN;
};
const thisMonth = (now = Date.now()) => new Date(now + 5.5 * 3600 * 1000).toISOString().slice(0, 7);   // India time

function checkEntry(b = {}) {
  const errors = [];
  const network = String(b.network || '');
  if (!IDS.has(network)) errors.push('Pick a network.');
  const month = String(b.month || '');
  if (!/^20\d\d-(0[1-9]|1[0-2])$/.test(month)) errors.push('Pick a month.');
  const pending = money(b.pending), confirmed = money(b.confirmed), paid = money(b.paid);
  if ([pending, confirmed, paid].some(Number.isNaN)) errors.push('Amounts must be numbers of 0 or more.');
  const note = String(b.note || '').trim().slice(0, 200);
  return errors.length ? { errors } : { entry: { network, month, pending, confirmed, paid, note } };
}

const zero = () => ({ pending: 0, confirmed: 0, paid: 0 });
const add = (a, b) => ({ pending: a.pending + (b.pending || 0), confirmed: a.confirmed + (b.confirmed || 0), paid: a.paid + (b.paid || 0) });

// sources: { admitad, cuelinks } objects with earnings({ month, refresh }) ->
//   { connected, figures: { currency, thisMonth: {pending, confirmed, paid}, total: {...} } | null, error, note }
function createEarnings(db, { sources = {}, connected = {}, now = () => Date.now() } = {}) {
  const rows = () => db.prepare('SELECT * FROM earnings_manual ORDER BY month DESC, network').all().map(r => ({ ...r }));
  const upsert = db.prepare(`INSERT INTO earnings_manual (network, month, pending, confirmed, paid, note, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(network, month) DO UPDATE SET pending = excluded.pending, confirmed = excluded.confirmed,
      paid = excluded.paid, note = excluded.note, updated_at = excluded.updated_at`);

  function save(body) {
    const r = checkEntry(body);
    if (r.errors) return r;
    const e = r.entry;
    upsert.run(e.network, e.month, e.pending, e.confirmed, e.paid, e.note);
    return { entry: e };
  }
  const remove = (network, month) => db.prepare('DELETE FROM earnings_manual WHERE network = ? AND month = ?').run(String(network), String(month)).changes > 0;

  async function report({ refresh = false } = {}) {
    const month = thisMonth(now());
    const manual = rows();
    const networks = await Promise.all(NETWORKS.map(async n => {
      const mine = manual.filter(r => r.network === n.id);
      const typed = { currency: 'INR', thisMonth: mine.filter(r => r.month === month).reduce(add, zero()), total: mine.reduce(add, zero()) };
      const src = sources[n.id];
      let api = null;
      if (src && src.earnings) {
        try { api = await src.earnings({ month, refresh }); } catch (e) { api = { connected: true, error: e.message }; }
      }
      const isConnected = api ? !!api.connected : !!connected[n.id];
      // Use the API's figures when it gave some; otherwise what the owner typed in.
      const useApi = !!(api && api.figures);
      return {
        id: n.id, name: n.name, dashboard: n.dashboard, how: n.how,
        connected: isConnected, auto: !!(src && src.earnings),
        source: useApi ? 'api' : mine.length ? 'manual' : null,
        figures: useApi ? api.figures : mine.length ? typed : null,
        apiError: api && api.error ? api.error : null,
        apiNote: api && api.note ? api.note : null,
        entries: mine,
      };
    }));
    // Totals add up rupee figures only.
    const inr = networks.filter(n => n.figures && n.figures.currency === 'INR');
    const totals = { currency: 'INR', thisMonth: inr.reduce((a, n) => add(a, n.figures.thisMonth), zero()), total: inr.reduce((a, n) => add(a, n.figures.total), zero()) };
    const other = networks.filter(n => n.figures && n.figures.currency !== 'INR').map(n => n.name);
    return { month, networks, totals, notInTotals: other };
  }

  return { report, save, remove, rows };
}

module.exports = { createEarnings, checkEntry, NETWORKS, thisMonth };
