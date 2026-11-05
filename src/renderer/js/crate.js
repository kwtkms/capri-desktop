// Her own seat: when your windows fill the screen (maximized ones can't be sat on), she makes
// herself a little hoverboard of light. Its pieces gather out of thin air and snap together.
// It counts as a window for her (capri.extraSeats), so she sits on it, hops on and off, puts her
// things on it. She rides it across the screen, pushes it along, and kicks it: it slides, hits
// the edge of the screen and shatters. It's a plain element on her layer, not a window of yours.

import { pick, sleep, rand, clamp } from './util.js';
import { Player } from './acting.js';

const TEXT = {
  fr: {
    build: ['Pas de place ? Je me fais une planche.', 'Tout est en plein écran. Pas grave, j’ai ma planche.', 'Je me pose sur ma board, tiens.'],
    ride: ['Wiii !', 'En route.', 'Glisse, glisse…', 'Mode hoverboard.'],
    push: ['Allez, on bouge.', 'Hop, un peu plus loin.'],
    kick: ['Tiens !', 'Goooal.', 'Et ça glisse !'],
    broke: ['Oups. Elle était fragile.', 'Bon. J’en referai une.', 'Cassée. Ça valait le coup.'],
    gone: ['Je range ma planche.', 'Pouf, plus de planche.'],
    moved: ['Wouh ! On déménage ?', 'Préviens quand tu conduis !', 'Ascenseur gratuit, merci.'],
    thanks: ['Là, c’est mieux ?', 'Ok, je la laisse là.'],
  },
  en: {
    build: ['No room? I’ll make a board.', 'Everything fullscreen. Fine, I’ve got my board.', 'I’ll sit on my board, then.'],
    ride: ['Wheee!', 'Off we go.', 'Glide, glide…', 'Hoverboard mode.'],
    push: ['Come on, moving.', 'A bit further.'],
    kick: ['Take that!', 'Goooal.', 'And it slides!'],
    broke: ['Oops. It was fragile.', 'Fine. I’ll make another.', 'Broken. Worth it.'],
    gone: ['Putting my board away.', 'Poof, no more board.'],
    moved: ['Whoa! Are we moving?', 'Warn me when you drive!', 'Free elevator, thanks.'],
    thanks: ['Better there?', 'Ok, I’ll leave it there.'],
  },
};

const ID = 'capri-crate';

export class Crate {
  constructor({ capri, panel, voice, lang = 'fr' }) {
    Object.assign(this, { capri, panel, voice, lang });
    this.box = null; // { x, y, w, h } overlay coordinates, its top edge is the seat
    this.el = document.createElement('div');
    this.el.className = 'crate';
    this.el.hidden = true;
    this.el.innerHTML = '<span class="crate__glow"></span>';
    document.getElementById('capri').before(this.el);
    capri.extraSeats = () => (this.box ? [{ id: ID, ...this.box, max: false, fake: true }] : []);
    this.sliding = false;
    this.dragging = false;
    this.bindDrag();
  }

  // Grab it with the mouse and put it somewhere else (somewhere less in the way). If she's on it,
  // she rides along; shaken hard, she falls off.
  bindDrag() {
    let grab = null;
    // on the window, not the element: it's thin, so it's caught with a margin around it (but a
    // click on Capri herself stays hers)
    window.addEventListener('mousedown', (e) => {
      if (!this.box || this.sliding || e.button !== 0 || !this.contains(e.clientX, e.clientY)) return;
      if (this.capri.hit(e.clientX, e.clientY)) return;
      e.preventDefault();
      this.capri.touch(); // moving her board: direct
      grab = { dx: e.clientX - this.box.x, dy: e.clientY - this.box.y };
      this.dragging = true;
      this.el.classList.add('crate--held');
    });
    window.addEventListener('mousemove', (e) => {
      if (!grab || !this.box) return;
      const c = this.capri;
      this.box.x = clamp(e.clientX - grab.dx, 4, c.view.w - this.box.w - 4);
      // not too low (she only sits on edges a bit above the bottom) nor too high
      this.box.y = clamp(e.clientY - grab.dy, 260 * c.scale, c.view.h - 30);
      this.moved();
    });
    window.addEventListener('mouseup', () => {
      if (!grab) return;
      grab = null;
      this.dragging = false;
      this.el.classList.remove('crate--held');
      this.builtAt = Date.now(); // you moved it: she keeps it a while longer
      if (this.onIt && Math.random() < 0.6) this.say(pick(this.t.moved), 'laugh');
      else if (!this.onIt && Math.random() < 0.4) this.say(pick(this.t.thanks), 'grin');
    });
  }

