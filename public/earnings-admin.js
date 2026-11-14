// Owner's Earnings page: one row per affiliate network, plus a form to type in earnings
// for networks with no earnings API. Uses the same admin key as Add products and Linezo.
(() => {
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SYMBOL = { INR: '₹', USD: '$', EUR: '€' };
const fmt = (n, cur = 'INR') => n == null ? '—' : (SYMBOL[cur] || cur + ' ') + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const monthName = m => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo - 1, 1)).toLocaleString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' }); };
const keyStore = {
  get() { try { return localStorage.getItem('cz-admin-key') || ''; } catch { return ''; } },
  set(v) { try { localStorage.setItem('cz-admin-key', v); } catch { /* private mode */ } },
  clear() { try { localStorage.removeItem('cz-admin-key'); } catch { /* private mode */ } },
};
let key = keyStore.get(), report = null;

let toastTimer;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3200); }
async function call(method, url, body) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-Admin-Key': key }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error((data.errors || []).join(' ') || data.error || 'Request failed'), { status: r.status });
  return data;
}

function locked(msg) {
  $('board').hidden = true; $('controls').hidden = true; $('keyForm').hidden = false;
  $('keyStatus').textContent = msg || '';
}

function status(n) {
  if (n.id === 'extrape') return ['No API', 'muted'];
  if (n.id === 'earnkaro') return n.connected ? ['Links connected', 'good'] : ['Not connected', 'muted'];
  if (!n.connected) return ['Not connected', 'muted'];
  return n.apiError ? ['Connected, report failed', 'warn'] : ['Connected', 'good'];
}

function cell(label, f, part, cur) {
  return `<div class="earn-fig"><span class="sub">${label}</span><span class="num">${f ? fmt(f[part], cur) : '—'}</span></div>`;
}

function render() {
  const r = report, t = r.totals;
  $('kpis').innerHTML = [
    ['This month, pending', t.thisMonth.pending], ['This month, confirmed', t.thisMonth.confirmed],
    ['All time, confirmed', t.total.confirmed], ['All time, paid to you', t.total.paid],
  ].map(([l, v]) => `<div class="kpi"><div class="sub">${l}</div><div class="v num">${fmt(v)}</div></div>`).join('');
  $('totalsNote').textContent = `This month is ${monthName(r.month)} (India time). Totals add up rupee amounts only` +
    (r.notInTotals.length ? `; ${r.notInTotals.join(', ')} reported in another currency and is not included.` : '.');

  $('networks').innerHTML = r.networks.map(n => {
    const [label, tone] = status(n);
    const cur = n.figures ? n.figures.currency : 'INR';
    const src = n.source === 'api' ? '<span class="pill good">From API</span>' : n.source === 'manual' ? '<span class="pill">Typed in</span>' : '';
    const notes = [
      n.apiError ? `<p class="sub warn-text">${esc(n.apiError)}${n.entries.length ? ' Showing your typed-in numbers instead.' : ''}</p>` : '',
      n.source === 'api' && n.apiNote ? `<p class="sub">${esc(n.apiNote)}</p>` : '',
      !n.figures ? `<p class="sub">${esc(n.auto ? (n.connected ? 'No earnings reported yet.' : n.how + ' Its keys are not on the server yet, so type the numbers in for now.') : n.how)}</p>` : '',
    ].join('');
    return `<article class="panel pad earn-row">
      <div class="earn-name">
        <h3>${esc(n.name)}</h3>
        <div class="earn-tags"><span class="pill ${tone}">${label}</span>${src}</div>
        <div class="earn-tags"><a class="btn btn-ghost small" href="${esc(n.dashboard)}" target="_blank" rel="noopener">Open dashboard ↗</a>
        <button type="button" class="btn btn-ghost small" data-enter="${n.id}">Type in</button></div>
      </div>
      <div class="earn-figs">
        <div class="earn-grp"><div class="eyebrow">This month</div><div class="earn-trio">${cell('Pending', n.figures && n.figures.thisMonth, 'pending', cur)}${cell('Confirmed', n.figures && n.figures.thisMonth, 'confirmed', cur)}${cell('Paid', n.figures && n.figures.thisMonth, 'paid', cur)}</div></div>
        <div class="earn-grp"><div class="eyebrow">All time</div><div class="earn-trio">${cell('Pending', n.figures && n.figures.total, 'pending', cur)}${cell('Confirmed', n.figures && n.figures.total, 'confirmed', cur)}${cell('Paid', n.figures && n.figures.total, 'paid', cur)}</div></div>
        ${notes}
      </div>
    </article>`;
  }).join('');

  const all = r.networks.flatMap(n => n.entries.map(e => ({ ...e, name: n.name })))
    .sort((a, b) => b.month.localeCompare(a.month) || a.name.localeCompare(b.name));
  $('entries').innerHTML = all.length ? all.map(e => `<tr>
      <td class="nowrap">${esc(monthName(e.month))}</td><td>${esc(e.name)}</td>
      <td class="r num">${fmt(e.pending)}</td><td class="r num">${fmt(e.confirmed)}</td><td class="r num">${fmt(e.paid)}</td>
      <td>${esc(e.note)}</td>
      <td class="r"><button type="button" class="btn btn-ghost small" data-edit="${esc(e.network)}|${esc(e.month)}">Edit</button>
        <button type="button" class="btn btn-ghost small danger" data-del="${esc(e.network)}|${esc(e.month)}">Delete</button></td>
    </tr>`).join('') : '<tr><td colspan="7" class="sub">Nothing typed in yet.</td></tr>';

  if (!$('e-network').options.length) {
    $('e-network').innerHTML = r.networks.map(n => `<option value="${n.id}">${esc(n.name)}</option>`).join('');
    $('e-month').value = r.month;
  }
}

