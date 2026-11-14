'use strict';

const $ = (id) => document.getElementById(id);
const canvas = $('canvas');

const DEFAULT_LIBRARY = [
  { label: 'NBC News', url: 'https://www.youtube.com/@NBCNews/live' },
  { label: 'ABC News', url: 'https://www.youtube.com/@ABCNews/live' },
  { label: 'CBS News', url: 'https://www.youtube.com/@CBSNews/live' },
  { label: 'LiveNOW from FOX', url: 'https://www.youtube.com/@LiveNOWFOX/live' },
  { label: 'MS NOW', url: 'https://www.youtube.com/@MSNOW/live' },
  { label: 'C-SPAN', url: 'https://www.youtube.com/@cspan/live' },
  { label: 'HasanAbi', url: 'https://www.twitch.tv/hasanabi' },
];

// This window's board: the main canvas (null) or one of the extra board windows,
// which start with their own streams the first time they open.
const BOARD = new URLSearchParams(location.search).get('board');
const BOARD_NAMES = { streamers: 'Streamers', news: 'News Live' };
const BOARD_DEFAULTS = {
  streamers: [
    { label: 'Destiny', url: 'https://www.youtube.com/@destiny/live' },
    { label: 'Hutch', url: 'https://www.youtube.com/@hutch/live' },
    { label: 'LonerBox', url: 'https://www.youtube.com/@lonerbox/live' },
    { label: "Let's Talk Elections", url: 'https://www.youtube.com/@LetsTalkElections/live' },
    { label: 'Pod Save America', url: 'https://www.youtube.com/@PodSaveAmerica/live' },
    { label: 'Still Counting', url: 'https://www.youtube.com/@StillCounting/live' },
  ],
  news: [
    { label: 'CNN', url: 'https://www.youtube.com/@CNN/live' },
    { label: 'Fox News', url: 'https://www.youtube.com/@FoxNews/live' },
    { label: 'MS NOW', url: 'https://www.youtube.com/@MSNOW/live' },
  ],
};

const MIN_W = 220, MIN_H = 130, SNAP_PX = 9, RETRY_MS = 60000, CHANNEL_CHECK_MS = 120000;

const state = { library: [], tiles: [], layouts: {}, snap: true, libraryOpen: true };
const views = new Map(); // tile id -> DOM and runtime handles
let topZ = 1, activeId = null, saveTimer = null, toastTimer = null;

const uid = () => Math.random().toString(36).slice(2, 10);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* ---------- Links ---------- */

function parseStream(raw) {
  let text = (raw || '').trim();
  if (!text) return null;
  if (/^@[\w.-]+$/.test(text)) text = `https://www.youtube.com/${text}`;
  if (!/^https?:\/\//i.test(text)) text = `https://${text}`;
  let url;
  try { url = new URL(text); } catch { return null; }
  const host = url.hostname.replace(/^(www|m|music)\./, '').toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);

  if (host === 'youtu.be' && parts[0]) return youtubeVideo(parts[0]);
  // A dragged thumbnail can carry its image address instead of the video link.
  if (/^i\d?\.ytimg\.com$/.test(host) && /^vi(_webp)?$/.test(parts[0]) && parts[1]) return youtubeVideo(parts[1]);
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (url.searchParams.get('v')) return youtubeVideo(url.searchParams.get('v'), url.searchParams.get('t'));
    if (['live', 'embed', 'shorts', 'v'].includes(parts[0]) && parts[1]) return youtubeVideo(parts[1]);
    let channel = null;
    if (parts[0]?.startsWith('@')) channel = `/${parts[0]}`;
    else if (['channel', 'c', 'user'].includes(parts[0]) && parts[1]) channel = `/${parts[0]}/${parts[1]}`;
    if (channel) {
      return { platform: 'youtube', channel, url: `https://www.youtube.com${channel}/live`, label: parts[0].startsWith('@') ? parts[0] : parts[1] };
    }
    return null;
  }
  if (host === 'clips.twitch.tv' && parts[0] && /^[\w-]+$/.test(parts[0])) return twitchClip(parts[0]);
  if (host === 'twitch.tv' && parts[1] === 'clip' && parts[2] && /^[\w-]+$/.test(parts[2])) return twitchClip(parts[2]);
  if (host === 'twitch.tv' && parts[0] === 'videos' && /^\d+$/.test(parts[1] || '')) {
    return { platform: 'twitch', vod: parts[1], url: `https://www.twitch.tv/videos/${parts[1]}`, label: 'Twitch video' };
  }
  if (host === 'twitch.tv' || host === 'player.twitch.tv') {
    const name = host === 'player.twitch.tv' ? url.searchParams.get('channel') : parts[0];
    if (!name || !/^\w+$/.test(name) || (host === 'twitch.tv' && parts.length > 1)) return null;
    return { platform: 'twitch', name, url: `https://www.twitch.tv/${name}`, label: name };
  }
  if ((host === 'kick.com' || host === 'player.kick.com') && parts[0] && /^[\w-]+$/.test(parts[0])) {
    return { platform: 'kick', name: parts[0], url: `https://kick.com/${parts[0]}`, label: parts[0] };
  }
  return null;
}

