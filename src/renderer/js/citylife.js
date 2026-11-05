// While her Night City is up (decor.js, the bare desktop in front), she lives in it: stands on
// the roofs, jumps on the elevated train and rides it, goes after the hologram koi, leans by a
// neon sign, tags a wall (her graffiti stays for the day). When the city goes, so does all that.

import { pick, sleep, rand, clamp } from './util.js';

const TAGS = ['CAPRI', 'CAPRI WAS HERE', 'NO FUTURE', 'PREEM', '★ CHOOM ★', 'NC 2077', 'KWTKMS & CAPRI', 'NETRUNNER', '夜の街', 'STAY'];
const TAG_COLORS = ['#ff2a55', '#36ff7a', '#8a5cff', '#36d6ff', '#ffd166'];
const MAX_TAGS_A_DAY = 6;

const TEXT = {
  fr: {
    roof: ['La vue est meilleure d’ici.', 'Mon toit préféré.', 'Night City by night.'],
    train: ['Hop, je monte !', 'NCART gratuit, c’est pour moi.', 'Tchou tchou, choom.'],
    trainOff: ['Mon arrêt.', 'Terminus pour moi.'],
    koi: ['Viens là, le poisson…', 'Je vais l’attraper, ce koi.'],
    koiMiss: ['Raté. Il est rapide pour un hologramme.', 'Pff, il m’a filé entre les doigts.'],
    sign: ['J’aime bien ce néon.', 'Je squatte l’enseigne.'],
    tag: ['Petite signature.', 'Street art, version netrunner.', 'Le quartier est à moi.'],
  },
  en: {
    roof: ['Better view from up here.', 'My favourite roof.', 'Night City by night.'],
    train: ['Hop, I’m getting on!', 'Free NCART ride, my favourite.', 'Choo choo, choom.'],
    trainOff: ['My stop.', 'End of the line for me.'],
    koi: ['Come here, fishy…', 'I’m gonna catch that koi.'],
    koiMiss: ['Missed. Fast for a hologram.', 'Pff, slipped right through my fingers.'],
    sign: ['I like this neon.', 'Hanging out by the sign.'],
    tag: ['Little signature.', 'Street art, netrunner style.', 'This block is mine.'],
  },
};

export class CityLife {
  constructor({ capri, panel, decor, play, lang = 'fr' }) {
    Object.assign(this, { capri, panel, decor, play, lang });
    this.next = 0;
    this.doing = false;
    this.inCity = false; // she's up on something of the city (not a real window)
    // a train coming: more often than not she goes and rides it, once it's well on screen
    decor.onTrain = () => {
      if (Math.random() > 0.7) return;
      setTimeout(() => {
        if (this.up && !this.doing && this.free() && this.decor.train) this.run(() => this.ride());
      }, 1800);
    };
    decor.her = () => {
      if (capri.stowed || capri.hidden) return null;
      const h = capri.head();
      return { x: h.x, y: h.y, angry: play.feud.active };
    };
    setInterval(() => this.tick(), 2000);
  }

  get t() {
    return TEXT[this.lang] || TEXT.en;
  }

  say(line, face = 'grin') {
    if (!this.panel.visible) this.panel.say({ kind: 'info', line, hold: 2600, face });
  }

  get up() {
    return this.decor.target === 1 && this.decor.alpha > 0.95;
  }

  free() {
    const c = this.capri;
    return !c.busy && !c.stowed && !c.hidden && !c.hiding && !c.dormant && c.stance !== 'fall' && c.stance !== 'peek' && !this.play.feud.active && c.mode !== 'sleep';
  }

  tick() {
    const c = this.capri;
    // the city went away while she was standing on part of it: down she comes
    if (!this.up) {
      if (this.inCity && !c.busy && c.stance === 'stand' && c.pos.y < c.floor - 4) c.fall();
      this.inCity = false;
      this.next = Math.max(this.next, Date.now() + 4000);
      return;
    }
    if (this.doing || !this.free() || Date.now() < this.next) return;
    this.next = Date.now() + rand(14000, 30000);
    // the train coming is too good to miss
    if (this.decor.train && Math.random() < 0.8) return this.run(() => this.ride());
    const tags = this.decor.graffiti?.length ?? this.decor.loadGraffiti().length;
    const options = ['roof', 'roof', 'koi', 'sign'];
    if (tags < MAX_TAGS_A_DAY) options.push('tag', 'tag');
    this.run(() => this[pick(options)]());
  }

