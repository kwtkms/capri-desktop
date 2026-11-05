'use strict';

// What her mind (renderer/js/skills.js) asks of the PC: how it's doing, media keys, locking the
// session. Nothing here takes free text: keys come from this list, everything else is a fixed call.

const os = require('node:os');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { shell } = require('electron');

const VK = { play: [0xb3], next: [0xb0], prev: [0xb1], volUp: Array(5).fill(0xaf), volDown: Array(5).fill(0xae), mute: [0xad] };
const WIN_D = [0x5b, 0x44]; // held together

const GB = 1024 ** 3;
const round = (v) => Math.round(v * 10) / 10;

const cpuTimes = () => os.cpus().reduce((all, c) => {
  const t = c.times;
  return { idle: all.idle + t.idle, total: all.total + t.user + t.nice + t.sys + t.idle + t.irq };
}, { idle: 0, total: 0 });

async function pcInfo() {
  const a = cpuTimes();
  await new Promise((r) => setTimeout(r, 400));
  const b = cpuTimes();
  const busy = 1 - (b.idle - a.idle) / Math.max(1, b.total - a.total);
  let diskFree = null;
  let diskTotal = null;
  try {
    const d = fs.statfsSync('C:\\');
    diskFree = Math.round(d.bavail * d.bsize / GB);
    diskTotal = Math.round(d.blocks * d.bsize / GB);
  } catch { /* no such disk */ }
  return {
    ramUsed: round((os.totalmem() - os.freemem()) / GB),
    ramTotal: round(os.totalmem() / GB),
    cpu: Math.round(busy * 100),
    diskFree,
    diskTotal,
    uptime: os.uptime(),
  };
}

function run(exe, args) {
  return new Promise((resolve) => {
    const child = spawn(exe, args, { windowsHide: true, stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

function pressKey(name) {
  const held = name === 'desktop';
  const keys = held ? WIN_D : VK[name];
  if (!keys) return Promise.resolve(false);
  const UP = 2;
  const steps = held
    ? [...keys.map((k) => `[K]::keybd_event(${k},0,0,0)`), ...keys.slice().reverse().map((k) => `[K]::keybd_event(${k},0,${UP},0)`)]
    : keys.flatMap((k) => [`[K]::keybd_event(${k},0,0,0)`, `[K]::keybd_event(${k},0,${UP},0)`]);
  const script = `Add-Type -Name K -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, UIntPtr e);'; ${steps.join('; ')}`;
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script]);
}

const lockPc = () => run('rundll32.exe', ['user32.dll,LockWorkStation']);

const screenClip = () => shell.openExternal('ms-screenclip:').then(() => true, () => false);

module.exports = { pcInfo, pressKey, lockPc, screenClip };