function youtubeVideo(id, time) {
  if (!/^[\w-]{11}$/.test(id)) return null;
  const start = startSeconds(time);
  const suffix = start ? `&t=${start}` : '';
  return { platform: 'youtube', video: id, start, url: `https://www.youtube.com/watch?v=${id}${suffix}`, label: 'YouTube' };
}

// YouTube writes start times as 1110, 1110s or 18m30s.
function startSeconds(time) {
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(time || '');
  return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
}

function twitchClip(slug) {
  return { platform: 'twitch', clip: slug, url: `https://clips.twitch.tv/${slug}`, label: 'Twitch clip' };
}

function playerUrl(stream, videoId, fullPage) {
  if (stream.clip) return `https://clips.twitch.tv/embed?clip=${stream.clip}&parent=localhost&autoplay=true&muted=false`;
  if (stream.vod) return `https://player.twitch.tv/?video=v${stream.vod}&parent=localhost&autoplay=true&muted=false`;
  if (stream.platform === 'twitch') return `https://player.twitch.tv/?channel=${stream.name}&parent=localhost&autoplay=true&muted=false`;
  if (stream.platform === 'kick') return `https://player.kick.com/${stream.name}?autoplay=true&muted=false`;
  const start = stream.start || 0;
  if (fullPage) return `https://www.youtube.com/watch?v=${videoId}${start ? `&t=${start}` : ''}`;
  return `https://www.youtube.com/embed/${videoId}?autoplay=1&playsinline=1&rel=0${start ? `&start=${start}` : ''}`;
}

/* ---------- Persistence ---------- */

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => host.save(state, BOARD), 250);
}

const tileSnapshot = (t) => ({ ...t, maximizedFrom: undefined, id: undefined });

/* ---------- Stream windows ---------- */

function applyRect(tile) {
  const el = views.get(tile.id).el;
  el.style.left = `${tile.x * 100}%`;
  el.style.top = `${tile.y * 100}%`;
  el.style.width = `${tile.w * 100}%`;
  el.style.height = `${tile.h * 100}%`;
  el.style.zIndex = tile.z;
}

function raise(tile) {
  if (activeId !== tile.id || tile.z !== topZ) tile.z = ++topZ;
  activeId = tile.id;
  for (const [id, v] of views) v.el.classList.toggle('active', id === activeId);
  applyRect(tile);
  save();
}

