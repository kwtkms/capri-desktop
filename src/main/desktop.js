'use strict';

// Her hands on your desktop (desktop.ps1): your desktop icons, which she can pick up, carry around
// and put back, and the taskbar buttons, which she can press.
//
// Moving an icon across the others makes Windows shift them, so she never drags one through the
// grid: before anything, the whole layout is saved (in her config, in case she crashes); the icon
// she "takes" is parked off every screen while she carries its picture; she sets it down only on
// a free cell; and when she puts it back, every icon is checked against the saved layout and put
// back if anything moved. Same check when she quits, and when she starts.

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const { app, screen } = require('electron');
const config = require('./config');

const SCRIPT = path.join(__dirname, 'desktop.ps1').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
const CELL = 76; // an icon's box, physical pixels

let child = null;
let queue = [];
let last = null; // { lv: {x,y}, icons: [...] } physical pixels, from the last listing

function helper() {
  if (child && child.exitCode === null && !child.killed) return child;
  child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, String(process.pid)], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    const next = queue.shift();
    if (!next) return;
    try {
      next.resolve(JSON.parse(line));
    } catch {
      next.resolve({ ok: false });
    }
  });
  child.on('exit', () => {
    child = null;
    for (const q of queue) q.resolve({ ok: false });
    queue = [];
  });
  return child;
}

function ask(line, timeout = 8000) {
  if (process.platform !== 'win32') return Promise.resolve({ ok: false });
  const h = helper();
  return new Promise((resolve) => {
    const entry = { resolve };
    queue.push(entry);
    setTimeout(() => {
      const i = queue.indexOf(entry);
      if (i >= 0) {
        queue.splice(i, 1);
        resolve({ ok: false, timeout: true });
      }
    }, timeout);
    try { h.stdin.write(`${line}\n`); } catch { resolve({ ok: false }); }
  });
}

async function list() {
  const res = await ask('icons');
  if (res.ok) last = res;
  return res.ok ? res : null;
}

// physical screen pixels <-> the overlay's coordinates
const toOverlay = (bounds, x, y) => {
  const p = screen.screenToDipPoint({ x, y });
  return { x: p.x - bounds.x, y: p.y - bounds.y };
};
const toScreen = (bounds, x, y) => screen.dipToScreenPoint({ x: x + bounds.x, y: y + bounds.y });

// all: every icon, even the ones on another screen than hers (tidying works on all of them)
function overlayIcons(bounds, res, all = false) {
  return res.icons
    .map((it) => {
      const a = toOverlay(bounds, res.lv.x + it.x, res.lv.y + it.y);
      const b = toOverlay(bounds, res.lv.x + it.x + CELL, res.lv.y + it.y + CELL);
      return { i: it.i, name: it.name, x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
    })
    .filter((it) => all || (it.x > -10 && it.y > -10 && it.x < bounds.width && it.y < bounds.height));
}

async function icons(bounds, all = false) {
  const res = await list();
  return res ? overlayIcons(bounds, res, all) : [];
}

// the grid's spacing, from where the icons are
function grid(res) {
  const step = (vals, fallback) => {
    const s = [...new Set(vals)].sort((a, b) => a - b);
    let best = Infinity;
    for (let k = 1; k < s.length; k++) if (s[k] - s[k - 1] > 20) best = Math.min(best, s[k] - s[k - 1]);
    return Number.isFinite(best) ? best : fallback;
  };
  const xs = res.icons.map((i) => i.x), ys = res.icons.map((i) => i.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), dx: step(xs, 96), dy: step(ys, 100) };
}

