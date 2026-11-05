# Tells Capri when an app's taskbar button starts flashing (a new Discord message, a call...).
# Windows' shell hook says which window flashes; we print only its process name, one per line.
# Never the window's title, never the message.
#
#   powershell -File notify.ps1 <capri pid>

param([int]$ParentPid = 0)
$ErrorActionPreference = 'Stop'

Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public class CapriNotify : Form {
  [DllImport("user32.dll")] static extern bool RegisterShellHookWindow(IntPtr hwnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern uint RegisterWindowMessage(string name);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);

  const int HSHELL_FLASH = 0x8006;
  uint shellMsg;
  int parent;
  Timer alive;

  public CapriNotify(int parentPid) {
    parent = parentPid;
    ShowInTaskbar = false;
    FormBorderStyle = FormBorderStyle.None;
    Opacity = 0;
    Width = 1; Height = 1;
    Load += (s, e) => {
      Visible = false;
      shellMsg = RegisterWindowMessage("SHELLHOOK");
      RegisterShellHookWindow(Handle);
    };
    // stop with Capri, even if she crashed without telling us
    alive = new Timer { Interval = 3000 };
    alive.Tick += (s, e) => {
      if (parent == 0) return;
      try { System.Diagnostics.Process.GetProcessById(parent); } catch { Application.Exit(); }
    };
    alive.Start();
  }

  protected override void WndProc(ref Message m) {
    if (shellMsg != 0 && m.Msg == (int)shellMsg && (m.WParam.ToInt32() & 0x7fff) == (HSHELL_FLASH & 0x7fff)) {
      uint pid;
      GetWindowThreadProcessId(m.LParam, out pid);
      string name = "";
      try { name = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName.ToLowerInvariant(); } catch { }
      if (name.Length > 0) {
        Console.Out.WriteLine(name.Replace("\"", ""));
        Console.Out.Flush();
      }
    }
    base.WndProc(ref m);
  }
}
"@

[System.Windows.Forms.Application]::Run((New-Object CapriNotify $ParentPid))