function makeButton(cls, text, title, onClick) {
  const b = document.createElement('button');
  b.className = cls;
  b.textContent = text;
  b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

function mountTile(tile) {
  const stream = parseStream(tile.url);
  const el = document.createElement('section');
  el.className = 'tile';

  const bar = document.createElement('div');
  bar.className = 'tile-bar';
  const dot = document.createElement('span');
  dot.className = `dot ${stream.platform}`;
  const title = document.createElement('span');
  title.className = 'tile-title';
  title.textContent = tile.label;
  title.title = tile.url;

  const mute = makeButton('mute', '', 'Mute or unmute', () => setMuted(tile, !tile.muted));
  const volume = document.createElement('input');
  volume.type = 'range';
  volume.min = 0; volume.max = 100; volume.value = Math.round(tile.volume * 100);
  volume.title = 'Volume';
  volume.addEventListener('input', () => {
    tile.volume = volume.value / 100;
    if (tile.muted && tile.volume > 0) setMuted(tile, false);
    else pushVolume(tile);
    save();
  });
  const solo = makeButton('solo', '🎧', 'Listen to only this stream', () => soloTile(tile));
  const reload = makeButton('reload', '⟳', 'Reload stream', () => loadPlayer(tile));
  const maximize = makeButton('maximize', '⤢', 'Fill the canvas, or restore', () => toggleMaximize(tile));
  const browser = makeButton('browser', '↗', 'Open in your browser', () => host.openExternal(tile.url));
  const close = makeButton('close', '✕', 'Close stream', () => removeTile(tile));
  bar.append(dot, title, mute, volume, solo, reload, browser, maximize, close);

  const view = document.createElement('div');
  view.className = 'tile-view';
  const status = document.createElement('div');
  status.className = 'tile-status';
  status.hidden = true;
  view.append(status);

  el.append(bar, view);
  for (const dir of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
    const grip = document.createElement('div');
    grip.className = `grip ${dir}`;
    grip.addEventListener('pointerdown', (e) => startResize(e, tile, dir));
    el.append(grip);
  }

  bar.addEventListener('pointerdown', (e) => {
    raise(tile);
    if (e.target.closest('button, input')) return;
    startMove(e, tile);
  });
  bar.addEventListener('dblclick', (e) => { if (!e.target.closest('button, input')) toggleMaximize(tile); });
  el.addEventListener('pointerdown', () => raise(tile));

  canvas.append(el);
  views.set(tile.id, { el, view, status, stream, mute, solo, volume, webview: null, retry: null, watch: null, checks: [], poll: null });
  applyRect(tile);
  renderAudio();
  loadPlayer(tile);
}

async function loadPlayer(tile) {
  const v = views.get(tile.id);
  if (!v) return;
  clearTimeout(v.retry);
  clearInterval(v.watch);
  v.checks.forEach(clearTimeout);
  v.checks = [];

  let videoId = v.stream.video;
  if (v.stream.channel) {
    showStatus(v, 'Looking for the live stream…');
    try { videoId = await host.resolveYouTube(v.stream.channel); } catch { videoId = null; }
    if (!views.has(tile.id)) return;
    if (!videoId) {
      destroyWebview(v);
      showStatus(v, `${tile.label} isn't live right now. Checking again every minute.`);
      v.retry = setTimeout(() => loadPlayer(tile), RETRY_MS);
      return;
    }
  }
  showStatus(v, null);
  openWebview(tile, v, playerUrl(v.stream, videoId, false), videoId);
  if (v.stream.channel) watchChannel(tile, v, videoId);
  if (v.stream.platform === 'kick') watchKick(tile, v);
}

// Kick's player swaps to an "offline" page and stays there, so a channel that goes live
// later needs a fresh player. Every other check while nothing is playing, load it again.
function watchKick(tile, v) {
  let idleChecks = 0;
  v.watch = setInterval(async () => {
    if (!views.has(tile.id) || !v.webview || !v.ready) return;
    const idle = await v.webview.executeJavaScript(`(() => {
      const el = document.querySelector('video');
      return !el || el.ended || el.readyState === 0 || el.currentTime === 0;
    })()`).catch(() => false);
    if (!idle) { idleChecks = 0; return; }
    if (++idleChecks % 2 === 0) loadPlayer(tile);
  }, CHANNEL_CHECK_MS);
}

// A channel tile is pinned to the video that was live (or scheduled) when it loaded. If
// that one hasn't started or has ended, ask the channel again: a scheduled stream that went
// live needs a fresh player, and a channel that moved to a new stream needs the new video.
// A video someone paused part-way through is left alone.
function watchChannel(tile, v, videoId) {
  let idleChecks = 0;
  v.watch = setInterval(async () => {
    if (!views.has(tile.id) || !v.webview || !v.ready) return;
    const idle = await v.webview.executeJavaScript(`(() => {
      const el = document.querySelector('video');
      return !el || el.ended || el.readyState === 0 || el.currentTime === 0;
    })()`).catch(() => false);
    if (!idle) { idleChecks = 0; return; }
    idleChecks++;
    let now = null;
    try { now = await host.resolveYouTube(v.stream.channel); } catch {}
    if (!views.has(tile.id)) return;
    if (now && now !== videoId) loadPlayer(tile);
    // Same video still waiting: a fresh player every ~10 minutes, not every check, so a
    // tile parked on a scheduled stream doesn't flash all evening.
    else if (v.webview && idleChecks % 5 === 0) v.webview.reload();
  }, CHANNEL_CHECK_MS);
}

function showStatus(v, text) {
  v.status.hidden = !text;
  v.status.textContent = text || '';
}

function destroyWebview(v) {
  if (v.webview) v.webview.remove();
  v.webview = null;
}

function openWebview(tile, v, src, videoId, fullPage = false) {
  destroyWebview(v);
  const wv = document.createElement('webview');
  wv.setAttribute('partition', 'persist:streams');
  wv.setAttribute('allowpopups', '');
  wv.setAttribute('webpreferences', 'backgroundThrottling=false');
  // YouTube embeds refuse to play when the request has no referrer.
  wv.setAttribute('httpreferrer', 'https://multiwatch.localhost/');
  wv.setAttribute('src', src);

  // A single YouTube video has no channel name in its link, so name it from the page.
  wv.addEventListener('page-title-updated', (e) => {
    const name = e.title.replace(/\s*-\s*YouTube$/, '').trim();
    if (!v.stream.video || tile.label !== 'YouTube' || !name || name === 'YouTube') return;
    tile.label = name;
    v.el.querySelector('.tile-title').textContent = name;
    const entry = state.library.find((l) => sameStream(l.url, tile.url));
    if (entry && entry.label === 'YouTube') {
      entry.label = name;
      renderLibrary();
    }
    save();
  });

  wv.addEventListener('dom-ready', () => {
    v.ready = true;
    wv.setAudioMuted(tile.muted);
    pushVolume(tile);
    if (fullPage) wv.insertCSS(YOUTUBE_PAGE_CSS);
    if (v.stream.platform === 'youtube' && !fullPage) {
      // Some broadcasters block embedding. Their normal page still plays, so switch to it.
      for (const delay of [2500, 6000, 12000]) {
        v.checks.push(setTimeout(async () => {
          if (v.webview !== wv) return;
          const blocked = await wv.executeJavaScript(`!!document.querySelector('.ytp-error, .ytp-embed-error')`).catch(() => false);
          if (blocked && v.webview === wv) {
            v.checks.forEach(clearTimeout);
            openWebview(tile, v, playerUrl(v.stream, videoId, true), videoId, true);
          }
        }, delay));
      }
    }
  });
  v.ready = false;
  v.webview = wv;
  v.view.append(wv);
}

const YOUTUBE_PAGE_CSS = `
  html, body { overflow: hidden !important; background: #000 !important; }
  #masthead-container, #secondary, #below, #chat, #panels, ytd-miniplayer { display: none !important; }
  #movie_player { position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; z-index: 2147483000 !important; }
  #movie_player video { left: 0 !important; top: 0 !important; width: 100vw !important; height: 100vh !important; object-fit: contain; }
`;

// The app owns audio. Players can reset these after buffering or an ad, so keep them applied.
function pushVolume(tile) {
  const v = views.get(tile.id);
  if (!v?.webview || !v.ready) return;
  v.webview.executeJavaScript(`
    window.__mwVolume = ${Number(tile.volume)};
    window.__mwTimer = window.__mwTimer || setInterval(() => {
      document.querySelectorAll('video').forEach((video) => {
        if (video.muted) video.muted = false;
        if (Math.abs(video.volume - window.__mwVolume) > 0.01) video.volume = window.__mwVolume;
      });
    }, 500);
    void 0;
  `).catch(() => {});
}

function setMuted(tile, muted) {
  tile.muted = muted;
  const v = views.get(tile.id);
  if (v?.webview && v.ready) v.webview.setAudioMuted(muted);
  pushVolume(tile);
  renderAudio();
  save();
}

function soloTile(tile) {
  const alreadySolo = !tile.muted && state.tiles.every((t) => t === tile || t.muted);
  for (const t of state.tiles) setMuted(t, alreadySolo ? t.muted : t !== tile);
}

function renderAudio() {
  const live = state.tiles.filter((t) => !t.muted);
  for (const t of state.tiles) {
    const v = views.get(t.id);
    if (!v) continue;
    v.mute.textContent = t.muted ? '🔇' : '🔊';
    v.mute.classList.toggle('is-muted', t.muted);
    v.mute.title = t.muted ? 'Unmute' : 'Mute';
    v.el.classList.toggle('audible', !t.muted);
    v.solo.classList.toggle('on', live.length === 1 && live[0] === t && state.tiles.length > 1);
  }
  $('mute-all').textContent = live.length ? 'Mute all' : 'Unmute all';
}

function removeTile(tile) {
  const v = views.get(tile.id);
  clearTimeout(v.retry);
  clearInterval(v.watch);
  v.checks.forEach(clearTimeout);
  v.el.remove();
  views.delete(tile.id);
  state.tiles = state.tiles.filter((t) => t !== tile);
  if (activeId === tile.id) activeId = null;
  renderAudio();
  renderEmpty();
  save();
}

function renderEmpty() {
  $('empty').hidden = state.tiles.length > 0;
}

function addStream(raw, label, at) {
  const stream = parseStream(raw);
  if (!stream) {
    toast('That link was not recognized. Use a YouTube, Twitch or Kick stream or channel link.');
    return false;
  }
  const box = canvas.getBoundingClientRect();
  const w = clamp(0.36, MIN_W / box.width, 1);
  const h = clamp((w * box.width * 9 / 16 + 30) / box.height, MIN_H / box.height, 1);
  const offset = (state.tiles.length % 8) * 0.03;
  const x = at ? (at.x - box.left) / box.width - w / 2 : 0.02 + offset;
  const y = at ? (at.y - box.top) / box.height - 15 / box.height : 0.02 + offset;
  const tile = {
    id: uid(),
    url: stream.url,
    label: label || stream.label,
    x: clamp(x, 0, 1 - w), y: clamp(y, 0, Math.max(0, 1 - h)), w, h,
    z: ++topZ,
    // Only the first stream starts with sound, so a new one never talks over the others.
    muted: state.tiles.some((t) => !t.muted),
    volume: 1,
  };
  state.tiles.push(tile);
  mountTile(tile);
  raise(tile);
  renderEmpty();
  if (!state.library.some((l) => sameStream(l.url, stream.url))) {
    state.library.push({ label: tile.label, url: stream.url });
    renderLibrary();
  }
  save();
  return true;
}

const sameStream = (a, b) => a.toLowerCase() === b.toLowerCase();

/* ---------- Move, resize, snap ---------- */

function pixelRect(tile, box) {
  return { x: tile.x * box.width, y: tile.y * box.height, w: tile.w * box.width, h: tile.h * box.height };
}

function snapLines(tile, box) {
  const xs = [0, box.width], ys = [0, box.height];
  for (const other of state.tiles) {
    if (other === tile) continue;
    const r = pixelRect(other, box);
    xs.push(r.x, r.x + r.w);
    ys.push(r.y, r.y + r.h);
  }
  return { xs, ys };
}

function nearest(value, lines) {
  let best = null, gap = SNAP_PX + 0.01;
  for (const line of lines) {
    const d = Math.abs(line - value);
    if (d < gap) { gap = d; best = line; }
  }
  return best;
}

function capture(e, onMove) {
  e.preventDefault();
  const target = e.currentTarget;
  target.setPointerCapture(e.pointerId);
  document.body.classList.add('interacting');
  const move = (ev) => onMove(ev);
  const end = () => {
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', end);
    target.removeEventListener('pointercancel', end);
    document.body.classList.remove('interacting');
    save();
  };
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerup', end);
  target.addEventListener('pointercancel', end);
}

function startMove(e, tile) {
  const box = canvas.getBoundingClientRect();
  const start = pixelRect(tile, box);
  const sx = e.clientX, sy = e.clientY;
  const lines = snapLines(tile, box);
  capture(e, (ev) => {
    let x = start.x + ev.clientX - sx;
    let y = start.y + ev.clientY - sy;
    if (state.snap && !ev.altKey) {
      const left = nearest(x, lines.xs), right = nearest(x + start.w, lines.xs);
      if (left !== null) x = left; else if (right !== null) x = right - start.w;
      const top = nearest(y, lines.ys), bottom = nearest(y + start.h, lines.ys);
      if (top !== null) y = top; else if (bottom !== null) y = bottom - start.h;
    }
    tile.x = clamp(x, 0, Math.max(0, box.width - start.w)) / box.width;
    tile.y = clamp(y, 0, Math.max(0, box.height - start.h)) / box.height;
    tile.maximizedFrom = null;
    applyRect(tile);
  });
}

function startResize(e, tile, dir) {
  e.stopPropagation();
  raise(tile);
  const box = canvas.getBoundingClientRect();
  const start = pixelRect(tile, box);
  const sx = e.clientX, sy = e.clientY;
  const lines = snapLines(tile, box);
  const ratio = start.w / Math.max(1, start.h - 30);
  capture(e, (ev) => {
    const dx = ev.clientX - sx, dy = ev.clientY - sy;
    let left = start.x, top = start.y, right = start.x + start.w, bottom = start.y + start.h;
    if (dir.includes('w')) left = clamp(left + dx, 0, right - MIN_W);
    if (dir.includes('e')) right = clamp(right + dx, left + MIN_W, box.width);
    if (dir.includes('n')) top = clamp(top + dy, 0, bottom - MIN_H);
    if (dir.includes('s')) bottom = clamp(bottom + dy, top + MIN_H, box.height);

    if (ev.shiftKey) {
      // Shift keeps the window's picture shape.
      const fromWidth = dir.includes('e') || dir.includes('w');
      if (fromWidth) {
        const h = (right - left) / ratio + 30;
        if (dir.includes('n')) top = Math.max(0, bottom - h); else bottom = Math.min(box.height, top + h);
      } else {
        const w = (bottom - top - 30) * ratio;
        if (dir.includes('w')) left = Math.max(0, right - w); else right = Math.min(box.width, left + w);
      }
    } else if (state.snap && !ev.altKey) {
      const snapTo = (value, set) => { const n = nearest(value, set); return n === null ? value : n; };
      if (dir.includes('w')) { const v = snapTo(left, lines.xs); if (right - v >= MIN_W) left = v; }
      if (dir.includes('e')) { const v = snapTo(right, lines.xs); if (v - left >= MIN_W) right = v; }
      if (dir.includes('n')) { const v = snapTo(top, lines.ys); if (bottom - v >= MIN_H) top = v; }
      if (dir.includes('s')) { const v = snapTo(bottom, lines.ys); if (v - top >= MIN_H) bottom = v; }
    }
    tile.x = left / box.width;
    tile.y = top / box.height;
    tile.w = (right - left) / box.width;
    tile.h = (bottom - top) / box.height;
    tile.maximizedFrom = null;
    applyRect(tile);
  });
}

function toggleMaximize(tile) {
  if (tile.maximizedFrom) {
    Object.assign(tile, tile.maximizedFrom, { maximizedFrom: null });
  } else {
    tile.maximizedFrom = { x: tile.x, y: tile.y, w: tile.w, h: tile.h };
    Object.assign(tile, { x: 0, y: 0, w: 1, h: 1 });
  }
  raise(tile);
}

/* ---------- Arrangements ---------- */

function setRect(tile, x, y, w, h) {
  Object.assign(tile, { x, y, w, h, maximizedFrom: null });
  applyRect(tile);
}

function arrangeGrid() {
  const n = state.tiles.length;
  if (!n) return;
  const box = canvas.getBoundingClientRect();
  let best = { cols: 1, area: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cw = box.width / cols, ch = box.height / rows - 30;
    const area = Math.min(cw, ch * 16 / 9) ** 2;
    if (area > best.area) best = { cols, area };
  }
  const rows = Math.ceil(n / best.cols);
  state.tiles.forEach((tile, i) => {
    const row = Math.floor(i / best.cols);
    const inRow = row === rows - 1 ? n - best.cols * (rows - 1) : best.cols;
    setRect(tile, (i % best.cols) / inRow, row / rows, 1 / inRow, 1 / rows);
  });
  save();
}

function arrangeSpotlight() {
  const n = state.tiles.length;
  if (!n) return;
  const main = state.tiles.find((t) => t.id === activeId) || state.tiles[0];
  const others = state.tiles.filter((t) => t !== main);
  if (!others.length) return setRect(main, 0, 0, 1, 1), save();
  const cols = others.length > 4 ? 2 : 1;
  const sideW = cols === 2 ? 0.36 : 0.25;
  setRect(main, 0, 0, 1 - sideW, 1);
  const rows = Math.ceil(others.length / cols);
  others.forEach((tile, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    setRect(tile, 1 - sideW + col * sideW / cols, row / rows, sideW / cols, 1 / rows);
  });
  save();
}

/* ---------- Library ---------- */

function renderLibrary() {
  const list = $('library-list');
  list.replaceChildren();
  state.library.forEach((item, index) => {
    const stream = parseStream(item.url);
    const li = document.createElement('li');
    li.draggable = true;
    li.title = item.url;
    const dot = document.createElement('span');
    dot.className = `dot ${stream?.platform || ''}`;
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = item.label;
    const remove = makeButton('remove', '✕', 'Remove from library', (e) => {
      e.stopPropagation();
      state.library.splice(index, 1);
      renderLibrary();
      save();
    });
    li.append(dot, name, remove);
    li.addEventListener('dblclick', () => addStream(item.url, item.label));
    li.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-multiwatch', JSON.stringify(item));
      e.dataTransfer.setData('text/plain', item.url);
      e.dataTransfer.effectAllowed = 'copy';
    });
    list.append(li);
  });
}