// Free cells of the grid, on a screen (Windows pulls icons left off-screen back into the grid and
// shifts the others to make room, so parking spots must be visible ones): on another screen than
// the main one first, where there are no icons. `except`: icon indexes not to count as in the way.
function freeCells(res, count, { otherScreensOnly = false, except = [] } = {}) {
  const g = grid(res);
  const primary = screen.getPrimaryDisplay().id;
  const displays = screen.getAllDisplays()
    .sort((a, b) => (a.id === primary) - (b.id === primary))
    .filter((d) => !otherScreensOnly || d.id !== primary)
    .map((d) => screen.dipToScreenRect(null, d.workArea));
  const taken = res.icons.filter((i) => !except.includes(i.i));
  const out = [];
  for (const r of displays) {
    // grid columns and rows that fall inside this screen (listview pixels)
    const c0 = Math.ceil((r.x - res.lv.x - g.x0) / g.dx), c1 = Math.floor((r.x + r.width - CELL - res.lv.x - g.x0) / g.dx);
    const r0 = Math.ceil((r.y - res.lv.y - g.y0) / g.dy), r1 = Math.floor((r.y + r.height - CELL - res.lv.y - g.y0) / g.dy);
    for (let col = c1; col >= c0; col--) { // from the far side of the screen
      for (let row = r0; row <= r1; row++) {
        const x = g.x0 + col * g.dx, y = g.y0 + row * g.dy;
        if (x < 0 || y < 0) continue;
        if (taken.some((i) => Math.abs(i.x - x) < g.dx * 0.8 && Math.abs(i.y - y) < g.dy * 0.8)) continue;
        out.push({ x, y });
        if (out.length >= count) return out;
      }
    }
  }
  return out;
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// One thing at a time on your desktop: tidying, a drawing, putting things back, carrying an
// icon... each waits for the one before to be completely done. Two of them overlapping would
// mix up which layout is "before".
let chain = Promise.resolve();
function exclusive(fn) {
  return (...args) => {
    const run = chain.then(() => fn(...args));
    chain = run.catch(() => {});
    return run;
  };
}

// Before she touches anything: the whole layout, saved.
async function snapshot(bounds) {
  const res = await list();
  if (!res) return [];
  const saved = config.load().iconsSnapshot;
  if (!saved || !Object.keys(saved).length) {
    const layout = {};
    for (const it of res.icons) layout[it.name] = { x: it.x, y: it.y };
    config.save({ iconsSnapshot: layout });
  }
  return overlayIcons(bounds, res);
}

// She takes icon i: with another screen, it waits there in a free spot while she carries its
// picture; with only one screen, it stays where it is until she sets it down.
async function take(i) {
  const res = await list();
  if (!res || !config.load().iconsSnapshot) return { ok: false };
  const [spot] = freeCells(res, 1, { otherScreensOnly: true });
  if (!spot) return { ok: true, parked: false };
  await ask(`move ${i} ${spot.x} ${spot.y}`);
  return { ok: true, parked: true };
}

// She sets icon i down near (x, y) of the overlay, on a free cell only.
async function put(bounds, i, x, y) {
  const res = await list();
  if (!res) return { ok: false };
  const g = grid(res);
  const p = toScreen(bounds, x, y);
  const lx = p.x - res.lv.x, ly = p.y - res.lv.y;
  const free = (cx, cy) => !res.icons.some((o) => o.i !== i && Math.abs(o.x - cx) < g.dx * 0.8 && Math.abs(o.y - cy) < g.dy * 0.8);
  const col0 = Math.round((lx - g.x0) / g.dx), row0 = Math.round((ly - g.y0) / g.dy);
  for (let r = 0; r < 6; r++) {
    for (let dc = -r; dc <= r; dc++) {
      for (let dr = -r; dr <= r; dr++) {
        const cx = g.x0 + (col0 + dc) * g.dx, cy = g.y0 + (row0 + dr) * g.dy;
        const s = toOverlay(bounds, res.lv.x + cx, res.lv.y + cy);
        if (cx < 0 || cy < 0 || s.x < 0 || s.y < 0 || s.x > bounds.width - 60 || s.y > bounds.height - 60) continue;
        if (free(cx, cy)) {
          await ask(`move ${i} ${cx} ${cy}`);
          return { ok: true, x: s.x, y: s.y };
        }
      }
    }
  }
  return { ok: false };
}

// Every icon back where the saved layout has it. Ones that moved go through a spot no screen
// shows first, so none of them gets pushed around on the way.
async function restore() {
  const saved = config.load().iconsSnapshot;
  if (!saved || !Object.keys(saved).length) return true;
  const ok = await putBack(saved);
  if (ok) config.save({ iconsSnapshot: null, iconsMoved: {} });
  return ok;
}

// Every icon to the spot `layout` (name -> {x, y}) gives it. The ones out of place first go to free
// cells nowhere near (another screen if there is one), then each to its spot; checked, and once
// more if Windows shuffled something on the way. Returns true when all are in place.
async function putBack(layout) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await list();
    if (!res) return false;
    const wrong = res.icons.filter((it) => layout[it.name] && (layout[it.name].x !== it.x || layout[it.name].y !== it.y));
    if (!wrong.length) return true;
    // free cells that aren't anybody's spot in the layout
    const targets = Object.values(layout);
    const spots = freeCells(res, wrong.length + targets.length)
      .filter((s) => !targets.some((t) => Math.abs(t.x - s.x) < 40 && Math.abs(t.y - s.y) < 40));
    if (process.argv.includes('--dev')) console.log('[desk] putBack attempt', attempt, 'wrong', wrong.length, 'spots', spots.length, JSON.stringify(spots.slice(0, 3)));
    if (spots.length < wrong.length) return false;
    for (const [k, it] of wrong.entries()) await ask(`move ${it.i} ${spots[k].x} ${spots[k].y}`);
    await pause(400);
    for (const it of wrong) await ask(`move ${it.i} ${layout[it.name].x} ${layout[it.name].y}`);
    await pause(400);
  }
  const res = await list();
  return Boolean(res) && res.icons.every((it) => !layout[it.name] || (layout[it.name].x === it.x && layout[it.name].y === it.y));
}