  // is the mouse on it (a little margin: it's thin)
  contains(x, y) {
    const b = this.box;
    return Boolean(b) && x >= b.x - 6 && x <= b.x + b.w + 6 && y >= b.y - 10 && y <= b.y + b.h + 10;
  }

  get t() {
    return TEXT[this.lang] || TEXT.en;
  }

  get up() {
    return Boolean(this.box);
  }

  // you told her to put it away: she doesn't make a new one right after
  get resting() {
    return Date.now() < (this.restUntil || 0);
  }

  get onIt() {
    return this.capri.stance === 'sit' && this.capri.perch?.id === ID;
  }

  say(line, face = 'grin') {
    if (!this.panel.visible && Math.random() < 0.6) this.panel.say({ kind: 'info', line, hold: 2400, face });
  }

  // can she sit anywhere real right now?
  roomOnWindows() {
    const c = this.capri;
    return (c.rawWindows?.wins || []).some((w) => c.canSit(w) && !c.covered(w, w.x + w.w / 2));
  }

  place() {
    const b = this.box;
    if (!b) return;
    this.el.style.transform = `translate3d(${Math.round(b.x)}px, ${Math.round(b.y)}px, 0)`;
    this.el.style.width = `${Math.round(b.w)}px`;
    this.el.style.height = `${Math.round(b.h)}px`;
  }

  // Her screen changed (she moved to your other screen, a resolution change): the board comes
  // along, inside the new screen, same distance from the bottom. Whoever sits on it rides along.
  fit() {
    const b = this.box;
    if (!b) return;
    const c = this.capri;
    const fromBottom = this.lastH ? this.lastH - b.y : 100;
    this.lastH = c.view.h;
    b.x = clamp(b.x, 6, c.view.w - b.w - 6);
    b.y = clamp(c.view.h - fromBottom, 260 * c.scale, c.view.h - 30);
    this.moved();
  }

  // it moved: tell her (whoever sits on it rides along)
  moved() {
    this.place();
    if (this.capri.rawWindows) this.capri.setWindows(this.capri.rawWindows);
  }

  // in the middle of something (a few steps, a hop): she finishes first, a few seconds at most
  async waitFree() {
    for (let k = 0; this.capri.busy && k < 40; k++) await sleep(100);
  }

  async getOff() {
    if (!this.onIt) return;
    this.capri.perform('hop');
    await sleep(200);
    this.capri.fall();
    await sleep(900);
  }

