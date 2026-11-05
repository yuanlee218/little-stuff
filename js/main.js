import { entries } from './db.js';
import { TYPES, typeById, cosine } from './types.js';
import { ai } from './ai-client.js';
import { fileToCanvas, makeSticker, polaroid, toBlob } from './sticker.js';

const MOODS = ['🥰', '😆', '🤩', '😌', '🥹', '😋', '🤭', '😴'];
const SIMILAR = 0.86; // CLIP image-image cosine above this = "looks like your …"

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad2 = (n) => String(n).padStart(2, '0');
const dateStr = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// small stable "random" per id, for sticker tilt and placement
const hash = (s) => {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
};

const state = {
  tab: 'calendar',
  month: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  list: [],
};
const urls = new Map();
const stickerURL = (e) => {
  if (!urls.has(e.id)) urls.set(e.id, URL.createObjectURL(e.sticker));
  return urls.get(e.id);
};

async function refresh() {
  state.list = (await entries.all()).sort((a, b) => (a.date + a.createdAt).localeCompare(b.date + b.createdAt));
  render();
}

// ---------------- views ----------------
function render() {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === state.tab));
  const v = $('#view');
  if (state.tab === 'calendar') v.innerHTML = calendarView();
  if (state.tab === 'collection') v.innerHTML = collectionView();
  if (state.tab === 'recap') v.innerHTML = recapView();
}

function monthEntries() {
  const prefix = `${state.month.getFullYear()}-${pad2(state.month.getMonth() + 1)}`;
  return state.list.filter((e) => e.date.startsWith(prefix));
}

function monthNav() {
  return `<div class="month-nav">
    <button class="icon" data-act="prev" aria-label="Previous month">‹</button>
    <h2>${MONTHS[state.month.getMonth()]} <span>${state.month.getFullYear()}</span></h2>
    <button class="icon" data-act="next" aria-label="Next month">›</button>
  </div>`;
}

function calendarView() {
  const y = state.month.getFullYear(), m = state.month.getMonth();
  const first = new Date(y, m, 1).getDay();
  const days = new Date(y, m + 1, 0).getDate();
  const today = dateStr(new Date());
  const byDay = {};
  for (const e of monthEntries()) (byDay[e.date] ||= []).push(e);

  let cells = '';
  for (let i = 0; i < first; i++) cells += '<div class="cell blank"></div>';
  for (let d = 1; d <= days; d++) {
    const ds = `${y}-${pad2(m + 1)}-${pad2(d)}`;
    const list = byDay[ds] || [];
    const stickers = list.slice(-3).map((e, i) => {
      const r = (hash(e.id) - 0.5) * 30;
      return `<img src="${stickerURL(e)}" alt="" style="--r:${r}deg;--i:${i}">`;
    }).join('');
    cells += `<button class="cell ${ds === today ? 'today' : ''} ${list.length ? 'has' : ''}" data-day="${ds}">
      <span class="num">${d}</span>${stickers}${list.length > 3 ? `<span class="more">+${list.length - 3}</span>` : ''}
    </button>`;
  }
  const count = monthEntries().length;
  return `${monthNav()}
    <div class="weekdays">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d) => `<span>${d}</span>`).join('')}</div>
    <div class="grid">${cells}</div>
    <p class="hint">${count ? `${count} little thing${count > 1 ? 's' : ''} this month ♡` : 'Tap ＋ to add your first little thing'}</p>`;
}

// Group by item type, then cluster look-alikes inside each type with CLIP embeddings.
function clusters(list) {
  const out = [];
  for (const e of list) {
    let best = null, bestSim = SIMILAR;
    for (const c of out) {
      const s = Math.max(...c.map((o) => cosine(o.embedding, e.embedding)));
      if (s > bestSim) { best = c; bestSim = s; }
    }
    if (best) best.push(e); else out.push([e]);
  }
  return out.sort((a, b) => b.length - a.length);
}

