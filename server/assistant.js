// Shopping assistant: a chat where shoppers ask things like "cheapest Tata Tea Gold 1 kg?" or
// "a good phone under ₹20,000" and get Comparezo's prices with Buy links.
//
// It uses Claude (Anthropic's API) with tools that read Comparezo's own catalog. Prices come only
// from the tools, never from the model's memory. Optionally (Admin → Assistant) it can also search
// stores live through Find in stores; each live search uses SerpApi / QuickCommerce credits.
//
// Settings live in the assistant_settings table and are changed on /assistant.html:
//   enabled       show the chat to shoppers (the owner can always try it on /assistant.html)
//   liveSearch    let it search stores live when the catalog has nothing
//   liveLimit     live searches a day, for everyone together
//   dailyLimit    shopper messages a day, for everyone together (protects your Anthropic bill)
//   greeting      the first message shoppers see
//   instructions  extra instructions from the owner (tone, what to recommend...)
// Turned on by ANTHROPIC_API_KEY; ASSISTANT_MODEL picks the model.

const DEFAULTS = {
  enabled: false,
  liveSearch: false,
  liveLimit: 20,
  dailyLimit: 200,
  greeting: 'Hi! Tell me what you want to buy and I\'ll find the cheapest store on Comparezo.',
  instructions: '',
};
const MAX_TURNS = 12;          // messages of history sent to Claude
const MAX_CHARS = 1000;        // per shopper message
const MAX_TOOL_ROUNDS = 5;
const STOP = new Set(['the', 'a', 'an', 'for', 'of', 'with', 'and', 'or', 'in', 'on', 'to', 'me', 'my', 'i', 'is', 'are', 'what', 'which',
  'best', 'cheapest', 'cheap', 'price', 'prices', 'buy', 'under', 'below', 'above', 'rs', 'inr', 'show', 'find', 'want', 'need', 'please', 'good']);

const today = (now = new Date()) => new Date(now.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);   // India date

