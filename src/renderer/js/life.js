// Capri beyond Claude Code: she notices what you're up to on the PC (the app in front, the time,
// the battery, your breaks), says a word now and then, and goes to sit on what you're using.
// She keeps it rare: a quiet companion, not a notification machine.

import { lifeLines } from './life-lines.js';
import { pick, fmt, duration } from './util.js';
import { moodLine } from './mood.js';

// process name (lowercase) -> what kind of thing you're doing
const KINDS = {
  browser: ['chrome', 'msedge', 'firefox', 'opera', 'opera_gx', 'brave', 'vivaldi', 'arc', 'zen'],
  discord: ['discord', 'discordptb', 'discordcanary'],
  music: ['spotify', 'deezer', 'applemusic', 'am-music', 'tidal', 'foobar2000', 'musicbee'],
  launcher: ['steam', 'steamwebhelper', 'epicgameslauncher', 'galaxyclient', 'battle.net', 'eadesktop', 'ubisoftconnect'],
  code: ['code', 'cursor', 'windsurf', 'idea64', 'pycharm64', 'webstorm64', 'rider64', 'devenv', 'sublime_text', 'notepad++', 'zed'],
  files: ['explorer'],
  work: ['winword', 'excel', 'powerpnt', 'onenote', 'notion', 'obsidian', 'acrobat', 'acrord32'],
  video: ['vlc', 'mpc-hc64', 'mpc-be64', 'potplayermini64', 'netflix', 'primevideo'],
  chat: ['whatsapp', 'telegram', 'signal', 'messenger'],
  claude: ['claude'],
};
const KIND_OF = new Map(Object.entries(KINDS).flatMap(([kind, apps]) => apps.map((a) => [a, kind])));

// Nice names for the apps she mentions when you click her.
const NAMES = {
  chrome: 'Chrome', msedge: 'Edge', firefox: 'Firefox', discord: 'Discord', spotify: 'Spotify', steam: 'Steam',
  code: 'VS Code', explorer: 'l’explorateur', winword: 'Word', excel: 'Excel', powerpnt: 'PowerPoint', claude: 'Claude',
};

const TALK_EVERY_MS = 4 * 60 * 1000;   // at most one remark about your apps this often
const SAME_KIND_MS = 25 * 60 * 1000;   // and not twice about the same thing within this
const SETTLE_MS = 5000;                // you stayed on it a moment: not just alt-tabbing through
const LATE_CHECK_MS = 10 * 60 * 1000;

export class Life {
  constructor({ capri, panel, brain, host, lang = 'fr' }) {
    this.capri = capri;
    this.panel = panel;
    this.brain = brain;
    this.host = host;
    this.away = false; // on your other screen for now (main/focus.js)
    this.lang = lang;
    this.app = '';
    this.appSince = Date.now();
    this.pending = null;
    this.lastTalk = 0;
    this.saidKind = new Map();
    this.lateNight = null; // the night she already told you to go to bed
    this.lowWarned = 1;    // battery level she last warned you at
    this.hiddenForGame = false;
    this.gaming = false;
    setInterval(() => this.checkLate(), LATE_CHECK_MS);
    this.watchBattery();
    // after midnight, 5 min without you touching her (capri.behave): bed; woken: a grumble
    capri.onBedtime = () => this.bedtime();
    capri.onWokenAtNight = () => setTimeout(() => {
      capri.perform('stretch'); // she sits back up, then stretches
      this.say(pick(this.t.grumble), { face: 'aside', hold: 3500 });
    }, 1200);
  }

  get t() {
    return lifeLines(this.lang);
  }

  // Can she talk without stepping on anything (Claude's work, a question, another panel)?
  free() {
    const c = this.capri;
    return c.mode === 'idle' && !c.busy && !c.stowed && !c.dormant && !c.focus && !this.panel.visible && !this.brain.busySessions.length;
  }

  say(line, { kind = 'info', hold = 4500, face } = {}) {
    this.panel.say({ kind, line, hold, ...(face ? { face } : {}) });
  }

