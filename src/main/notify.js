'use strict';

// An app's taskbar button flashing (a new message on Discord, a call...): notify.ps1 tells us
// which app, by process name only. Never the title, never the message.

const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');

const SCRIPT = path.join(__dirname, 'notify.ps1').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

function startNotifyWatch({ onFlash }) {
  if (process.platform !== 'win32') return { stop() {} };
  let child = null;
  let stopped = false;
  let restarts = 0;
  const start = () => {
    child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, String(process.pid)], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      const app = line.trim().toLowerCase();
      if (/^[\w .-]{1,60}$/.test(app)) onFlash(app);
    });
    child.stderr.on('data', (d) => console.error('[capri] notify watch:', String(d).trim()));
    child.on('exit', () => {
      child = null;
      if (!stopped && restarts++ < 3) setTimeout(start, 5000);
    });
  };
  start();
  return {
    stop() {
      stopped = true;
      child?.kill();
    },
  };
}

module.exports = { startNotifyWatch };
