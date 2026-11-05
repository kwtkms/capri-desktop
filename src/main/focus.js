'use strict';

// Gets her out of your way. A game, anything fullscreen, or something you're watching or reading
// (an episode, a video, a scan: windows.ps1 "watch") on her screen sends her to your other screen,
// or out of sight when you have nowhere else to send her. She comes back once it's really over:
// the window is closed, shrunk, or replaced by something else, not just because you alt-tabbed to
// your other screen with the game still open.

const { screen } = require('electron');

// Games that don't always run fullscreen (process names, lowercase). Fullscreen apps need no entry.
const GAMES = new Set([
  'cyberpunk2077', 'witcher3', 'eldenring', 'bg3', 'bg3_dx11', 'starfield', 'gta5', 'gta5_enhanced',
  'rdr2', 'valorant-win64-shipping', 'league of legends', 'cs2', 'fortniteclient-win64-shipping',
  'minecraft.windows', 'javaw', 'robloxplayerbeta', 'overwatch', 'r5apex', 'helldivers2',
]);

// Windows that cover a whole screen without being anything you play or watch: the lock screen,
// overlays, capture tools, Steam's borderless window. They're never a reason, and they don't end one.
const NOT_BUSY = new Set([
  'lockapp', 'logonui', 'medal', 'snippingtool', 'screensketch', 'steamwebhelper', 'searchhost', 'searchapp',
  'startmenuexperiencehost', 'shellexperiencehost', 'textinputhost', 'nvidia overlay', 'nvcontainer',
  'gamebar', 'gamebarftserver', 'discordoverlay', 'shellhost',
]);

const FLEE_MS = 1500;   // alt-tabbing through something shouldn't move her
const RETURN_MS = 6000; // flipping between two tabs shouldn't send her back and forth

function reasonOf({ app, full, watch, big }) {
  const name = String(app || '').toLowerCase();
  if (GAMES.has(name)) return 'game';
  if (NOT_BUSY.has(name)) return null;
  // a video or a scan only counts in a big window: a small one in a corner leaves her room
  // (she used to flee to the other screen for any tab with "scan" or "youtube" in its title)
  if (watch && (big || full)) return 'watch';
  if (full) return 'game';
  return null;
}

function displayOf(mon) {
  if (!mon) return null;
  return screen.getDisplayMatching(screen.screenToDipRect(null, { x: mon.x, y: mon.y, width: mon.w, height: mon.h }));
}

// still covering most of the screen it was on
function fills(win, mon) {
  const w = Math.min(win.x + win.w, mon.x + mon.w) - Math.max(win.x, mon.x);
  const h = Math.min(win.y + win.h, mon.y + mon.h) - Math.max(win.y, mon.y);
  return w > 0 && h > 0 && w * h * 10 >= mon.w * mon.h * 7;
}

