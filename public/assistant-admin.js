// Admin → Assistant: switch the shopping assistant on for shoppers, set its limits, and try it.
// Uses the same admin key as Add products, Earnings and Linezo.
(() => {
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const keyStore = {
  get() { try { return localStorage.getItem('cz-admin-key') || ''; } catch { return ''; } },
  set(v) { try { localStorage.setItem('cz-admin-key', v); } catch { /* private mode */ } },
  clear() { try { localStorage.removeItem('cz-admin-key'); } catch { /* private mode */ } },
};
let key = keyStore.get(), chatMounted = false;

let toastTimer;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3200); }
async function call(method, url, body) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-Admin-Key': key }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error((data.errors || []).join(' ') || data.error || 'Request failed'), { status: r.status });
  return data;
}
function locked(msg) { $('board').hidden = true; $('controls').hidden = true; $('keyForm').hidden = false; $('keyStatus').textContent = msg || ''; }

function render(d) {
  const s = d.settings;
  $('enabled').checked = s.enabled; $('liveSearch').checked = s.liveSearch;
  $('dailyLimit').value = s.dailyLimit; $('liveLimit').value = s.liveLimit;
  $('greeting').value = s.greeting; $('instructions').value = s.instructions;
  $('setupNote').hidden = d.connected;
  const on = d.connected && s.enabled;
  $('liveBadge').textContent = on ? 'On for shoppers' : 'Off for shoppers';
  $('liveBadge').classList.toggle('off', !on);
  $('modelLine').textContent = d.connected ? `Model: ${d.model}. Today: ${d.today.messages} of ${s.dailyLimit} shopper messages, ${d.today.live_searches} of ${s.liveLimit} live searches.` : 'Not connected yet: add ANTHROPIC_API_KEY on Render.';
  const n = x => Number(x || 0).toLocaleString('en-IN');
  $('usage').innerHTML = d.usage.length ? d.usage.map(u => `<tr><td>${esc(u.day)}</td><td>${n(u.messages)}</td><td>${n(u.live_searches)}</td><td>${n(u.input_tokens)}</td><td>${n(u.output_tokens)}</td></tr>`).join('') : '<tr><td colspan="5" class="sub">No messages yet.</td></tr>';
  if (!chatMounted && d.connected) {
    chatMounted = true;
    window.czMountChat($('tryChat'), { greeting: s.greeting, adminKey: () => key,
      onShowProduct: id => window.open(`/#compare`, '_blank', 'noopener'), onAnswer: () => load(true) });
  } else if (!d.connected) $('tryChat').innerHTML = '<div class="ac-log"><div class="ac-msg bot">Add ANTHROPIC_API_KEY on Render to try the assistant.</div></div>';
}

async function load(quiet) {
  if (!key) return locked();
  try {
    const d = await call('GET', '/api/admin/assistant');
    $('keyForm').hidden = true; $('board').hidden = false; $('controls').hidden = false;
    render(d);
  } catch (e) {
    if (e.status === 401 || e.status === 403) { keyStore.clear(); key = ''; return locked(e.message); }
    if (!quiet) toast(e.message);
  }
}

$('keyForm').addEventListener('submit', e => { e.preventDefault(); key = $('adminKey').value.trim(); keyStore.set(key); load(); });
$('logout').addEventListener('click', () => { keyStore.clear(); key = ''; locked('Logged out.'); });
$('settingsForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('save').disabled = true; $('saveStatus').textContent = 'Saving…';
  try {
    await call('PATCH', '/api/admin/assistant', {
      enabled: $('enabled').checked, liveSearch: $('liveSearch').checked,
      dailyLimit: Number($('dailyLimit').value), liveLimit: Number($('liveLimit').value),
      greeting: $('greeting').value, instructions: $('instructions').value,
    });
    $('saveStatus').textContent = 'Saved.';
    toast($('enabled').checked ? 'Saved. Shoppers now see “Ask Comparezo”.' : 'Saved.');
    load(true);
  } catch (err) { $('saveStatus').textContent = ''; toast(err.message); }
  finally { $('save').disabled = false; }
});
load();
})();
