// What she does with herself between two things: she walks around (on the floor, along the
// top of a window), gets bored (juggles, draws in the air, stretches, crosses her arms), shrinks
// to hide in a corner or blows up huge for two seconds to make you jump. And she reacts when you
// open or close a window right next to her. Her moods show: laughs, pouts, startles.

import { pick, sleep, rand, clamp } from './util.js';

const TEXT = {
  fr: {
    bored: ['Je m’ennuie…', 'Il se passe rien, là.', 'Tu fais quoi, toi ?', 'Bon. Je vais m’occuper toute seule.'],
    juggle: ['Regarde, je jongle avec des octets.', 'Trois paquets de données en l’air. Record personnel.'],
    doodle: ['Je dessine dans l’air. C’est de l’art.', 'Un petit graffiti invisible.'],
    tiny: ['Mode furtif.', 'Je me fais toute petite.', 'Tu me vois ? Non ? Parfait.'],
    giant: ['BOUH !', 'Mode GÉANTE !', 'Je suis IMMENSE !'],
    giantAfter: ['Haha, t’as sursauté ?', 'Pardon. Pas pardon.'],
    startleOpen: ['Woh ! Ça sort d’où, ça ?', 'Préviens quand tu ouvres un truc !', 'Une fenêtre sauvage apparaît.'],
    startleClose: ['Pouf, disparue.', 'Elle était bien, cette fenêtre.', 'Hé, j’étais à côté !'],
    walk: ['Petite balade.', 'Je me dégourdis les jambes.', 'Patrouille du bureau.'],
  },
  en: {
    bored: ['I’m bored…', 'Nothing’s happening.', 'What are you up to?', 'Fine. I’ll keep myself busy.'],
    juggle: ['Look, I’m juggling bytes.', 'Three data packets in the air. Personal best.'],
    doodle: ['Drawing in the air. It’s art.', 'A little invisible graffiti.'],
    tiny: ['Stealth mode.', 'Making myself tiny.', 'See me? No? Perfect.'],
    giant: ['BOO!', 'GIANT mode!', 'I’m HUGE!'],
    giantAfter: ['Haha, did you jump?', 'Sorry. Not sorry.'],
    startleOpen: ['Whoa! Where did that come from?', 'Warn me when you open stuff!', 'A wild window appears.'],
    startleClose: ['Poof, gone.', 'I liked that window.', 'Hey, I was right there!'],
    walk: ['Little walk.', 'Stretching my legs.', 'Desk patrol.'],
  },
};

export class Antics {
  constructor({ capri, panel, voice, play, lang = 'fr' }) {
    Object.assign(this, { capri, panel, voice, play, lang });
    this.prevWins = null;
    this.lastStartle = 0;
    this.crate = null; // app.js: her own seat (crate.js)
    this.tidy = null;  // app.js: drawings with your desktop icons (tidy.js)
    capri.onAntic = () => this.pickOne();
    capri.onIdle = () => this.idle();
    // sleepy while standing: she goes and lies down on a window, or on her board
    const toBed = () => {
      if (capri.mode === 'sleep' && capri.stance === 'stand' && !capri.busy && !capri.stowed && !capri.dragging) this.sitSomewhere();
    };
    capri.onWantBed = () => setTimeout(toBed, 1500);
    // knocked off her ledge in her sleep (window closed, maximized): she goes back to lie down
    setInterval(toBed, 15000);
  }

  get t() {
    return TEXT[this.lang] || TEXT.en;
  }

  say(line, face = 'grin', hold = 2600) {
    if (!this.panel.visible && Math.random() < 0.6) this.panel.say({ kind: 'info', line, hold, face });
  }

  free() {
    const c = this.capri;
    return !c.busy && !c.stowed && !c.hidden && !c.hiding && !c.dormant && c.mode !== 'sleep' && !c.nightSleep && !c.focus && c.stance !== 'fall' && c.stance !== 'peek' && !this.play.feud.active;
  }