// its picture, for her to carry: the shortcut's own icon
async function image(name) {
  const dirs = [app.getPath('desktop'), process.env.PUBLIC && path.join(process.env.PUBLIC, 'Desktop')].filter(Boolean);
  for (const dir of dirs) {
    let entries = [];
    try { entries = fs.readdirSync(dir); } catch { continue; }
    const file = entries.find((f) => f === name || f.replace(/\.[^.]+$/, '') === name);
    if (!file) continue;
    try {
      const img = await app.getFileIcon(path.join(dir, file), { size: 'large' });
      return img.toDataURL();
    } catch { /* no icon */ }
  }
  return null;
}

async function findButton(bounds, words) {
  const res = await ask(`find ${String(words).slice(0, 60)}`);
  if (!res.ok) return null;
  const a = toOverlay(bounds, res.rect.x, res.rect.y);
  const b = toOverlay(bounds, res.rect.x + res.rect.w, res.rect.y + res.rect.h);
  return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
}

const press = (words) => ask(`press ${String(words).slice(0, 60)}`);

// ---- "range mon bureau": your icons sorted by theme, in columns ----

// "Range mon bureau". plan: icon names in their new order, column by column (rows per column
// given back by tidyStart). The layout from before is saved for "annule"; the new one is applied
// the same careful way as putting icons back (putBack), then she walks along it with her zaps.
// temporary: one of her own drawings, undone by herself a minute later: it goes back to the
// layout of right now (and the "before" of an earlier tidying is kept aside for "annule" after)
async function tidyStart(temporary = false) {
  const res = await list();
  if (!res) return { ok: false };
  const layout = {};
  for (const it of res.icons) layout[it.name] = { x: it.x, y: it.y };
  const prev = config.load();
  if (temporary) {
    config.save({ iconsBeforeTidy: layout, tidyStash: prev.tidyKeepsBefore ? prev.iconsBeforeTidy : null });
  } else if (!(prev.iconsBeforeTidy && prev.tidyKeepsBefore)) {
    // already tidied (or drawn) and not undone: "annule" still goes back to the layout from before
    config.save({ iconsBeforeTidy: layout });
  }
  config.save({ tidyInProgress: true, tidyKeepsBefore: true });
  const g = grid(res);
  const rows = Math.max(...res.icons.map((i) => Math.round((i.y - g.y0) / g.dy))) + 1;
  // the main screen's columns
  const main = screen.dipToScreenRect(null, screen.getPrimaryDisplay().workArea);
  const cols = Math.floor((main.x + main.width - res.lv.x - g.x0 - CELL) / g.dx) + 1;
  return { ok: true, rows: Math.max(3, rows), cols: Math.max(3, cols) };
}

// the new layout: cells is [{ name, col, row }]; returns where each landed in the overlay
async function tidyApply(bounds, cells) {
  const before = config.load().iconsBeforeTidy;
  const res = last || (await list());
  if (!before || !res) return { ok: false };
  const g = grid({ icons: Object.values(before) });
  const layout = {};
  for (const c of cells) if (before[c.name]) layout[c.name] = { x: g.x0 + c.col * g.dx, y: g.y0 + c.row * g.dy };
  const ok = await putBack(layout);
  config.save({ tidyInProgress: false });
  if (!ok) {
    // couldn't lay it out cleanly: back to how it was
    await putBack(before);
    return { ok: false };
  }
  return {
    ok: true,
    at: cells.filter((c) => layout[c.name]).map((c) => {
      const o = toOverlay(bounds, res.lv.x + layout[c.name].x, res.lv.y + layout[c.name].y);
      return { name: c.name, x: o.x, y: o.y };
    }),
  };
}

// back to the layout from before she tidied
async function tidyUndo() {
  const before = config.load().iconsBeforeTidy;
  if (!before) return { ok: false };
  const ok = await putBack(before);
  const stash = config.load().tidyStash;
  if (ok && stash) {
    // back from one of her drawings to your earlier tidying: "annule" can still undo that one
    config.save({ tidyInProgress: false, iconsBeforeTidy: stash, tidyKeepsBefore: true, tidyStash: null });
    return { ok, more: true };
  }
  config.save({ tidyInProgress: false, iconsBeforeTidy: ok ? null : before, tidyKeepsBefore: !ok, tidyStash: null });
  return { ok };
}

