// Owner's Spin players page: the mobile numbers saved by Spin to win (GET /api/admin/spin-players),
// with a search box and a CSV download that opens in Excel. Uses the same admin key as Add products.
(() => {
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const keyStore = {
  get() { try { return localStorage.getItem('cz-admin-key') || ''; } catch { return ''; } },
  set(v) { try { localStorage.setItem('cz-admin-key', v); } catch { /* private mode */ } },
  clear() { try { localStorage.removeItem('cz-admin-key'); } catch { /* private mode */ } },
};
let key = keyStore.get(), players = [];

let toastTimer;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3200); }
// Times are saved in UTC; show them in India time.
const when = s => s ? new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z').toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '';
const pretty = p => String(p || '').replace(/^\+91(\d{5})(\d{5})$/, '+91 $1 $2');
const indiaDay = d => new Date(new Date(d).getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);

function locked(msg) {
  $('board').hidden = true; $('controls').hidden = true; $('keyForm').hidden = false;
  $('keyStatus').textContent = msg || '';
  $('adminKey').focus();
}

async function load() {
  if (!key) return locked();
  try {
    const r = await fetch('/api/admin/spin-players', { headers: { 'X-Admin-Key': key }, cache: 'no-store' });
    const data = await r.json().catch(() => ({}));
    if (r.status === 401 || r.status === 403) { keyStore.clear(); key = ''; return locked(data.error || 'Wrong admin key.'); }
    if (!r.ok) throw new Error(data.error || 'Could not load the list.');
    players = Array.isArray(data) ? data : [];
  } catch (e) { return toast(e.message); }
  $('keyForm').hidden = true; $('controls').hidden = false; $('board').hidden = false;
  render();
}

function render() {
  const today = indiaDay(Date.now());
  const toIso = s => s && (s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  const spinsTotal = players.reduce((n, p) => n + (p.spins || 0), 0);
  const playedToday = players.filter(p => p.last_at && indiaDay(toIso(p.last_at)) === today).length;
  const newToday = players.filter(p => p.first_at && indiaDay(toIso(p.first_at)) === today).length;
  $('kpis').innerHTML = [['Numbers saved', players.length], ['New today', newToday], ['Played today', playedToday], ['Total spins', spinsTotal]]
    .map(([l, v]) => `<div class="kpi"><div class="sub">${l}</div><div class="v num">${v.toLocaleString('en-IN')}</div></div>`).join('');

  const q = $('filter').value.trim().toLowerCase().replace(/\s+/g, '');
  const shown = q ? players.filter(p => (p.phone + (p.last_deal_title || '')).toLowerCase().replace(/\s+/g, '').includes(q)) : players;
  $('rows').innerHTML = shown.map((p, i) => `<tr><td>${i + 1}</td><td class="num">${esc(pretty(p.phone))}</td><td>${esc(when(p.first_at))}</td><td>${esc(when(p.last_at))}</td><td class="r num">${p.spins || 0}</td><td>${esc(p.last_deal_title || '')}</td></tr>`).join('');
  $('empty').hidden = shown.length > 0;
  $('empty').textContent = players.length ? 'No numbers match your search.' : 'No one has played yet.';
}

// CSV with a BOM so Excel shows ₹ and other characters correctly. The number is written as text
// (="+91…") so Excel keeps the + and doesn't turn it into 9.19E+11.
function download() {
  if (!players.length) return toast('There are no numbers to download yet.');
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Mobile number', 'First spin (India time)', 'Last spin (India time)', 'Spins', 'Last deal won'].map(cell).join(',')];
  for (const p of players) lines.push([`="${p.phone}"`, cell(when(p.first_at)), cell(when(p.last_at)), p.spins || 0, cell(p.last_deal_title)].join(','));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `comparezo-spin-players-${indiaDay(Date.now())}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$('keyForm').addEventListener('submit', e => {
  e.preventDefault();
  key = $('adminKey').value.trim();
  if (!key) return;
  keyStore.set(key);
  load();
});
$('refresh').addEventListener('click', () => load().then(() => toast('List refreshed.')));
$('download').addEventListener('click', download);
$('filter').addEventListener('input', render);
$('logout').addEventListener('click', () => { keyStore.clear(); key = ''; players = []; locked('Logged out.'); });

load();
})();