  // Every few seconds (capri.onIdle): one small thing, her normal behaviour. Mostly quiet; she
  // only says something now and then.
  idle() {
    const c = this.capri;
    if (!this.free() || c.mode === 'sleep') return;
    const sitting = c.stance === 'sit';
    const music = this.play.playing;
    const onCrate = sitting && c.perch?.id === 'capri-crate';
    const options = sitting ? [
      ['look', 18, () => c.perform('look')],
      ['glance', c.mouse ? 8 : 0, () => c.perform('glance', c.mouse.x > c.pos.x ? 1 : -1)],
      ['curious', 10, () => c.perform('curious', c.towardCenter())],
      ['stretch', 8, () => c.perform('stretch')],
      ['juggle', 9, () => c.perform('juggle')],
      ['doodle', 6, () => c.perform('doodle', c.towardCenter())],
      ['groove', music ? 20 : 3, () => c.perform('groove')],
      ['sitLean', 7, () => c.perform('sitLean')],
      ['sitSwing', 6, () => c.perform('sitSwing')],
      ['sitHug', 4, () => c.perform('sitHug')],
      ['ledge', 7, () => c.ledgeWalk()],
      ['crateRide', onCrate && this.crate ? 12 : 0, () => this.crate.ride()],
      ['crateKick', onCrate && this.crate ? 2 : 0, () => this.crate.kick()],
      ['cratePush', onCrate && this.crate ? 2 : 0, () => this.crate.push()],
      ['nothing', 18, () => {}],
    ] : [
      ['look', 14, () => c.perform('look')],
      ['glance', c.mouse ? 8 : 0, () => c.perform('glance', c.mouse.x > c.pos.x ? 1 : -1)],
      ['sway', 8, () => c.perform('sway')],
      ['wave', c.mouse ? 2 : 0, () => c.perform('wave', c.mouse.x > c.pos.x ? 1 : -1)],
      ['curious', 8, () => c.perform('curious', c.towardCenter())],
      ['steps', 22, () => this.steps()],
      ['stretch', 7, () => c.perform('stretch')],
      ['juggle', 8, () => c.perform('juggle')],
      ['crossArms', 6, () => c.perform('crossArms', c.towardCenter())],
      ['doodle', 5, () => c.perform('doodle', c.towardCenter())],
      ['hop', 4, () => c.perform('hop')],
      ['turn', 5, () => c.perform('turn')],
      ['groove', music ? 25 : 4, () => c.perform(pick(['groove', 'grooveArms', 'grooveBounce']))],
      ['sit', 8, () => this.sitSomewhere()],
      ['drawDesk', c.windows.desk && this.tidy ? 3 : 0, () => this.tidy.doodle()],
      ['crate', this.crate?.up ? 7 : 0, () => pick([() => this.crate.ride(), () => this.crate.ride(), () => this.crate.push(), () => this.crate.kick()])()],
      ['nothing', 14, () => {}],
    ];
    const live = options.filter(([, w]) => w > 0);
    let r = Math.random() * live.reduce((n, [, w]) => n + w, 0);
    for (const [, w, run] of live) {
      r -= w;
      if (r <= 0) return run();
    }
  }

  // a few steps one way or the other, not far
  async steps() {
    const c = this.capri;
    const to = clamp(c.pos.x + pick([-1, 1]) * rand(80, 320), 80, c.view.w - 80);
    await c.walkTo(to, { speed: 110 });
  }

  // she wants to sit: a window if there's room, else her own seat (crate.js)
  async sitSomewhere() {
    const c = this.capri;
    const seat = c.pickSeat({ any: true });
    if (seat) return c.hopTo(seat);
    if (!this.crate) return;
    if (this.crate.up) return c.hopTo({ win: { id: 'capri-crate', ...this.crate.box }, dx: this.crate.box.w / 2 });
    return this.crate.build();
  }

  // from capri.wanderStep: one of her antics, or false to let her do her usual thing
  pickOne() {
    if (!this.free()) return false;
    const c = this.capri;
    const r = Math.random();
    if (c.stance === 'sit') {
      if (r < 0.4) { c.ledgeWalk(); return true; }
      if (r < 0.6) { this.bored(); return true; }
      return false;
    }
    if (r < 0.4) { this.walk(); return true; }
    if (r < 0.75) { this.bored(); return true; }
    if (r < 0.88) { this.tiny(); return true; }
    this.giant();
    return true;
  }

  async walk() {
    const c = this.capri;
    const { w } = c.view;
    const to = clamp(c.pos.x + pick([-1, 1]) * rand(w * 0.15, w * 0.4), 80, w - 80);
    if (Math.random() < 0.3) this.say(pick(this.t.walk), 'calm', 2000);
    await c.walkTo(to);
    if (Math.random() < 0.4) c.perform(pick(['look', 'stretch', 'crossArms']), c.towardCenter());
  }