function setupDrop() {
  // Files and links dragged anywhere raise a shield, so players cannot swallow the drop.
  let depth = 0;
  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    depth++;
    document.body.classList.add('dropping', 'interacting');
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  const finish = () => {
    depth = 0;
    document.body.classList.remove('dropping', 'interacting');
  };
  window.addEventListener('dragleave', () => { if (--depth <= 0) finish(); });
  window.addEventListener('dragend', finish);
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    finish();
    if (!canvas.contains(e.target)) return;
    const at = { x: e.clientX, y: e.clientY };
    const own = e.dataTransfer.getData('application/x-multiwatch');
    if (own) {
      const item = JSON.parse(own);
      addStream(item.url, item.label, at);
      return;
    }
    const candidates = linksFromDrag(e.dataTransfer);
    const snapshot = {
      types: [...e.dataTransfer.types].map((t) => [t, e.dataTransfer.getData(t).slice(0, 500)]),
      files: [...e.dataTransfer.files].map((f) => [f.name, f.type, f.size]),
    };
    const files = [...e.dataTransfer.files].filter((f) => /\.url$/i.test(f.name));
    Promise.all(files.map((f) => f.text())).then((texts) => {
      for (const text of texts) candidates.push(...linksInText(text));
      const link = candidates.find((c) => parseStream(c));
      if (link) {
        addStream(link, null, at);
        return;
      }
      host.logDrop(snapshot);
      toast('Browsers don\'t share the address when you drag a tab. Copy the address and press Ctrl+V here, or drag a link from the page.');
    });
  });
}

