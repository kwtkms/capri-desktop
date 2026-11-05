import { Capri } from './capri.js';
import { FxLayer } from './fx.js';
import { Chip, Mask } from './chip.js';
import { Panel } from './panel.js';
import { Voice } from './voice.js';
import { Brain } from './brain.js';
import { Guide } from './guide.js';
import { Life } from './life.js';
import { Ask } from './ask.js';
import { Play } from './play.js';
import { Decor } from './decor.js';
import { Sisters } from './sisters.js';
import { Reminders } from './reminders.js';
import { Props } from './props.js';
import { Chase } from './chase.js';
import { Antics } from './antics.js';
import { Memory } from './memory.js';
import { CityLife } from './citylife.js';
import { Hands } from './hands.js';
import { Tidy } from './tidy.js';
import { Crate } from './crate.js';
import { Focus } from './focus.js';
import { Facts } from './facts.js';
import { Mind } from './mind.js';
import { Skills } from './skills.js';
import { moodOfDay } from './mood.js';
import { LINES } from './lines.js';
import { pick, fmt } from './util.js';

const host = window.host;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// close-ups of her for the cut-ins, frames of the show (tools/build-cutins.py)
const CUTINS = ['grin', 'laugh', 'eyes', 'many', 'look'];

async function boot() {
  const [config, image, intro, ...cutins] = await Promise.all([
    host.getConfig(),
    loadImage('../../assets/capri/capri-full.png'),
    loadImage('../../assets/capri/intro-face.webp').catch(() => null), // her intro, frames of the show
    ...CUTINS.map((name) => loadImage(`../../assets/capri/cutin-${name}.png`)),
    document.fonts.load('600 16px "Chakra Petch"'),
    document.fonts.load('400 11px "JetBrains Mono"'),
  ]);
  document.documentElement.lang = config.lang;

  const fx = new FxLayer(document.getElementById('fx'), {
    cutins: Object.fromEntries(CUTINS.map((name, i) => [name, cutins[i]])),
    intro,
  });
  fx.resize(innerWidth, innerHeight);
  const chip = new Chip(document.getElementById('chip'));
  chip.place(innerWidth, innerHeight);
  const mask = new Mask(document.getElementById('mask'));

  const voice = new Voice();
  voice.configure(config);
  host.listSounds().then((list) => list.length && voice.loadCustom(list));

  const panel = new Panel({
    panel: document.getElementById('panel'),
    ticker: document.getElementById('ticker'),
    labels: LINES[config.lang] || LINES.fr,
  });

  const capri = new Capri({
    root: document.getElementById('capri'),
    canvas: document.getElementById('sprite'),
    image,
    fx,
    voice,
  });
  capri.wander = config.wander;
  capri.possessWindows = config.possess;
  capri.setScale(config.scale);
  // asleep, she doesn't talk: only what can't wait (a permission Claude asks for, a reminder,
  // an error) still shows
  const say = panel.say.bind(panel);
  // in focus mode (focus.js), her chatter waits too: only what you asked for, Claude, and alerts
  panel.say = (opts) => {
    if (capri.mode === 'sleep' && opts.kind !== 'alert' && opts.kind !== 'error') return;
    if (capri.focus && !opts.focusLine && (opts.kind === 'info' || opts.kind === 'idle')) return;
    return say(opts);
  };

  const brain = new Brain({ capri, panel, voice, host, lang: config.lang });
  // everything that isn't Claude: your apps, the time, the battery, your breaks, your games
  const life = new Life({ capri, panel, brain, host, lang: config.lang });
  // questions you ask her (Ctrl+Alt+Q)
  const ask = new Ask({ form: document.getElementById('ask'), capri, panel, host, life, lang: config.lang });
  // stroking, annoying, throwing, hide-and-seek, your music, water breaks, pranks
  const play = new Play({ capri, panel, voice, host, life, brain, config, lang: config.lang });
  // reminders (Ctrl+Alt+R), understood locally
  ask.reminders = new Reminders({ capri, panel, host, voice, life, list: config.reminders || [], lang: config.lang });
  // her other selves, now and then (sisters.js)
  play.sisters = new Sisters({ capri, panel, image, fx, life, lang: config.lang });
  // her hands on your desktop: icons she carries and puts back, buttons she presses (hands.js)
  const hands = new Hands({ capri, panel, voice, host, lang: config.lang });
  ask.hands = hands;
  play.hands = hands;
  // "range mon bureau", "range mes fenêtres", "annule" (tidy.js)
  const tidy = new Tidy({ capri, panel, voice, host, hands, lang: config.lang });
  ask.tidy = tidy;
  play.tidy = tidy;
  hands.tidy = tidy;
  // her walks, boredom, size tricks, startles when a window opens by her (antics.js)
  const antics = new Antics({ capri, panel, voice, play, lang: config.lang });
  antics.tidy = tidy;
  // bedtime (life.js): she goes and lies down on a window, or on her board
  life.goLieDown = () => antics.sitSomewhere();
  play.antics = antics;
  // "concentre-moi 25 min" (focus.js), and what you tell her to remember (facts.js)
  const focus = new Focus({ capri, panel, life, lang: config.lang });
  focus.onSit = () => capri.stance !== 'sit' && antics.sitSomewhere();
  ask.focus = focus;
  ask.facts = new Facts({ host, panel, capri, saved: config.facts || [], lang: config.lang });
  // her own mind: what she understands and answers without Claude (mind.js, skills.js)
  ask.mind = new Mind({ learned: config.mindLearned || [], host });
  ask.skills = new Skills({ host, life, reminders: ask.reminders, lang: config.lang });
  // her own seat when your windows fill the screen (crate.js)
  const crate = new Crate({ capri, panel, voice, lang: config.lang });
  antics.crate = crate;
  play.crate = crate;
  // She must never be "gone" without a reason (put away, hidden for a game, hide-and-seek, in
  // her mask). Every few seconds: is she on the screen, drawn, and not stuck in the middle of a
  // move? If not twice in a row, she's put back where you can see her, and it's noted in the
  // local journal (main: capri-diag.log) so the cause can be found.
  let lost = 0;
  let busySince = 0;
  setInterval(() => {
    const c = capri;
    const now = performance.now();
    busySince = c.busy ? busySince || now : 0;
    if (c.stowed || c.stowing || c.dormant || c.hiding || life.hiddenForGame || c.dragging || c.stance === 'fall') {
      lost = 0;
      return;
    }
    const { w, h } = c.view;
    const why = [];
    // (peeking in from an edge, her feet are off the screen on purpose: she used to be yanked out of it)
    if (c.stance !== 'peek' && !(c.pos.x > -40 && c.pos.x < w + 40 && c.pos.y > 40 && c.pos.y < h + 160)) why.push(`out of view ${Math.round(c.pos.x)},${Math.round(c.pos.y)} in ${w}x${h}`);
    if (c.hidden) why.push('hidden');
    if (!c.busy && c.p.alpha < 0.3) why.push(`alpha ${c.p.alpha.toFixed(2)}`);
    if (!c.busy && (c.p.collapse > 0.5 || c.p.dissolve > 0.5)) why.push('half dissolved');
    if (busySince && now - busySince > 45000) why.push('stuck busy');
    if (!why.length) {
      lost = 0;
      return;
    }
    if (++lost < 2) return;
    lost = 0;
    host.diag(`rescued: ${why.join(', ')} (mode ${c.mode}, stance ${c.stance}, perch ${c.perch?.id ?? '-'}, last went to ${c.lastGoal ?? '?'})`);
    c.endAct(false);
    c.pending = null;
    c.busy = false;
    busySince = 0;
    c.setHidden(false);
    Object.assign(c.p, { collapse: 0, dissolve: 0, glitch: 0, split: 0, alpha: c.mode === 'sleep' ? 0.85 : 1 });
    c.setStance('stand');
    c.pos = c.spot('post');
    c.place();
    c.drawFrame();
  }, 3000);

  // what she remembers about your days, kept on this PC (memory.js)
  const memory = new Memory({ host, life, saved: config.memories || {}, lang: config.lang });
  life.memory = memory;
  ask.skills.memory = memory;
  // her things on your windows (props.js), and running after your pointer (chase.js)
  play.props = new Props({ capri, panel, fx, lang: config.lang });
  play.props.crate = crate;
  ask.props = play.props; // "range ton café"
  ask.play = play;        // "cache-cache"
  play.chase = new Chase({ capri, panel, host, lang: config.lang });
  // her netrunner visor: on while Claude works for you, or while you code
  let visor = null;
  setInterval(() => {
    const coding = ['code', 'cursor', 'windsurf', 'idea64', 'pycharm64', 'webstorm64', 'devenv', 'zed'].includes(life.app);
    const want = (capri.mode === 'work' || coding) && !capri.stowed && !capri.hidden && !capri.dormant;
    if (want && !visor) {
      visor = fx.visor(() => {
        if (capri.hidden || capri.stowed || capri.hiding || capri.stance === 'peek') return null;
        const h = capri.head();
        const s = capri.scale;
        return { x: h.x - capri.facing * 6 * s, y: h.y + 4 * s, s, tilt: (capri.tilt * Math.PI) / 180 - capri.p.head * capri.facing };
      }, () => visorOn);
    }
    visorOn = want;
    if (!want) visor = null;
  }, 1000);
  let visorOn = false;
  // her mood of the day: lazy days, she moves less
  capri.moveRate = moodOfDay().move;
  // her place: the bare desktop becomes a bit of Night City
  const decor = new Decor(document.getElementById('decor'));
  play.onLevel = (v) => decor.setLevel(v);
  ask.decor = decor; // "montre ta ville"
  // ...and she lives in it while it's up (citylife.js)
  const city = new CityLife({ capri, panel, decor, play, lang: config.lang });
  let nextDecorLine = 0;
  decor.onShown = () => {
    const now = Date.now();
    if (now < nextDecorLine || !play.free() || Math.random() > 0.5) return;
    nextDecorLine = now + 30 * 60000;
    capri.perform('spin', capri.towardCenter());
    panel.say({ kind: 'info', line: config.lang === 'en' ? 'Welcome to my neighborhood.' : 'Bienvenue dans mon quartier.', hold: 3500, face: 'grin' });
  };

  // Click-through everywhere except on her body, the panel and her biochip.
  let interactive = false;
  let mouse = null;
  const setInteractive = (on) => {
    if (on === interactive) return;
    interactive = on;
    host.setInteractive(on);
  };
  const onChip = () => Boolean(chip.visible && mouse && chip.contains(mouse.x, mouse.y, 0));
  const refreshHit = () => {
    if (capri.dragging || crate.dragging) return setInteractive(true);
    if (!mouse) return setInteractive(false);
    const r = panel.rect();
    const onPanel = r && mouse.x >= r.left && mouse.x <= r.right && mouse.y >= r.top && mouse.y <= r.bottom;
    document.body.style.cursor = onChip() ? 'pointer' : '';
    // her board too: you can grab it and move it (crate.js)
    return setInteractive(Boolean(onPanel || capri.hit(mouse.x, mouse.y) || onChip() || ask.contains(mouse.x, mouse.y) || crate.contains(mouse.x, mouse.y)));
  };
  // Her biochip: her eyes on it follow the pointer over it, and she comes out when you click it
  // (only then, so the pointer passing through that corner doesn't call her back).
  // Her mask, asleep: the pointer coming over it stirs her, and a moment of that wakes her up.
  let wakeTimer = 0;
  const comeOut = () => {
    if (capri.stowed) host.setConfig({ visible: true }); // the tray and Ctrl+Alt+C follow
    capri.unstow();
  };
  const hoverChip = () => {
    chip.pointer = chip.visible && mouse && chip.contains(mouse.x, mouse.y) ? mouse : null;
    const near = mask.visible && mouse && mask.contains(mouse.x, mouse.y, 30);
    mask.pointer = near ? mouse : null;
    if (!near) {
      clearTimeout(wakeTimer);
      wakeTimer = 0;
    } else if (!wakeTimer) {
      wakeTimer = setTimeout(() => {
        wakeTimer = 0;
        if (capri.dormant) capri.wake();
      }, 400);
    }
  };
  window.addEventListener('mousemove', (e) => {
    mouse = { x: e.clientX, y: e.clientY };
    refreshHit();
    hoverChip();
  });
  document.addEventListener('mouseleave', () => {
    mouse = null;
    refreshHit();
    hoverChip();
  });
  window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (chip.visible && chip.contains(e.clientX, e.clientY, 0)) host.openMenu();
  });
  window.addEventListener('click', (e) => {
    if (chip.visible && chip.contains(e.clientX, e.clientY, 0)) comeOut();
  });
  // While you drag something (an icon off your desktop), Windows sends no mouse moves: main
  // tells us where the pointer is, so she can still be dropped on.
  host.onCursor?.((p) => {
    if (capri.dragging) return;
    mouse = p.inside ? { x: p.x, y: p.y } : null;
    refreshHit();
  });
  // An icon from your desktop dropped on her: she takes it and keeps it (hands.js). Nothing is
  // done to the file: the drop is only a "link", she just reads its name. Dropped anywhere else
  // on her layer, nothing happens (and the page never opens the file).
  const onHer = (x, y) => capri.hit(x, y) || (Math.abs(x - capri.pos.x) < 90 * capri.scale && y > capri.head().top && y < capri.pos.y);
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    const over = onHer(e.clientX, e.clientY);
    e.dataTransfer.dropEffect = over ? 'link' : 'none';
    if (over && !capri.act && !capri.busy) capri.perform('curious', capri.towardCenter());
  });
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    if (!onHer(e.clientX, e.clientY)) return;
    const file = e.dataTransfer.files?.[0];
    const path = file ? host.pathOf(file) : '';
    const name = String(path).split(/[\\/]/).pop().replace(/\.(lnk|url|appref-ms|exe)$/i, '');
    if (!name) return;
    const res = await hands.give(name);
    if (!res.ok) panel.say({ kind: 'info', line: hands.t.notGiven.replace('{what}', name), hold: 4000, face: 'aside' });
  });

  // wiring
  capri.onMove = (head) => {
    // pointing at something: the panel goes on her other side, so it doesn't cover it
    panel.setAnchor({ ...head, lean: capri.pointing ? -capri.pointing.dir : 0 }, capri.view);
    // she may have moved out from under a still pointer: never leave a dead click zone behind
    refreshHit();
  };
  capri.onTeleport = (phase) => (phase === 'start' ? panel.suspend() : panel.resume());
  capri.chipAt = () => chip.center();
  capri.onStow = () => {
    chip.setMode(capri.mode);
    chip.show();
    crate.putAway(); // her board goes with her
  };
  capri.onUnstow = () => chip.hide();
  capri.onDoze = (phase, face) => {
    if (phase === 'start') {
      mask.place(face.x, face.y, capri.scale * 1.1);
      mask.show();
    } else if (phase === 'waking') {
      mask.wake();
    } else {
      mask.hide();
    }
  };
  capri.onMode = (mode, prev) => {
    chip.setMode(mode, prev);
  };
  // now and then she says something about the satellite: while she looks at it, or once
  // the red light has gone up (never during, nothing should cover that)
  capri.onGaze = (when) => {
    const lines = when === 'end' ? brain.t.uplink : brain.t.gaze;
    if (!panel.visible && Math.random() < (when === 'end' ? 0.6 : 0.4)) panel.say({ kind: 'info', line: pick(lines), hold: 3800 });
  };
  capri.onClick = () => {
    if (play.click()) return; // found her (hide-and-seek), or one click too many
    if (panel.visible) panel.hide();
    else if (brain.busySessions.length) brain.status();
    else life.status(); // Claude isn't doing anything: she talks about you instead
  };
  panel.onChar = (kind) => voice.play('blip', { mood: kind });
  // while she talks: nods, a hand explaining, a cocked head and a shrug
  panel.onTalk = (talking) => talking && capri.perform(pick(['talk', 'talk', 'talkHand', 'talkTilt']), capri.towardCenter());
  capri.onMenu = () => host.openMenu();

  // Her guide (guide.js): her welcome on first launch, and "How does it work?" in her menu,
  // where she takes you to things and points at them.
  const guide = new Guide({ capri, panel, voice, host, brain });
  // the first Claude Code event that ever reaches her: so you know it worked
  brain.linked = config.linked;
  brain.onLinked = () => {
    host.setConfig({ linked: true, welcomed: true });
    voice.play('hello');
    capri.perform('hop');
    panel.say({ kind: 'done', badge: 'LINK', line: brain.t.welcome.linked, hold: 6000 });
  };

  // The demo's second half, after its fake Claude session: everything she does on her own, one
  // after the other, a line before each.
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (done, max = 15000) => {
    for (const t0 = Date.now(); !done() && Date.now() - t0 < max;) await wait(100);
  };
  const free = () => !capri.busy && !capri.act && capri.stance !== 'fall';
  brain.onShowcase = async () => {
    const t = brain.t.showcase;
    const caption = (line) => panel.say({ kind: 'info', line, hold: 2200 });
    capri.nextMove = capri.nextGaze = performance.now() + 120000; // nothing of her own in between
    if (capri.stowed) await capri.unstow();
    if (capri.dormant) capri.wake();
    await until(free);
    panel.hide();

    caption(t.minds);
    await wait(1000);
    await capri.perform('split');
    await wait(900);

    caption(t.zap);
    await wait(1000);
    const h = capri.head();
    capri.zap(h.x + capri.towardCenter() * 280, h.y - 170);
    await wait(1800);

    panel.hide();
    if (capri.gaze({ big: true })) await until(() => !capri.sky);
    await wait(2500);

    // a little terminal opens for her to take over, and closes under her once she's done with it
    if (capri.possessWindows && (await host.demoWindow(true))) {
      const top = () => capri.windows.wins.find((w) => capri.canSit(w)); // it opens on top of everything
      await until(top, 4000);
      const win = top();
      const seat = win && { win, dx: win.w * 0.4 };
      if (seat) {
        panel.hide();
        await capri.sitOn(seat);
        await until(free);
        caption(t.possess);
        await wait(1400);
        panel.hide();
        await capri.possess();
        await wait(1800);
      }
      host.demoWindow(false);
      await wait(400);
      await until(free); // she may have fallen off it
      await wait(900);
    }

    caption(t.sleep);
    await wait(1400);
    panel.hide();
    capri.setMode('sleep');
    await wait(2500); // dozing off
    await capri.doze();
    await wait(4500);
    capri.wake();
    await until(free);
    await wait(1200);

    caption(t.chip);
    await wait(1600);
    panel.hide();
    await capri.stow();
    await wait(3500);
    await capri.unstow();
    await wait(600);
    panel.say({ kind: 'info', line: t.end, hold: 5000 });
  };

  host.onClaudeEvent((evt) => brain.handle(evt));
  host.onWindows((data) => {
    capri.setWindows(data);
    brain.onWindows(data);
    life.onWindows(data);
    play.onWindows(data);
    play.props.setWindows(capri.windows.wins); // with her own seat in it

    antics.onWindows(data.wins);
    if (!decor.holdWins) {
      decor.setWindows(data.wins);
      decor.setDesk(data.desk, { allowed: !capri.stowed && !capri.hidden });
    }
  });
  // the windows as they are now: the watcher only speaks again when something changes
  host.windowsNow().then((data) => data && capri.setWindows(data));

  let screenId = null;
  host.onResize(({ width, height, screen }) => {
    // another screen: nothing of the old one comes along, and the windows "appearing" around her
    // aren't anything to jump at
    if (screenId !== null && screen !== screenId) {
      capri.changedScreen();
      crate.putAway();
      play.props.clear();
      play.cancelHide();
      antics.prevWins = null;
    }
    screenId = screen;
    fx.resize(width, height);
    decor.resize(width, height);
    chip.place(width, height);
    capri.setView(width, height);
    crate.fit();
  });
  window.addEventListener('resize', () => {
    fx.resize(innerWidth, innerHeight);
    chip.place(innerWidth, innerHeight);
    capri.setView(innerWidth, innerHeight);
    crate.fit();
  });

  host.onConfig((cfg) => {
    voice.configure(cfg);
    capri.wander = cfg.wander;
    capri.possessWindows = cfg.possess;
    if (cfg.scale !== capri.scale) capri.setScale(cfg.scale);
    if (cfg.lang !== brain.lang) {
      for (const part of [brain, life, ask, play, play.feud, play.props, play.sisters, play.chase, hands, tidy, antics, focus, crate, ask.reminders, ask.facts, ask.skills, city]) part.lang = cfg.lang;
      panel.labels = LINES[cfg.lang] || LINES.fr;
      document.documentElement.lang = cfg.lang;
    }
  });

  host.onCommand(async (cmd) => {
    const t = brain.t;
    switch (cmd.name) {
      case 'teleport':
        capri.teleport(capri.spot('random'));
        break;
      case 'status':
        brain.status();
        break;
      case 'welcome': // "How does it work?" in her menu
        guide.menu();
        break;
      case 'fakeClaude': { // --dev: the topmost window (the test window) is where a prompt was typed, and you're elsewhere
        const win = capri.windows.wins[0];
        if (win) {
          brain.sessions.set('dev', { id: 'dev', project: 'dev', taskStart: Date.now(), count: 0, files: new Set(), log: [], working: true, waiting: false, window: win.id, seen: Date.now() });
          capri.windows = { ...capri.windows, fg: -1 };
        }
        break;
      }
      case 'guide': // --dev: one topic of her guide (welcome, menu, connect, icon, claude, folder)
        if (cmd.topic === 'welcome') guide.welcome();
        else if (cmd.topic === 'menu') guide.menu();
        else if (typeof guide[cmd.topic] === 'function') guide.scene(() => guide[cmd.topic]());
        break;
      case 'stow': // Ctrl+Alt+C: into her biochip, or back out
        if (cmd.on) capri.stow();
        else capri.unstow();
        break;
      case 'relocate': // a game took her screen: she's on the other one now (or back home)
        life.relocate(cmd);
        break;
      case 'away': // a game took her only screen: into her biochip until it's over
        life.hideForGame(cmd.on, cmd.reason);
        break;
      case 'life': // screen locked, back from a break, charger...
        life.onLife(cmd);
        play.onLife(cmd);
        memory.onLife(cmd);
        break;
      case 'hide': // her menu: hide-and-seek, now
        play.hide();
        break;
      case 'prank': // her menu: a fake hack, now
        play.prank();
        break;
      case 'flash': // an app flashing in the taskbar (notify.ps1): its name only
        play.flash(String(cmd.app || ''));
        break;
      case 'sister': // her menu / --dev: one of her other selves drops by
        play.sisters.visit(cmd.kind);
        break;
      case 'rhythm': // --dev: her ears on (or off), as when Spotify plays
        if (cmd.on) await play.rhythm.start();
        else play.rhythm.stop();
        console.log('[capri] rhythm on:', play.rhythm.on);
        break;
      case 'decor': // --dev: her Night City now, as if the desktop were in front (windows ignored)
        if (cmd.on) {
          decor.build();
          decor.show();
          decor.setWindows([]);
          decor.holdWins = true;
        } else {
          decor.holdWins = false;
          decor.setDesk(false);
        }
        break;
      case 'antic': // --dev: walk, bored, tiny, giant, ledgeWalk
        if (cmd.what === 'ledgeWalk') capri.ledgeWalk();
        else antics[cmd.what]?.();
        break;
      case 'invasion': // --dev
        play.sisters.invasion();
        break;
      case 'city': // --dev: roof, ride, koi, sign, tag
        city.run(() => city[cmd.what]());
        break;
      case 'say': // --dev: as if you had typed this in her box
        ask.input.value = String(cmd.text || '');
        ask.submit();
        break;
      case 'doodle': // --dev: one of her temporary drawings, now
        if (cmd.after) tidy.revertAfter = Number(cmd.after);
        tidy.arrange(cmd.mode || 'smiley', { temporary: true });
        break;
      case 'crate': // --dev: build, push, kick, dismiss
        crate[cmd.what || 'build']?.();
        break;
      case 'carry': // --dev: she carries one of your desktop icons around
        hands.carry();
        break;
      case 'open': // --dev: as if you had typed "ouvre <what>"
        hands.open(String(cmd.what || ''));
        break;
      case 'event': // --dev: one of her events, now
        play.event();
        break;
      case 'chase': // --dev: she runs after your pointer
        play.chase.start();
        break;
      case 'prop': // --dev: she puts one of her things on her window
        // ({ kind }: at her feet, wherever she is)
        if (cmd.kind) {
          play.props.items.push({ kind: cmd.kind, win: null, dx: 0, x: capri.pos.x + 80, y: capri.pos.y, vy: 0, falling: false, lastX: 0, floorSince: 0, placed: performance.now() });
          play.props.ensureLayer();
        } else play.props.place();
        break;
      case 'visor': // --dev: as if Claude were working
        capri.setMode(cmd.on ? 'work' : 'idle');
        break;
      case 'kickWindow': // --dev
        play.kickWindow();
        break;
      case 'bedtime': // --dev
        life.yawnedAt = 0;
        life.checkBedtime(true);
        break;
      case 'touch': // --dev: as if you had clicked her
        capri.touch();
        capri.wake();
        break;
      case 'lie': // --dev: tuning her lying pose
        capri.lieTune = cmd.params || null;
        if (cmd.facing) capri.facing = cmd.facing;
        if (cmd.side) capri.lieSide = cmd.side;
        break;
      case 'seats': { // --dev: where she'd sit, 300 draws, in the log
        const xs = [];
        for (let i = 0; i < 300; i++) {
          const seat = capri.pickSeat({ any: true });
          if (seat) xs.push(seat.win.x + seat.dx);
        }
        console.log('[capri] seats', JSON.stringify({ n: xs.length, min: Math.min(...xs), max: Math.max(...xs), w: capri.view.w, wins: capri.windows.wins.map((w) => [w.x, w.y, w.w, w.max]) }));
        break;
      }
      case 'state': // --dev: what she's doing, in the log
        console.log('[capri] state', JSON.stringify({ mode: capri.mode, stance: capri.stance, perch: capri.perch?.id, act: capri.act?.name, busy: capri.busy, night: capri.nightSleep, lieK: capri.lieK, pos: capri.pos, head: capri.head(), tilt: capri.tilt, facing: capri.facing, side: capri.lieSide, panel: panel.visible, stowed: capri.stowed, view: capri.view, props: play.props.items.map((i) => i.kind) }));
        break;
      case 'vision': // Ctrl+Alt+V: she looks at your screen
        ask.open({ vision: true });
        break;
      case 'remind': // Ctrl+Alt+R: a reminder (reminders.js, no Claude)
        if (ask.visible) ask.close();
        else ask.open({ remind: true });
        break;
      case 'ask': // Ctrl+Alt+Q or her menu: the question box
        if (ask.visible) ask.close();
        else ask.open();
        break;
      case 'satellite': // the whole sequence, on demand (tray)
        if (capri.stowed) {
          host.setConfig({ visible: true });
          await capri.unstow();
        }
        capri.wake();
        if (capri.stance === 'peek') await capri.unpeek();
        if (!capri.gaze({ big: true })) setTimeout(() => capri.gaze({ big: true }), 1500);
        break;
      case 'hooks':
        if (cmd.ok) panel.say({ kind: 'info', line: cmd.action === 'install' ? t.hooksOk : t.hooksRemoved, hold: 6000 });
        else panel.say({ kind: 'error', line: fmt(t.hooksFail, { error: cmd.error }), hold: 9000 });
        break;
      // --dev helpers
      case 'intro': // her intro again, as when she starts (still: as with Windows' animations off)
        panel.hide();
        await capri.intro(capri.spot('post'), cmd.still ? { still: true } : {});
        break;
      case 'pose':
        capri.debug = cmd.params || null;
        if (cmd.still) capri.nextMove = capri.nextGaze = Infinity; // no wandering off mid-test
        if (cmd.hush) {
          panel.setTicker(null);
          panel.hide();
        }
        if (cmd.scale) capri.setScale(cmd.scale);
        if (cmd.stance) capri.setStance(cmd.stance, cmd);
        if (cmd.at) capri.pos = cmd.at;
        if (cmd.facing) capri.facing = cmd.facing;
        capri.drawFrame();
        break;
      case 'config': // a setting, as if changed from her menu
        host.setConfig(cmd.patch || {});
        break;
      case 'focus': // as if window `fg` had come to the front
        capri.windows = { ...capri.windows, fg: cmd.fg };
        brain.onWindows(capri.windows);
        break;
      case 'freeze':
        capri.hidden = Boolean(cmd.on);
        break;
      case 'act':
        // behaviours by method name (gaze, celebrate, hurt, shed, peek, fall, wanderStep...) or acts by name
        if (cmd.act === 'sit') {
          // pile: n-th window she could sit on from the top of the pile (0: the --dev test window
          // opened last), instead of the usual choice
          const top = cmd.pile !== undefined && capri.windows.wins.filter((w) => capri.canSit(w))[cmd.pile];
          const seat = top ? { win: top, dx: top.w * 0.4 } : capri.pickSeat();
          if (seat) capri.hopTo(seat);
        } else if (typeof capri[cmd.act] === 'function') capri[cmd.act](...(cmd.args || []));
        else capri.perform(cmd.act, cmd.dir || 0);
        break;
      default:
        break;
    }
  });

  // entrance: her face big in the corner says hi, then she dives down to her spot
  // (put away last time: she starts in her biochip)
  if (config.visible === false) capri.stowNow();
  else if (intro) await capri.intro(capri.spot('post'));
  else await capri.materialize(capri.spot('post'));
  const hooks = await host.hooksStatus();
  if (!config.welcomed || !hooks.installed) guide.welcome();
  else {
    panel.say({ kind: 'info', line: life.greeting(), hold: 4000 });
    capri.perform('stretch');
    // once a day, something she remembers from yesterday
    setTimeout(() => {
      let told = null;
      try { told = localStorage.getItem('capri.recalled'); } catch { /* storage off */ }
      const day = new Date().toDateString();
      const line = told !== day && memory.recall();
      if (!line || panel.visible) return;
      try { localStorage.setItem('capri.recalled', day); } catch { /* storage off */ }
      panel.say({ kind: 'info', line, hold: 6000, face: 'smug' });
    }, 9000);
  }
}

boot().catch((err) => {
  console.error('[capri] boot failed', err);
});
