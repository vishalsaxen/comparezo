// What the customer actually pays at a store, and which store is cheapest.

function effectivePrice(offer, { includeExtras = true } = {}) {
  if (!includeExtras) return offer.price;
  return Math.max(0, offer.price + (offer.delivery_fee || 0) - (offer.coupon || 0));
}

// Cheapest by effective price; ties go to the faster delivery.
function compareOffers(offers, opts = {}) {
  const rows = offers.map(o => ({ ...o, effective: effectivePrice(o, opts) }));
  if (!rows.length) return { offers: [], cheapest: null, savings: 0, fastestDays: null };
  const cheapest = rows.reduce((a, b) =>
    b.effective < a.effective || (b.effective === a.effective && b.delivery_days < a.delivery_days) ? b : a);
  const costliest = Math.max(...rows.map(r => r.effective));
  const fastestDays = Math.min(...rows.map(r => r.delivery_days));
  rows.sort((a, b) => a.effective - b.effective || a.delivery_days - b.delivery_days);
  return { offers: rows, cheapest, savings: costliest - cheapest.effective, fastestDays };
}

module.exports = { effectivePrice, compareOffers };