function linksInText(text) {
  const decoded = text.replace(/&amp;/g, '&');
  const absolute = decoded.match(/https?:\/\/[^\s"'<>]+/g) || [];
  // Page HTML can link to videos by path alone.
  const relative = [...decoded.matchAll(/href="(\/(?:watch\?|shorts\/|live\/)[^"]+)"/g)]
    .map((m) => `https://www.youtube.com${m[1]}`);
  return [...absolute, ...relative];
}

// Browsers package a dragged link differently, so look through every format they send.
function linksFromDrag(data) {
  const priority = ['text/uri-list', 'text/x-moz-url', 'url', 'text/plain', 'text/html'];
  const rank = (type) => { const i = priority.indexOf(type.toLowerCase()); return i < 0 ? priority.length : i; };
  const types = [...data.types].filter((t) => t !== 'Files').sort((a, b) => rank(a) - rank(b));
  const links = [];
  for (const type of types) {
    const text = data.getData(type);
    links.push(...linksInText(text));
    if (type === 'text/plain' && text.trim()) links.push(text.trim());
  }
  return links;
}

/* ---------- Layouts ---------- */

function loadLayout(name) {
  const saved = state.layouts[name];
  if (!saved) return;
  for (const tile of [...state.tiles]) removeTile(tile);
  for (const entry of saved) {
    const tile = { ...entry, id: uid(), z: ++topZ };
    state.tiles.push(tile);
    mountTile(tile);
  }
  renderAudio();
  renderEmpty();
  save();
}

function renderLayouts() {
  const list = $('layout-list');
  list.replaceChildren();
  for (const name of Object.keys(state.layouts).sort()) {
    const li = document.createElement('li');
    const load = makeButton('load', name, `Open ${name}`, () => {
      loadLayout(name);
      $('layouts-pop').hidden = true;
    });
    const del = makeButton('icon-btn', '✕', `Delete ${name}`, () => {
      delete state.layouts[name];
      renderLayouts();
      save();
    });
    li.append(load, del);
    list.append(li);
  }
}

/* ---------- Top bar ---------- */

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4500);
}