function collectionView() {
  if (!state.list.length) return `<h2 class="page-title">Collection</h2><p class="hint">Your stickers will be sorted here by type.</p>`;
  const byType = {};
  for (const e of state.list) (byType[e.type] ||= []).push(e);
  const groups = Object.entries(byType).sort((a, b) => b[1].length - a[1].length);
  return `<h2 class="page-title">Collection</h2>` + groups.map(([type, list]) => {
    const t = typeById(type);
    const cl = clusters(list);
    return `<section class="shelf">
      <h3>${t.emoji} ${esc(t.label)} <small>${list.length}</small></h3>
      ${cl.map((c) => `<div class="cluster ${c.length > 1 ? 'multi' : ''}">
        ${c.length > 1 ? `<span class="tag">look-alikes ×${c.length}</span>` : ''}
        <div class="row">${c.map((e) => `<button class="stk" data-entry="${e.id}"><img src="${stickerURL(e)}" alt="${esc(e.name)}" style="--r:${(hash(e.id) - 0.5) * 16}deg"><span>${esc(e.name)}</span></button>`).join('')}</div>
      </div>`).join('')}
    </section>`;
  }).join('');
}

function recapView() {
  const list = monthEntries();
  const title = `${monthNav()}`;
  if (!list.length) return `${title}<div class="recap card"><p class="hint">Nothing here yet. Your month recap fills in as you add stickers.</p></div>`;
  const count = (key) => {
    const m = {};
    for (const e of list) if (e[key]) m[e[key]] = (m[e[key]] || 0) + 1;
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  };
  const topType = count('type')[0];
  const topMood = count('mood')[0];
  const days = new Set(list.map((e) => e.date)).size;
  const collage = list.map((e) => {
    const a = hash(e.id), b = hash(e.id + 'y');
    return `<img src="${stickerURL(e)}" alt="${esc(e.name)}" data-entry="${e.id}" style="left:${8 + a * 64}%;top:${6 + b * 62}%;--r:${(a - 0.5) * 40}deg">`;
  }).join('');
  return `${title}
    <div class="recap card">
      <h3 class="confetti">Your ${MONTHS[state.month.getMonth()]} of little stuff 🎉</h3>
      <div class="stats">
        <div><b>${list.length}</b><span>little things</span></div>
        <div><b>${days}</b><span>happy days</span></div>
        <div><b>${typeById(topType[0]).emoji}</b><span>mostly ${esc(typeById(topType[0]).label.toLowerCase())}</span></div>
        <div><b>${topMood ? topMood[0] : '·'}</b><span>top mood</span></div>
      </div>
      <div class="collage">${collage}</div>
    </div>`;
}

// ---------------- sheet (modal) ----------------
function openSheet(html) {
  $('#sheetBody').innerHTML = html;
  $('#sheet').classList.remove('hidden');
  document.body.classList.add('locked');
}
function closeSheet() {
  $('#sheet').classList.add('hidden');
  document.body.classList.remove('locked');
}

function dayView(ds) {
  const list = state.list.filter((e) => e.date === ds);
  const d = new Date(ds + 'T12:00');
  const title = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const body = list.length ? list.map((e) => `
    <article class="page-item" style="--r:${(hash(e.id) - 0.5) * 6}deg">
      <button class="stk" data-entry="${e.id}"><img src="${stickerURL(e)}" alt="${esc(e.name)}"></button>
      <div class="note">
        <h4>${esc(e.name)} ${e.mood || ''}</h4>
        ${e.note ? `<p>${esc(e.note)}</p>` : ''}
        ${e.place ? `<small>📍 ${esc(e.place)}</small>` : ''}
      </div>
    </article>`).join('') : '<p class="hint">No stickers this day.</p>';
  openSheet(`<header class="sheet-head"><h2>${title}</h2><button class="icon" data-act="close" aria-label="Close">✕</button></header>
    <div class="journal">${body}</div>
    <button class="btn ghost" data-act="add-on" data-day="${ds}">＋ Add to this day</button>`);
}

// ---------------- add / edit flow ----------------
let draft = null; // { id?, stickerBlob, stickerURL, photoBlob, embedding, types, type, name, mood, note, place, date }

