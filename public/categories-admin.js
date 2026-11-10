// Category admin: edits the category tree through the API while the app runs.
(() => {
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get() { try { return localStorage.getItem('cz-admin-key') || ''; } catch { return ''; } },
  set(v) { try { localStorage.setItem('cz-admin-key', v); } catch { /* private mode */ } },
};
let key = store.get(), unlocked = false, tree = [];

let toastTimer;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3200); }
function say(text, cls = '') { $('msg').className = cls; $('msg').textContent = text; }

async function call(method, url, body) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-Admin-Key': key }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: r.status });
  return data;
}

function row(item, i, list, level, parent) {
  const isSub = level > 0;
  const isOther = item.name === 'Other';
  const canUp = i > 0 && !isOther, canDown = i < list.length - 1 && list[i + 1].name !== 'Other' && !isOther;
  return `<div class="cat-row${isSub ? ' is-sub' : ''}${level === 2 ? ' is-type' : ''}" data-id="${item.id}">
    <span class="cat-name">${esc(item.name)}</span>
    ${unlocked ? `<span class="cat-actions">
      <button type="button" class="btn btn-ghost small" data-act="up" ${canUp ? '' : 'disabled'} aria-label="Move ${esc(item.name)} up">↑</button>
      <button type="button" class="btn btn-ghost small" data-act="down" ${canDown ? '' : 'disabled'} aria-label="Move ${esc(item.name)} down">↓</button>
      <button type="button" class="btn btn-ghost small" data-act="rename">Rename</button>
      <button type="button" class="btn btn-ghost small danger" data-act="delete" data-name="${esc(item.name)}"${parent ? ` data-parent="${esc(parent)}"` : ''}>Delete</button>
    </span>` : ''}
  </div>`;
}

// Types (sub-sub-categories) sit under a sub-category, folded away so long lists stay tidy.
function types(s, c) {
  if (!s.types.length && !unlocked) return '';
  const open = openTypes.has(s.id) ? ' open' : '';
  return `<details class="cat-types" data-sub="${s.id}"${open}><summary>${s.types.length ? `${s.types.length} type${s.types.length === 1 ? '' : 's'}` : 'Add types'}</summary>
    ${s.types.map((t, k) => row(t, k, s.types, 2, `${c.name} › ${s.name}`)).join('')}
    ${unlocked ? `<form class="add-sub" data-parent="${s.id}">
      <input maxlength="40" placeholder="Add a type to ${esc(s.name)}" aria-label="New type for ${esc(s.name)}">
      <button class="btn btn-ghost small" type="submit">Add</button>
    </form>` : ''}
  </details>`;
}
const openTypes = new Set();
document.addEventListener('toggle', e => {
  const d = e.target.closest?.('.cat-types'); if (!d) return;
  d.open ? openTypes.add(Number(d.dataset.sub)) : openTypes.delete(Number(d.dataset.sub));
}, true);

function render() {
  $('addForm').hidden = !unlocked;
  $('tree').innerHTML = tree.map((c, i) => `<section class="panel cat-card">
      ${row(c, i, tree, 0)}
      <div class="cat-subs">
        ${c.subcategories.length ? c.subcategories.map((s, j) => row(s, j, c.subcategories, 1, c.name) + types(s, c)).join('') : '<p class="sub">No sub-categories yet.</p>'}
      </div>
      ${unlocked ? `<form class="add-sub" data-parent="${c.id}">
        <input maxlength="40" placeholder="Add a sub-category to ${esc(c.name)}" aria-label="New sub-category for ${esc(c.name)}">
        <button class="btn btn-ghost small" type="submit">Add</button>
      </form>` : ''}
    </section>`).join('') || '<p class="sub">No categories yet.</p>';
}

async function load() {
  tree = await (await fetch('/api/categories')).json();
  render();
}

async function unlock(silent) {
  if (!key) return;
  try {
    await call('POST', '/api/admin/check');
    unlocked = true; store.set(key);
    $('keyStatus').className = 'ok'; $('keyStatus').textContent = 'Editing unlocked.';
  } catch (e) {
    unlocked = false;
    if (!silent) { $('keyStatus').className = 'err'; $('keyStatus').textContent = e.message; }
  }
  render();
}

$('keyForm').addEventListener('submit', e => { e.preventDefault(); key = $('adminKey').value.trim(); unlock(false); });

$('addForm').addEventListener('submit', async e => {
  e.preventDefault();
  const input = $('newCat');
  try { tree = await call('POST', '/api/categories', { name: input.value }); input.value = ''; render(); say(''); toast('Category added.'); }
  catch (err) { say(err.message, 'err'); }
});

$('tree').addEventListener('submit', async e => {
  const f = e.target.closest('.add-sub'); if (!f) return;
  e.preventDefault();
  const input = f.querySelector('input');
  const isType = !!f.closest('.cat-types');
  try { tree = await call('POST', '/api/categories', { name: input.value, parentId: Number(f.dataset.parent) }); render(); say(''); toast(isType ? 'Type added.' : 'Sub-category added.'); }
  catch (err) { say(err.message, 'err'); }
});

$('tree').addEventListener('click', async e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const rowEl = b.closest('.cat-row'), id = rowEl.dataset.id, act = b.dataset.act;
  try {
    if (act === 'up' || act === 'down') tree = await call('PATCH', `/api/categories/${id}`, { move: act });
    else if (act === 'rename') {
      const nameEl = rowEl.querySelector('.cat-name');
      if (rowEl.querySelector('input')) return;
      const old = nameEl.textContent;
      nameEl.innerHTML = `<form class="rename"><input value="${esc(old)}" maxlength="40" aria-label="New name"><button class="btn btn-brand small" type="submit">Save</button><button class="btn btn-ghost small" type="button" data-cancel>Cancel</button></form>`;
      const form = nameEl.querySelector('form'), input = form.querySelector('input');
      input.focus(); input.select();
      form.querySelector('[data-cancel]').addEventListener('click', ev => { ev.stopPropagation(); render(); });
      form.addEventListener('submit', async ev => {
        ev.preventDefault();
        try { tree = await call('PATCH', `/api/categories/${id}`, { name: input.value }); render(); say(''); toast('Renamed. Existing products and listings were updated too.'); }
        catch (err) { say(err.message, 'err'); }
      });
      return;
    } else if (act === 'delete') {
      const what = b.dataset.parent ? `"${b.dataset.name}" from ${b.dataset.parent}` : `"${b.dataset.name}" and all its sub-categories`;
      if (!b.dataset.confirm) { b.dataset.confirm = '1'; b.textContent = 'Confirm delete'; say(`Click "Confirm delete" to remove ${what}.`); return; }
      tree = await call('DELETE', `/api/categories/${id}`);
      toast('Deleted.');
    }
    render(); say('');
  } catch (err) {
    say(err.message, 'err');
    if (err.status === 401) { unlocked = false; render(); }
  }
});

load().then(() => unlock(true)).catch(err => say('Could not load categories: ' + err.message, 'err'));
})();
