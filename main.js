const { app, BrowserWindow, ipcMain, session, shell, net } = require('electron');
const fs = require('fs');
const path = require('path');

// Test runs use a throwaway profile and open quietly at given bounds.
const test = process.env.MULTIWATCH_TEST_BOUNDS;
if (process.env.MULTIWATCH_USERDATA) app.setPath('userData', process.env.MULTIWATCH_USERDATA);

// Streams must start with sound without a click inside each player.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Extra stream boards (Streamers, News Live) are the same canvas in their own window,
// each with its own layout file so no board overwrites another.
const BOARDS = { streamers: 'Streamers', news: 'News Live' };
const statePath = (board) => path.join(app.getPath('userData'), BOARDS[board] ? `state-${board}.json` : 'state.json');
const isWeb = (url) => /^https?:\/\//i.test(url);
const BROWSER_UA = () => session.defaultSession.getUserAgent()
  .replace(/\s*Electron\/\S+/, '').replace(/\s*multiwatch\/\S+/i, '');

let win;
// Page windows show websites side by side (not streams): News Desks and Instagram.
// Each has its own file (desks.json, instagram.json) so nothing overwrites anything else.
const PAGE_SETS = { desks: 'News Desks', instagram: 'Instagram' };
const pageWins = {};
const pagesPath = (kind) => path.join(app.getPath('userData'), `${kind}.json`);
function loadPages(kind) {
  try { return JSON.parse(fs.readFileSync(pagesPath(kind), 'utf8')); }
  catch { return null; }
}
function savePages(kind, patch) {
  const next = { ...(loadPages(kind) || {}), ...patch };
  const tmp = pagesPath(kind) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 1));
  fs.renameSync(tmp, pagesPath(kind));
}

function openPages(kind) {
  if (!PAGE_SETS[kind]) return;
  const open = pageWins[kind];
  if (open && !open.isDestroyed()) { if (open.isMinimized()) open.restore(); open.focus(); return; }
  const saved = loadPages(kind) || {};
  // Test runs put it beside the main window on the same (quiet) monitor.
  const tb = test ? test.split(',').map(Number) : null;
  const n = Object.keys(PAGE_SETS).indexOf(kind) + 1;
  const b = tb ? { x: tb[0] + 40 * n, y: tb[1] + 40 * n, width: 1400, height: 860 } : (saved.bounds || { width: 1400, height: 900 });
  const w = new BrowserWindow({
    ...b,
    show: false,
    backgroundColor: '#0b0d12',
    autoHideMenuBar: true,
    title: PAGE_SETS[kind],
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      webviewTag: true,
    },
  });
  pageWins[kind] = w;
  w.removeMenu();
  w.once('ready-to-show', () => (test ? w.showInactive() : w.show()));
  w.webContents.on('will-navigate', (e) => e.preventDefault());
  const remember = () => { if (!w.isMinimized() && !w.isMaximized()) savePages(kind, { bounds: w.getBounds() }); };
  w.on('resize', remember);
  w.on('move', remember);
  // Closed by hand: stay closed next launch. Closed because the app quit: reopen next launch.
  w.on('closed', () => { pageWins[kind] = null; if (!quitting) savePages(kind, { open: false }); });
  w.loadFile(path.join(__dirname, 'renderer', 'desks.html'), { query: { set: kind } });
  savePages(kind, { open: true });
}
// Boards: open state and window position per board, in boards.json.
const boardsPath = () => path.join(app.getPath('userData'), 'boards.json');
function loadBoards() {
  try { return JSON.parse(fs.readFileSync(boardsPath(), 'utf8')); }
  catch { return {}; }
}
function saveBoard(id, patch) {
  const all = loadBoards();
  all[id] = { ...(all[id] || {}), ...patch };
  const tmp = boardsPath() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(all, null, 1));
  fs.renameSync(tmp, boardsPath());
}
const boardWins = {};

function openBoard(id) {
  if (!BOARDS[id]) return;
  const open = boardWins[id];
  if (open && !open.isDestroyed()) { if (open.isMinimized()) open.restore(); open.focus(); return; }
  const saved = loadBoards()[id] || {};
  const tb = test ? test.split(',').map(Number) : null;
  const n = Object.keys(BOARDS).indexOf(id) + 2;
  const b = tb ? { x: tb[0] + 40 * n, y: tb[1] + 40 * n, width: 1500, height: 860 } : (saved.bounds || { width: 1600, height: 900 });
  const w = new BrowserWindow({
    ...b,
    show: false,
    backgroundColor: '#0b0d12',
    autoHideMenuBar: true,
    title: `Multiwatch – ${BOARDS[id]}`,
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      webviewTag: true,
    },
  });
  boardWins[id] = w;
  w.removeMenu();
  w.once('ready-to-show', () => (test ? w.showInactive() : w.show()));
  w.webContents.on('will-navigate', (e) => e.preventDefault());
  const remember = () => { if (!w.isMinimized() && !w.isMaximized()) saveBoard(id, { bounds: w.getBounds() }); };
  w.on('resize', remember);
  w.on('move', remember);
  w.on('closed', () => { boardWins[id] = null; if (!quitting) saveBoard(id, { open: false }); });
  w.loadFile(path.join(__dirname, 'renderer', 'index.html'), { query: { board: id } });
  saveBoard(id, { open: true });
}