  // Her first words: depends on the time of day, and on her mood of the day (mood.js).
  greeting() {
    const h = new Date().getHours();
    const part = h < 5 ? 'night' : h < 12 ? 'morning' : h < 18 ? 'afternoon' : h < 23 ? 'evening' : 'night';
    return `${pick(this.t.time[part])} ${moodLine(this.lang)}`;
  }

  // Bedtime (capri.behave, after midnight with nobody touching her for 5 min): she stretches,
  // yawns, goes to lie down on a window or on her board, and falls asleep. She sleeps until you
  // touch her (or until morning, when you unlock the PC or come back from a break).
  async bedtime() {
    const c = this.capri;
    c.perform('stretch');
    if (!this.panel.visible) this.say(pick(this.t.yawn), { face: 'aside', hold: 3500 });
    await new Promise((r) => setTimeout(r, 3000));
    if (!c.nightSleep || c.stowed) return; // touched meanwhile
    if (c.stance !== 'sit') await this.goLieDown?.();
    if (c.nightSleep) c.setMode('sleep');
  }

  // "bonne nuit", "dors" typed in her box: bed now, whatever the time; she sleeps until you
  // touch her (or say "debout")
  goToBed() {
    this.capri.nightSleep = true;
    this.bedtime();
  }

  // what you're doing in front (KINDS): 'discord', 'video', 'code'... or undefined
  get kind() {
    return KIND_OF.get(this.app);
  }

  // --dev: bedtime now
  checkBedtime() {
    this.capri.nightSleep = true;
    this.bedtime();
  }

  checkLate() {
    const now = new Date();
    const h = now.getHours();
    if (h < 1 || h > 5) return;
    const night = now.toDateString();
    if (this.lateNight === night || !this.free()) return;
    this.lateNight = night;
    this.capri.perform('curious', this.capri.towardCenter());
    this.say(fmt(pick(this.t.time.late), { hour: h }), { face: 'aside', hold: 6000 });
  }

  // The app in front changed (windows.ps1 -> main -> here).
  onWindows({ app, reason }) {
    const name = String(app || '').toLowerCase();
    // a game, anything fullscreen, or something you watch or read in front (main/focus.js): no
    // pranks, no games
    this.gaming = Boolean(reason);
    if (!name || name === this.app) return;
    this.app = name;
    this.appSince = Date.now();
    clearTimeout(this.pending);
    this.pending = setTimeout(() => this.settled(name), SETTLE_MS);
  }

  settled(name) {
    if (name !== this.app) return;
    const kind = KIND_OF.get(name);
    const now = Date.now();
    // now and then she goes and sits on what you're using
    if (this.free() && this.capri.wander && Math.random() < 0.35) {
      const seat = this.capri.pickSeat({ frontOnly: true });
      if (seat && this.capri.perch?.id !== seat.win.id) this.capri.hopTo(seat);
    }
    if (!kind || now - this.lastTalk < TALK_EVERY_MS || now - (this.saidKind.get(kind) || 0) < SAME_KIND_MS) return;
    if (!this.free() || Math.random() > 0.55) return;
    this.lastTalk = now;
    this.saidKind.set(kind, now);
    this.capri.perform(pick(['look', 'curious', 'hop']), this.capri.towardCenter());
    this.say(pick(this.t.apps[kind]), { face: pick(['look', 'smug', 'grin']) });
  }

  // A line for the questions you ask her (ask.js): what you're on, and the time.
  context() {
    const clock = new Date().toLocaleString(this.lang, { weekday: 'long', hour: '2-digit', minute: '2-digit' });
    const app = NAMES[this.app] || this.app;
    return app ? `${clock}, kwtkms est sur ${app}` : clock;
  }

