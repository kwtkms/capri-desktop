# Capri's hands on your desktop: where your desktop icons are (and their names), moving one
# (she always puts it back where it was), and finding / pressing a button on the taskbar.
# One request per line on stdin, one JSON line back on stdout:
#   icons                 -> {"ok":true,"lv":{x,y},"icons":[{"i":0,"name":"Steam","x":12,"y":40}, ...]}
#   move <i> <x> <y>      -> {"ok":true}            (listview coordinates, physical pixels)
#   find <words>          -> {"ok":true,"rect":{x,y,w,h}} | {"ok":false}   (a taskbar button)
#   press <words>         -> {"ok":true} | {"ok":false}                     (clicks it, through UI Automation)
#   winrect <hwnd>        -> {"ok":true,x,y,w,h,max}   (a window's visible frame, physical pixels)
#   place <hwnd> x y w h  -> {"ok":true}               (puts that frame there; un-maximizes first)
#   maximize <hwnd>       -> {"ok":true}
# Taskbar button names can carry window titles: they never leave this script, only a yes/no and
# a rectangle for the one asked for.
#
#   powershell -File desktop.ps1 <capri pid>

param([int]$ParentPid = 0)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class CapriDesk {
  delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindow(string cls, string name);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string name);
  [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] static extern IntPtr VirtualAllocEx(IntPtr p, IntPtr addr, UIntPtr size, uint type, uint protect);
  [DllImport("kernel32.dll")] static extern bool VirtualFreeEx(IntPtr p, IntPtr addr, UIntPtr size, uint type);
  [DllImport("kernel32.dll")] static extern bool ReadProcessMemory(IntPtr p, IntPtr addr, byte[] buf, UIntPtr size, out UIntPtr read);
  [DllImport("kernel32.dll")] static extern bool WriteProcessMemory(IntPtr p, IntPtr addr, byte[] buf, UIntPtr size, out UIntPtr written);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("user32.dll")] static extern bool InvalidateRect(IntPtr h, IntPtr r, bool erase);
  [DllImport("user32.dll")] static extern bool UpdateWindow(IntPtr h);

  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }

  const uint LVM_GETITEMCOUNT = 0x1004, LVM_GETITEMPOSITION = 0x1010, LVM_SETITEMPOSITION = 0x100F, LVM_GETITEMTEXTW = 0x1073;

  public static void Init() { SetProcessDpiAwarenessContext(new IntPtr(-4)); }

  // the desktop's icon list: under Progman, or under one of the WorkerW windows
  static IntPtr ListView() {
    IntPtr def = FindWindowEx(FindWindow("Progman", null), IntPtr.Zero, "SHELLDLL_DefView", null);
    if (def == IntPtr.Zero) {
      EnumWindows((h, l) => {
        IntPtr d = FindWindowEx(h, IntPtr.Zero, "SHELLDLL_DefView", null);
        if (d != IntPtr.Zero) { def = d; return false; }
        return true;
      }, IntPtr.Zero);
    }
    return def == IntPtr.Zero ? IntPtr.Zero : FindWindowEx(def, IntPtr.Zero, "SysListView32", null);
  }

  static string Esc(string s) {
    var b = new StringBuilder();
    foreach (char c in s) {
      if (c == '"' || c == '\\') b.Append('\\').Append(c);
      else if (c >= ' ') b.Append(c);
    }
    return b.ToString();
  }

  public static string Icons() {
    IntPtr lv = ListView();
    if (lv == IntPtr.Zero) return "{\"ok\":false}";
    RECT wr; GetWindowRect(lv, out wr);
    RECT pr; GetWindowRect(FindWindow("Shell_TrayWnd", null), out pr); // the main screen's taskbar: its width is the main screen's
    uint pid; GetWindowThreadProcessId(lv, out pid);
    IntPtr proc = OpenProcess(0x0008 | 0x0010 | 0x0020 | 0x0400, false, pid);
    if (proc == IntPtr.Zero) return "{\"ok\":false}";
    IntPtr mem = VirtualAllocEx(proc, IntPtr.Zero, (UIntPtr)4096, 0x1000 | 0x2000, 0x04);
    var sb = new StringBuilder("{\"ok\":true,\"lv\":{\"x\":" + wr.L + ",\"y\":" + wr.T + ",\"w\":" + (wr.R - wr.L) + ",\"h\":" + (wr.B - wr.T) + "},\"main\":{\"x\":" + pr.L + ",\"y\":" + pr.T + ",\"w\":" + (pr.R - pr.L) + ",\"b\":" + pr.B + "},\"icons\":[");
    try {
      int count = (int)SendMessage(lv, LVM_GETITEMCOUNT, IntPtr.Zero, IntPtr.Zero);
      UIntPtr io;
      for (int i = 0; i < count && i < 300; i++) {
        SendMessage(lv, LVM_GETITEMPOSITION, (IntPtr)i, mem);
        var pt = new byte[8];
        ReadProcessMemory(proc, mem, pt, (UIntPtr)8, out io);
        int x = BitConverter.ToInt32(pt, 0), y = BitConverter.ToInt32(pt, 4);
        // LVITEMW (64-bit layout): mask, iItem, iSubItem, state, stateMask, [pad], pszText, cchTextMax ...
        var item = new byte[88];
        BitConverter.GetBytes(0x1).CopyTo(item, 0);          // LVIF_TEXT
        BitConverter.GetBytes(i).CopyTo(item, 4);
        BitConverter.GetBytes((long)mem + 1024).CopyTo(item, 24); // pszText
        BitConverter.GetBytes(260).CopyTo(item, 32);         // cchTextMax
        WriteProcessMemory(proc, mem + 512, item, (UIntPtr)item.Length, out io);
        SendMessage(lv, LVM_GETITEMTEXTW, (IntPtr)i, mem + 512);
        var txt = new byte[520];
        ReadProcessMemory(proc, mem + 1024, txt, (UIntPtr)520, out io);
        string name = Encoding.Unicode.GetString(txt);
        int z = name.IndexOf('\0'); if (z >= 0) name = name.Substring(0, z);
        if (i > 0) sb.Append(',');
        sb.Append("{\"i\":" + i + ",\"name\":\"" + Esc(name) + "\",\"x\":" + x + ",\"y\":" + y + "}");
      }
    } finally {
      VirtualFreeEx(proc, mem, UIntPtr.Zero, 0x8000);
      CloseHandle(proc);
    }
    return sb.Append("]}").ToString();
  }

  // ---- windows: where one is (its visible frame), and putting it somewhere ----
  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);

  public static string WinRect(long id) {
    IntPtr h = new IntPtr(id);
    if (!IsWindow(h)) return "{\"ok\":false}";
    RECT f;
    if (DwmGetWindowAttribute(h, 9, out f, 16) != 0) GetWindowRect(h, out f);
    return "{\"ok\":true,\"x\":" + f.L + ",\"y\":" + f.T + ",\"w\":" + (f.R - f.L) + ",\"h\":" + (f.B - f.T) + ",\"max\":" + (IsZoomed(h) ? "true" : "false") + "}";
  }

  // puts the window's visible frame at x, y, w, h (the invisible resize borders accounted for)
  public static string Place(long id, int x, int y, int w, int h) {
    IntPtr hw = new IntPtr(id);
    if (!IsWindow(hw) || w < 120 || h < 80) return "{\"ok\":false}";
    if (IsZoomed(hw)) ShowWindow(hw, 9); // SW_RESTORE
    RECT wr, fr;
    GetWindowRect(hw, out wr);
    if (DwmGetWindowAttribute(hw, 9, out fr, 16) != 0) fr = wr;
    int l = fr.L - wr.L, t = fr.T - wr.T, r = wr.R - fr.R, b = wr.B - fr.B;
    SetWindowPos(hw, IntPtr.Zero, x - l, y - t, w + l + r, h + t + b, 0x0004 | 0x0010); // NOZORDER | NOACTIVATE
    return "{\"ok\":true}";
  }

  public static string Maximize(long id) {
    IntPtr h = new IntPtr(id);
    if (!IsWindow(h)) return "{\"ok\":false}";
    ShowWindow(h, 3); // SW_MAXIMIZE
    return "{\"ok\":true}";
  }

  public static string Move(int i, int x, int y) {
    IntPtr lv = ListView();
    if (lv == IntPtr.Zero || x < 0 || y < 0 || x > 32000 || y > 32000) return "{\"ok\":false}";
    SendMessage(lv, LVM_SETITEMPOSITION, (IntPtr)i, (IntPtr)((y << 16) | (x & 0xFFFF)));
    // the desktop doesn't always repaint by itself
    InvalidateRect(lv, IntPtr.Zero, true);
    UpdateWindow(lv);
    return "{\"ok\":true}";
  }
}
"@

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
[CapriDesk]::Init()

