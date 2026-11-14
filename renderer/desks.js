/* Page windows: websites side by side, shown as-is (signed in through the same profile
   as the streams), never read or scraped. Two sets use this page:
   - News Desks (?set=desks): the four decision desks' results pages, for watching their
     calls. Each address can be changed and is remembered, for when a desk moves its
     results to a new page on the night.
   - Instagram (?set=instagram): accounts' profiles, where a live video shows as a LIVE
     ring on the profile picture. Accounts can be added and removed. */

const SET = new URLSearchParams(location.search).get('set') === 'instagram' ? 'instagram' : 'desks';
const SETS = {
  desks: {
    title: 'News Desks',
    hint: 'Their own pages, live. Sound is off until you turn it on.',
    panes: [
      { id: 'ap', name: 'AP', color: '#e5383b', url: 'https://apnews.com/hub/election-2026' },
      { id: 'nyt', name: 'NYT', color: '#d4d4d8', url: 'https://www.nytimes.com/' },
      { id: 'ddhq', name: 'DDHQ', color: '#4c8dff', url: 'https://results.decisiondeskhq.com/' },
      { id: 'fox', name: 'Fox', color: '#f5a524', url: 'https://www.foxnews.com/elections/2026/midterm-results' },
    ],
  },
  instagram: {
    title: 'Instagram',
    hint: 'Sign in once inside a pane. A LIVE ring on the profile picture means they\u2019re live: click it.',
    editable: true,
    panes: [
      { id: 'aaronparnas', name: 'Aaron Parnas', color: '#e1306c', url: 'https://www.instagram.com/aaronparnas/' },
      { id: 'us.elections', name: '@us.elections', color: '#e1306c', url: 'https://www.instagram.com/us.elections/' },
      { id: 'isaiahrmartin', name: 'Isaiah Martin', color: '#e1306c', url: 'https://www.instagram.com/isaiahrmartin/' },
    ],
  },
};
const CFG = SETS[SET];
const DEFAULT_PANES = CFG.panes;

const $ = (id) => document.getElementById(id);
const isWeb = (url) => /^https?:\/\//i.test(url);
let view = { layout: 'grid', panes: DEFAULT_PANES.map((p) => ({ ...p })) };
const live = new Map();          // pane id -> { el, wv, status, sound }
let solo = null;

function save() { host.saveDesks({ ...view, seen: DEFAULT_PANES.map((p) => p.id) }, SET); }

function ago(t) {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'loaded just now' : `loaded ${m} min ago`;
}

function mountPane(p) {
  const el = document.createElement('section');
  el.className = 'pane';
  el.style.setProperty('--desk', p.color);
  el.innerHTML = `
    <div class="pane-bar">
      <span class="name"></span>
      <input type="text" spellcheck="false" autocomplete="off" title="Paste a different page and press Enter">
      <span class="status"></span>
      <button class="sound" title="Sound on or off">Sound off</button>
      <button class="icon-btn reload" title="Reload">⟳</button>
      <button class="icon-btn ext" title="Open in your browser">↗</button>
      <button class="icon-btn grow" title="Fill the window (again to go back)">⤢</button>
      ${CFG.editable ? '<button class="icon-btn remove" title="Remove">✕</button>' : ''}
    </div>`;
  el.querySelector('.name').textContent = p.name;
  const input = el.querySelector('input');
  input.value = p.url;

  const wv = document.createElement('webview');
  wv.setAttribute('partition', 'persist:streams');
  wv.setAttribute('allowpopups', '');   // sign-in pop-ups (Google, Apple) open in the app
  wv.setAttribute('webpreferences', 'backgroundThrottling=false');
  wv.setAttribute('src', p.url);
  el.appendChild(wv);

  const v = { el, wv, status: el.querySelector('.status'), sound: false, loadedAt: 0 };
  live.set(p.id, v);

  wv.addEventListener('dom-ready', () => wv.setAudioMuted(!v.sound));
  wv.addEventListener('did-start-loading', () => { v.status.textContent = 'loading…'; });
  // News pages never stop loading ads, so "loaded" means the page itself is in.
  wv.addEventListener('dom-ready', () => { v.loadedAt = Date.now(); v.status.textContent = ago(v.loadedAt); });
  wv.addEventListener('did-fail-load', (e) => {
    if (e.isMainFrame && e.errorCode !== -3) v.status.textContent = 'didn’t load, try ⟳';
  });
  // Following a link inside the page: show where it went, so it can be kept with Enter.
  wv.addEventListener('did-navigate', (e) => { if (document.activeElement !== input) input.value = e.url; });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { input.value = p.url; input.blur(); }
    if (e.key !== 'Enter') return;
    let url = input.value.trim();
    if (url && !isWeb(url)) url = 'https://' + url;
    if (!isWeb(url)) return;
    p.url = url;
    input.value = url;
    input.blur();
    wv.loadURL(url);
    save();
  });
  el.querySelector('.sound').addEventListener('click', (e) => {
    v.sound = !v.sound;
    wv.setAudioMuted(!v.sound);
    e.currentTarget.textContent = v.sound ? 'Sound on' : 'Sound off';
    e.currentTarget.classList.toggle('live', v.sound);
  });
  el.querySelector('.reload').addEventListener('click', () => wv.reload());
  el.querySelector('.ext').addEventListener('click', () => host.openExternal(wv.getURL() || p.url));
  el.querySelector('.grow').addEventListener('click', () => setSolo(solo === p.id ? null : p.id));
  el.querySelector('.remove')?.addEventListener('click', () => {
    if (!confirm(`Remove ${p.name}?`)) return;
    if (solo === p.id) setSolo(null);
    el.remove();
    live.delete(p.id);
    view.panes = view.panes.filter((x) => x !== p);
    renderLayout();
    save();
  });
  $('desks').appendChild(el);
}