// ---- "range mes fenêtres" ----

// The windows to arrange (front first, as windows.ps1 lists them), and the slots for them in
// the work area: 1 big; 2 halves; 3 a big one left + two stacked; 4 a 2x2 grid; 5-6 a 3x2 grid.
async function windowsPlan(bounds, wins, workArea) {
  const area = screen.dipToScreenRect(null, workArea);
  const picked = [];
  for (const w of wins) {
    if (picked.length >= 6) break;
    if (w.w < 300 || w.h < 200) continue;
    if (w.x + w.w / 2 < 0 || w.x + w.w / 2 > bounds.width || w.y + w.h / 2 < 0 || w.y + w.h / 2 > bounds.height) continue; // not on her screen
    const r = await ask(`winrect ${w.id}`);
    if (r.ok) picked.push({ id: w.id, before: { x: r.x, y: r.y, w: r.w, h: r.h, max: r.max } });
  }
  if (!picked.length) return [];
  const gap = 8;
  const { x, y, width: W, height: H } = area;
  const n = picked.length;
  const half = (W - gap * 3) / 2;
  let slots;
  if (n === 1) slots = [{ x: x + W * 0.1, y: y + H * 0.06, w: W * 0.8, h: H * 0.88 }];
  else if (n === 2) slots = [0, 1].map((k) => ({ x: x + gap + k * (half + gap), y: y + gap, w: half, h: H - gap * 2 }));
  else if (n === 3) {
    const hh = (H - gap * 3) / 2;
    slots = [
      { x: x + gap, y: y + gap, w: half, h: H - gap * 2 },
      { x: x + gap * 2 + half, y: y + gap, w: half, h: hh },
      { x: x + gap * 2 + half, y: y + gap * 2 + hh, w: half, h: hh },
    ];
  } else {
    const cols = n === 4 ? 2 : 3;
    const cw = (W - gap * (cols + 1)) / cols, ch = (H - gap * 3) / 2;
    slots = picked.map((_, k) => ({ x: x + gap + (k % cols) * (cw + gap), y: y + gap + Math.floor(k / cols) * (ch + gap), w: cw, h: ch }));
  }
  config.save({ windowsBefore: picked.map((p) => ({ id: p.id, ...p.before })) });
  return picked.map((p, k) => {
    const s = slots[k];
    const to = toOverlay(bounds, Math.round(s.x), Math.round(s.y));
    const to2 = toOverlay(bounds, Math.round(s.x + s.w), Math.round(s.y + s.h));
    const fr = toOverlay(bounds, p.before.x, p.before.y);
    const fr2 = toOverlay(bounds, p.before.x + p.before.w, p.before.y + p.before.h);
    return { id: p.id, from: { x: fr.x, y: fr.y, w: fr2.x - fr.x, h: fr2.y - fr.y }, to: { x: to.x, y: to.y, w: to2.x - to.x, h: to2.y - to.y } };
  });
}

// window id's frame to (x, y, w, h) of the overlay
async function placeWindow(bounds, id, x, y, w, h) {
  const a = toScreen(bounds, x, y);
  const b = toScreen(bounds, x + w, y + h);
  return ask(`place ${id} ${Math.round(a.x)} ${Math.round(a.y)} ${Math.round(b.x - a.x)} ${Math.round(b.y - a.y)}`);
}

// every window back where it was before she arranged them
async function windowsUndo() {
  const before = config.load().windowsBefore;
  if (!before?.length) return { ok: false };
  for (const b of before) {
    await ask(`place ${b.id} ${b.x} ${b.y} ${b.w} ${b.h}`);
    if (b.max) await ask(`maximize ${b.id}`);
  }
  config.save({ windowsBefore: null });
  return { ok: true };
}

const pending = () => Boolean(config.load().iconsSnapshot);

// started up after a crash in the middle of tidying: the layout from before comes back
async function recover() {
  const cfg = config.load();
  if (cfg.tidyInProgress && cfg.iconsBeforeTidy) await tidyUndo();
  else await restore();
}

function stop() {
  child?.kill();
}

module.exports = {
  icons, image, findButton, press, pending, stop, windowsPlan, placeWindow, windowsUndo,
  // everything that moves your icons or rewrites the saved layouts, one at a time
  snapshot: exclusive(snapshot),
  take: exclusive(take),
  put: exclusive(put),
  restore: exclusive(restore),
  recover: exclusive(recover),
  tidyStart: exclusive(tidyStart),
  tidyApply: exclusive(tidyApply),
  tidyUndo: exclusive(tidyUndo),
};
