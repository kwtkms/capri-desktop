# Watches the top-level windows so Capri can sit on them.
# Prints one JSON line whenever something changes: the foreground window and the visible
# windows in z-order (front first), as physical-pixel frame bounds. No titles, no contents.
#
#   powershell -File windows.ps1 <capri hwnd> <capri pid>

param([long]$Self = 0, [int]$ParentPid = 0)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class CapriWindows {
  delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }

  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hwnd);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hwnd, int index);
  [DllImport("user32.dll")] static extern int GetClassName(IntPtr hwnd, StringBuilder name, int max);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out RECT value, int size);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out int value, int size);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int max);
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO info);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] static extern uint GetClipboardSequenceNumber();
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);

  [StructLayout(LayoutKind.Sequential)]
  public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
  [StructLayout(LayoutKind.Sequential)]
  public struct LASTINPUTINFO { public int cbSize; public uint dwTime; }
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X, Y; }

  // Words that make her react (Edgerunners, Cyberpunk). The title itself never leaves here:
  // only whether one of them is in it.
  static readonly string[] WINK = { "edgerunners", "cyberpunk", "night city", "david martinez", "lucy kushinada", "rebecca", "i really want to stay at your house", "let you down", "capricorn" };

  // Watching or reading something (an episode, a video, a scan...): she gets out of the way.
  // Same rule: only yes/no leaves here.
  static readonly string[] WATCH = {
    "youtube", "netflix", "crunchyroll", "prime video", "disney+", "twitch", "animationdigitalnetwork", " adn ", "anime-sama", "voiranime",
    "vostfr", "vostfree", "streaming", "episode", "épisode", "saison", "season", "film",
    "scan", "manga", "manhwa", "webtoon", "chapitre", "chapter", "mangadex", "japscan", "lelscan", "sushiscan", "comick",
  };
  static readonly string[] PLAYERS = { "vlc", "mpc-hc64", "mpc-be64", "potplayermini64", "netflix", "primevideo", "disneyplus", "crunchyroll" };

  static string Wink(IntPtr fg) {
    var t = new StringBuilder(256);
    GetWindowText(fg, t, 256);
    string title = t.ToString().ToLowerInvariant();
    bool wink = false, watch = false;
    foreach (var w in WINK) if (title.Contains(w)) { wink = true; break; }
    foreach (var w in WATCH) if (title.Contains(w)) { watch = true; break; }
    string app = lastApp.ToLowerInvariant();
    foreach (var p in PLAYERS) if (app == p) { watch = true; break; }
    return ",\"wink\":" + (wink ? "true" : "false") + ",\"watch\":" + (watch ? "true" : "false");
  }

  // How much you're typing: the last-input time moving while the pointer stays put means a key.
  // Which key, never known. Share of the last ~6 s (40 polls) that saw some typing, in tenths.
  static uint lastInput = 0;
  static int lastX = 0, lastY = 0;
  static readonly bool[] typed = new bool[40];
  static int typedAt = 0;

  static string Typing() {
    var li = new LASTINPUTINFO();
    li.cbSize = Marshal.SizeOf(typeof(LASTINPUTINFO));
    GetLastInputInfo(ref li);
    POINT p;
    GetCursorPos(out p);
    bool key = li.dwTime != lastInput && p.X == lastX && p.Y == lastY;
    lastInput = li.dwTime; lastX = p.X; lastY = p.Y;
    typed[typedAt++ % typed.Length] = key;
    int n = 0;
    foreach (var b in typed) if (b) n++;
    return ",\"typing\":" + (n * 10 / typed.Length);
  }

  // Copy and paste, for her little data cube: the clipboard's change counter (never its
  // contents), and Ctrl+V (only those two keys are ever looked at). Counters, so a quick press
  // between two polls isn't missed.
  static int pastes = 0;
  static bool vDown = false;

  static string Clip() {
    bool v = (GetAsyncKeyState(0x56) & 0x8001) != 0;
    bool ctrl = (GetAsyncKeyState(0x11) & 0x8000) != 0;
    if (v && ctrl && !vDown) pastes++;
    vDown = v && ctrl;
    return ",\"clip\":" + GetClipboardSequenceNumber() + ",\"paste\":" + pastes;
  }

  const int GWL_EXSTYLE = -20;
  const int WS_EX_TOOLWINDOW = 0x80;
  const int WS_EX_NOACTIVATE = 0x08000000;
  const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;
  const int DWMWA_CLOAKED = 14;

  public static void Init() {
    SetProcessDpiAwarenessContext(new IntPtr(-4)); // per-monitor v2: real pixels everywhere
  }

  static uint lastPid = 0;
  static string lastApp = "";

  // The app in front (process name only), and whether its window fills its whole monitor:
  // a game or a fullscreen video, the cue for Capri to get out of the way.
  static string Foreground(IntPtr fg) {
    var sb = new StringBuilder();
    uint pid;
    GetWindowThreadProcessId(fg, out pid);
    if (pid != lastPid) {
      lastPid = pid;
      try { lastApp = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; } catch { lastApp = ""; }
    }
    sb.Append(",\"app\":\"").Append(lastApp.Replace("\\", "").Replace("\"", "")).Append('"');
    var cls = new StringBuilder(64);
    GetClassName(fg, cls, 64);
    string c = cls.ToString();
    bool shell = c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd";
    // the desktop itself in front: her playground (decor.js)
    sb.Append(",\"desk\":").Append(c == "Progman" || c == "WorkerW" ? "true" : "false");
    if (!shell) Remember(fg);
    sb.Append(Wink(fg));
    RECT r;
    var mi = new MONITORINFO();
    mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
    if (!shell && GetWindowRect(fg, out r) && GetMonitorInfo(MonitorFromWindow(fg, 2), ref mi)) {
      var m = mi.rcMonitor;
      // a maximized window can cover a monitor that has no taskbar: that's not fullscreen
      bool full = !IsZoomed(fg) && r.Left <= m.Left && r.Top <= m.Top && r.Right >= m.Right && r.Bottom >= m.Bottom;
      // big: maximized, or covering most of its monitor (a video or a scan you're really into,
      // not a small window in a corner)
      long area = (long)(Math.Min(r.Right, m.Right) - Math.Max(r.Left, m.Left)) * (Math.Min(r.Bottom, m.Bottom) - Math.Max(r.Top, m.Top));
      long mArea = (long)(m.Right - m.Left) * (m.Bottom - m.Top);
      bool big = IsZoomed(fg) || (mArea > 0 && area * 10 >= mArea * 7);
      sb.Append(",\"big\":").Append(big ? "true" : "false");
      sb.Append(",\"full\":").Append(full ? "true" : "false")
        .Append(",\"mon\":{\"x\":").Append(m.Left).Append(",\"y\":").Append(m.Top)
        .Append(",\"w\":").Append(m.Right - m.Left).Append(",\"h\":").Append(m.Bottom - m.Top).Append('}');
    } else {
      sb.Append(",\"full\":false");
    }
    return sb.ToString();
  }

  // The windows you've had in front lately, whatever they are and wherever they are, minimized or
  // not: so she knows a game is still open once you've alt-tabbed away from it (focus.js).
  static readonly System.Collections.Generic.List<IntPtr> recent = new System.Collections.Generic.List<IntPtr>();

  static void Remember(IntPtr fg) {
    recent.Remove(fg);
    recent.Add(fg);
    if (recent.Count > 32) recent.RemoveAt(0);
  }

  static string Seen() {
    var sb = new StringBuilder(",\"seen\":[");
    bool first = true;
    for (int i = recent.Count - 1; i >= 0; i--) {
      IntPtr h = recent[i];
      int cloaked;
      RECT r;
      bool cloak = DwmGetWindowAttribute(h, DWMWA_CLOAKED, out cloaked, 4) == 0 && cloaked != 0;
      if (!IsWindow(h) || !IsWindowVisible(h) || cloak || !GetWindowRect(h, out r)) {
        recent.RemoveAt(i);
        continue;
      }
      if (!first) sb.Append(',');
      first = false;
      sb.Append("{\"id\":").Append(h.ToInt64())
        .Append(",\"x\":").Append(r.Left).Append(",\"y\":").Append(r.Top)
        .Append(",\"w\":").Append(r.Right - r.Left).Append(",\"h\":").Append(r.Bottom - r.Top)
        .Append(",\"mini\":").Append(IsIconic(h) ? "true" : "false").Append('}');
    }
    return sb.Append(']').ToString();
  }

  static int musicTick = 0;
  static string music = "";

  // What Spotify is playing: its window title is "Artist - Song" while music plays, just
  // "Spotify ..." when paused. The only title read, every 3 s.
  static string Music() {
    if (musicTick++ % 20 == 0) {
      string found = "";
      try {
        foreach (var p in System.Diagnostics.Process.GetProcessesByName("Spotify")) {
          string t = p.MainWindowTitle;
          if (!string.IsNullOrEmpty(t)) { found = t; break; }
        }
      } catch { }
      music = found;
    }
    var clean = new StringBuilder();
    foreach (char ch in music) {
      if (ch == '"' || ch == '\\') clean.Append('\\').Append(ch);
      else if (ch >= ' ') clean.Append(ch);
    }
    return ",\"music\":\"" + clean.ToString() + "\"";
  }

  static IntPtr lastFront = IntPtr.Zero;

  public static string Snapshot(long self) {
    var sb = new StringBuilder();
    IntPtr front = GetForegroundWindow();
    // typing in her box puts her in front: you're still on what you were on
    if (front.ToInt64() == self && IsWindow(lastFront)) front = lastFront;
    else lastFront = front;
    sb.Append("{\"fg\":").Append(front.ToInt64()).Append(Foreground(front)).Append(Seen()).Append(Music()).Append(Typing()).Append(Clip()).Append(",\"wins\":[");
    int count = 0;
    var bars = new StringBuilder();
    EnumWindows((h, l) => {
      if (h.ToInt64() == self || !IsWindowVisible(h) || IsIconic(h)) return true;
      var tcls = new StringBuilder(64);
      GetClassName(h, tcls, 64);
      string tc = tcls.ToString();
      // the taskbars (one per screen): where Capri's screen really ends, whatever Windows says
      // the work area is at that moment
      if (tc == "Shell_TrayWnd" || tc == "Shell_SecondaryTrayWnd") {
        RECT tr;
        if (GetWindowRect(h, out tr)) {
          if (bars.Length > 0) bars.Append(',');
          bars.Append("{\"x\":").Append(tr.Left).Append(",\"y\":").Append(tr.Top)
            .Append(",\"w\":").Append(tr.Right - tr.Left).Append(",\"h\":").Append(tr.Bottom - tr.Top).Append('}');
        }
        return true;
      }
      if (count >= 40) return true;
      int ex = GetWindowLong(h, GWL_EXSTYLE);
      if ((ex & WS_EX_TOOLWINDOW) != 0 || (ex & WS_EX_NOACTIVATE) != 0) return true;
      int cloaked;
      if (DwmGetWindowAttribute(h, DWMWA_CLOAKED, out cloaked, 4) == 0 && cloaked != 0) return true;
      var cls = new StringBuilder(64);
      GetClassName(h, cls, 64);
      string c = cls.ToString();
      if (c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd" || c == "Shell_SecondaryTrayWnd") return true;
      RECT r;
      if (DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS, out r, 16) != 0) return true;
      if (r.Right - r.Left < 200 || r.Bottom - r.Top < 120) return true;
      if (count > 0) sb.Append(',');
      count++;
      sb.Append("{\"id\":").Append(h.ToInt64())
        .Append(",\"x\":").Append(r.Left).Append(",\"y\":").Append(r.Top)
        .Append(",\"w\":").Append(r.Right - r.Left).Append(",\"h\":").Append(r.Bottom - r.Top)
        .Append(",\"max\":").Append(IsZoomed(h) ? "true" : "false").Append('}');
      return true;
    }, IntPtr.Zero);
    sb.Append("],\"bars\":[").Append(bars.ToString()).Append("]}");
    return sb.ToString();
  }
}
"@

[CapriWindows]::Init()
$last = ''
$tick = 0
while ($true) {
  $snap = [CapriWindows]::Snapshot($Self)
  if ($snap -ne $last) {
    [Console]::Out.WriteLine($snap)
    [Console]::Out.Flush()
    $last = $snap
  }
  # stop with Capri, even if she crashed without telling us
  $tick++
  if ($ParentPid -and ($tick % 20 -eq 0) -and -not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { break }
  Start-Sleep -Milliseconds 150
}