async function startAdd(file, date) {
  const photoURL = URL.createObjectURL(file);
  openSheet(`<div class="processing">
      <img class="proc-photo" src="${photoURL}" alt="">
      <div class="scissors">✂️</div>
      <p id="procMsg">Getting ready…</p>
      <ol class="steps">
        <li data-step="models">Load AI models <span></span></li>
        <li data-step="recognize">Recognize the item <span></span></li>
      </ol>
    </div>`);
  const MSG = { models: 'Waking up the AI…', recognize: 'What is this little thing?' };
  let cur = null, curStart = 0;
  const tick = setInterval(() => {
    const li = cur && cur !== 'models' && document.querySelector(`[data-step="${cur}"] span`);
    if (li) li.textContent = `${((performance.now() - curStart) / 1000).toFixed(0)}s`;
  }, 500);
  const onStep = (s) => {
    if (cur) document.querySelector(`[data-step="${cur}"]`)?.classList.replace('doing', 'done');
    cur = s; curStart = performance.now();
    document.querySelector(`[data-step="${s}"]`)?.classList.add('doing');
    const msg = document.getElementById('procMsg');
    if (msg) msg.textContent = MSG[s];
  };
  try {
    const canvas = await fileToCanvas(file, 1024);
    const blob = await toBlob(canvas, 'image/jpeg', 0.92);
    const times = {};

    onStep('models');
    let t = performance.now();
    await modelsReady;
    times.waitModels = Math.round(performance.now() - t);

    onStep('recognize');
    const { result: { embedding, types }, ms } = await ai.recognize(blob);
    times.recognize = ms;
    clearInterval(tick);
    URL.revokeObjectURL(photoURL);

    // Show the form now with a framed-photo placeholder; the die-cut sticker swaps in when ready.
    const placeholder = await toBlob(polaroid(canvas, 640));
    const photoBlob = await toBlob(await fileToCanvas(file, 480), 'image/jpeg', 0.8);
    const top = typeById(types[0].id);
    const d = draft = {
      stickerBlob: placeholder, stickerURL: URL.createObjectURL(placeholder), photoBlob, embedding, types,
      type: top.id, name: top.label, mood: '', note: '', place: '', date: date || dateStr(new Date()),
      times, cutting: true, cutStart: performance.now(),
    };
    d.cutPromise = ai.cutout(blob).then(async ({ result: mask, ms: cutMs }) => {
      const { canvas: st } = makeSticker(canvas, mask);
      const sb = await toBlob(st);
      URL.revokeObjectURL(d.stickerURL);
      d.stickerBlob = sb; d.stickerURL = URL.createObjectURL(sb);
      d.times.cutout = cutMs;
    }).catch((err) => {
      console.error(err);
      d.cutError = String(err.message || err); // keep the framed photo as the sticker
    }).finally(() => {
      d.cutting = false;
      console.log('[little-stuff] timings', d.times, types.slice(0, 3));
      if (draft === d) updatePreview();
    });
    editForm();
  } catch (err) {
    clearInterval(tick);
    console.error(err);
    openSheet(`<header class="sheet-head"><h2>Oops</h2><button class="icon" data-act="close">✕</button></header>
      <p>Couldn't make that sticker: ${esc(err.message || err)}</p>`);
  }
}

// Update just the sticker preview + status lines, without re-rendering the form (keeps typing intact).
function updatePreview() {
  const d = draft;
  const img = $('.preview img');
  if (img && img.src !== d.stickerURL) { img.src = d.stickerURL; img.classList.remove('waiting'); img.style.animation = 'none'; void img.offsetWidth; img.style.animation = ''; }
  const badge = $('#cutBadge');
  if (badge) badge.outerHTML = cutBadge(d);
  const tm = $('#timing');
  if (tm) tm.outerHTML = timingLine(d);
}

function cutBadge(d) {
  if (d.cutting) return `<div id="cutBadge" class="cut-badge">✂️ cutting out your sticker… <span id="cutTimer">${Math.round((performance.now() - d.cutStart) / 1000)}s</span><br><small>keep filling in, it'll pop in when ready</small></div>`;
  if (d.cutError) return `<div id="cutBadge" class="cut-badge err">Couldn't cut this one out, so it's saved as a framed photo.</div>`;
  return '<div id="cutBadge"></div>';
}

