// INRDeals (inrdeals.com) is an Indian affiliate network. Approved publishers make tracking links
// on publisher.inrdeals.com (Link Generator) that look like:
//   https://linkinr.com/?campaign_id=u0wYtw&inventory_id=mZnr6J&url=https%3A%2F%2Fwww.biba.in%2F
// campaign_id is the store's campaign, inventory_id is the publisher's website, url is the page.
//
// INRDeals does have publisher APIs (transactions, coupon feed, stores), but each needs API access
// that the publisher must request first (Profile menu -> API Key -> Request API Access, checked
// 2026-11-20). Until then this module only builds links, from the owner's own example links in
// INRDEALS_LINKS: paste one generated link per store, separated by new lines or ";". The store is
// read from the link's url= part; "<store domain>=<link>" works too. Any page on that store then
// gets the same campaign_id and inventory_id with its own url.
// A store link matches an entry when its host is the domain or a subdomain of it.

const cleanDomain = d => String(d || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[/?#].*$/, '');

function parseOne(part) {
  part = part.trim();
  if (!part) return null;
  let domain = '', link = part;
  const m = part.match(/^([^=\s]+)=(https:\/\/.+)$/);
  if (m && !/^https?:/i.test(m[1])) { domain = cleanDomain(m[1]); link = m[2].trim(); }
  let u;
  try { u = new URL(link); } catch { return null; }
  if (u.protocol !== 'https:' || !/(^|\.)linkinr\.com$/.test(u.hostname)) return null;
  const campaign = u.searchParams.get('campaign_id') || '';
  const inventory = u.searchParams.get('inventory_id') || '';
  if (!/^[A-Za-z0-9_-]{2,40}$/.test(campaign) || !/^[A-Za-z0-9_-]{2,40}$/.test(inventory)) return null;
  if (!domain) { try { domain = cleanDomain(new URL(u.searchParams.get('url') || '').hostname); } catch { return null; } }
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return null;
  return { domain, campaign, inventory, base: `${u.origin}${u.pathname}` };
}

function parseLinks(text = '') {
  const map = [];
  for (const part of String(text).split(/[\n;]+/)) {
    const e = parseOne(part);
    if (e && !map.some(x => x.domain === e.domain)) map.push(e);
  }
  // Longest domain first, so shop.example.com beats example.com.
  return map.sort((a, b) => b.domain.length - a.domain.length);
}

function createInrDeals({ links = '' } = {}) {
  const entries = parseLinks(links);

  // The INRDeals tracking link for a store link, or null if no campaign covers that store.
  function convert(url) {
    let host;
    try { const u = new URL(url); if (u.protocol !== 'https:') return null; host = u.hostname.toLowerCase(); } catch { return null; }
    const e = entries.find(x => host === x.domain || host.endsWith('.' + x.domain));
    if (!e) return null;
    const q = new URLSearchParams({ campaign_id: e.campaign, inventory_id: e.inventory, url });
    return `${e.base}?${q}`;
  }

  return { convert, connected: entries.length > 0, stores: entries.map(e => e.domain) };
}

module.exports = { createInrDeals, parseLinks };
