'use strict';

// Feeds the overlay with the position of the other windows (Windows only), so Capri can
// sit on them. A small PowerShell helper does the Win32 calls; we turn its physical pixels
// into the overlay's coordinates.

const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const { screen } = require('electron');

// in the installed app it sits next to the app archive (asarUnpack), where PowerShell can read it
const SCRIPT = path.join(__dirname, 'windows.ps1').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

function startWindowWatch({ overlay, onUpdate }) {
  if (process.platform !== 'win32') return { stop() {} };

  let child = null;
  let stopped = false;
  let restarts = 0;
  let lastSnap = null;

  const handle = overlay.getNativeWindowHandle();
  const self = handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0));

  const toOverlay = (win, bounds) => {
    const dip = screen.screenToDipRect(null, { x: win.x, y: win.y, width: win.w, height: win.h });
    return { id: win.id, x: dip.x - bounds.x, y: dip.y - bounds.y, w: dip.width, h: dip.height, max: win.max };
  };

  const start = () => {
    child = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', SCRIPT, String(self), String(process.pid),
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });

    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      try {
        lastSnap = JSON.parse(line);
      } catch {
        return;
      }
      emit(lastSnap);
    });
    child.stderr.on('data', (d) => console.error('[capri] window watch:', String(d).trim()));
    child.on('exit', () => {
      child = null;
      if (!stopped && restarts++ < 3) setTimeout(start, 3000);
    });
  };

  const emit = (snap) => {
    if (overlay.isDestroyed()) return;
    const bounds = overlay.getBounds();
    const wins = snap.wins
      .map((w) => toOverlay(w, bounds))
      // only what overlaps Capri's screen
      .filter((w) => w.x < bounds.width && w.x + w.w > 0 && w.y < bounds.height && w.y + w.h > 0);
    // app: the process in front; full: its window fills its monitor (mon, physical pixels)
    // music: Spotify's window title ("Artist - Song" while it plays)
    // desk: the desktop is in front; wink: an Edgerunners / Cyberpunk title in front (yes/no only);
    // typing: 0..10, how much you've been typing lately (never which keys)
    // clip / paste: counters, they move when you copy (the clipboard, never what's in it) and
    // when you press Ctrl+V
    // bars: the taskbars, in screen DIPs (main.js keeps her screen above them)
    const bars = (snap.bars || []).map((b) => screen.screenToDipRect(null, { x: b.x, y: b.y, width: b.w, height: b.h }));
    onUpdate({
      fg: snap.fg, wins, app: snap.app || '', full: Boolean(snap.full), big: Boolean(snap.big), bars, mon: snap.mon || null, music: snap.music || '',
      desk: Boolean(snap.desk), wink: Boolean(snap.wink), watch: Boolean(snap.watch), typing: Number(snap.typing) || 0,
      clip: Number(snap.clip) || 0, paste: Number(snap.paste) || 0,
      // seen: the windows you've had in front lately, in physical pixels (focus.js)
      seen: snap.seen || [],
    });
  };

  start();
  return {
    stop() {
      stopped = true;
      child?.kill();
    },
    // the overlay moved: the watcher sees no change (it doesn't count itself), but all the windows
    // are somewhere else relative to her now. She used to go and sit where they had been.
    refresh() {
      if (lastSnap) setImmediate(() => emit(lastSnap));
    },
  };
}

module.exports = { startWindowWatch };