function timingLine(d) {
  if (!d.times) return '<p id="timing"></p>';
  const s = (ms) => `${(ms / 1000).toFixed(1)}s`;
  const parts = [];
  if (d.times.waitModels > 500) parts.push(`models ${s(d.times.waitModels)}`);
  parts.push(`recognize ${s(d.times.recognize)}`);
  if (d.times.cutout != null) parts.push(`cut-out ${s(d.times.cutout)} (${aiBackend.startsWith('gpu') ? 'GPU' : 'CPU'})`);
  return `<p id="timing" class="hint small timing">on-device · no photo left your phone<br>${parts.join(' · ')}</p>`;
}
setInterval(() => {
  const el = document.getElementById('cutTimer');
  if (el && draft?.cutting) el.textContent = `${Math.round((performance.now() - draft.cutStart) / 1000)}s`;
}, 500);

function similarTo(embedding, excludeId) {
  let best = null, bestSim = SIMILAR;
  for (const e of state.list) {
    if (e.id === excludeId || !e.embedding) continue;
    const s = cosine(e.embedding, embedding);
    if (s > bestSim) { best = e; bestSim = s; }
  }
  return best;
}

function editForm() {
  const d = draft;
  const sim = similarTo(d.embedding, d.id);
  const suggested = (d.types || []).slice(0, 3).map((t) => t.id);
  const chips = TYPES.map((t) => {
    const isSug = suggested.includes(t.id);
    return `<button class="chip ${d.type === t.id ? 'on' : ''} ${isSug ? '' : 'extra'}" data-type="${t.id}">${t.emoji} ${esc(t.label)}</button>`;
  }).join('');
  openSheet(`<header class="sheet-head"><h2>${d.id ? 'Edit sticker' : 'New little thing'}</h2><button class="icon" data-act="close" aria-label="Close">✕</button></header>
    <div class="preview"><img src="${d.stickerURL}" alt="sticker" class="${d.cutting ? 'waiting' : ''}"></div>
    ${d.times ? cutBadge(d) : ''}
    ${sim ? `<button class="similar" data-act="use-similar" data-entry="${sim.id}"><img src="${stickerURL(sim)}" alt=""><span>Looks like your <b>${esc(sim.name)}</b>! Same group?</span></button>` : ''}
    <label class="lbl">What is it? <small>${d.types ? 'AI guess, tap to fix' : ''}</small></label>
    <div class="chips" id="chips">${chips}<button class="chip more" data-act="more-types">more…</button></div>
    <label class="lbl" for="fName">Name</label>
    <input id="fName" class="field" value="${esc(d.name)}" maxlength="40" autocomplete="off">
    <label class="lbl">Mood</label>
    <div class="moods">${MOODS.map((m) => `<button class="mood ${d.mood === m ? 'on' : ''}" data-mood="${m}">${m}</button>`).join('')}</div>
    <label class="lbl" for="fNote">Why I got it / how I felt</label>
    <textarea id="fNote" class="field" rows="3" placeholder="in your own words…">${esc(d.note)}</textarea>
    <div class="two">
      <div><label class="lbl" for="fPlace">Place</label><input id="fPlace" class="field" value="${esc(d.place)}" placeholder="optional"></div>
      <div><label class="lbl" for="fDate">Date</label><input id="fDate" class="field" type="date" value="${d.date}"></div>
    </div>
    <button class="btn" data-act="save">Stick it in ✨</button>
    ${d.id ? '<button class="btn ghost danger" data-act="delete">Remove sticker</button>' : ''}
    ${d.times ? timingLine(d) : ''}`);
}

function syncDraftFromForm() {
  if (!draft) return;
  draft.name = $('#fName')?.value.trim() ?? draft.name;
  draft.note = $('#fNote')?.value ?? draft.note;
  draft.place = $('#fPlace')?.value.trim() ?? draft.place;
  draft.date = $('#fDate')?.value || draft.date;
}

async function saveDraft(btn) {
  syncDraftFromForm();
  const d = draft;
  if (d.cutting) {
    btn.textContent = 'Finishing your sticker… ✂️';
    await d.cutPromise;
  }
  const old = d.id ? state.list.find((e) => e.id === d.id) : null;
  const entry = {
    id: d.id || uid(),
    createdAt: old?.createdAt || new Date().toISOString(),
    date: d.date, type: d.type, name: d.name || typeById(d.type).label,
    mood: d.mood, note: d.note, place: d.place,
    sticker: d.stickerBlob, photo: d.photoBlob, embedding: d.embedding,
  };
  await entries.put(entry);
  urls.delete(entry.id);
  draft = null;
  closeSheet();
  const dt = new Date(entry.date + 'T12:00');
  state.month = new Date(dt.getFullYear(), dt.getMonth(), 1);
  state.tab = 'calendar';
  await refresh();
  const cell = document.querySelector(`[data-day="${entry.date}"]`);
  cell?.classList.add('pop');
}