  async bored() {
    const c = this.capri;
    // your desktop in front: she'd rather draw with your icons (tidy.js, put back a minute later)
    if (c.windows.desk && this.tidy && Math.random() < 0.5 && (await this.tidy.doodle())) return;
    const what = pick(['juggle', 'doodle', 'stretch', 'crossArms']);
    if (what === 'juggle' || what === 'doodle') this.say(pick(this.t[what]), 'smug');
    else if (Math.random() < 0.4) this.say(pick(this.t.bored), 'aside');
    await c.perform(what, c.towardCenter());
  }

  // tiny, hiding in a corner for a bit, then back to her size
  async tiny() {
    const c = this.capri;
    const scale = c.scale;
    this.say(pick(this.t.tiny), 'smug', 2000);
    await sleep(900);
    const corner = { x: pick([70, c.view.w - 70]), y: c.floor };
    await c.vanish({ beam: false });
    c.setScale(scale * 0.35);
    await c.materialize(corner);
    await sleep(rand(8000, 15000));
    if (c.scale !== scale * 0.35) return; // something resized her meanwhile
    // put away meanwhile: back to her size, and she doesn't come out for this
    if (c.stowed || c.stowing) {
      c.setScale(scale);
      return;
    }
    c.perform('hop');
    await sleep(400);
    await c.vanish({ beam: false });
    c.setScale(scale);
    await c.materialize({ x: clamp(c.pos.x, 120, c.view.w - 120), y: c.floor });
  }

  // huge for two seconds: BOO
  async giant() {
    const c = this.capri;
    const scale = c.scale;
    const big = Math.min(scale * 2.4, (c.view.h * 0.9) / 420);
    c.busy = true;
    try {
      c.fx.lines(c.pos.x, c.pos.y - 200 * big, { inner: 160, life: 500 });
      this.voice.play('alert');
      c.setScale(big);
      c.pos = { x: clamp(c.pos.x, 200, c.view.w - 200), y: c.floor };
      c.place();
      c.perform('startle');
      this.panel.say({ kind: 'alert', line: pick(this.t.giant), hold: 1600, face: 'laugh' });
      await sleep(1800);
      c.setScale(scale);
      c.place();
      c.fx.burst(c.pos.x, c.pos.y - 100 * scale, { count: 16, power: 0.6 });
    } finally {
      c.busy = false;
    }
    await sleep(300);
    c.perform('laugh');
    this.say(pick(this.t.giantAfter), 'laugh');
  }

  // A window opened or closed right next to her: she jumps, and gets out of its way.
  onWindows(wins) {
    const prev = this.prevWins;
    this.prevWins = wins;
    if (!prev || !this.free()) return;
    const c = this.capri;
    const now = Date.now();
    if (now - this.lastStartle < 8000) return;
    const s = c.scale;
    const box = { x0: c.pos.x - 110 * s, x1: c.pos.x + 110 * s, y0: c.head().top - 40, y1: c.pos.y + 20 };
    const near = (w) => w.x < box.x1 + 60 && w.x + w.w > box.x0 - 60 && w.y < box.y1 + 60 && w.y + w.h > box.y0 - 60;
    const ids = new Set(prev.map((w) => w.id));
    const opened = wins.find((w) => !ids.has(w.id) && near(w) && w.id !== c.perch?.id);
    const nowIds = new Set(wins.map((w) => w.id));
    const closed = prev.find((w) => !nowIds.has(w.id) && near(w) && w.id !== c.perch?.id);
    if (opened) {
      this.lastStartle = now;
      c.perform('startle');
      this.voice.play('rise', { soft: true });
      this.say(pick(this.t.startleOpen), 'wide');
      // standing behind where it opened: she steps out from under it
      const under = opened.x < c.pos.x && opened.x + opened.w > c.pos.x && opened.y < c.pos.y && opened.y + opened.h > c.head().y;
      if (under && c.stance === 'stand') {
        const left = opened.x - 90 * s, right = opened.x + opened.w + 90 * s;
        const to = left > 80 && (c.pos.x - left < right - c.pos.x || right > c.view.w - 80) ? left : right;
        setTimeout(() => c.walkTo(to, { speed: 320 }), 700);
      }
    } else if (closed) {
      this.lastStartle = now;
      c.perform(Math.random() < 0.5 ? 'startle' : 'look');
      this.say(pick(this.t.startleClose), 'aside');
    }
  }
}
