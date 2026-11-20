// Clicks on Super Saver Deals. Every "Get deal" button goes through our server (/api/go/deal/<id>,
// /api/go/admitad/<id>, /api/go/cuelinks/<id>), which counts the click here before sending the
// shopper on. One row per deal per day (India time) in deal_clicks, kept in Firestore like the rest.
//
// Earnings per deal: the networks only tell us what a deal earned if the link carries a sub ID.
// So deal links to Admitad and Cuelinks get subid=deals-<deal id> added (see subidFor), and the
// Admitad sub-ID report is read back on the Earnings page. EarnKaro links carry no sub ID, so
// EarnKaro earnings can't be split per deal.

const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|headless|lighthouse|curl|wget|python|axios|node-fetch/i;
const DEDUPE_MS = 30 * 1000;   // the same shopper clicking the same deal twice within 30 s counts once

const indiaDay = (t = Date.now()) => new Date(t + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const subidFor = deal => `deals-${String(deal).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 100)}`;
const networkOf = deal => (deal.startsWith('admitad-') ? 'Admitad' : deal.startsWith('cuelinks-') ? 'Cuelinks' : 'Your deal');

function createDealClicks(db, { now = () => Date.now(), onClick = null } = {}) {
  const upsert = db.prepare(`INSERT INTO deal_clicks (deal, day, clicks, title, store, last_at) VALUES (?, ?, 1, ?, ?, ?)
    ON CONFLICT(deal, day) DO UPDATE SET clicks = clicks + 1, title = COALESCE(excluded.title, title), store = COALESCE(excluded.store, store), last_at = excluded.last_at`);
  const recent = new Map();   // "ip|deal" -> time

  // Count one click. Returns false when it was skipped (a bot, a link preview or a double click).
  function record(req, { deal, title = null, store = null }) {
    if (req.method !== 'GET') return false;
    const ua = String(req.get('user-agent') || '');
    if (!ua || BOT.test(ua) || /prefetch|prerender/i.test(String(req.get('purpose') || req.get('sec-purpose') || ''))) return false;
    const t = now();
    // Render sits behind a proxy, so the shopper's address is the first one in X-Forwarded-For.
    const ip = String(req.get('x-forwarded-for') || '').split(',')[0].trim() || req.ip;
    const who = `${ip}|${ua}|${deal}`;
    if (t - (recent.get(who) || 0) < DEDUPE_MS) return false;
    recent.set(who, t);
    if (recent.size > 5000) for (const [k, at] of recent) if (t - at >= DEDUPE_MS) recent.delete(k);
    upsert.run(String(deal), indiaDay(t), title ? String(title).slice(0, 160) : null, store ? String(store).slice(0, 60) : null, new Date(t).toISOString());
    if (onClick) onClick();
    return true;
  }

  // Clicks for the owner: totals, clicks per day for the last `days` days, and one row per deal.
  // `earned` maps a sub ID to { pending, confirmed, currency } from the networks that report sub IDs.
  function report({ days = 30, live = [], earned = {} } = {}) {
    days = [7, 30, 90, 365].includes(Number(days)) ? Number(days) : 30;
    const t = now(), today = indiaDay(t);
    const dayAgo = n => indiaDay(t - n * 86400 * 1000);
    const from = dayAgo(days - 1);
    const sum = since => db.prepare('SELECT COALESCE(SUM(clicks), 0) AS n FROM deal_clicks WHERE day >= ?').get(since).n;
    const totals = { today: sum(today), last7: sum(dayAgo(6)), last30: sum(dayAgo(29)), allTime: sum('0000') };

    const byDay = new Map(db.prepare('SELECT day, SUM(clicks) AS n FROM deal_clicks WHERE day >= ? GROUP BY day').all(from).map(r => [r.day, r.n]));
    const perDay = Array.from({ length: days }, (_, i) => { const d = dayAgo(days - 1 - i); return { day: d, clicks: byDay.get(d) || 0 }; });

    const liveById = new Map(live.map(d => [d.id, d]));
    const rows = db.prepare(`SELECT deal, SUM(CASE WHEN day >= ? THEN clicks ELSE 0 END) AS clicks, SUM(clicks) AS all_time, MAX(last_at) AS last_at,
        (SELECT title FROM deal_clicks c2 WHERE c2.deal = c.deal AND title IS NOT NULL ORDER BY day DESC LIMIT 1) AS title,
        (SELECT store FROM deal_clicks c2 WHERE c2.deal = c.deal AND store IS NOT NULL ORDER BY day DESC LIMIT 1) AS store
      FROM deal_clicks c GROUP BY deal ORDER BY clicks DESC, all_time DESC, last_at DESC LIMIT 500`).all(from);
    const deals = rows.map(r => {
      const l = liveById.get(r.deal);
      return { deal: r.deal, network: networkOf(r.deal), title: (l && l.title) || r.title || r.deal, store: (l && l.store) || r.store || '',
        clicks: r.clicks, allTime: r.all_time, lastAt: r.last_at, live: !!l, earned: earned[subidFor(r.deal)] || null };
    });
    return { days, from, to: today, totals, perDay, deals, liveDeals: live.length, clickedDeals: deals.length };
  }

  return { record, report };
}

module.exports = { createDealClicks, subidFor, indiaDay, BOT };