  async run(fn) {
    if (this.capri.asleep) return;
    this.doing = true;
    try {
      await fn();
    } catch (err) {
      console.error('[capri] citylife:', err);
    } finally {
      this.doing = false;
    }
  }

  async roof() {
    const c = this.capri;
    const roofs = (this.decor.roofs || []).filter((r) => r.x1 - r.x0 > 50);
    if (!roofs.length) return;
    const r = pick(roofs);
    await c.teleport({ x: rand(r.x0, r.x1), y: r.y });
    this.inCity = true;
    c.footprints(c.pos.x, c.pos.y);
    await sleep(600);
    c.perform(pick(['look', 'stretch', 'crossArms']), c.towardCenter());
    if (Math.random() < 0.5) this.say(pick(this.t.roof), 'calm');
  }

  // onto the train as it goes by, a ride across, and off
  async ride() {
    const c = this.capri;
    const d = this.decor;
    const t = d.train;
    if (!t) return;
    const carW = 156; // a car and the gap after it (decor.drawTrain)
    const len = t.cars * carW;
    // where the train will be once she's there: she lands on the part of it that's on screen
    const x0 = t.x + t.dir * t.speed * 0.7, x1 = x0 + len;
    const a = Math.max(x0 + 40, 100), b = Math.min(x1 - 40, c.view.w - 100);
    if (a >= b) return;
    const roof = d.trackY - 26; // the cars' roof
    this.say(pick(this.t.train), 'laugh');
    await c.teleport({ x: (a + b) / 2, y: roof });
    this.inCity = true;
    if (!d.train) return c.fall();
    c.busy = true;
    const until = performance.now() + rand(4000, 7000);
    let last = performance.now();
    await new Promise((done) => {
      const step = (now) => {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        const tr = d.train;
        if (!tr || now > until || c.pos.x < 60 || c.pos.x > c.view.w - 60 || !this.up) return done();
        c.pos = { x: c.pos.x + tr.dir * tr.speed * dt, y: roof };
        c.runLean = -tr.dir * 6; // the wind
        c.place();
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    c.runLean = 0;
    c.busy = false;
    if (Math.random() < 0.6) this.say(pick(this.t.trainOff), 'smug');
    c.perform('hop');
    await sleep(350);
    c.fall();
  }

  async koi() {
    const c = this.capri;
    const k = this.decor.koi;
    if (!k) return;
    this.say(pick(this.t.koi), 'smug');
    await c.teleport({ x: clamp(k.x + k.dir * k.size * 2, 100, c.view.w - 100), y: clamp(k.y + 260 * c.scale, 200, c.floor) });
    this.inCity = true;
    await c.perform('alarm', k.x > c.pos.x ? 1 : -1);
    // it darts away, glitching
    k.dir = c.pos.x > k.x ? -1 : 1;
    k.dash = performance.now();
    c.fx.slices(k.x - k.size, k.y - k.size * 0.3, k.size * 2, k.size * 0.6, { count: 6, life: 220 });
    await sleep(500);
    c.perform('crossArms', c.towardCenter());
    this.say(pick(this.t.koiMiss), 'aside');
  }

  async sign() {
    const c = this.capri;
    const signs = this.decor.signs || [];
    if (!signs.length) return;
    const s = pick(signs);
    const side = s.x > c.view.w / 2 ? -1 : 1;
    await c.teleport({ x: clamp(s.x + side * 120, 80, c.view.w - 80), y: clamp(s.y + 220 * c.scale, 260, c.floor) });
    this.inCity = true;
    c.faceToward(s.x);
    await c.perform('crossArms', s.x > c.pos.x ? 1 : -1);
    if (Math.random() < 0.5) this.say(pick(this.t.sign), 'calm');
  }

  // she tags one of the big walls up front
  async tag() {
    const c = this.capri;
    const spot = this.decor.graffitiSpot();
    if (!spot) return;
    const s = c.scale;
    const side = spot.x > c.view.w / 2 ? -1 : 1;
    await c.teleport({ x: clamp(spot.x + side * 150 * s, 80, c.view.w - 80), y: clamp(spot.y + 230 * s, 260, c.floor) });
    this.inCity = true;
    c.faceToward(spot.x);
    const dir = spot.x > c.pos.x ? 1 : -1;
    c.perform('doodle', dir);
    await sleep(500);
    this.decor.addGraffiti(pick(TAGS), pick(TAG_COLORS));
    c.fx.burst(spot.x, spot.y, { count: 14, power: 0.4, spread: 40 });
    await sleep(1600);
    c.perform('laugh');
    this.say(pick(this.t.tag), 'laugh');
  }
}
