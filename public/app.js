'use strict';

const GOOGLE_ICON = `<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;
const COLORS = ['#2962ff', '#e53935', '#43a047', '#8e24aa', '#fb8c00', '#00897b', '#d81b60', '#5d4037', '#546e7a', '#fdd835'];
const TYPE_LABELS = { text: 'Short text', long: 'Long text', number: 'Number', date: 'Date / year' };
const PLACE_LABELS = { front: 'Front – big', sub: 'Front – small line', meta: 'Back – top line', back: 'Back – main text' };

// ---------- state ----------
let me = { user: null, googleEnabled: false, devLogin: false };
let classes = [], layouts = [], cards = [];
let currentClassId = null;

// ---------- utils ----------
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};
function renderMarkup(text) {
  return esc(text)
    .replace(/\*\*([\s\S]+?)\*\*/g, '<span class="b">$1</span>')
    .replace(/!!([\s\S]+?)!!/g, '<span class="r">$1</span>')
    .replace(/__([\s\S]+?)__/g, '<span class="p">$1</span>');
}
const isEmpty = v => v == null || v === '';
const parseYear = s => { const m = String(s ?? '').match(/\d{3,4}/); return m ? parseInt(m[0], 10) : null; };

function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}
async function api(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
// Two-click confirm for destructive buttons (no browser dialogs).
function confirmClick(btn, label) {
  if (btn.dataset.armed === '1') { btn.dataset.armed = ''; btn.textContent = btn.dataset.label; return true; }
  btn.dataset.label = btn.textContent; btn.dataset.armed = '1'; btn.textContent = label;
  setTimeout(() => { if (btn.dataset.armed === '1') { btn.dataset.armed = ''; btn.textContent = btn.dataset.label; } }, 4000);
  return false;
}
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));

const currentClass = () => classes.find(c => c.id === currentClassId);
const layoutById = id => layouts.find(l => l.id === id);
const currentLayout = () => layoutById(currentClass()?.layoutId);
const groupFields = layout => layout.fields.filter(f => f.group);

// ---------- card rendering (shared by grid, study, previews) ----------
function fieldText(f, v, isHtml) {
  if (isHtml) return String(v);
  return f.type === 'long' ? renderMarkup(v) : esc(v);
}
function groupValueLabel(f, v) {
  if (isEmpty(v)) return `No ${f.label.toLowerCase()}`;
  const name = f.names?.[v];
  return `${f.label} ${v}${name ? `: ${name}` : ''}`;
}
function cardInner(card, layout, { editable = false } = {}) {
  const F = card.fields, html = card.isHtml;
  const by = p => layout.fields.filter(f => f.place === p && !isEmpty(F[f.key]));
  const [main, ...moreFront] = by('front');
  const mainText = main ? fieldText(main, F[main.key], html) : '';
  const long = main && String(F[main.key]).length > 70;
  const sub = by('sub').map(f => f.type === 'number' ? `${esc(f.label)} ${esc(F[f.key])}` : esc(F[f.key])).join(' · ');
  const meta = by('meta').map(f => `<b>${esc(f.label)}:</b> ${esc(F[f.key])}`).join(' &nbsp;|&nbsp; ');
  const back = by('back').map((f, i) =>
    `<div class="back-field">${i > 0 ? `<div class="back-label">${esc(f.label)}</div>` : ''}${fieldText(f, F[f.key], html)}</div>`).join('');
  return `
    <div class="flip-inner">
      <div class="face front">
        ${editable ? '<span class="mine-tag">My card</span><button class="card-edit" type="button">Edit</button>' : ''}
        <div class="body">
          <div class="term${long ? ' long' : ''}">${mainText}</div>
          ${moreFront.map(f => `<div class="front-extra">${fieldText(f, F[f.key], html)}</div>`).join('')}
          ${sub ? `<div class="period">${sub}</div>` : ''}
        </div>
      </div>
      <div class="face back">
        <div class="body">
          ${meta ? `<div class="meta">${meta}</div>` : ''}
          <div class="text">${back || '<span class="empty-back">(nothing on the back yet)</span>'}</div>
        </div>
      </div>
    </div>`;
}

// ---------- account ----------
function renderAccount() {
  const acct = $('account'), banner = $('signinBanner');
  const signIn = me.googleEnabled
    ? `<a class="btn google" href="/auth/google">${GOOGLE_ICON} Sign in with Google</a>`
    : me.devLogin ? '<a class="btn" href="/auth/dev">Dev sign-in</a>' : '';
  if (me.user) {
    const u = me.user;
    acct.innerHTML = `${u.picture ? `<img src="${esc(u.picture)}" alt="" referrerpolicy="no-referrer">` : ''}
      <span class="who" title="${esc(u.email)}">${esc(u.name || u.email)}</span>
      <button class="btn" id="logoutBtn">Sign out</button>`;
    $('logoutBtn').onclick = async () => { await api('/auth/logout', { method: 'POST' }); location.reload(); };
    banner.hidden = true;
  } else {
    acct.innerHTML = signIn;
    banner.hidden = false;
    banner.innerHTML = signIn
      ? 'Sign in with Google to make your own classes, layouts, and cards. They’re saved to your account.'
      : 'Sign-in isn’t set up on this server yet (see README: Google OAuth).';
  }
  $('footerLinks').hidden = !me.user;
}

// ---------- class bar ----------
function renderClassBar() {
  const bar = $('classBar');
  bar.innerHTML = classes.map(c => `
    <button class="class-chip${c.id === currentClassId ? ' active' : ''}" data-id="${c.id}" style="--c:${esc(c.color)}">
      <span class="dot"></span>${esc(c.name)}<span class="n">${c.cardCount}</span>
      ${!c.builtin && c.id === currentClassId ? '<span class="gear" title="Edit class" data-edit="1">⚙</span>' : ''}
    </button>`).join('') +
    (me.user ? '<button class="class-chip add" id="addClass">+ New class</button>' : '');
  bar.querySelectorAll('.class-chip[data-id]').forEach(b => b.addEventListener('click', e => {
    const id = Number(b.dataset.id);
    if (e.target.dataset.edit) { openClassDialog(currentClass()); return; }
    if (id !== currentClassId) selectClass(id);
  }));
  $('addClass')?.addEventListener('click', () => openClassDialog());
}

async function selectClass(id) {
  if (!classes.some(c => c.id === id)) id = classes[0]?.id;
  currentClassId = id;
  store.set('classcards.class', String(id));
  resetFilters(false);
  renderClassBar();
  const cls = currentClass();
  document.documentElement.style.setProperty('--accent', cls?.color || '#2962ff');
  $('className').textContent = cls?.name || 'ClassCards';
  $('classSub').textContent = cls ? `${layoutById(cls.layoutId)?.name || ''} layout · tap a card to flip` : '';
  $('root').innerHTML = '<div class="no-results">Loading…</div>';
  cards = cls ? await api(`/api/classes/${cls.id}/cards`) : [];
  if (id !== currentClassId) return; // user switched again while loading
  setupFilters();
  render();
}

// ---------- filters ----------
const searchEl = $('search'), sourceEl = $('sourceFilter');
let groupSelects = []; // [{ field, from, to }] or [{ field, eq }]

function setupFilters() {
  const layout = currentLayout(), cls = currentClass();
  $('newBtn').hidden = !me.user;
  sourceEl.hidden = !(me.user && cls?.builtin);
  if (sourceEl.hidden) sourceEl.value = '';
  const gf = layout ? groupFields(layout) : [];
  const wrap = $('groupFilters');
  wrap.innerHTML = '';
  groupSelects = gf.map(f => {
    const vals = [...new Set(cards.map(c => c.fields[f.key]).filter(v => !isEmpty(v)))]
      .sort((a, b) => (typeof a === 'number' && typeof b === 'number') ? a - b : String(a).localeCompare(String(b)));
    const opts = '<option value="">Any</option>' + vals.map(v => `<option value="${esc(v)}">${esc(f.names?.[v] ? `${v}: ${f.names[v]}` : v)}</option>`).join('');
    const label = document.createElement('label');
    label.className = 'range-label';
    if (f.type === 'number') {
      label.innerHTML = `${esc(f.label)} <select>${opts}</select><span class="range-to">to</span><select>${opts}</select>`;
      const [from, to] = label.querySelectorAll('select');
      from.onchange = to.onchange = render;
      wrap.appendChild(label);
      return { field: f, from, to };
    }
    label.innerHTML = `${esc(f.label)} <select>${opts}</select>`;
    const eq = label.querySelector('select');
    eq.onchange = render;
    wrap.appendChild(label);
    return { field: f, eq };
  });
  $('yearFilter').hidden = !layout?.fields.some(f => f.type === 'date');
  searchEl.placeholder = `Search ${cls?.name || ''} cards...`;
}

function resetFilters(rerender = true) {
  searchEl.value = ''; sourceEl.value = '';
  $('yearFromFilter').value = $('yearToFilter').value = '';
  groupSelects.forEach(g => { (g.eq ? [g.eq] : [g.from, g.to]).forEach(s => { s.value = ''; }); });
  if (rerender) render();
}

function filtered() {
  const layout = currentLayout(); if (!layout) return [];
  const q = searchEl.value.trim().toLowerCase(), src = sourceEl.value;
  const dateField = layout.fields.find(f => f.type === 'date');
  const yf = $('yearFromFilter').value ? +$('yearFromFilter').value : null;
  const yt = $('yearToFilter').value ? +$('yearToFilter').value : null;
  const list = cards.filter(c => {
    if (src === 'mine' && !c.mine) return false;
    if (src === 'builtin' && !c.builtin) return false;
    for (const g of groupSelects) {
      const v = c.fields[g.field.key];
      if (g.eq) { if (g.eq.value && String(v) !== g.eq.value) return false; continue; }
      if (g.from.value && (isEmpty(v) || v < +g.from.value)) return false;
      if (g.to.value && (isEmpty(v) || v > +g.to.value)) return false;
    }
    if (dateField && (yf != null || yt != null)) {
      const y = parseYear(c.fields[dateField.key]);
      if (y == null || (yf != null && y < yf) || (yt != null && y > yt)) return false;
    }
    if (q) {
      const hay = layout.fields.map(f => String(c.fields[f.key] ?? '')).join(' ').replace(/<[^>]+>/g, '').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const gf = groupFields(layout);
  const cmp = (a, b) => {
    if (isEmpty(a) && isEmpty(b)) return 0;
    if (isEmpty(a)) return 1; if (isEmpty(b)) return -1;
    return typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b));
  };
  return list.sort((a, b) => {
    for (const f of gf) { const d = cmp(a.fields[f.key], b.fields[f.key]); if (d) return d; }
    return (a.builtin === b.builtin ? 0 : a.builtin ? -1 : 1) || a.id - b.id;
  });
}

// ---------- grid ----------
function render() {
  const root = $('root'), layout = currentLayout(), list = filtered();
  root.innerHTML = '';
  $('count').textContent = `${list.length} ${list.length === 1 ? 'card' : 'cards'}`;
  if (!list.length) {
    root.innerHTML = `<div class="no-results">${cards.length || !me.user
      ? (cards.length ? 'No cards match your search.' : 'This class has no cards yet.')
      : 'No cards yet. Click <b>+ New card</b> to make the first one.'}</div>`;
    return;
  }
  const gf = groupFields(layout);
  const heads = ['period-title', 'module-title', 'sub-title'];
  let last = gf.map(() => Symbol()), grid = null;
  for (const c of list) {
    let changedAt = gf.findIndex((f, i) => c.fields[f.key] !== last[i]);
    if (changedAt !== -1 || !grid) {
      if (changedAt === -1) changedAt = gf.length;
      for (let i = changedAt; i < gf.length; i++) {
        const f = gf[i], v = c.fields[f.key];
        last[i] = v;
        const h = document.createElement('div');
        h.className = heads[i];
        h.textContent = groupValueLabel(f, v);
        root.appendChild(h);
      }
      grid = document.createElement('div'); grid.className = 'grid';
      root.appendChild(grid);
    }
    const el = document.createElement('div');
    el.className = 'flip-card';
    el.innerHTML = cardInner(c, layout, { editable: c.mine });
    el.addEventListener('click', () => el.classList.toggle('flipped'));
    el.querySelector('.card-edit')?.addEventListener('click', e => { e.stopPropagation(); openCardDialog(c); });
    grid.appendChild(el);
  }
}

// ---------- card editor ----------
const cardDialog = $('cardDialog'), cardForm = $('cardForm');
let editingCard = null;

function cardFormValues() {
  const out = {};
  cardForm.querySelectorAll('[data-key]').forEach(el => { out[el.dataset.key] = el.value; });
  return out;
}
function updateCardPreview() {
  const layout = currentLayout();
  const fields = cardFormValues();
  layout.fields.forEach(f => { if (f.type === 'number' && fields[f.key] !== '') fields[f.key] = Number(fields[f.key]); });
  const flipped = $('cardPreview').classList.contains('flipped');
  $('cardPreview').innerHTML = cardInner({ fields, isHtml: false }, layout);
  $('cardPreview').classList.toggle('flipped', flipped);
}
$('cardPreview').addEventListener('click', () => $('cardPreview').classList.toggle('flipped'));

function openCardDialog(card = null) {
  if (!me.user) return;
  const layout = currentLayout(), cls = currentClass();
  editingCard = card;
  $('cardTitle').textContent = `${card ? 'Edit card' : 'New card'} · ${cls.name}`;
  $('cardDelete').hidden = !card;
  $('cardError').textContent = '';
  const remembered = JSON.parse(store.get(`classcards.last.${cls.id}`) || '{}');
  $('cardFields').innerHTML = layout.fields.map(f => {
    const v = card ? card.fields[f.key] : (f.group ? (remembered[f.key] ?? '') : '');
    const attrs = `data-key="${esc(f.key)}" aria-label="${esc(f.label)}"`;
    const input = f.type === 'long'
      ? `<textarea ${attrs} maxlength="4000">${esc(v ?? '')}</textarea>`
      : `<input ${attrs} type="${f.type === 'number' ? 'number' : 'text'}" ${f.type === 'number' ? 'min="0" inputmode="numeric"' : 'maxlength="200"'} value="${esc(v ?? '')}">`;
    const cls = f.type === 'number' ? 'field small' : f.type === 'long' ? 'field full' : 'field';
    return `<label class="${cls}">${esc(f.label)}${f.type === 'date' ? ' <small>(include a year to filter by it)</small>' : ''}${input}</label>`;
  }).join('');
  $('cardFields').querySelectorAll('[data-key]').forEach(el => el.addEventListener('input', updateCardPreview));
  $('cardPreview').classList.remove('flipped');
  updateCardPreview();
  cardDialog.showModal();
  const firstFront = layout.fields.find(f => f.place === 'front');
  cardForm.querySelector(`[data-key="${CSS.escape(firstFront.key)}"]`)?.focus();
}

cardForm.addEventListener('submit', async e => {
  e.preventDefault();
  const cls = currentClass(), layout = currentLayout(), fields = cardFormValues();
  $('cardSave').disabled = true;
  try {
    if (editingCard) {
      const saved = await api(`/api/cards/${editingCard.id}`, { method: 'PUT', body: JSON.stringify({ fields }) });
      cards[cards.findIndex(c => c.id === saved.id)] = saved;
      toast('Card saved');
    } else {
      const saved = await api(`/api/classes/${cls.id}/cards`, { method: 'POST', body: JSON.stringify({ fields }) });
      cards.push(saved); cls.cardCount++;
      toast('Card created');
    }
    const rem = {}; groupFields(layout).forEach(f => { rem[f.key] = fields[f.key]; });
    store.set(`classcards.last.${cls.id}`, JSON.stringify(rem));
    cardDialog.close();
    renderClassBar(); setupFiltersKeepValues(); render();
  } catch (err) { $('cardError').textContent = err.message; }
  finally { $('cardSave').disabled = false; }
});

$('cardDelete').onclick = async () => {
  if (!editingCard || !confirmClick($('cardDelete'), 'Click again to delete')) return;
  try {
    await api(`/api/cards/${editingCard.id}`, { method: 'DELETE' });
    cards = cards.filter(c => c.id !== editingCard.id); currentClass().cardCount--;
    cardDialog.close(); renderClassBar(); setupFiltersKeepValues(); render(); toast('Card deleted');
  } catch (err) { $('cardError').textContent = err.message; }
};
$('newBtn').onclick = () => openCardDialog();

// Rebuild filter dropdowns (new values may exist) while keeping what the user picked.
function setupFiltersKeepValues() {
  const saved = groupSelects.map(g => g.eq ? [g.eq.value] : [g.from.value, g.to.value]);
  setupFilters();
  groupSelects.forEach((g, i) => (g.eq ? [g.eq] : [g.from, g.to]).forEach((s, j) => { s.value = saved[i]?.[j] ?? ''; }));
}

// ---------- class editor ----------
const classDialog = $('classDialog'), classForm = $('classForm');
let editingClass = null, pickedColor = COLORS[0];

function renderSwatches() {
  $('swatches').innerHTML = COLORS.map(c =>
    `<button type="button" class="swatch${c === pickedColor ? ' on' : ''}" data-c="${c}" style="background:${c}" aria-label="${c}"></button>`).join('') +
    `<label class="swatch custom${COLORS.includes(pickedColor) ? '' : ' on'}" title="Custom color" style="background:${COLORS.includes(pickedColor) ? 'conic-gradient(red,yellow,lime,cyan,blue,magenta,red)' : pickedColor}">
       <input type="color" value="${pickedColor}"></label>`;
  $('swatches').querySelectorAll('.swatch[data-c]').forEach(b => b.onclick = () => { pickedColor = b.dataset.c; renderSwatches(); });
  $('swatches').querySelector('input[type=color]').oninput = e => { pickedColor = e.target.value; renderSwatches(); };
}
function layoutSummary(l) {
  const by = p => l.fields.filter(f => f.place === p).map(f => f.label).join(', ');
  return [['Front', [by('front'), by('sub')].filter(Boolean).join(' · ')], ['Back', [by('meta'), by('back')].filter(Boolean).join(' · ')]]
    .map(([k, v]) => `${k}: ${esc(v || '—')}`).join(' &nbsp;/&nbsp; ');
}
function fillLayoutSelect(selectedId) {
  const sel = $('classLayout');
  const opt = l => `<option value="${l.id}">${esc(l.name)}</option>`;
  sel.innerHTML = `<optgroup label="Built-in">${layouts.filter(l => l.builtin).map(opt).join('')}</optgroup>` +
    (layouts.some(l => !l.builtin) ? `<optgroup label="My layouts">${layouts.filter(l => !l.builtin).map(opt).join('')}</optgroup>` : '');
  sel.value = String(selectedId ?? layouts[0]?.id);
  $('layoutSummary').innerHTML = layoutSummary(layoutById(Number(sel.value)));
}
$('classLayout').onchange = () => { $('layoutSummary').innerHTML = layoutSummary(layoutById(Number($('classLayout').value))); };

function openClassDialog(cls = null) {
  editingClass = cls;
  $('classTitle').textContent = cls ? 'Edit class' : 'New class';
  classForm.name.value = cls?.name || '';
  pickedColor = cls?.color || COLORS[classes.filter(c => !c.builtin).length % COLORS.length];
  renderSwatches();
  fillLayoutSelect(cls?.layoutId);
  const locked = !!(cls && cls.cardCount > 0);
  $('classLayout').disabled = locked;
  $('classNewLayout').hidden = locked;
  if (locked) $('layoutSummary').innerHTML += '<br>The layout can’t be changed once a class has cards.';
  $('classDelete').hidden = !cls;
  $('classError').textContent = '';
  classDialog.showModal();
  classForm.name.focus();
}

classForm.addEventListener('submit', async e => {
  e.preventDefault();
  const body = JSON.stringify({ name: classForm.name.value, color: pickedColor, layoutId: Number($('classLayout').value) });
  try {
    const saved = editingClass
      ? await api(`/api/classes/${editingClass.id}`, { method: 'PUT', body })
      : await api('/api/classes', { method: 'POST', body });
    classes = await api('/api/classes');
    classDialog.close();
    toast(editingClass ? 'Class saved' : 'Class created');
    await selectClass(saved.id);
  } catch (err) { $('classError').textContent = err.message; }
});

$('classDelete').onclick = async () => {
  if (!editingClass) return;
  const n = editingClass.cardCount;
  if (!confirmClick($('classDelete'), n ? `Delete class + ${n} card${n === 1 ? '' : 's'}?` : 'Click again to delete')) return;
  try {
    await api(`/api/classes/${editingClass.id}`, { method: 'DELETE' });
    classes = await api('/api/classes');
    classDialog.close(); toast('Class deleted');
    await selectClass(classes[0]?.id);
  } catch (err) { $('classError').textContent = err.message; }
};
$('classNewLayout').onclick = e => { e.preventDefault(); openLayoutDialog(null, null, true); };

// ---------- layouts list ----------
const layoutsDialog = $('layoutsDialog');
function renderLayoutList() {
  $('layoutList').innerHTML = layouts.map(l => `
    <div class="layout-row">
      <div><b>${esc(l.name)}</b>${l.builtin ? ' <span class="tag">Built-in</span>' : ''}
        <div class="markup-help">${layoutSummary(l)}</div></div>
      <div class="layout-row-actions">
        <button class="btn" data-dup="${l.id}">Duplicate</button>
        ${l.builtin ? '' : `<button class="btn" data-edit="${l.id}">Edit</button>`}
      </div>
    </div>`).join('');
  $('layoutList').querySelectorAll('[data-dup]').forEach(b => b.onclick = () => openLayoutDialog(null, layoutById(Number(b.dataset.dup))));
  $('layoutList').querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openLayoutDialog(layoutById(Number(b.dataset.edit))));
}
$('layoutsLink').onclick = e => { e.preventDefault(); renderLayoutList(); layoutsDialog.showModal(); };
$('layoutNew').onclick = () => openLayoutDialog();

// ---------- layout builder ----------
const layoutDialog = $('layoutDialog'), layoutForm = $('layoutForm');
let editingLayout = null, lfRows = [], layoutFromClassDialog = false;

function openLayoutDialog(layout = null, copyFrom = null, fromClass = false) {
  editingLayout = layout; layoutFromClassDialog = fromClass;
  const base = layout || copyFrom;
  $('layoutTitle').textContent = layout ? 'Edit layout' : copyFrom ? `New layout (from ${copyFrom.name})` : 'New layout';
  layoutForm.name.value = layout ? layout.name : copyFrom ? `${copyFrom.name} (copy)` : '';
  lfRows = base
    ? base.fields.map(f => ({ key: layout ? f.key : undefined, label: f.label, type: f.type, place: f.place, group: !!f.group }))
    : [{ label: 'Unit', type: 'number', place: 'sub', group: true },
       { label: 'Term', type: 'text', place: 'front', group: false },
       { label: 'Definition', type: 'long', place: 'back', group: false }];
  $('layoutDelete').hidden = !layout;
  $('layoutError').textContent = '';
  renderLayoutRows();
  layoutDialog.showModal();
  layoutForm.name.focus();
}

function renderLayoutRows() {
  const sel = (opts, v) => Object.entries(opts).map(([k, l]) => `<option value="${k}"${k === v ? ' selected' : ''}>${l}</option>`).join('');
  $('layoutFields').innerHTML = lfRows.map((r, i) => `
    <div class="lf-row" data-i="${i}">
      <input data-p="label" value="${esc(r.label)}" maxlength="40" placeholder="Field name" aria-label="Field name">
      <select data-p="type" aria-label="Type">${sel(TYPE_LABELS, r.type)}</select>
      <select data-p="place" aria-label="Shows on">${sel(PLACE_LABELS, r.place)}</select>
      <label class="lf-group" title="Group cards into sections by this field"><input type="checkbox" data-p="group"${r.group ? ' checked' : ''}${r.type === 'number' || r.type === 'text' ? '' : ' disabled'}><span>Sections</span></label>
      <span class="lf-actions">
        <button type="button" data-a="up" title="Move up"${i === 0 ? ' disabled' : ''}>↑</button>
        <button type="button" data-a="down" title="Move down"${i === lfRows.length - 1 ? ' disabled' : ''}>↓</button>
        <button type="button" data-a="del" title="Remove"${lfRows.length === 1 ? ' disabled' : ''}>✕</button>
      </span>
    </div>`).join('');
  $('layoutFields').querySelectorAll('.lf-row').forEach(row => {
    const i = Number(row.dataset.i);
    row.querySelectorAll('[data-p]').forEach(el => el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', () => {
      const p = el.dataset.p;
      lfRows[i][p] = el.type === 'checkbox' ? el.checked : el.value;
      if (p === 'type') { if (!['number', 'text'].includes(el.value)) lfRows[i].group = false; renderLayoutRows(); }
      else updateLayoutPreview();
    }));
    row.querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
      const a = b.dataset.a;
      if (a === 'del') lfRows.splice(i, 1);
      else { const j = a === 'up' ? i - 1 : i + 1; [lfRows[i], lfRows[j]] = [lfRows[j], lfRows[i]]; }
      renderLayoutRows();
    });
  });
  $('addField').disabled = lfRows.length >= 12;
  updateLayoutPreview();
}
$('addField').onclick = () => { lfRows.push({ label: '', type: 'text', place: 'back', group: false }); renderLayoutRows(); $('layoutFields').querySelector('.lf-row:last-child input').focus(); };

function updateLayoutPreview() {
  const fields = lfRows.map((r, i) => ({ ...r, key: `k${i}` }));
  const sample = {};
  fields.forEach(f => { sample[f.key] = f.type === 'number' ? 1 : f.type === 'date' ? '1776' : (f.label || 'Field'); });
  const flipped = $('layoutPreview').classList.contains('flipped');
  $('layoutPreview').innerHTML = cardInner({ fields: sample, isHtml: false }, { fields });
  $('layoutPreview').classList.toggle('flipped', flipped);
}
$('layoutPreview').addEventListener('click', () => $('layoutPreview').classList.toggle('flipped'));

layoutForm.addEventListener('submit', async e => {
  e.preventDefault();
  const body = JSON.stringify({ name: layoutForm.name.value, fields: lfRows });
  try {
    const saved = editingLayout
      ? await api(`/api/layouts/${editingLayout.id}`, { method: 'PUT', body })
      : await api('/api/layouts', { method: 'POST', body });
    layouts = await api('/api/layouts');
    layoutDialog.close();
    toast(editingLayout ? 'Layout saved' : 'Layout created');
    if (layoutsDialog.open) renderLayoutList();
    if (layoutFromClassDialog && classDialog.open) fillLayoutSelect(saved.id);
    if (editingLayout && currentLayout()?.id === saved.id) { setupFilters(); render(); }
  } catch (err) { $('layoutError').textContent = err.message; }
});

$('layoutDelete').onclick = async () => {
  if (!editingLayout || !confirmClick($('layoutDelete'), 'Click again to delete')) return;
  try {
    await api(`/api/layouts/${editingLayout.id}`, { method: 'DELETE' });
    layouts = await api('/api/layouts');
    layoutDialog.close(); toast('Layout deleted');
    if (layoutsDialog.open) renderLayoutList();
  } catch (err) { $('layoutError').textContent = err.message; }
};

// ---------- study mode ----------
const overlay = $('studyOverlay'), studyCard = $('studyCard');
let deck = [], idx = 0;
function renderStudy() {
  studyCard.classList.remove('flipped');
  const c = deck[idx]; if (!c) return;
  studyCard.innerHTML = cardInner(c, currentLayout());
  $('studyCounter').textContent = `${idx + 1} / ${deck.length}`;
}
function openStudy() { deck = filtered(); if (!deck.length) return; idx = 0; renderStudy(); overlay.classList.add('open'); }
const closeStudy = () => overlay.classList.remove('open');
const step = d => { if (!deck.length) return; idx = (idx + d + deck.length) % deck.length; renderStudy(); };
$('studyBtn').onclick = openStudy;
$('studyClose').onclick = closeStudy;
$('studyPrev').onclick = () => step(-1);
$('studyNext').onclick = () => step(1);
$('studyShuffle').onclick = () => {
  for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  idx = 0; renderStudy(); toast('Shuffled');
};
studyCard.onclick = () => studyCard.classList.toggle('flipped');
document.addEventListener('keydown', e => {
  if (!overlay.classList.contains('open')) return;
  if (e.key === 'ArrowRight') step(1);
  else if (e.key === 'ArrowLeft') step(-1);
  else if (e.key === 'Escape') closeStudy();
  else if (e.key === ' ') { e.preventDefault(); studyCard.classList.toggle('flipped'); }
});

// ---------- filter events ----------
searchEl.addEventListener('input', render);
sourceEl.addEventListener('change', render);
[$('yearFromFilter'), $('yearToFilter')].forEach(el => el.addEventListener('input', render));
$('clearBtn').onclick = () => resetFilters();

// ---------- boot ----------
(async function init() {
  try {
    [me, classes, layouts] = await Promise.all([api('/api/me'), api('/api/classes'), api('/api/layouts')]);
  } catch (err) {
    $('root').innerHTML = `<div class="no-results">Couldn’t load: ${esc(err.message)}</div>`;
    return;
  }
  if (new URLSearchParams(location.search).get('login') === 'cancelled') { toast('Sign-in cancelled'); history.replaceState(null, '', '/'); }
  renderAccount();
  await selectClass(Number(store.get('classcards.class')) || classes[0]?.id);
})();