// "@aaronparnas", "aaronparnas" or an instagram.com profile link -> a pane.
function instagramPane(raw) {
  let text = raw.trim();
  const m = text.match(/instagram\.com\/([\w.]+)/i);
  if (m) text = m[1];
  text = text.replace(/^@/, '');
  if (!/^[\w.]{1,30}$/.test(text)) return null;
  const id = text.toLowerCase();
  return { id, name: '@' + id, color: '#e1306c', url: `https://www.instagram.com/${id}/` };
}

function setSolo(id) {
  solo = id;
  $('desks').classList.toggle('solo', !!id);
  for (const [pid, v] of live) v.el.classList.toggle('big', pid === id);
}

function renderLayout() {
  const n = Math.max(1, view.panes.length), cols = Math.ceil(Math.sqrt(n));
  $('desks').classList.toggle('cols', view.layout === 'cols');
  $('desks').style.gridTemplateColumns = `repeat(${view.layout === 'cols' ? n : cols}, 1fr)`;
  $('desks').style.gridTemplateRows = view.layout === 'cols' ? '1fr' : `repeat(${Math.ceil(n / cols)}, 1fr)`;
  for (const b of $('layout').children) b.classList.toggle('on', b.dataset.v === view.layout);
}

(async function start() {
  document.title = CFG.title;
  $('brand').textContent = CFG.title;
  $('hint').textContent = CFG.hint;
  $('add-form').hidden = !CFG.editable;
  // Instagram's pages are tall, so its accounts start side by side.
  if (SET === 'instagram') view.layout = 'cols';
  const saved = await host.loadDesks(SET);
  if (saved && Array.isArray(saved.panes) && CFG.editable) {
    // Every account that was added is kept, in its order.
    view.layout = saved.layout === 'grid' ? 'grid' : 'cols';
    view.panes = saved.panes.filter((p) => p && p.id && isWeb(p.url));
    // Accounts added to the defaults later still show up once; one removed by hand stays removed.
    const seen = new Set(saved.seen || view.panes.map((p) => p.id));
    for (const d of DEFAULT_PANES) if (!seen.has(d.id) && !view.panes.some((p) => p.id === d.id)) view.panes.push({ ...d });
  } else if (saved && Array.isArray(saved.panes)) {
    // Keep remembered addresses, but always the four desks in their order.
    view.layout = saved.layout === 'cols' ? 'cols' : 'grid';
    for (const p of view.panes) {
      const s = saved.panes.find((x) => x.id === p.id);
      if (s && isWeb(s.url)) p.url = s.url;
    }
  }
  view.panes.forEach(mountPane);
  renderLayout();

  $('layout').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    view.layout = b.dataset.v;
    setSolo(null);
    renderLayout();
    save();
  });
  $('reload-all').addEventListener('click', () => { for (const v of live.values()) v.wv.reload(); });
  $('reset').addEventListener('click', () => {
    if (!confirm('Put back the original pages?')) return;
    setSolo(null);
    for (const v of live.values()) v.el.remove();
    live.clear();
    view.panes = DEFAULT_PANES.map((p) => ({ ...p }));
    view.panes.forEach(mountPane);
    renderLayout();
    save();
  });
  $('add-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const p = instagramPane($('add-input').value);
    if (!p) return;
    $('add-input').value = '';
    if (view.panes.some((x) => x.id === p.id)) return;
    view.panes.push(p);
    mountPane(p);
    renderLayout();
    save();
  });
  $('fullscreen').addEventListener('click', () => host.toggleFullscreen());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && solo && e.target.tagName !== 'INPUT') setSolo(null); });
  // Keep the "loaded N min ago" labels honest.
  setInterval(() => { for (const v of live.values()) if (v.loadedAt) v.status.textContent = ago(v.loadedAt); }, 30000);
})();
