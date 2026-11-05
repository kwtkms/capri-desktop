'use strict';

// Her zap, for real: she jolts your mouse pointer, a shake then a shove away from her.
// A small PowerShell helper stays up to move the pointer (SetCursorPos), so the jolt is instant.

const { spawn } = require('node:child_process');
const { screen } = require('electron');

const HELPER = `
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class CapriCursor { [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y); [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v); public struct R { public int L, T, Ri, B; } [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r); [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h); [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags); public static void Nudge(long id, int dx, int dy) { IntPtr h = new IntPtr(id); R r; if (IsZoomed(h) || !GetWindowRect(h, out r)) return; SetWindowPos(h, IntPtr.Zero, r.L + dx, r.T + dy, 0, 0, 0x0015); } }'
[CapriCursor]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  $p = $line.Split(',')
  if ($p.Length -eq 2) { [CapriCursor]::SetCursorPos([int]$p[0], [int]$p[1]) | Out-Null }
  elseif ($p.Length -eq 4 -and $p[0] -eq 'W') { [CapriCursor]::Nudge([long]$p[1], [int]$p[2], [int]$p[3]) }
}
`;

let child = null;

function helper() {
  if (child && !child.killed && child.exitCode === null) return child;
  child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', HELPER], {
    windowsHide: true,
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  child.on('exit', () => { child = null; });
  return child;
}

// Warm it up so the first zap isn't late.
function prepare() {
  if (process.platform === 'win32') helper();
}

// dir: -1 / 1, the side she shoves it to; power: 1 a jolt, 2 a proper launch
function kick(dir = 1, power = 1) {
  if (process.platform !== 'win32') return;
  const h = helper();
  const start = screen.getCursorScreenPoint(); // DIP
  const steps = [];
  // the shake
  for (const [dx, dy] of [[-7, 4], [8, -5], [-6, -6], [7, 5]]) steps.push({ x: start.x + dx * power, y: start.y + dy * power });
  // the shove, easing out
  const dist = 140 * power;
  for (let i = 1; i <= 7; i++) {
    const k = 1 - Math.pow(1 - i / 7, 3);
    steps.push({ x: start.x + dir * dist * k, y: start.y - 40 * power * Math.sin(k * Math.PI) });
  }
  steps.forEach((p, i) => {
    setTimeout(() => {
      const phys = screen.dipToScreenPoint({ x: Math.round(p.x), y: Math.round(p.y) });
      try { h.stdin.write(`${phys.x},${phys.y}\n`); } catch { /* helper gone */ }
    }, i * 22);
  });
}

// She kicks the window she sits on (id: its handle, from windows.ps1): a little shove sideways
// that springs back halfway, in physical pixels. Never a maximized window (the helper checks).
function nudge(id, dx, scale = 1) {
  if (process.platform !== 'win32' || !id) return;
  const h = helper();
  const total = Math.round(dx * scale);
  const steps = [0.45, 0.35, 0.2, -0.12, -0.06].map((k) => Math.round(total * k));
  steps.forEach((step, i) => {
    setTimeout(() => {
      try { h.stdin.write(`W,${id},${step},0\n`); } catch { /* helper gone */ }
    }, i * 40);
  });
}

function stop() {
  child?.kill();
}

module.exports = { prepare, kick, nudge, stop };
