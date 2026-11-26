// Is a listing the exact product that was searched for, or a different model, size or an accessory?
// Used by "Find in stores" so "Google Pixel 11 128GB" doesn't count a Pixel 11 Pro, a Pixel 11a,
// the 256GB model, a phone case or a renewed phone as the same product.

const BRANDS = new Set(['google', 'apple', 'samsung', 'oneplus', 'xiaomi', 'redmi', 'realme', 'vivo', 'oppo',
  'motorola', 'moto', 'nothing', 'iqoo', 'poco', 'sony', 'hp', 'dell', 'lenovo', 'asus', 'acer', 'boat', 'jbl', 'lg', 'mi']);
const STOP = new Set(['the', 'a', 'an', 'with', 'for', 'and', 'of', 'in', 'to', 'by', 'on', 'new', 'phone', 'mobile',
  'smartphone', 'price', 'buy', 'online', 'india', 'latest', 'unlocked', '5g', '4g', 'dual', 'sim']);
const COLOURS = new Set(['black', 'white', 'blue', 'green', 'red', 'pink', 'purple', 'grey', 'gray', 'silver', 'gold',
  'obsidian', 'porcelain', 'hazel', 'rose', 'mint', 'lemongrass', 'peony', 'aloe', 'bay', 'graphite', 'titanium',
  'cream', 'yellow', 'orange', 'violet', 'lavender', 'midnight', 'starlight', 'natural', 'beige', 'brown', 'navy']);
// Words that make it a different model when the search didn't include them.
const VARIANTS = ['pro', 'xl', 'fold', 'flip', 'mini', 'max', 'plus', 'ultra', 'lite', 'fe', 'neo', 'edge', 'prime'];
// Accessories, spare parts and items that aren't new.
const NOT_THE_PRODUCT = ['case', 'cover', 'tempered', 'protector', 'screen guard', 'screenguard', 'charger', 'cable',
  'adapter', 'skin', 'pouch', 'holder', 'stand for', 'strap', 'sticker', 'mount', 'lens guard', 'camera guard',
  'back glass', 'replacement', 'battery for', 'display for', 'housing', 'dummy', 'compatible with',
  'refurbished', 'renewed', 'pre owned', 'preowned', 'used', 'unboxed'];

function norm(text) {
  return String(text || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/(\d+)\s*(gb|tb)\b/g, '$1$2')   // "128 GB" -> "128gb"
    .replace(/[^a-z0-9+]+/g, ' ').trim();
}
const isSize = t => /^\d+(gb|tb)$/.test(t);

function parseQuery(q) {
  const all = norm(q).split(' ').filter(t => t && !STOP.has(t));
  return {
    required: all.filter(t => !BRANDS.has(t) && !COLOURS.has(t) && !isSize(t)),
    sizes: all.filter(isSize),
    variants: all.filter(t => VARIANTS.includes(t)),
    // The rules only make sense for things with model numbers or sizes (phones, laptops, earbuds).
    applies: all.some(t => /\d/.test(t)),
  };
}

// { ok, reason?, sizeConfirmed? }
function checkVariant(q, title) {
  const query = typeof q === 'string' ? parseQuery(q) : q;
  const t = norm(title), words = t.split(' ');
  const has = w => words.includes(w);
  if (!query.applies) return { ok: true, sizeConfirmed: true };
  if (NOT_THE_PRODUCT.some(w => (' ' + t + ' ').includes(' ' + w + ' '))) return { ok: false, reason: 'accessory or not new' };
  const missing = query.required.filter(w => !has(w));
  if (missing.length) {
    const near = words.find(x => missing.some(m => x !== m && x.startsWith(m) && /\d/.test(m)));
    return { ok: false, reason: near ? `different model (${near})` : `missing "${missing.join(' ')}"` };
  }
  const extra = VARIANTS.find(v => has(v) && !query.variants.includes(v));
  if (extra) return { ok: false, reason: `different model (${extra})` };
  if (query.sizes.length && !query.sizes.every(has)) {
    const other = words.filter(isSize);
    if (other.length) return { ok: false, reason: `different size (${other.join('/')})` };
    return { ok: true, sizeConfirmed: false };
  }
  return { ok: true, sizeConfirmed: true };
}

module.exports = { checkVariant, parseQuery, norm };