function editEntry(id) {
  const e = state.list.find((x) => x.id === id);
  if (!e) return;
  draft = { ...e, stickerBlob: e.sticker, photoBlob: e.photo, stickerURL: stickerURL(e), types: null };
  editForm();
}

// ---------------- events ----------------
let pendingDate = null;
document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('button, [data-entry], [data-day]');
  if (!el) {
    if (ev.target.id === 'sheet') closeSheet();
    return;
  }
  const act = el.dataset.act;
  if (el.dataset.tab) { state.tab = el.dataset.tab; render(); return; }
  if (act === 'prev' || act === 'next') {
    state.month = new Date(state.month.getFullYear(), state.month.getMonth() + (act === 'prev' ? -1 : 1), 1);
    render(); return;
  }
  if (act === 'close') { draft = null; closeSheet(); return; }
  if (act === 'add-on') { pendingDate = el.dataset.day; $('#fileInput').click(); return; }
  if (el.id === 'addBtn') { pendingDate = null; $('#fileInput').click(); return; }
  if (act === 'more-types') { $('#chips').classList.add('all'); return; }
  if (el.dataset.type && draft) {
    syncDraftFromForm();
    const prevLabel = typeById(draft.type).label;
    draft.type = el.dataset.type;
    if (!draft.name || draft.name === prevLabel) draft.name = typeById(draft.type).label;
    const showAll = $('#chips').classList.contains('all');
    editForm();
    if (showAll) $('#chips').classList.add('all');
    return;
  }
  if (el.dataset.mood && draft) { syncDraftFromForm(); draft.mood = draft.mood === el.dataset.mood ? '' : el.dataset.mood; editForm(); return; }
  if (act === 'use-similar' && draft) {
    syncDraftFromForm();
    const s = state.list.find((e) => e.id === el.dataset.entry);
    if (s) { draft.type = s.type; if (draft.name === typeById(draft.types?.[0]?.id).label) draft.name = s.name; }
    editForm(); return;
  }
  if (act === 'save') { el.disabled = true; await saveDraft(el); return; }
  if (act === 'delete' && draft?.id) {
    if (confirm('Remove this sticker?')) { await entries.remove(draft.id); urls.delete(draft.id); draft = null; closeSheet(); refresh(); }
    return;
  }
  if (el.dataset.entry) { editEntry(el.dataset.entry); return; }
  if (el.dataset.day) { dayView(el.dataset.day); return; }
});

$('#fileInput').addEventListener('change', (ev) => {
  const f = ev.target.files?.[0];
  ev.target.value = '';
  if (f) startAdd(f, pendingDate);
});

// ---------------- AI warm-up pill ----------------
const pill = $('#aiStatus');
ai.onProgress((p) => {
  const pct = `${Math.round(p * 100)}%`;
  pill.textContent = `getting sticker magic ready · ${pct}`;
  const li = document.querySelector('[data-step="models"].doing span');
  if (li) li.textContent = `downloading ${pct}`;
});
pill.textContent = 'getting sticker magic ready…';
let aiBackend = 'cpu';
const modelsReady = ai.load();
modelsReady
  .then(({ result }) => {
    aiBackend = result.backend;
    pill.textContent = `sticker magic ready ✨ ${aiBackend.startsWith('gpu') ? '(GPU)' : '(CPU)'}`;
    pill.classList.add('ok'); setTimeout(() => pill.classList.add('fade'), 2500); })
  .catch((e) => { console.error(e); pill.textContent = 'AI failed to load. Tap to retry'; pill.onclick = () => location.reload(); });

// debug hook for testing without a camera: await window.__addFromURL(url)
window.__addFromURL = async (url, date) => {
  const blob = await (await fetch(url)).blob();
  await startAdd(new File([blob], 'test.jpg', { type: blob.type }), date);
};
window.__draft = () => draft;

refresh();