let quitting = false;
app.on('before-quit', () => { quitting = true; });

function createWindow() {
  const bounds = test ? test.split(',').map(Number) : null;
  win = new BrowserWindow({
    width: bounds ? bounds[2] : 1600,
    height: bounds ? bounds[3] : 900,
    x: bounds ? bounds[0] : undefined,
    y: bounds ? bounds[1] : undefined,
    show: false,
    backgroundColor: '#0b0d12',
    autoHideMenuBar: true,
    title: 'Multiwatch',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      webviewTag: true,
    },
  });
  win.removeMenu();
  win.once('ready-to-show', () => {
    if (test) win.showInactive();
    else { win.maximize(); win.show(); }
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

// Cloudflare and Google sign-in checks compare the user agent with the browser's brand
// list, and Electron's says only "Chromium", which reads as a bot. Report the brands
// Chrome itself sends (headers and navigator.userAgentData alike).
function chromeLike(contents) {
  const major = process.versions.chrome.split('.')[0];
  const brands = [{ brand: 'Chromium', version: major }, { brand: 'Google Chrome', version: major }, { brand: 'Not=A?Brand', version: '24' }];
  try {
    contents.debugger.attach('1.3');
    contents.debugger.sendCommand('Emulation.setUserAgentOverride', {
      userAgent: BROWSER_UA(),
      userAgentMetadata: {
        brands,
        fullVersionList: brands.map((b) => ({ ...b, version: b.brand === 'Not=A?Brand' ? '24.0.0.0' : process.versions.chrome })),
        platform: 'Windows', platformVersion: '19.0.0', architecture: 'x86', bitness: '64', model: '', mobile: false, wow64: false,
      },
    });
  } catch { /* already attached (e.g. DevTools open): keep the plain user agent */ }
}

app.on('web-contents-created', (_e, contents) => {
  if (contents.session !== session.fromPartition('persist:streams')) return;
  chromeLike(contents);
  if (contents.getType() !== 'webview') return;
  // A sign-in pop-up from a page window (News Desks, Instagram) opens in the app, so the
  // login lands in the app's own profile. Links clicked inside a player open in the normal browser.
  const host = contents.hostWebContents && BrowserWindow.fromWebContents(contents.hostWebContents);
  const inPages = host && Object.values(pageWins).includes(host);
  contents.setWindowOpenHandler(({ url }) => {
    if (inPages && isWeb(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: { width: 560, height: 760, autoHideMenuBar: true, backgroundColor: '#ffffff' } };
    }
    if (isWeb(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
});

ipcMain.handle('state:load', (_e, board) => {
  try { return JSON.parse(fs.readFileSync(statePath(board), 'utf8')); }
  catch { return null; }
});

ipcMain.handle('state:save', (_e, state, board) => {
  const tmp = statePath(board) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 1));
  fs.renameSync(tmp, statePath(board));
});

// A channel URL has no video ID, so ask YouTube what the channel is live with right now.
ipcMain.handle('youtube:resolve', async (_e, channelPath) => {
  if (!/^\/(@[\w.-]+|channel\/[\w-]+|c\/[\w.-]+|user\/[\w.-]+)$/.test(channelPath)) return null;
  const res = await net.fetch(`https://www.youtube.com${channelPath}/live`, {
    headers: { 'User-Agent': BROWSER_UA(), 'Accept-Language': 'en-US,en;q=0.9' },
  });
  const html = await res.text();
  const canonical = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/);
  return canonical ? canonical[1] : null;
});

// Records what a browser sent when a drop had no usable link, since each browser differs.
ipcMain.handle('log:drop', (_e, details) => {
  const entry = JSON.stringify({ at: new Date().toISOString(), ...details });
  fs.appendFileSync(path.join(app.getPath('userData'), 'drop-log.txt'), entry + '\n');
});

ipcMain.handle('window:fullscreen', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  w.setFullScreen(!w.isFullScreen());
  return w.isFullScreen();
});

ipcMain.handle('desks:open', (_e, kind) => openPages(kind || 'desks'));
ipcMain.handle('board:open', (_e, id) => openBoard(id));
ipcMain.handle('desks:load', (_e, kind) => loadPages(kind || 'desks')?.view || null);
ipcMain.handle('desks:save', (_e, view, kind) => savePages(kind || 'desks', { view }));

ipcMain.handle('open:external', (_e, url) => {
  if (isWeb(url)) shell.openExternal(url);
});

app.setAppUserModelId('Multiwatch');

app.whenReady().then(() => {
  // Sign-ins persist here, and sites see a plain Chrome user agent.
  session.fromPartition('persist:streams').setUserAgent(BROWSER_UA());
  createWindow();
  for (const kind of Object.keys(PAGE_SETS)) if (loadPages(kind)?.open) openPages(kind);
  for (const id of Object.keys(BOARDS)) if (loadBoards()[id]?.open) openBoard(id);
});

// Closing the main window ends the app, News Desks included.
app.on('browser-window-created', (_e, w) => {
  if (w === win) w.on('closed', () => app.quit());
});
app.on('window-all-closed', () => app.quit());
