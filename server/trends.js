// Linezo: sales trends built from recorded customer purchases.

function isoDay(d) { return d.toISOString().slice(0, 10); }

function getTrends(db, { days = 30, category = null, now = new Date() } = {}) {
  days = Math.min(Math.max(parseInt(days, 10) || 30, 7), 365);
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const prevStart = new Date(start);
  prevStart.setUTCDate(prevStart.getUTCDate() - days);

  const where = 'created_at >= ? AND created_at < ?' + (category ? ' AND category = ?' : '');
  const end = new Date(now); end.setUTCHours(24, 0, 0, 0);
  const args = (from, to) => [from.toISOString().replace('T', ' ').slice(0, 19), to.toISOString().replace('T', ' ').slice(0, 19), ...(category ? [category] : [])];

  const dailyRows = db.prepare(
    `SELECT substr(created_at,1,10) AS day, SUM(quantity) AS units, SUM(amount*quantity) AS revenue
     FROM purchases WHERE ${where} GROUP BY day ORDER BY day`).all(...args(start, end));
  const byDay = new Map(dailyRows.map(r => [r.day, r]));
  const daily = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start); d.setUTCDate(d.getUTCDate() + i);
    const r = byDay.get(isoDay(d));
    daily.push({ day: isoDay(d), units: r ? Number(r.units) : 0, revenue: r ? Number(r.revenue) : 0 });
  }

  const totals = db.prepare(`SELECT COALESCE(SUM(quantity),0) AS units, COALESCE(SUM(amount*quantity),0) AS revenue FROM purchases WHERE ${where}`);
  const cur = totals.get(...args(start, end));
  const prev = totals.get(...args(prevStart, start));

  const byStore = db.prepare(
    `SELECT store, SUM(quantity) AS units, SUM(amount*quantity) AS revenue FROM purchases WHERE ${where}
     GROUP BY store ORDER BY units DESC`).all(...args(start, end)).map(n);
  const byCategory = db.prepare(
    `SELECT category, SUM(quantity) AS units, SUM(amount*quantity) AS revenue FROM purchases WHERE ${where}
     GROUP BY category ORDER BY units DESC`).all(...args(start, end)).map(n);
  const topProducts = db.prepare(
    `SELECT COALESCE(p.name, l.title) AS name, pu.category, SUM(pu.quantity) AS units, SUM(pu.amount*pu.quantity) AS revenue,
            CASE WHEN pu.listing_id IS NOT NULL THEN 1 ELSE 0 END AS individual
     FROM purchases pu LEFT JOIN products p ON p.id = pu.product_id LEFT JOIN listings l ON l.id = pu.listing_id
     WHERE ${where.replace(/created_at/g, 'pu.created_at').replace('category', 'pu.category')}
     GROUP BY COALESCE(pu.product_id, -pu.listing_id) ORDER BY units DESC LIMIT 8`).all(...args(start, end)).map(n);

  const pct = (a, b) => (b ? Math.round(((a - b) / b) * 1000) / 10 : null);
  return {
    days, category,
    from: isoDay(start), to: isoDay(new Date(end.getTime() - 1)),
    totals: {
      units: Number(cur.units), revenue: Number(cur.revenue),
      unitsChangePct: pct(Number(cur.units), Number(prev.units)),
      revenueChangePct: pct(Number(cur.revenue), Number(prev.revenue)),
      avgOrder: cur.units ? Math.round(Number(cur.revenue) / Number(cur.units)) : 0,
    },
    daily, byStore, byCategory, topProducts,
  };
}

function n(r) { return { ...r, units: Number(r.units), revenue: Number(r.revenue) }; }

module.exports = { getTrends };