// home: the screen she lives on (her setting). moveTo(display, reason): put her on that screen for
// now, moveTo(null): back home. hide(on, reason): out of sight and back, without touching her setting.
function createFocusWatch({ home, moveTo, hide, log }) {
  const blockers = new Map(); // window id -> { id, listed, reason, mon }: what she's staying away from
  let away = null;            // null | { screen: displayId, hidden? } | { hidden: true }
  let pending = null;         // { key, timer }: the move she's about to make
  let pausedUntil = 0;        // you decided where she goes (recall, aside): no fleeing until then
  let asideTo = null;
  let known = new Set();      // the windows in the way when you decided
  let pauseTimer = null;

  // what's in the way, now: a game holds until it's closed, even minimized (alt-tabbing out of an
  // exclusive-fullscreen game minimizes it); the rest until it's minimized, shrunk or replaced.
  function update(data) {
    const reason = reasonOf(data);
    const app = String(data.app || '').toLowerCase();
    const ignored = NOT_BUSY.has(app);
    if (reason && data.mon) {
      blockers.set(data.fg, { id: data.fg, listed: GAMES.has(app), reason, mon: data.mon });
      // you decided about what was open then, not about a game you start afterwards
      if (Date.now() < pausedUntil && !known.has(data.fg)) {
        pausedUntil = 0;
        asideTo = null;
      }
    }
    const fgDisplay = data.big && !ignored && data.mon ? displayOf(data.mon)?.id : null;
    const seen = new Map((data.seen || []).map((w) => [w.id, w]));
    for (const b of blockers.values()) {
      const win = seen.get(b.id);
      // closed, or gone to another virtual desktop
      if (!win && b.id !== data.fg) {
        blockers.delete(b.id);
        continue;
      }
      if (b.listed) continue;
      if (b.id === data.fg) {
        if (!reason && !ignored) blockers.delete(b.id); // same window, another tab, out of fullscreen
        continue;
      }
      const replaced = fgDisplay && fgDisplay === displayOf(b.mon)?.id;
      if (win.mini || !fills(win, b.mon) || replaced) blockers.delete(b.id);
    }
    settle();
  }

  // where she should be, given all that
  function wanted() {
    const all = screen.getAllDisplays();
    if (Date.now() < pausedUntil) {
      const there = asideTo && all.find((d) => d.id === asideTo);
      return there ? { key: `screen:${there.id}`, display: there, reason: 'asked' } : { key: 'home' };
    }
    const homeDisplay = home();
    const taken = new Map();
    for (const b of blockers.values()) {
      const id = displayOf(b.mon)?.id;
      if (id !== undefined && !taken.has(id)) taken.set(id, b.reason);
    }
    if (!taken.has(homeDisplay.id)) return { key: 'home' };
    const reason = taken.get(homeDisplay.id);
    const free = all.filter((d) => !taken.has(d.id));
    if (!free.length) return { key: 'hidden', reason };
    const target = free.find((d) => d.id === away?.screen) || free.find((d) => d.id === screen.getPrimaryDisplay().id) || free[0];
    return { key: `screen:${target.id}`, display: target, reason };
  }

  const currentKey = () => (away?.hidden ? 'hidden' : away?.screen !== undefined ? `screen:${away.screen}` : 'home');

  function settle() {
    const want = wanted();
    if (want.key === currentKey()) {
      if (pending) clearTimeout(pending.timer);
      pending = null;
      return;
    }
    if (pending?.key === want.key) return; // on its way
    if (pending) clearTimeout(pending.timer);
    pending = {
      key: want.key,
      timer: setTimeout(() => {
        pending = null;
        apply(wanted());
      }, want.key === 'home' ? RETURN_MS : FLEE_MS),
    };
  }

  function apply(want) {
    if (want.key === currentKey()) return;
    log?.(`${want.key} (${want.reason || 'free'}), ${blockers.size} in the way`);
    if (want.key === 'hidden') {
      hide(true, want.reason);
      away = { ...away, hidden: true };
      return;
    }
    if (away?.hidden) hide(false);
    if (want.key === 'home') {
      if (away?.screen !== undefined) moveTo(null);
      away = null;
      return;
    }
    const already = away?.screen === want.display.id; // out of hiding, on the screen she was on
    away = { screen: want.display.id };
    if (!already) moveTo(want.display, want.reason);
  }

  function pause(ms) {
    pausedUntil = Date.now() + ms;
    known = new Set(blockers.keys());
    if (pending) clearTimeout(pending.timer);
    pending = null;
    clearTimeout(pauseTimer);
    pauseTimer = setTimeout(() => {
      asideTo = null;
      settle();
    }, ms + 100);
  }

  return {
    update,
    // you called her back (tray click, her shortcut): home now, and no fleeing for a while
    recall(ms = 20 * 60 * 1000) {
      asideTo = null;
      pause(ms);
      apply({ key: 'home' });
    },
    // "va sur l'autre écran": there, for a while. False when there's no other screen.
    aside(ms = 20 * 60 * 1000) {
      const here = away?.screen ?? home().id;
      const other = screen.getAllDisplays().find((d) => d.id !== here);
      if (!other) return false;
      if (other.id === home().id) {
        asideTo = null;
        pause(ms);
        apply({ key: 'home' });
        return true;
      }
      asideTo = other.id;
      pause(ms);
      apply(wanted());
      return true;
    },
    // her home screen changed (her menu)
    homeChanged() {
      away = away?.hidden ? { hidden: true } : null;
      settle();
    },
    get away() {
      return away;
    },
  };
}

module.exports = { createFocusWatch, reasonOf };