function renderChrome() {
  $('snap').classList.toggle('on', state.snap);
  $('library').hidden = !state.libraryOpen;
}

function setupPaste() {
  // Ctrl+V anywhere in the app adds the copied link, except while typing in a box.
  document.addEventListener('paste', (e) => {
    if (e.target.closest?.('input')) return;
    const text = e.clipboardData.getData('text/plain');
    e.preventDefault();
    addStream(linksInText(text).find((l) => parseStream(l)) ?? text);
  });
}

function setupTopbar() {
  $('add-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (addStream($('add-input').value)) $('add-input').value = '';
  });
  $('toggle-library').addEventListener('click', () => {
    state.libraryOpen = !state.libraryOpen;
    renderChrome();
    save();
  });
  $('mute-all').addEventListener('click', () => {
    const anyLive = state.tiles.some((t) => !t.muted);
    for (const t of state.tiles) setMuted(t, anyLive);
  });
  $('grid').addEventListener('click', arrangeGrid);
  $('spotlight').addEventListener('click', arrangeSpotlight);
  $('snap').addEventListener('click', () => {
    state.snap = !state.snap;
    renderChrome();
    save();
  });
  $('fullscreen').addEventListener('click', () => host.toggleFullscreen());
  $('news-desks').addEventListener('click', () => host.openDesks('desks'));
  $('instagram').addEventListener('click', () => host.openDesks('instagram'));
  for (const b of document.querySelectorAll('[data-board]')) {
    b.addEventListener('click', () => host.openBoard(b.dataset.board));
  }
  $('layouts-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    $('layouts-pop').hidden = !$('layouts-pop').hidden;
    if (!$('layouts-pop').hidden) $('layout-name').focus();
  });
  $('layouts-pop').addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => { $('layouts-pop').hidden = true; });
  $('layout-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('layout-name').value.trim();
    if (!name) return;
    state.layouts[name] = state.tiles.map(tileSnapshot);
    $('layout-name').value = '';
    renderLayouts();
    save();
    toast(`Saved layout "${name}"`);
  });
}