  // When you click her and Claude isn't doing anything: something about you.
  status() {
    const app = NAMES[this.app] || (this.app ? this.app.charAt(0).toUpperCase() + this.app.slice(1) : '');
    const clock = new Date().toLocaleTimeString(this.lang, { hour: '2-digit', minute: '2-digit' });
    const lines = app ? this.t.idle : this.t.idle.filter((l) => !l.includes('{app}'));
    // now and then, something she remembers about your days instead (memory.js)
    const remembered = Math.random() < 0.3 && this.memory?.recall();
    const line = remembered || fmt(pick(lines), { app, time: duration(Date.now() - this.appSince, this.lang), clock });
    this.say(line, { kind: 'idle', face: pick(['calm', 'smug', 'aside']) });
  }

  // From main (life.js): screen lock, sleep, charger, breaks.
  onLife(evt) {
    const c = this.capri;
    switch (evt.type) {
      case 'lock':
        c.setMode('sleep');
        return;
      case 'unlock':
      case 'resume':
        if (c.nightSleep && new Date().getHours() >= 6) c.touch(); // morning: you're back, she gets up
        c.wake();
        setTimeout(() => this.free() && this.say(pick(this.t[evt.type]), { face: 'grin' }), 1500);
        return;
      case 'back':
        if (c.nightSleep && new Date().getHours() >= 6) c.touch();
        c.wake();
        setTimeout(() => {
          if (!this.free()) return;
          c.perform('hop');
          this.say(fmt(pick(this.t.back), { minutes: evt.minutes }), { face: 'grin' });
        }, 1500);
        return;
      case 'battery':
      case 'charging':
        if (this.free()) this.say(pick(this.t[evt.type]));
        return;
      default:
    }
  }

  watchBattery() {
    if (!navigator.getBattery) return;
    navigator.getBattery().then((battery) => {
      const check = () => {
        const level = Math.round(battery.level * 100);
        if (battery.charging) {
          this.lowWarned = 1;
          return;
        }
        const step = level <= 10 ? 0.1 : level <= 20 ? 0.2 : 1;
        if (step >= this.lowWarned) return;
        this.lowWarned = step;
        this.capri.wake();
        this.capri.perform('alarm', this.capri.towardCenter());
        this.say(fmt(pick(this.t.low), { level }), { kind: 'alert', hold: 7000, face: 'wide' });
      };
      battery.addEventListener('levelchange', check);
      battery.addEventListener('chargingchange', check);
      check();
    }).catch(() => {});
  }

  // A game, something fullscreen, or something you're watching or reading took her screen
  // (main/focus.js; reason: 'game' or 'watch').
  async relocate({ away, reason }) {
    const c = this.capri;
    this.away = away;
    // her chatter goes; a question from Claude or an answer you're reading comes along with her
    if (['info', 'idle'].includes(this.panel.current?.kind)) this.panel.hide();
    if (c.stowed || c.dormant) return;
    // the overlay goes through in-between sizes on its way to a screen with another scale: a spot
    // picked in one of those is off the real screen
    await new Promise((r) => setTimeout(r, 400));
    // asleep, she's just carried over, and sleeps on
    if (c.asleep) {
      c.setView(c.view.w, c.view.h);
      return;
    }
    await c.teleport(c.spot('post'));
    c.setView(c.view.w, c.view.h);
    const lines = away ? { watch: this.t.awayWatch, asked: this.t.awayAsked }[reason] || this.t.away : this.t.home;
    this.say(pick(lines), { hold: 3500 });
  }

  async hideForGame(on, reason) {
    const c = this.capri;
    if (on) {
      if (c.stowed) {
        this.host.awayDone();
        return;
      }
      this.hiddenForGame = true;
      this.say(pick(reason === 'watch' ? this.t.hidingWatch : this.t.hiding), { hold: 1500 });
      await new Promise((r) => setTimeout(r, 900));
      if (!this.hiddenForGame) return; // it's over already
      this.panel.hide();
      await c.stow();
      this.host.awayDone();
    } else if (this.hiddenForGame) {
      this.hiddenForGame = false;
      await c.unstow();
      this.say(pick(this.t.unhide), { hold: 3000 });
    }
  }
}
