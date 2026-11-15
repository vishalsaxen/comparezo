// Aff Alliances (affalliances.com) is an Indian CPA/CPS affiliate network. It has no public
// publisher API (checked 2026-11-15: no API keys, deeplink, coupon or report endpoints on the
// site or in the publisher account). Approved publishers get tracking links per offer from
// their account manager / offer page instead.
//
// So this module only uses those tracking links, set by the owner in AFFALLIANCES_LINKS:
//   one entry per store, "<store domain>=<tracking link>", separated by new lines or ";".
//   If the tracking link contains {url}, the shopper's store link is put there (URL-encoded),
//   which is how deeplinks usually work. Without {url}, the shopper goes to the offer's own
//   landing page (fine for whole-store offers such as Lenovo India).
// Example:
//   AFFALLIANCES_LINKS=lenovo.com=https://track.example/click?o=12&a=34&url={url};asus.com=https://track.example/click?o=56&a=34
// A store link matches an entry when its host is the domain or a subdomain of it.

function parseLinks(text = '') {
  const map = [];
  for (const part of String(text).split(/[\n;]+/)) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const domain = part.slice(0, i).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
    const template = part.slice(i + 1).trim();
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) || !/^https:\/\/\S+$/.test(template)) continue;
    map.push({ domain, template });
  }
  // Longest domain first, so shop.example.com beats example.com.
  return map.sort((a, b) => b.domain.length - a.domain.length);
}

function createAffAlliances({ links = '' } = {}) {
  const entries = parseLinks(links);

  // The Aff Alliances tracking link for a store link, or null if no offer covers that store.
  function convert(url) {
    let host;
    try { const u = new URL(url); if (u.protocol !== 'https:') return null; host = u.hostname.toLowerCase(); } catch { return null; }
    const e = entries.find(x => host === x.domain || host.endsWith('.' + x.domain));
    if (!e) return null;
    return e.template.includes('{url}') ? e.template.split('{url}').join(encodeURIComponent(url)) : e.template;
  }

  return { convert, connected: entries.length > 0, stores: entries.map(e => e.domain) };
}

module.exports = { createAffAlliances, parseLinks };