async function load(refresh = false) {
  if (!key) return locked();
  $('refresh').disabled = true;
  try {
    report = await call('GET', '/api/admin/earnings' + (refresh ? '?refresh=1' : ''));
    $('keyForm').hidden = true; $('board').hidden = false; $('controls').hidden = false;
    render();
    if (refresh) toast('Earnings refreshed.');
  } catch (e) {
    if (e.status === 401 || e.status === 403) { keyStore.clear(); key = ''; return locked(e.message); }
    toast(e.message === 'Failed to fetch' ? 'The server is waking up. Try Refresh in a moment.' : e.message);
  } finally { $('refresh').disabled = false; }
}

function fill(network, month) {
  const e = report && report.networks.flatMap(n => n.entries).find(x => x.network === network && x.month === month);
  $('e-network').value = network;
  $('e-month').value = month || report.month;
  $('e-pending').value = e ? e.pending : '';
  $('e-confirmed').value = e ? e.confirmed : '';
  $('e-paid').value = e ? e.paid : '';
  $('e-note').value = e ? e.note : '';
  $('entryForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
  $('e-pending').focus({ preventScroll: true });
}

$('keyForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  key = $('adminKey').value.trim();
  if (!key) return;
  try { await call('POST', '/api/admin/check'); keyStore.set(key); $('keyStatus').textContent = ''; load(); }
  catch (e) { key = ''; $('keyStatus').textContent = e.message; }
});
$('refresh').addEventListener('click', () => load(true));
$('logout').addEventListener('click', () => { keyStore.clear(); key = ''; location.href = '/'; });

$('networks').addEventListener('click', ev => {
  const b = ev.target.closest('[data-enter]');
  if (b) fill(b.dataset.enter, report.month);
});
$('entries').addEventListener('click', async ev => {
  const ed = ev.target.closest('[data-edit]'), del = ev.target.closest('[data-del]');
  if (ed) { const [n, m] = ed.dataset.edit.split('|'); fill(n, m); }
  if (del) {
    const [n, m] = del.dataset.del.split('|');
    try { await call('DELETE', `/api/admin/earnings/${encodeURIComponent(n)}/${encodeURIComponent(m)}`); toast('Entry deleted.'); load(); }
    catch (e) { toast(e.message); }
  }
});
$('e-network').addEventListener('change', () => fill($('e-network').value, $('e-month').value));
$('e-month').addEventListener('change', () => fill($('e-network').value, $('e-month').value));

$('entryForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const body = { network: $('e-network').value, month: $('e-month').value, pending: $('e-pending').value, confirmed: $('e-confirmed').value, paid: $('e-paid').value, note: $('e-note').value };
  $('entryStatus').textContent = 'Saving…';
  try { await call('POST', '/api/admin/earnings', body); $('entryStatus').textContent = 'Saved.'; load(); }
  catch (e) { $('entryStatus').textContent = e.message; }
});

load();
})();