function Normal([string]$s) {
  $s = $s.ToLowerInvariant().Normalize([Text.NormalizationForm]::FormD)
  return (($s.ToCharArray() | Where-Object { [Globalization.CharUnicodeInfo]::GetUnicodeCategory($_) -ne 'NonSpacingMark' }) -join '')
}

# the taskbar button whose name starts with what's asked (its app name comes first)
function TaskbarButton([string]$words) {
  $A = [System.Windows.Automation.AutomationElement]
  $tray = $A::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children,
    (New-Object System.Windows.Automation.PropertyCondition($A::ClassNameProperty, 'Shell_TrayWnd')))
  if (-not $tray) { return $null }
  $cond = New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
  $q = Normal $words
  $best = $null
  foreach ($b in $tray.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)) {
    $n = Normal $b.Current.Name
    if (-not $n) { continue }
    if ($n.StartsWith($q)) { return $b }
    if (-not $best -and $n.Contains($q) -and $q.Length -ge 4) { $best = $b }
  }
  return $best
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  $out = '{"ok":false}'
  try {
    $parts = $line.Split(' ', 2)
    switch ($parts[0]) {
      'icons' { $out = [CapriDesk]::Icons() }
      'move' {
        $a = $parts[1].Split(' ')
        $out = [CapriDesk]::Move([int]$a[0], [int]$a[1], [int]$a[2])
      }
      'winrect' { $out = [CapriDesk]::WinRect([long]$parts[1]) }
      'place' {
        $a = $parts[1].Split(' ')
        $out = [CapriDesk]::Place([long]$a[0], [int]$a[1], [int]$a[2], [int]$a[3], [int]$a[4])
      }
      'maximize' { $out = [CapriDesk]::Maximize([long]$parts[1]) }
      'find' {
        $b = TaskbarButton $parts[1]
        if ($b) {
          $r = $b.Current.BoundingRectangle
          $out = '{"ok":true,"rect":{"x":' + [int]$r.X + ',"y":' + [int]$r.Y + ',"w":' + [int]$r.Width + ',"h":' + [int]$r.Height + '}}'
        }
      }
      'press' {
        $b = TaskbarButton $parts[1]
        if ($b) {
          $p = $b.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
          $p.Invoke()
          $out = '{"ok":true}'
        }
      }
    }
  } catch { $out = '{"ok":false}' }
  [Console]::Out.WriteLine($out)
  [Console]::Out.Flush()
  if ($ParentPid -and -not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { break }
}