function createAssistant(db, { apiKey = '', model = 'claude-haiku-5-5', fetch = globalThis.fetch, compareOffers, buyLink,
  liveSearch = null, linkFor = async u => u, timeoutMs = 30000 } = {}) {
  const connected = Boolean(apiKey);

  // ---------- settings and usage ----------
  function settings() {
    const s = { ...DEFAULTS };
    for (const r of db.prepare('SELECT key, value FROM assistant_settings').all()) {
      if (!(r.key in DEFAULTS)) continue;
      try { s[r.key] = JSON.parse(r.value); } catch { /* ignore a bad value */ }
    }
    return s;
  }
  function saveSettings(input) {
    const s = settings(), errors = [];
    const next = { ...s };
    if ('enabled' in input) next.enabled = Boolean(input.enabled);
    if ('liveSearch' in input) next.liveSearch = Boolean(input.liveSearch);
    for (const k of ['liveLimit', 'dailyLimit']) if (k in input) {
      const n = Number(input[k]);
      if (!Number.isInteger(n) || n < 0 || n > 100000) errors.push(`${k === 'liveLimit' ? 'Live searches' : 'Messages'} a day must be a whole number from 0 to 100000.`);
      else next[k] = n;
    }
    if ('greeting' in input) next.greeting = String(input.greeting || '').trim().slice(0, 300) || DEFAULTS.greeting;
    if ('instructions' in input) next.instructions = String(input.instructions || '').trim().slice(0, 2000);
    if (errors.length) return { errors };
    const up = db.prepare('INSERT INTO assistant_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const k of Object.keys(DEFAULTS)) up.run(k, JSON.stringify(next[k]));
    return { settings: next };
  }
  function usageToday() {
    return db.prepare('SELECT * FROM assistant_usage WHERE day = ?').get(today()) || { day: today(), messages: 0, live_searches: 0, input_tokens: 0, output_tokens: 0 };
  }
  function count(field, n = 1) {
    db.prepare(`INSERT INTO assistant_usage (day, ${field}) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET ${field} = ${field} + excluded.${field}`).run(today(), n);
  }
  const usage = (days = 14) => db.prepare('SELECT * FROM assistant_usage ORDER BY day DESC LIMIT ?').all(days);

  // ---------- tools ----------
  const offersFor = db.prepare('SELECT * FROM offers WHERE product_id = ?');
  const words = q => String(q || '').toLowerCase().replace(/[^a-z0-9.+ ]+/g, ' ').split(/\s+/).filter(w => w.length > 1 && !STOP.has(w));

  function summary(p) {
    const c = compareOffers(offersFor.all(p.id));
    if (!c.cheapest) return null;
    return {
      id: p.id, name: p.name, spec: p.spec || undefined, category: [p.category, p.sub_category, p.type].filter(Boolean).join(' › '),
      stores: c.offers.length,
      cheapest: { store: c.cheapest.store, price: c.cheapest.effective, delivery_days: c.cheapest.delivery_days },
      offers: c.offers.slice(0, 6).map(o => ({ store: o.store, price: o.effective, mrp: o.mrp || undefined, delivery_days: o.delivery_days, rating: o.rating || undefined, updated: String(o.updated_at || '').slice(0, 10) })),
      image: p.image || null,
    };
  }

  function searchProducts({ query, max_price, category }) {
    const ws = words(query);
    if (!ws.length && !category) return { results: [], note: 'Give some words to search for.' };
    const fields = "lower(name || ' ' || coalesce(spec,'') || ' ' || category || ' ' || coalesce(sub_category,'') || ' ' || coalesce(type,''))";
    const run = (all) => {
      let sql = `SELECT * FROM products WHERE 1=1`;
      const args = [];
      if (ws.length) { sql += ` AND (${ws.map(() => `${fields} LIKE ?`).join(all ? ' AND ' : ' OR ')})`; args.push(...ws.map(w => `%${w}%`)); }
      if (category) { sql += ` AND (lower(category) LIKE ? OR lower(coalesce(sub_category,'')) LIKE ?)`; args.push(`%${String(category).toLowerCase()}%`, `%${String(category).toLowerCase()}%`); }
      return db.prepare(sql + ' LIMIT 200').all(...args);
    };
    let rows = run(true), loose = false;
    if (!rows.length && ws.length > 1) { rows = run(false); loose = true; }
    // Most words matched first, then cheapest.
    const hay = p => `${p.name} ${p.spec || ''} ${p.category} ${p.sub_category || ''} ${p.type || ''}`.toLowerCase();
    let list = rows.map(p => ({ p, hits: ws.filter(w => hay(p).includes(w)).length })).map(x => ({ ...x, s: summary(x.p) })).filter(x => x.s);
    if (max_price) list = list.filter(x => x.s.cheapest.price <= Number(max_price));
    list.sort((a, b) => b.hits - a.hits || a.s.cheapest.price - b.s.cheapest.price);
    return { results: list.slice(0, 8).map(x => x.s), ...(loose ? { note: 'No product had every word; these match some of them.' } : {}) };
  }

  function getProduct({ id }) {
    const p = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(id));
    if (!p) return { error: 'No product with that id.' };
    const c = compareOffers(offersFor.all(p.id));
    return { id: p.id, name: p.name, spec: p.spec, category: [p.category, p.sub_category, p.type].filter(Boolean).join(' › '),
      offers: c.offers.map(o => ({ store: o.store, price: o.price, mrp: o.mrp || undefined, delivery_fee: o.delivery_fee || 0, coupon: o.coupon || 0,
        total: o.effective, delivery_days: o.delivery_days, rating: o.rating || undefined, updated: String(o.updated_at || '').slice(0, 10) })),
      savings: c.savings };
  }

  async function searchStores({ query }, ctx) {
    const s = settings();
    if (!liveSearch || !s.liveSearch) return { error: 'Live store search is turned off.' };
    if (usageToday().live_searches >= s.liveLimit) return { error: 'Today\'s live store searches are used up.' };
    count('live_searches');
    const r = await liveSearch(String(query || '').slice(0, 120));
    const exact = (r.results || []).filter(x => x.match === 'exact');
    const list = (exact.length ? exact : r.results || []).slice(0, 8);
    const out = [];
    for (const x of list) {
      const key = `L${ctx.live.length + out.length + 1}`;
      out.push({ ref: key, store: x.store, title: x.title, price: x.price, same_product: x.match === 'exact' });
      ctx.liveById[key] = { store: x.store, title: x.title, price: x.price, url: x.url };
    }
    return { results: out, note: 'Live prices right now. They are not saved on Comparezo.' };
  }

  const TOOLS = [
    { name: 'search_products', description: 'Search the Comparezo catalog. Returns products with their cheapest store and price (rupees, delivery and coupons included). Use short product words, e.g. "tata tea gold 1 kg" or "pixel 11".',
      input_schema: { type: 'object', properties: { query: { type: 'string' }, max_price: { type: 'number', description: 'Only products whose cheapest price is at most this, in rupees.' }, category: { type: 'string' } }, required: ['query'] } },
    { name: 'get_product', description: 'Every store\'s price for one product: price, delivery fee, coupon, total, delivery days, rating.',
      input_schema: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] } },
    { name: 'show_products', description: 'Show product cards with Buy buttons under your answer. Call it once, last, with the products you recommend (most relevant first, at most 4). Products from search_products/get_product use their id; live results use their ref (e.g. "L1").',
      input_schema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'integer' } }, refs: { type: 'array', items: { type: 'string' } } } } },
  ];
  const LIVE_TOOL = { name: 'search_stores', description: 'Search online stores live (Amazon, Flipkart, Blinkit, Zepto...) when the Comparezo catalog has nothing suitable. Uses paid credits, so call it at most once per question and only after search_products found nothing useful.',
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Exact product with size, e.g. "Tata Tea Gold 1 kg"' } }, required: ['query'] } };

  function system(s) {
    return [
      'You are the shopping assistant on Comparezo, an Indian price-comparison site. You help shoppers find where a product is cheapest.',
      'Rules:',
      '- Use the tools for every price, store and product. Never state a price, store or product that a tool did not return. If nothing is found, say so plainly and suggest a different wording.',
      '- Prices are in Indian rupees; write them like ₹1,299. "price" in tool results already includes delivery fees and coupons.',
      '- Keep answers short: a sentence or two, then the key facts. Name the cheapest store and its price, and the saving versus the dearest store when useful.',
      '- Prices were last checked on the date shown ("updated"); mention it if it is more than a few days old. Stock and prices at the store may differ.',
      '- Finish by calling show_products with the products you recommend, so the shopper gets Buy buttons. Do not write links or URLs yourself.',
      '- Only help with shopping and Comparezo. Politely decline anything else. Do not give medical, legal or financial advice.',
      '- Comparezo may earn a commission when shoppers buy through its links, at no extra cost to them. Say so if asked.',
      '- Reply in the language the shopper writes in (English, Hindi, Hinglish...).',
      s.liveSearch && liveSearch ? '- If the catalog has nothing suitable, you may call search_stores once to check stores live.' : '- You can only search the Comparezo catalog.',
      s.instructions ? `Extra instructions from the Comparezo owner:\n${s.instructions}` : '',
    ].filter(Boolean).join('\n');
  }

  async function callClaude(body) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify(body), signal: ctl.signal,
      });
      const data = await r.json().catch(() => ({}));
      if (r.status === 401) throw new Error('The Anthropic API key is not valid. Check ANTHROPIC_API_KEY.');
      if (r.status === 429 || r.status === 529) throw new Error('The assistant is busy. Please try again in a minute.');
      if (!r.ok) throw new Error((data.error && data.error.message) || `Anthropic API answered ${r.status}`);
      return data;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('The assistant took too long to answer. Please try again.');
      throw e;
    } finally { clearTimeout(t); }
  }

  // ---------- one chat turn ----------
  // messages: [{ role: 'user'|'assistant', content: 'text' }, ...], ending with the shopper's message.
  async function chat(messages, { owner = false } = {}) {
    if (!connected) return { status: 503, error: 'The assistant is not set up yet.' };
    const s = settings();
    if (!owner && !s.enabled) return { status: 403, error: 'The assistant is turned off.' };
    if (!owner && usageToday().messages >= s.dailyLimit) return { status: 429, error: 'The assistant has answered as many questions as it can today. Please try again tomorrow, or search above.' };

    const history = (Array.isArray(messages) ? messages : [])
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .slice(-MAX_TURNS).map(m => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));
    while (history.length && history[0].role !== 'user') history.shift();
    if (!history.length || history[history.length - 1].role !== 'user') return { status: 400, error: 'Send a question.' };

    count('messages');
    const tools = s.liveSearch && liveSearch ? [...TOOLS, LIVE_TOOL] : TOOLS;
    const ctx = { live: [], liveById: {} };
    let shown = null;
    const convo = history.slice();
    let text = '';
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const res = await callClaude({ model, max_tokens: 900, system: system(s), tools, messages: convo });
      count('input_tokens', (res.usage && res.usage.input_tokens) || 0);
      count('output_tokens', (res.usage && res.usage.output_tokens) || 0);
      const blocks = res.content || [];
      text = blocks.filter(b => b.type === 'text').map(b => b.text).join('\n').trim() || text;
      const uses = blocks.filter(b => b.type === 'tool_use');
      if (res.stop_reason !== 'tool_use' || !uses.length || round === MAX_TOOL_ROUNDS) break;
      convo.push({ role: 'assistant', content: blocks });
      const results = [];
      for (const u of uses) {
        let out;
        try {
          if (u.name === 'search_products') out = searchProducts(u.input || {});
          else if (u.name === 'get_product') out = getProduct(u.input || {});
          else if (u.name === 'search_stores') out = await searchStores(u.input || {}, ctx);
          else if (u.name === 'show_products') { shown = u.input || {}; out = { ok: true }; }
          else out = { error: 'Unknown tool.' };
        } catch (e) { out = { error: e.message }; }
        results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out) });
      }
      convo.push({ role: 'user', content: results });
    }

    // Cards with Buy buttons for what the assistant chose to show.
    const products = [];
    for (const id of ((shown && shown.ids) || []).slice(0, 4)) {
      const p = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(id));
      if (!p) continue;
      const c = compareOffers(offersFor.all(p.id));
      if (!c.cheapest) continue;
      products.push({ id: p.id, name: p.name, image: p.image || null, store: c.cheapest.store, price: c.cheapest.effective,
        stores: c.offers.length, buyUrl: buyLink(c.cheapest, p) });
    }
    const live = [];
    for (const ref of ((shown && shown.refs) || []).slice(0, 4)) {
      const x = ctx.liveById[ref];
      if (x && x.url) live.push({ store: x.store, title: x.title, price: x.price, buyUrl: await linkFor(x.url) });
    }
    return { reply: text || 'Sorry, I could not find an answer. Try asking another way.', products, live };
  }

  return { connected, model, settings, saveSettings, usage, usageToday, chat, searchProducts, getProduct };
}

module.exports = { createAssistant, DEFAULTS, today };