  // Her pieces of light come together out of nowhere and snap into a board; she hops on.
  async build() {
    const c = this.capri;
    await this.waitFree();
    if (this.box || c.busy || this.resting) return false;
    const s = c.scale;
    const w = 110 * s + 50, h = 12;
    const side = c.pos.x > c.view.w / 2 ? -1 : 1;
    const x = clamp(c.pos.x + side * (80 * s + 30) - w / 2, 10, c.view.w - w - 10);
    // it hovers: low, or higher up now and then
    const low = c.view.h - rand(70, 110) - h;
    const y = Math.random() < 0.6 ? low : clamp(low - rand(120, 320), 300 * s, low);
    const cx = x + w / 2, cy = y + h / 2;
    this.say(pick(this.t.build), 'smug');
    await c.perform('doodle', side); // drawing it in the air
    c.fx.burst(cx, cy, { count: 22, power: 0.7, spread: w * 0.8, inward: true });
    c.fx.vortex(cx, cy, { radius: w * 0.55, life: 420, count: 12 });
    this.voice.play('teleport-in', { soft: true });
    await sleep(380);
    this.box = { x, y, w, h };
    this.lastH = c.view.h;
    this.el.hidden = false;
    this.el.classList.remove('crate--gone');
    this.el.classList.add('crate--in');
    setTimeout(() => this.el.classList.remove('crate--in'), 450);
    this.moved();
    c.fx.ring(cx, cy, { size: 0.6 });
    await sleep(450);
    await c.hopTo({ win: { id: ID, ...this.box }, dx: w / 2 });
    this.builtAt = Date.now();
    return true;
  }

  // She rides it: sitting on it, it glides off across the screen with her, and slows down.
  async ride() {
    const c = this.capri;
    await this.waitFree();
    if (!this.box || c.busy || this.sliding || c.asleep) return false;
    if (!this.onIt) {
      await c.hopTo({ win: { id: ID, ...this.box }, dx: this.box.w / 2 });
      await sleep(400);
      if (!this.onIt) return false;
    }
    const b = this.box;
    const dir = b.x + b.w / 2 < c.view.w / 2 ? 1 : -1;
    const target = clamp(b.x + dir * rand(c.view.w * 0.25, c.view.w * 0.55), 10, c.view.w - b.w - 10);
    const lift = Math.random() < 0.5 ? clamp(b.y - rand(40, 160), 300 * c.scale, c.view.h - 70) : b.y;
    this.say(pick(this.t.ride), 'laugh');
    this.voice.play('rise', { soft: true });
    this.sliding = true;
    const x0 = b.x, y0 = b.y, t0 = performance.now();
    const dur = 900 + Math.abs(target - x0) * 1.2;
    let trail = 0;
    await new Promise((done) => {
      const step = (now) => {
        const k = Math.min(1, (now - t0) / dur);
        const u = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; // eases in and out
        const px = b.x;
        b.x = x0 + (target - x0) * u;
        b.y = y0 + (lift - y0) * Math.sin(u * Math.PI);
        trail += Math.abs(b.x - px);
        if (trail > 18) {
          trail = 0;
          c.fx.glyph(b.x + (dir > 0 ? 0 : b.w), b.y + b.h);
        }
        this.moved();
        if (k < 1 && this.box) requestAnimationFrame(step);
        else done();
      };
      requestAnimationFrame(step);
    });
    this.sliding = false;
    return true;
  }

  // she stands by it and pushes it along, walking
  async push() {
    const c = this.capri;
    await this.waitFree();
    if (!this.box || c.busy || this.sliding || c.asleep) return false;
    await this.getOff();
    const b = this.box;
    if (!b) return false;
    const s = c.scale;
    const dir = b.x + b.w / 2 < c.view.w / 2 ? 1 : -1;
    const behind = dir > 0 ? b.x - 40 * s : b.x + b.w + 40 * s;
    await c.teleport({ x: clamp(behind, 60, c.view.w - 60), y: b.y + b.h + 60 * s });
    this.say(pick(this.t.push), 'grin');
    const target = clamp(b.x + rand(150, 400) * dir, 10, c.view.w - b.w - 10);
    const startBox = b.x, startHer = c.pos.x;
    c.busy = true;
    c.facing = dir > 0 ? -1 : 1;
    const t0 = performance.now(), dur = Math.abs(target - b.x) / (120 * s + 60) * 1000;
    await new Promise((done) => {
      const step = (now) => {
        const k = Math.min(1, (now - t0) / Math.max(300, dur));
        b.x = startBox + (target - startBox) * k;
        c.pos = { x: startHer + (target - startBox) * k, y: c.pos.y };
        c.runLean = -dir * 7; // putting her weight into it
        if (!c.act) c.act = { player: new Player('step'), done: () => {} };
        c.place();
        this.moved();
        if (k < 1) requestAnimationFrame(step);
        else done();
      };
      requestAnimationFrame(step);
    });
    c.runLean = 0;
    c.endAct(false);
    c.busy = false;
    return true;
  }

