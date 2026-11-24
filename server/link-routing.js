// Which store links Cuelinks can pay for, and which links should be left exactly as they are.
//
// Cuelinks' "Unmonetized traffic" report (checked 2026-11-24) showed clicks it could not pay for:
//  - Stores that are not live on Cuelinks: amazon.in (Cuelinks doesn't pay on Amazon), cashify.in,
//    alonge.in. Those go through EarnKaro, Aff Alliances, INRDeals or Admitad instead, never Cuelinks.
//    More can be added with CUELINKS_SKIP ("domain, domain" or one per line).
//  - Comparezo's own sites (comparezo.onrender.com, vishalsaxen.github.io…). Those are internal links,
//    so they are never sent to an affiliate network.
//  - Links that already are affiliate redirects (bit.ly, linksredirect.com, ypetp.com, EarnKaro…).
//    They earn through their own network, so they are not wrapped again. More can be added with
//    AFFILIATE_REDIRECT_HOSTS.
// A link matches a domain when its host is that domain or a subdomain of it.

const NOT_ON_CUELINKS = ['amazon.in', 'amazon.com', 'amzn.in', 'cashify.in', 'alonge.in'];
const OWN_SITES = ['comparezo.giazonest.com', 'comparezo.web.app', 'comparezo.firebaseapp.com', 'comparezo.onrender.com', 'vishalsaxen.github.io', 'localhost'];
const REDIRECTORS = ['linksredirect.com', 'ypetp.com', 'bit.ly', 'bitly.com', 'bilty.co', 'amzn.to', 'ekaro.in', 'fkrt.it', 'fktr.in', 'myntr.it', 'ajiio.in', 'extp.in', 'linkinr.com', 'admitad.com', 'ad.admitad.com'];

const cleanDomain = d => String(d || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[/?#:].*$/, '');
const list = text => String(text || '').split(/[\s,;]+/).map(cleanDomain).filter(d => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d));
const hostOf = url => { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } };
const matches = (host, domains) => !!host && domains.some(d => host === d || host.endsWith('.' + d));

function createLinkRouting({ cuelinksSkip = '', redirectHosts = '' } = {}) {
  const skip = [...new Set([...NOT_ON_CUELINKS, ...list(cuelinksSkip)])];
  const redirectors = [...new Set([...REDIRECTORS, ...list(redirectHosts)])];
  return {
    // Our own pages: never wrapped in an affiliate link.
    isOwnSite: url => matches(hostOf(url), OWN_SITES),
    // Already an affiliate redirect: send the shopper through it unchanged.
    isRedirect: url => matches(hostOf(url), redirectors),
    // A store Cuelinks doesn't pay for: don't fall back to a Cuelinks link.
    cuelinksPays: url => !matches(hostOf(url), skip),
    notOnCuelinks: skip,
  };
}

module.exports = { createLinkRouting, NOT_ON_CUELINKS, OWN_SITES, REDIRECTORS };
