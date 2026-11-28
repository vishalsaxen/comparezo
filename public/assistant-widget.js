// Shopping assistant chat (server/assistant.js).
// On the shop page: a floating "Ask Comparezo" button, shown only when the owner turned the assistant
// on (Admin → Assistant). On /assistant.html the same chat is mounted inline for the owner to try,
// sending the admin key so it works even while it's off for shoppers.
(() => {
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = n => n == null ? '' : '₹' + Number(n).toLocaleString('en-IN');
const apiUrl = u => (u && u.startsWith('/api/') ? (window.CZ_API || '') : '') + (u || '');
const safe = u => /^(https?:\/\/|\/api\/)/i.test(u || '') ? apiUrl(u) : '#';
// **bold** and line breaks only; everything else is shown as text.
const fmt = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');

// Builds a chat inside `box`. opts: { greeting, adminKey: () => string, onShowProduct(id, name) }
function mountChat(box, opts = {}) {
  const history = [];   // { role, content }
  box.innerHTML = `
    <div class="ac-log" aria-live="polite"></div>
    <form class="ac-form">
      <label class="sr-only" for="${box.id || 'ac'}-q">Ask about a product</label>
      <input id="${box.id || 'ac'}-q" class="ac-input" autocomplete="off" maxlength="1000" placeholder="e.g. Cheapest Tata Tea Gold 1 kg?">
      <button class="btn btn-brand ac-send" type="submit">Ask</button>
    </form>
    <div class="ac-foot">Answers use Comparezo's prices. Comparezo may earn a commission on purchases.</div>`;
  const log = box.querySelector('.ac-log'), form = box.querySelector('.ac-form'), input = box.querySelector('.ac-input'), send = box.querySelector('.ac-send');

  const bubble = (cls, html) => { const d = document.createElement('div'); d.className = 'ac-msg ' + cls; d.innerHTML = html; log.appendChild(d); log.scrollTop = log.scrollHeight; return d; };
  if (opts.greeting) bubble('bot', fmt(opts.greeting));

  function cards(r) {
    const p = (r.products || []).map(x => `
      <div class="ac-card">
        <div class="ac-card-t">${esc(x.name)}</div>
        <div class="ac-card-p"><span class="num">${inr(x.price)}</span> on ${esc(x.store)}${x.stores > 1 ? ` <span class="sub">· ${x.stores} stores</span>` : ''}</div>
        <div class="ac-card-a">
          ${x.buyUrl ? `<a class="btn btn-brand" href="${esc(safe(x.buyUrl))}" target="_blank" rel="noopener noreferrer sponsored">Buy on ${esc(x.store)} ↗</a>` : ''}
          <button type="button" class="btn btn-ghost" data-show="${x.id}" data-name="${esc(x.name)}">All prices</button>
        </div>
      </div>`).join('');
    const l = (r.live || []).map(x => `
      <div class="ac-card">
        <div class="ac-card-t">${esc(x.title)}</div>
        <div class="ac-card-p"><span class="num">${inr(x.price)}</span> on ${esc(x.store)} <span class="sub">· live price</span></div>
        <div class="ac-card-a"><a class="btn btn-brand" href="${esc(safe(x.buyUrl))}" target="_blank" rel="noopener noreferrer sponsored">Buy on ${esc(x.store)} ↗</a></div>
      </div>`).join('');
    return p || l ? `<div class="ac-cards">${p}${l}</div>` : '';
  }

  log.addEventListener('click', e => {
    const b = e.target.closest('[data-show]');
    if (b && opts.onShowProduct) opts.onShowProduct(Number(b.dataset.show), b.dataset.name);
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q || send.disabled) return;
    input.value = '';
    bubble('me', esc(q));
    history.push({ role: 'user', content: q });
    const wait = bubble('bot ac-wait', '<span class="ac-dots"><i></i><i></i><i></i></span> Checking prices…');
    send.disabled = true;
    try {
      const key = opts.adminKey ? opts.adminKey() : '';
      const r = await fetch('/api/assistant/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { 'X-Admin-Key': key } : {}) }, body: JSON.stringify({ messages: history.slice(-12) }) });
      const d = await r.json().catch(() => ({}));
      wait.remove();
      if (!r.ok) { bubble('bot ac-err', esc(d.error || 'Something went wrong. Please try again.')); history.pop(); return; }
      bubble('bot', fmt(d.reply) + cards(d));
      history.push({ role: 'assistant', content: d.reply });
      opts.onAnswer && opts.onAnswer(d);
    } catch {
      wait.remove();
      bubble('bot ac-err', 'Could not reach Comparezo. Check your connection and try again.');
      history.pop();
    } finally { send.disabled = false; input.focus(); }
  });
  return { focus: () => input.focus() };
}
window.czMountChat = mountChat;

// ---------- floating button on the shop page ----------
if (!document.getElementById('assistantPage')) {
  fetch('/api/assistant/config').then(r => r.ok ? r.json() : null).then(cfg => {
    if (!cfg || !cfg.enabled) return;
    const fab = document.createElement('button');
    fab.type = 'button'; fab.className = 'ac-fab'; fab.setAttribute('aria-expanded', 'false'); fab.setAttribute('aria-controls', 'acPanel');
    fab.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg><span>Ask Comparezo</span>';
    const panel = document.createElement('section');
    panel.id = 'acPanel'; panel.className = 'ac-panel'; panel.hidden = true; panel.setAttribute('aria-label', 'Shopping assistant');
    panel.innerHTML = '<div class="ac-head"><strong>Ask Comparezo</strong><button type="button" class="ac-x" aria-label="Close">×</button></div><div class="ac-body" id="acChat"></div>';
    document.body.append(panel, fab);
    let chat = null;
    const toggle = open => {
      panel.hidden = !open; fab.setAttribute('aria-expanded', String(open)); fab.hidden = open;
      if (open) { chat = chat || mountChat(panel.querySelector('#acChat'), { greeting: cfg.greeting, onShowProduct: (id, name) => { window.czShowProduct && window.czShowProduct(id, name); if (matchMedia('(max-width:600px)').matches) toggle(false); } }); chat.focus(); }
    };
    fab.addEventListener('click', () => toggle(true));
    panel.querySelector('.ac-x').addEventListener('click', () => toggle(false));
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) toggle(false); });
  }).catch(() => {});
}
})();
