// Where "Buy here" sends a shopper. A real offer URL from a store feed wins.
// Until feeds are connected, we open the store's own search for the product name.
const SEARCH = {
  'Amazon.in': q => `https://www.amazon.in/s?k=${encodeURIComponent(q)}`,
  'Flipkart': q => `https://www.flipkart.com/search?q=${encodeURIComponent(q)}`,
  'Meesho': q => `https://www.meesho.com/search?q=${encodeURIComponent(q)}`,
  'Myntra': q => `https://www.myntra.com/${encodeURIComponent(q.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))}`,
  'JioMart': q => `https://www.jiomart.com/search/${encodeURIComponent(q)}`,
  'Snapdeal': q => `https://www.snapdeal.com/search?keyword=${encodeURIComponent(q)}`,
};

function buyUrl(offer, productName) {
  if (offer.url && /^https:\/\//.test(offer.url)) return offer.url;
  const search = SEARCH[offer.store];
  return search ? search(productName) : null;
}

module.exports = { buyUrl };