  // A kick: it shoots off, hits the edge of the screen, and shatters.
  async kick() {
    const c = this.capri;
    await this.waitFree();
    if (!this.box || c.busy || this.sliding || c.asleep) return false;
    await this.getOff();
    const b = this.box;
    if (!b) return false;
    const s = c.scale;
    const dir = b.x + b.w / 2 < c.view.w / 2 ? 1 : -1;
    await c.teleport({ x: clamp(dir > 0 ? b.x - 30 * s : b.x + b.w + 30 * s, 60, c.view.w - 60), y: b.y + b.h + 60 * s });
    c.facing = dir > 0 ? -1 : 1;
    await c.perform('alarm', dir);
    this.say(pick(this.t.kick), 'laugh');
    this.voice.play('land');
    c.fx.burst(dir > 0 ? b.x : b.x + b.w, b.y + b.h / 2, { count: 10, power: 0.5, spread: 20 });
    this.sliding = true;
    let v = dir * rand(1100, 1600);
    let last = performance.now();
    let hit = false;
    await new Promise((done) => {
      const step = (now) => {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        b.x += v * dt;
        b.y += Math.sin(now / 40) * 0.6; // wobbling
        if (b.x < 6 || b.x + b.w > c.view.w - 6) {
          b.x = clamp(b.x, 6, c.view.w - b.w - 6);
          hit = true;
          this.moved();
          return done();
        }
        v *= Math.pow(0.35, dt);
        this.moved();
        if (Math.abs(v) > 60) requestAnimationFrame(step);
        else done();
      };
      requestAnimationFrame(step);
    });
    this.sliding = false;
    // into the wall (or it just gives up): it shatters
    await this.shatter(hit ? (v > 0 ? b.x + b.w : b.x) : b.x + b.w / 2);
    await sleep(300);
    c.perform('laugh');
    this.say(pick(this.t.broke), 'laugh');
    return true;
  }

  // it breaks into shards of light that fly off and fade
  async shatter(at) {
    const c = this.capri;
    const b = this.box;
    if (!b) return;
    const y = b.y + b.h / 2;
    c.fx.crackle({ x: at, y }, { life: 300, radius: 30, count: 3 });
    c.fx.burst(b.x + b.w / 2, y, { count: 30, power: 0.9, spread: b.w * 0.6 });
    c.fx.slices(b.x, b.y - 6, b.w, b.h + 12, { count: 8, life: 220 });
    c.fx.ring(at, y, { size: 0.7 });
    this.voice.play('bolt', { soft: true });
    this.el.classList.add('crate--gone');
    await sleep(220);
    this.box = null;
    this.el.hidden = true;
    this.moved();
  }

  // She's put away (Ctrl+Alt+C, a game): the board goes with her, quietly. She makes a new one
  // when she needs it again.
  putAway() {
    const b = this.box;
    if (!b) return;
    this.capri.fx.burst(b.x + b.w / 2, b.y + b.h / 2, { count: 10, power: 0.4, spread: b.w / 2, inward: true });
    this.box = null;
    this.dragging = false;
    this.el.classList.remove('crate--held');
    this.el.hidden = true;
    this.moved();
  }

  async dismiss() {
    const c = this.capri;
    if (!this.box) return;
    await this.getOff();
    const b = this.box;
    if (!b) return;
    this.say(pick(this.t.gone), 'calm');
    c.fx.burst(b.x + b.w / 2, b.y + b.h / 2, { count: 16, power: 0.5, spread: b.w / 2, inward: true });
    this.el.classList.add('crate--gone');
    await sleep(300);
    this.box = null;
    this.el.hidden = true;
    this.moved();
  }
}