/* ---------- Start ---------- */

(async function start() {
  const saved = await host.load(BOARD);
  const defaults = BOARD_DEFAULTS[BOARD];
  Object.assign(state, saved || { library: (defaults || DEFAULT_LIBRARY).map((l) => ({ ...l })) });
  if (BOARD_NAMES[BOARD]) {
    document.title = `Multiwatch – ${BOARD_NAMES[BOARD]}`;
    document.querySelector('.brand').textContent = BOARD_NAMES[BOARD];
  }
  for (const b of document.querySelectorAll('[data-board]')) b.hidden = b.dataset.board === BOARD;
  state.tiles = state.tiles.filter((t) => parseStream(t.url));
  topZ = state.tiles.reduce((m, t) => Math.max(m, t.z || 1), 1);
  setupTopbar();
  setupDrop();
  setupPaste();
  renderChrome();
  renderLibrary();
  renderLayouts();
  state.tiles.forEach(mountTile);
  renderAudio();
  renderEmpty();
  // First open of a board: its streams side by side, all muted so it never talks over
  // the main window. Unmute one with its speaker button.
  if (defaults && !saved) {
    for (const d of defaults) addStream(d.url, d.label);
    for (const t of state.tiles) setMuted(t, true);
    arrangeGrid();
  }
})();
