'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const {
  app, BrowserWindow, Tray, Menu, ipcMain, screen, protocol, net, shell, globalShortcut, nativeImage, session, desktopCapturer,
} = require('electron');

const config = require('./config');
const { TRAY, LANGS } = require('./labels');
const { createBridge } = require('./bridge');
const { startWindowWatch } = require('./windows');
const { createFocusWatch, reasonOf } = require('./focus');
const { startLifeWatch } = require('./life');
const { startNotifyWatch } = require('./notify');
const { launch } = require('./launch');
const desk = require('./desktop');
const { ask } = require('./ask');
const skills = require('./skills');
const cursor = require('./cursor');
const hooks = require('../../scripts/install-hooks');
const demoSteps = require('../../scripts/demo-sequence');

const ROOT = path.resolve(__dirname, '..', '..');
const DEV = process.argv.includes('--dev');
const PORT = Number(process.env.CAPRI_PORT) || 47823;
const SOUND_EXT = /\.(mp3|wav|ogg|m4a)$/i;
const CLAUDE_CODE_HELP = 'https://code.claude.com/docs/en/quickstart';

protocol.registerSchemesAsPrivileged([
  { scheme: 'capri', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

let overlay = null;
let tray = null;
let trayMenu = null; // also what she opens when you right-click her
let demoTimer = null;
let windowWatch = null;
let notifyWatch = null;
// the watcher only speaks when something changes: the overlay asks for this when it (re)loads
let lastWindows = null;

const userSoundsDir = () => path.join(app.getPath('userData'), 'sounds');

// A small local journal of where she went and why (another screen, hidden, put back on screen):
// for the times she "isn't there". Kept on this PC, trimmed when it gets big.
function diag(msg) {
  try {
    const file = path.join(app.getPath('userData'), 'capri-diag.log');
    if (fs.existsSync(file) && fs.statSync(file).size > 256 * 1024) fs.renameSync(file, file + '.old');
    fs.appendFileSync(file, `${new Date().toLocaleString('fr-FR')}  ${msg}\n`);
  } catch { /* nothing to do */ }
}

// capri://app/...        -> files of this repo
// capri://usersounds/... -> the user's own sound overrides
function serveProtocol() {
  protocol.handle('capri', (request) => {
    const url = new URL(request.url);
    const base = url.host === 'usersounds' ? userSoundsDir() : ROOT;
    const target = path.resolve(base, '.' + decodeURIComponent(url.pathname));
    if (target !== base && !target.startsWith(base + path.sep)) {
      return new Response('forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(target).toString());
  });
}

// the screen she lives on (her setting)
function homeDisplay() {
  const { displayId } = config.load();
  return screen.getAllDisplays().find((d) => d.id === displayId) || screen.getPrimaryDisplay();
}

// where she is now: home, unless she fled a game to your other screen (focus.js)
let awayDisplayId = null;
function targetDisplay() {
  return (awayDisplayId && screen.getAllDisplays().find((d) => d.id === awayDisplayId)) || homeDisplay();
}

const focusWatch = createFocusWatch({
  home: homeDisplay,
  log: (msg) => diag(`focus: ${msg} [${lastWindows?.app || '?'}]`),
  moveTo: (display, reason) => {
    awayDisplayId = display ? display.id : null;
    diag(display ? `moved to the other screen (${reason}, ${lastWindows?.app || '?'})` : 'back home');
    tray?.setToolTip(display ? 'Capri — sur ton autre écran (clic : reviens)' : 'Capri');
    fitOverlay();
    sendCommand('relocate', { away: Boolean(display), reason });
  },
  // hidden for a game: once she's folded into her biochip, the whole overlay goes, so not even
  // the chip sits on top of the game
  hide: (on, reason) => {
    clearTimeout(hideTimer);
    diag(on ? `hidden (${reason}, ${lastWindows?.app || '?'})` : 'shown again');
    tray?.setToolTip(on ? 'Capri — cachée (clic : reviens)' : awayDisplayId ? 'Capri — sur ton autre écran (clic : reviens)' : 'Capri');
    if (on) {
      sendCommand('away', { on: true, reason });
      // once she's folded into it (overlay:away), or anyway after a while: hiding the window
      // while she's still moving would freeze her halfway
      hideTimer = setTimeout(() => overlay?.hide(), 8000);
    } else {
      overlay?.showInactive();
      sendCommand('away', { on: false });
    }
  },
});
let hideTimer = null;

// Her screen's usable area: the work area, cut above that screen's taskbar as it really is.
// On the second screen (200 %), Windows sometimes reports a work area that runs under the
// taskbar, and she ended up standing behind it.
function usableArea() {
  const { workArea, bounds } = targetDisplay();
  const area = { ...workArea };
  for (const b of lastWindows?.bars || []) {
    const overlaps = b.x < bounds.x + bounds.width && b.x + b.width > bounds.x && b.y < bounds.y + bounds.height && b.y + b.height > bounds.y;
    if (!overlaps || b.width < b.height) continue; // side taskbars: the work area handles those
    // (a few px of rounding between DIPs and pixels at 200 % don't count)
    if (b.y > bounds.y + bounds.height / 2) {
      // a real taskbar sits against the screen's bottom: the other screen's, converted with the
      // wrong scale, once landed mid-screen here and cut her area down to 912 px
      if (b.y + b.height < bounds.y + bounds.height - 8 || b.height > 120) continue;
      if (b.y - area.y < area.height - 4) area.height = b.y - area.y; // at the bottom
    } else if (b.y > bounds.y + 8 || b.height > 120) {
      continue; // same thing at the top
    } else if (b.y + b.height > area.y + 4) { // at the top
      const cut = b.y + b.height - area.y;
      area.y += cut;
      area.height -= cut;
    }
  }
  return area;
}

function fitOverlay() {
  if (!overlay) return;
  const workArea = usableArea();
  const { workArea: reported } = targetDisplay();
  if (workArea.height !== reported.height) diag(`work area runs under the taskbar (${JSON.stringify(reported)}), using ${JSON.stringify(workArea)}`);
  // with screens at different scales (here 100 % and 200 %), Electron converts the new bounds
  // with the scale of the screen the window is on NOW: straddling both, it lands half off-screen,
  // and again on every retry. A small step fully inside the target screen first fixes the scale.
  overlay.setBounds({ x: workArea.x + 20, y: workArea.y + 20, width: 200, height: 200 });
  overlay.setBounds(workArea);
  // moving to a screen with another scale factor, Windows resizes the window by that factor
  // on the way: the second call lands it on the right size
  overlay.setBounds(workArea);
  overlay.webContents.send('overlay:resize', { width: workArea.width, height: workArea.height, screen: targetDisplay().id });
  windowWatch?.refresh();
}

// With two screens at different scales (100 % / 125 %), Windows sometimes leaves the overlay
// straddling both, half off-screen, and she seems gone. Check now and then and put it back.
function overlayMisplaced() {
  const workArea = usableArea();
  const b = overlay.getBounds();
  return Math.abs(b.x - workArea.x) > 2 || Math.abs(b.y - workArea.y) > 2
    || Math.abs(b.width - workArea.width) > 2 || Math.abs(b.height - workArea.height) > 2;
}

function guardOverlay() {
  if (!overlay || overlay.isDestroyed() || !overlay.isVisible()) return;
  if (overlayMisplaced()) {
    console.log('[capri] overlay misplaced, refitting', overlay.getBounds(), screen.dipToScreenRect(overlay, overlay.getBounds()));
    diag(`overlay misplaced ${JSON.stringify(overlay.getBounds())}, refitting`);
    fitOverlay();
    setTimeout(() => overlay && !overlay.isDestroyed() && overlayMisplaced() && fitOverlay(), 200);
  }
  // other always-on-top windows (games, fullscreen players) can push her under them
  overlay.moveTop();
}

function createOverlay() {
  const { workArea } = targetDisplay();
  overlay = new BrowserWindow({
    ...workArea,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    alwaysOnTop: true,
    type: process.platform === 'win32' ? 'toolbar' : undefined,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.loadURL('capri://app/src/renderer/index.html');
  // always shown: put away, she's still there as her biochip in the corner
  overlay.once('ready-to-show', () => overlay.showInactive());
  overlay.webContents.on('render-process-gone', (_e, details) => {
    console.error('[capri] renderer gone:', details.reason);
  });
  if (DEV) {
    overlay.webContents.on('console-message', (e) => {
      const { level, message, lineNumber, sourceId } = e;
      console.log(`[renderer:${level}] ${message} (${String(sourceId).split('/').pop()}:${lineNumber})`);
    });
    if (process.env.CAPRI_DEVTOOLS) overlay.webContents.openDevTools({ mode: 'detach' });
  }
}

// Ctrl+Alt+Q or her menu: the question box, next to her (out of her biochip if need be)
// (Ctrl+Alt+V: the same, but she'll look at your screen)
function openAsk(name = 'ask') {
  if (focusWatch.away?.hidden) focusWatch.recall(); // the whole overlay is gone: the box would open nowhere
  if (!config.load().visible) toggleVisible(true);
  sendCommand(name);
}

function sendCommand(name, payload = {}) {
  overlay?.webContents.send('capri:command', { name, ...payload });
}

// Ctrl+Alt+C: she folds herself away into her biochip in the corner, or comes back out of it.
function toggleVisible(force) {
  // hidden for a game: that's you calling her back
  if (force === undefined && focusWatch.away?.hidden) {
    focusWatch.recall();
    return;
  }
  const visible = typeof force === 'boolean' ? force : !config.load().visible;
  config.save({ visible });
  sendCommand('stow', { on: !visible });
  rebuildTray();
}

function playDemo() {
  clearTimeout(demoTimer);
  let i = 0;
  const next = () => {
    if (i >= demoSteps.length) return;
    const [delay, evt] = demoSteps[i++];
    demoTimer = setTimeout(() => {
      overlay?.webContents.send('claude:event', evt);
      next();
    }, delay);
  };
  next();
}

// During the demo, a little fake terminal for her to sit on and take over (window tracking is
// Windows only, so only there). Opened without stealing focus; closing it drops her off it.
let demoWin = null;
const DEMO_TERMINAL = `<body style="margin:0;background:#14101c;color:#8f8aa3;font:13px/1.7 Consolas,monospace;padding:14px 18px">
<div style="color:#36ff7a">PS C:\\night-city-api&gt; npm test -- gigs</div>
<div>&nbsp;&nbsp;GET /gigs</div><div style="color:#36ff7a">&nbsp;&nbsp;&nbsp;&nbsp;✓ returns 20 items per page</div>
<div style="color:#36ff7a">&nbsp;&nbsp;&nbsp;&nbsp;✓ paginates with a cursor</div><div style="color:#36ff7a">&nbsp;&nbsp;&nbsp;&nbsp;✓ rejects a bad cursor</div>
<div>&nbsp;&nbsp;6 passing (212ms)</div><div style="color:#36ff7a">PS C:\\night-city-api&gt; _</div></body>`;

function demoWindow(open) {
  demoWin?.destroy();
  demoWin = null;
  if (!open || process.platform !== 'win32') return false;
  const b = overlay.getBounds();
  demoWin = new BrowserWindow({
    x: Math.round(b.x + b.width * 0.5 - 310), y: Math.round(b.y + b.height * 0.42), width: 620, height: 300,
    show: false, alwaysOnTop: true, title: 'night-city-api — npm test', backgroundColor: '#14101c', autoHideMenuBar: true,
  });
  demoWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(DEMO_TERMINAL)}`);
  demoWin.once('ready-to-show', () => demoWin?.showInactive());
  demoWin.on('closed', () => { demoWin = null; });
  return true;
}

// 'auto' -> the first system language Capri speaks, English otherwise.
function resolveLang(setting) {
  if (LANGS.includes(setting)) return setting;
  const preferred = [...app.getPreferredSystemLanguages(), app.getSystemLocale(), app.getLocale()];
  for (const tag of preferred) {
    const base = String(tag || '').toLowerCase().split(/[-_]/)[0];
    if (LANGS.includes(base)) return base;
  }
  return 'en';
}

// What the overlay gets: `lang` is the resolved one, `langSetting` what the user picked.
function rendererConfig() {
  const cfg = config.load();
  return { ...cfg, lang: resolveLang(cfg.lang), langSetting: cfg.lang };
}

function updateConfig(patch) {
  config.save(patch);
  const cfg = rendererConfig();
  overlay?.webContents.send('capri:config', cfg);
  rebuildTray();
  return cfg;
}

function rebuildTray() {
  if (!tray) return;
  const cfg = config.load();
  const hookState = hooks.status();
  const t = TRAY[resolveLang(cfg.lang)];

  const displays = screen.getAllDisplays();
  const current = homeDisplay().id; // her setting, not where she happens to be right now

  const menu = Menu.buildFromTemplate([
    { label: t.online(PORT), enabled: false },
    { type: 'separator' },
    { label: t.teleport, click: () => sendCommand('teleport') },
    { label: t.satellite, click: () => sendCommand('satellite') },
    { label: t.demo, click: playDemo },
    { label: t.help, click: () => sendCommand('welcome') },
    { label: t.ask || 'Lui poser une question', accelerator: 'Ctrl+Alt+Q', click: () => openAsk() },
    { label: t.vision || 'Regarder mon écran', accelerator: 'Ctrl+Alt+V', click: () => openAsk('vision') },
    { label: t.remind || 'Me rappeler quelque chose', accelerator: 'Ctrl+Alt+R', click: () => openAsk('remind') },
    { label: t.hideSeek || 'Jouer à cache-cache', click: () => sendCommand('hide') },
    { label: t.prank || 'Faire une blague', click: () => sendCommand('prank') },
    { label: t.sister || 'Appeler une autre moi', click: () => sendCommand('sister') },
    { label: cfg.visible ? t.hide : t.show, accelerator: 'Ctrl+Alt+C', click: () => toggleVisible() },
    { type: 'separator' },
    {
      label: t.size,
      submenu: [[t.small, 0.45], [t.medium, 0.6], [t.large, 0.8]].map(([label, scale]) => ({
        label, type: 'radio', checked: Math.abs(cfg.scale - scale) < 0.01, click: () => updateConfig({ scale }),
      })),
    },
    {
      label: t.sound,
      submenu: [
        { label: t.mute, type: 'checkbox', checked: cfg.muted, click: (item) => updateConfig({ muted: item.checked }) },
        { type: 'separator' },
        {
          label: t.soundsDir,
          click: () => {
            fs.mkdirSync(userSoundsDir(), { recursive: true });
            shell.openPath(userSoundsDir());
          },
        },
      ],
    },
    {
      label: t.screen,
      enabled: displays.length > 1,
      submenu: displays.map((d, i) => ({
        label: `${i + 1} — ${d.size.width}×${d.size.height}`,
        type: 'radio',
        checked: d.id === current,
        click: () => { config.save({ displayId: d.id }); awayDisplayId = null; focusWatch.homeChanged(); fitOverlay(); rebuildTray(); },
      })),
    },
    { label: t.wander, type: 'checkbox', checked: cfg.wander, click: (item) => updateConfig({ wander: item.checked }) },
    { label: t.possess, type: 'checkbox', checked: cfg.possess, click: (item) => updateConfig({ possess: item.checked }) },
    {
      label: t.lang,
      submenu: [[t.auto, 'auto'], ...LANGS.map((lang) => [TRAY[lang].name, lang])].map(([label, lang]) => ({
        label, type: 'radio', checked: cfg.lang === lang, click: () => updateConfig({ lang }),
      })),
    },
    {
      label: t.startup,
      type: 'checkbox',
      checked: app.getLoginItemSettings(loginItemOptions()).openAtLogin,
      click: (item) => app.setLoginItemSettings({ ...loginItemOptions(), openAtLogin: item.checked }),
    },
    { type: 'separator' },
    hookState.installed
      ? { label: t.hooksOn, enabled: false }
      : { label: t.hooksOff, click: () => runHooks('install') },
    ...(hookState.installed ? [{ label: t.hooksRemove, click: () => runHooks('uninstall') }] : []),
    { type: 'separator' },
    { label: t.quit, click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  trayMenu = menu;
}

// Run from a clone (`npm start`), electron.exe alone would open the default Electron app at login:
// it needs the project folder as argument.
function loginItemOptions() {
  return app.isPackaged ? {} : { path: process.execPath, args: [ROOT] };
}

// From the tray, she says how it went; from her welcome panel (quiet), the panel does.
function runHooks(action, { quiet = false } = {}) {
  let outcome;
  try {
    const result = action === 'install' ? hooks.install() : hooks.uninstall();
    outcome = { action, ok: true, file: result.file };
  } catch (err) {
    outcome = { action, ok: false, error: err.message };
  }
  if (!quiet) sendCommand('hooks', outcome);
  rebuildTray();
  return outcome;
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(ROOT, 'assets', 'icons', 'tray.png'));
  tray = new Tray(icon);
  tray.setToolTip('Capri');
  // away on your other screen, or hidden: a click brings her back (and she stays a while);
  // otherwise she tells you how things are going
  tray.on('click', () => {
    if (focusWatch.away) {
      diag('called back from the tray');
      focusWatch.recall();
      return;
    }
    sendCommand('status');
  });
  rebuildTray();
}

function registerIpc() {
  ipcMain.on('diag', (_e, msg) => diag(`overlay: ${msg}`));
  ipcMain.on('overlay:away', () => {
    if (!focusWatch.away?.hidden) return;
    clearTimeout(hideTimer);
    overlay?.hide();
  });
  // "va sur l'autre écran", "reviens": you decide, for a while
  ipcMain.handle('screen:move', (_e, where) => {
    if (where === 'aside') return focusWatch.aside();
    if (where === 'stow') return toggleVisible(false);
    const was = Boolean(focusWatch.away);
    if (was) focusWatch.recall();
    return was;
  });
  ipcMain.on('overlay:interactive', (_e, on) => {
    overlay?.setIgnoreMouseEvents(!on, { forward: true });
  });
  ipcMain.handle('overlay:cursor', () => {
    const p = screen.getCursorScreenPoint();
    const b = overlay.getBounds();
    return { x: p.x - b.x, y: p.y - b.y, inside: p.x >= b.x && p.y >= b.y && p.x < b.x + b.width && p.y < b.y + b.height };
  });
  ipcMain.handle('config:get', () => rendererConfig());
  ipcMain.handle('hooks:status', () => hooks.status());
  ipcMain.handle('config:set', (_e, patch) => updateConfig(patch));
  ipcMain.handle('demo:window', (_e, open) => demoWindow(open));
  // right-clicking her: the same menu as the tray icon (which Windows often hides behind the ^ by the clock)
  ipcMain.on('menu:open', () => trayMenu?.popup({ window: overlay }));
  // her welcome panel's buttons
  ipcMain.handle('hooks:install', () => runHooks('install', { quiet: true }));
  ipcMain.handle('claude:found', () => fs.existsSync(path.dirname(hooks.status().file))); // Claude Code keeps its settings there
  ipcMain.on('claude:help', () => shell.openExternal(CLAUDE_CODE_HELP));
  ipcMain.handle('windows:get', () => lastWindows);
  // questions you ask her (ask.js): the overlay takes the keyboard only while you type
  ipcMain.handle('ask', (_e, { question, context, vision }) => ask(question, context, { vision: Boolean(vision) }));
  // her zap, when you annoy her: your pointer gets jolted away (cursor.js)
  // "ouvre Spotify": a folder, a shortcut of yours, or a known site (launch.js)
  ipcMain.handle('launch', (_e, query) => launch(String(query || '').slice(0, 120)));
  // what her own mind asks of the PC (skills.js)
  ipcMain.handle('skill:info', () => skills.pcInfo());
  ipcMain.handle('skill:key', (_e, name) => skills.pressKey(String(name)));
  ipcMain.handle('skill:lock', () => skills.lockPc());
  ipcMain.handle('skill:clip', () => skills.screenClip());
  // her hands on your desktop (desktop.js): icons she carries and puts back, taskbar buttons
  ipcMain.handle('desk:icons', (_e, all) => desk.icons(overlay.getBounds(), Boolean(all)));
  ipcMain.handle('desk:snapshot', () => desk.snapshot(overlay.getBounds()));
  ipcMain.handle('desk:take', (_e, i) => desk.take(Number(i)));
  ipcMain.handle('desk:put', (_e, { i, x, y }) => desk.put(overlay.getBounds(), Number(i), Number(x), Number(y)));
  ipcMain.handle('desk:image', (_e, name) => desk.image(String(name || '')));
  ipcMain.handle('desk:restore', () => desk.restore());
  // "range mon bureau" / "range mes fenêtres", and "annule"
  ipcMain.handle('desk:tidyStart', (_e, temporary) => desk.tidyStart(Boolean(temporary)));
  ipcMain.handle('desk:tidyApply', (_e, cells) => desk.tidyApply(overlay.getBounds(), Array.isArray(cells) ? cells.slice(0, 400) : []));
  ipcMain.handle('desk:tidyUndo', () => desk.tidyUndo());
  ipcMain.handle('win:plan', () => desk.windowsPlan(overlay.getBounds(), lastWindows?.wins || [], targetDisplay().workArea));
  ipcMain.handle('win:place', (_e, { id, x, y, w, h }) => desk.placeWindow(overlay.getBounds(), Number(id), Number(x), Number(y), Number(w), Number(h)));
  ipcMain.handle('win:undo', () => desk.windowsUndo());
  ipcMain.handle('desk:find', (_e, words) => desk.findButton(overlay.getBounds(), String(words || '')));
  ipcMain.handle('desk:press', (_e, words) => desk.press(String(words || '')));
  ipcMain.on('cursor:kick', (_e, { dir, power }) => cursor.kick(Math.sign(dir) || 1, Math.min(2, Math.max(1, Number(power) || 1))));
  // only a window she's sitting on, and only a little
  ipcMain.on('window:nudge', (_e, { id, dx }) => {
    const n = Math.max(-60, Math.min(60, Number(dx) || 0));
    if (lastWindows?.wins?.some((w) => w.id === id && !w.max)) cursor.nudge(id, n, targetDisplay().scaleFactor);
  });
  ipcMain.on('overlay:keyboard', (_e, on) => {
    if (!overlay) return;
    overlay.setFocusable(Boolean(on));
    if (on) overlay.focus();
  });
  // her guide: where her tray icon is (it lives in the taskbar, off the overlay, hence overlay
  // coordinates past its edge), and the corner by the clock in case Windows hid it behind the ^
  ipcMain.handle('guide:tray', () => {
    const o = overlay.getBounds();
    const d = targetDisplay().bounds;
    const b = tray?.getBounds();
    const icon = b && b.width > 0 ? { x: b.x - o.x, y: b.y - o.y, w: b.width, h: b.height } : null;
    const corner = { x: d.x + d.width - 150 - o.x, y: d.y + d.height - 44 - o.y, w: 140, h: 40 };
    return { icon, corner };
  });
  // her guide: Claude Code's folder (~/.claude) in Explorer, its settings file selected
  ipcMain.handle('guide:claudeFolder', () => {
    const file = hooks.status().file;
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) return { found: false, dir };
    if (fs.existsSync(file)) shell.showItemInFolder(file);
    else shell.openPath(dir);
    return { found: true, dir, file: fs.existsSync(file) };
  });
  ipcMain.handle('sounds:list', () => {
    try {
      return fs.readdirSync(userSoundsDir())
        .filter((f) => SOUND_EXT.test(f))
        .map((f) => ({ name: f.replace(SOUND_EXT, '').toLowerCase(), url: `capri://usersounds/${encodeURIComponent(f)}` }));
    } catch {
      return [];
    }
  });
}

// Only in --dev: lets scripts drive the overlay and grab frames of it (no desktop content, just our window).
const testWins = new Map(); // name -> test window
let focusSim = false;

async function debugHandler(route, body) {
  if (!DEV) throw new Error('debug routes need --dev');
  if (route === 'command') {
    sendCommand(body.name, body);
    return { ok: true };
  }
  if (route === 'overlay') {
    // where the overlay really is: optionally sent to display #`to` (index) first
    if (body.to !== undefined) {
      const d = screen.getAllDisplays()[body.to];
      awayDisplayId = d ? d.id : null;
      fitOverlay();
      await new Promise((r) => setTimeout(r, 400));
    }
    const b = overlay.getBounds();
    return {
      target: targetDisplay().workArea, scale: targetDisplay().scaleFactor, bounds: b,
      physical: screen.dipToScreenRect(overlay, b), content: overlay.getContentBounds(),
      inner: await overlay.webContents.executeJavaScript('({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio })'),
      displays: screen.getAllDisplays().map((d) => ({ id: d.id, bounds: d.bounds, work: d.workArea, scale: d.scaleFactor })),
    };
  }
  if (route === 'focus') {
    // what the window watcher would say, made up: the real one goes quiet while this is on
    if (body.sim !== undefined) focusSim = Boolean(body.sim);
    if (body.data) focusWatch.update(body.data);
    await new Promise((r) => setTimeout(r, body.wait || 0));
    return {
      away: focusWatch.away, target: targetDisplay().id, displays: screen.getAllDisplays().map((d) => d.id), visible: overlay.isVisible(),
      mons: screen.getAllDisplays().map((d) => screen.dipToScreenRect(null, d.bounds)),
      bounds: overlay.getBounds(), app: lastWindows?.app, fg: lastWindows?.fg, reason: lastWindows?.reason, seen: lastWindows?.seen, wins: lastWindows?.wins,
    };
  }
  if (route === 'reload') {
    overlay.webContents.reloadIgnoringCache();
    return { ok: true };
  }
  if (route === 'testwin') {
    // plain windows to sit on, opened without stealing focus, by name (`id`, default "main");
    // each one opened goes in front of the others. { open: false } without an id closes them all.
    const id = body.id ?? 'main';
    if (!body.open && body.id === undefined) {
      for (const win of testWins.values()) win.destroy();
      testWins.clear();
      return { ok: true };
    }
    testWins.get(id)?.destroy();
    testWins.delete(id);
    if (body.open) {
      const b = overlay.getBounds();
      const win = new BrowserWindow({
        x: b.x + (body.x ?? 300), y: b.y + (body.y ?? 380), width: body.w ?? 720, height: body.h ?? 380,
        show: false, alwaysOnTop: true, title: `Capri test window ${id}`, backgroundColor: '#1b1726', frame: !body.bare, thickFrame: !body.bare,
      });
      win.loadURL('data:text/html,<body style="background:%231b1726"></body>');
      // front: it takes the focus, as a game you just opened or alt-tabbed to
      if (body.front) {
        win.show();
        win.focus();
      } else win.showInactive();
      testWins.set(id, win);
    }
    return { ok: true };
  }
  if (route === 'movewin' && testWins.has(body.id ?? 'main')) {
    const win = testWins.get(body.id ?? 'main');
    const [x, y] = win.getPosition();
    win.setPosition(x + (body.dx || 0), y + (body.dy || 0));
    return { ok: true };
  }
  if (route === 'mouse') {
    // the pointer moving over the overlay (css px), and clicking if asked, without touching the real one
    const at = { x: Math.round(body.x), y: Math.round(body.y) };
    overlay.webContents.sendInputEvent({ type: 'mouseMove', ...at });
    if (body.click) {
      overlay.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...at });
      overlay.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...at });
    }
    return { ok: true };
  }
  if (route === 'capture') {
    const image = await overlay.webContents.capturePage();
    // installed, the app's own folder is read-only: its data folder instead
    const dir = path.join(app.isPackaged ? app.getPath('userData') : ROOT, 'captures');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${(body.name || 'frame').replace(/[^\w-]/g, '')}.png`);
    fs.writeFileSync(file, image.toPNG());
    return { ok: true, file };
  }
  throw new Error('unknown debug route');
}

function main() {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on('second-instance', () => sendCommand('status'));
  if (process.platform === 'win32') app.setAppUserModelId('capri.desktop');

  app.whenReady().then(() => {
    serveProtocol();
    registerIpc();
    createOverlay();
    createTray();
    windowWatch = startWindowWatch({
      overlay,
      onUpdate: (data) => {
        const barsChanged = JSON.stringify(data.bars) !== JSON.stringify(lastWindows?.bars);
        data.reason = reasonOf(data); // a game or a video in front: the same answer everywhere
        lastWindows = data;
        if (barsChanged && overlayMisplaced()) fitOverlay();
        overlay?.webContents.send('windows:update', data);
        if (!focusSim) focusWatch.update(data);
      },
    });
    // the rest of your life on this PC: screen locked, back from a break, unplugged... (life.js)
    startLifeWatch({ onLife: (evt) => sendCommand('life', evt) });
    // an app flashing in the taskbar (a Discord message...): which app only
    notifyWatch = startNotifyWatch({ onFlash: (app) => sendCommand('flash', { app }) });
    // her ears for the music rhythm (play.js): the sound your PC plays, analysed on the spot,
    // never recorded or sent. The picture that comes with it is dropped at once.
    session.defaultSession.setDisplayMediaRequestHandler((_req, callback) => {
      desktopCapturer.getSources({ types: ['screen'] })
        .then((sources) => callback(sources[0] ? { video: sources[0], audio: 'loopback' } : {}))
        .catch(() => callback({}));
    });
    createBridge({
      port: PORT,
      onEvent: (evt) => overlay?.webContents.send('claude:event', evt),
      onDebug: DEV ? debugHandler : null,
    });
    globalShortcut.register('Control+Alt+C', () => toggleVisible());
    globalShortcut.register('Control+Alt+Q', () => openAsk());
    globalShortcut.register('Control+Alt+V', () => openAsk('vision'));
    globalShortcut.register('Control+Alt+R', () => openAsk('remind'));
    cursor.prepare();
    // icons she was carrying when she last stopped (a crash): back where they were
    desk.recover().catch(() => {});
    screen.on('display-metrics-changed', fitOverlay);
    setInterval(guardOverlay, 3000);
    // the pointer, for the overlay: during a drag (an icon off your desktop) Windows sends it no
    // mouse moves, and she has to be able to catch what you drop on her
    let lastCursor = '';
    setInterval(() => {
      if (!overlay || overlay.isDestroyed() || !overlay.isVisible()) return;
      const p = screen.getCursorScreenPoint();
      const key = `${p.x},${p.y}`;
      if (key === lastCursor) return;
      lastCursor = key;
      const b = overlay.getBounds();
      overlay.webContents.send('overlay:cursor', { x: p.x - b.x, y: p.y - b.y, inside: p.x >= b.x && p.y >= b.y && p.x < b.x + b.width && p.y < b.y + b.height });
    }, 120);
    screen.on('display-added', () => { fitOverlay(); rebuildTray(); });
    screen.on('display-removed', () => {
      // she may have been on it: she works out where to be again
      if (awayDisplayId && !screen.getAllDisplays().some((d) => d.id === awayDisplayId)) {
        awayDisplayId = null;
        focusWatch.homeChanged();
      }
      fitOverlay();
      rebuildTray();
    });
  });

  // quitting with one of your icons in her hands: she puts it back first
  let restored = false;
  app.on('before-quit', (e) => {
    if (restored || !desk.pending()) return;
    e.preventDefault();
    restored = true;
    const done = () => app.quit();
    Promise.race([desk.restore(), new Promise((r) => setTimeout(r, 4000))]).then(done, done);
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    windowWatch?.stop();
    notifyWatch?.stop();
    cursor.stop();
    desk.stop();
  });
  app.on('window-all-closed', (e) => e.preventDefault());
}

main();
