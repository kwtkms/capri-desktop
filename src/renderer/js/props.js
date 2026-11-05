// Her things: a coffee, a neon plant, a little robot cat. She puts one down on the top edge of a
// window now and then; it rides along with the window, hides when another window covers it, and
// if you shake the window, close it or minimize it, it falls (and lands on whatever is below,
// or on the floor, where she comes to pick it up later). Drawn on her effects layer.

import { pick } from './util.js';

const KINDS = ['coffee', 'plant', 'cat'];
const MAX = 3;
const GRAVITY = 2200;

const TEXT = {
  fr: {
    put: {
      coffee: ['Je pose mon café là. Touche pas.', 'Pause café. Sur ta fenêtre.'],
      plant: ['Un peu de verdure. Enfin, de néon.', 'Ma plante. Elle pousse en Wi-Fi.'],
      cat: ['Je te présente Bit. Il garde la fenêtre.', 'Mon chat. Il mord pas. Presque.'],
    },
    fell: ['Mon café !', 'Hé ! Mes affaires !', 'Tu fais tomber mes trucs, là.'],
    pick: ['Je range mes affaires.', 'Je récupère mon bazar.'],
    away: { coffee: 'Café rangé.', plant: 'Plante rangée.', cat: 'Bit est rentré.', seat: 'Planche rangée, je t’en refais pas de suite.', all: 'C’est rangé, plus rien ne traîne.' },
    none: { coffee: 'J’ai pas de café de sorti, choom.', plant: 'Ma plante n’est pas sortie, choom.', cat: 'Bit n’est pas sorti, choom.', seat: 'J’ai pas de planche de sortie, choom.', all: 'J’ai rien qui traîne, choom.' },
    names: { coffee: 'un café', plant: 'une plante néon', cat: 'Bit, ton chat robot' },
    onScreen: 'Tes affaires posées à l’écran : {list}',
    nothing: 'Tu n’as rien de posé à l’écran',
  },
  en: {
    put: {
      coffee: ['Putting my coffee here. Don’t touch.', 'Coffee break. On your window.'],
      plant: ['A bit of green. Well, neon.', 'My plant. It grows on Wi-Fi.'],
      cat: ['Meet Bit. He guards the window.', 'My cat. Doesn’t bite. Mostly.'],
    },
    fell: ['My coffee!', 'Hey! My stuff!', 'You’re knocking my things over.'],
    pick: ['Tidying my stuff.', 'Picking up my mess.'],
    away: { coffee: 'Coffee’s away.', plant: 'Plant’s away.', cat: 'Bit’s back inside.', seat: 'Board’s away, no new one for a while.', all: 'All tidied up.' },
    none: { coffee: 'No coffee out, choom.', plant: 'My plant isn’t out, choom.', cat: 'Bit isn’t out, choom.', seat: 'No board out, choom.', all: 'Nothing of mine lying around, choom.' },
    names: { coffee: 'a coffee', plant: 'a neon plant', cat: 'Bit, your robot cat' },
    onScreen: 'Your things on screen: {list}',
    nothing: 'You have nothing out on screen',
  },
};

export class Props {
  constructor({ capri, panel, fx, lang = 'fr' }) {
    Object.assign(this, { capri, panel, fx, lang });
    this.items = []; // { kind, win, dx, x, y, vy, falling, floorSince }
    this.layer = null;
  }

  // drawn only while there is something to draw (an empty effects layer stops redrawing)
  ensureLayer() {
    if (this.layer || !this.items.length) return;
    this.layer = this.fx.add({ type: 'props', life: Infinity, draw: (ctx, now, dt) => this.draw(ctx, now, dt) });
  }

  get t() {
    return TEXT[this.lang] || TEXT.en;
  }

  say(line, face = 'smug') {
    if (!this.panel.visible) this.panel.say({ kind: 'info', line, hold: 2800, face });
  }

  // she puts something down on the window she's sitting on
  place() {
    const c = this.capri;
    const win = c.stance === 'sit' && c.windows.wins.find((w) => w.id === c.perch?.id);
    if (!win || win.max || c.asleep || Date.now() < (this.restUntil || 0)) return false;
    if (this.items.length >= MAX) this.items.shift();
    const kind = pick(KINDS.filter((k) => !this.items.some((i) => i.kind === k)).concat(KINDS).slice(0, 3));
    // a little way along from her, on her side toward the middle of the window
    const side = c.pos.x - win.x < win.w / 2 ? 1 : -1;
    // and not on top of another of her things already there
    const here = this.items.filter((i) => i.win === win.id).length;
    const dx = Math.max(30, Math.min(win.w - 30, c.pos.x - win.x + side * (90 * c.scale + here * 48)));
    this.items.push({ kind, win: win.id, dx, x: win.x + dx, y: win.y, vy: 0, falling: false, lastX: win.x, floorSince: 0, placed: performance.now() });
    this.ensureLayer();
    c.perform('look');
    c.fx.burst(win.x + dx, win.y - 10, { count: 8, power: 0.3, spread: 20 });
    this.say(pick(this.t.put[kind]));
    return true;
  }

  // "range ton café", "range tes affaires": gone, right now. Returns what she has to say about it.
  // And no taking them out again right after you asked.
  putAway(kind = null) {
    const rest = Date.now() + 30 * 60000;
    const seat = (!kind || kind === 'seat') && this.crate?.up;
    if (!kind || kind === 'seat') this.crate && (this.crate.restUntil = rest);
    if (kind !== 'seat') this.restUntil = rest;
    const going = kind === 'seat' ? [] : this.items.filter((i) => !kind || i.kind === kind);
    if (seat) this.crate.dismiss();
    if (!going.length && !seat) return this.t.none[kind || 'all'];
    this.items = this.items.filter((i) => !going.includes(i));
    for (const it of going) this.fx.vortex(it.x, it.y - 10, { radius: 40, life: 300, count: 8 });
    return this.t.away[kind || 'all'];
  }

  // she's changing screens: the windows they were on stay behind, she takes them along, no fall
  clear() {
    this.items = [];
  }

  // what's out right now, for the questions you ask her (ask.js)
  context() {
    if (!this.items.length) return this.t.nothing;
    return this.t.onScreen.replace('{list}', this.items.map((i) => this.t.names[i.kind]).join(', '));
  }

  covered(winId, x, y) {
    for (const o of this.capri.windows.wins) {
      if (o.id === winId) return false;
      if (o.x < x && o.x + o.w > x && o.y < y && o.y + o.h > y) return true;
    }
    return false;
  }

  setWindows(wins) {
    let fell = false;
    for (const it of this.items) {
      if (it.falling || !it.win) continue;
      const win = wins.find((w) => w.id === it.win);
      if (!win || win.max) {
        it.falling = true;
        it.win = null;
        fell = true;
        continue;
      }
      // moved hard sideways (a shake): it slides off
      const jump = Math.abs(win.x - it.lastX);
      it.lastX = win.x;
      if (jump > 70) {
        it.falling = true;
        it.win = null;
        it.vx = (win.x > it.x - it.dx ? 1 : -1) * 260;
        fell = true;
        continue;
      }
      it.x = win.x + it.dx;
      it.y = win.y;
    }
    if (fell && Math.random() < 0.6) {
      this.capri.perform('alarm', 0);
      this.say(pick(this.t.fell), 'wide');
    }
  }

  // what's under a falling thing: a window's top edge, or the floor
  landing(it) {
    let best = null;
    for (const w of this.capri.windows.wins) {
      if (w.max || it.x < w.x + 10 || it.x > w.x + w.w - 10 || w.y < it.y - 2) continue;
      if (this.covered(w.id, it.x, w.y + 2)) continue;
      if (!best || w.y < best.y) best = w;
    }
    return best;
  }

  draw(ctx, now, dt) {
    const floor = this.capri.floor;
    for (const it of this.items) {
      if (it.falling) {
        it.vy += GRAVITY * dt;
        it.x += (it.vx || 0) * dt;
        const ny = it.y + it.vy * dt;
        const under = this.landing(it);
        const stopAt = under ? under.y : floor;
        if (ny >= stopAt) {
          it.y = stopAt;
          it.vy = 0;
          it.vx = 0;
          it.falling = false;
          if (under) {
            it.win = under.id;
            it.dx = it.x - under.x;
            it.lastX = under.x;
          } else {
            it.floorSince = now;
          }
          this.fx.burst(it.x, it.y - 6, { count: 6, power: 0.3, spread: 14 });
        } else {
          it.y = ny;
        }
      }
      if (it.win && this.covered(it.win, it.x, it.y - 4)) continue;
      this.drawOne(ctx, it, now);
    }
    // left on the floor a while, or there for 20 min: she tidies it away
    const stale = this.items.find((i) => (i.floorSince && now - i.floorSince > 60000) || now - i.placed > 20 * 60000);
    if (stale && !this.capri.busy) {
      this.items = this.items.filter((i) => i !== stale);
      this.fx.vortex(stale.x, stale.y - 10, { radius: 40, life: 300, count: 8 });
      if (Math.random() < 0.5) this.say(pick(this.t.pick), 'calm');
    }
    if (!this.items.length) {
      this.layer.life = 0;
      this.layer = null;
    }
  }

  drawOne(ctx, it, now) {
    const s = Math.max(0.7, this.capri.scale * 1.4);
    ctx.save();
    ctx.translate(it.x, it.y);
    ctx.scale(s, s);
    ctx.lineJoin = 'round';
    if (it.kind === 'coffee') {
      // a cup, with steam
      ctx.fillStyle = '#14101c';
      ctx.strokeStyle = '#ff2a55';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-8, -16); ctx.lineTo(8, -16); ctx.lineTo(6, 0); ctx.lineTo(-6, 0); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(10, -9, 4, -Math.PI / 2, Math.PI / 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 2; i++) {
        const o = Math.sin(now / 300 + i * 2) * 2;
        ctx.beginPath(); ctx.moveTo(-3 + i * 5, -19); ctx.quadraticCurveTo(-6 + i * 5 + o, -25, -2 + i * 5, -31); ctx.stroke();
      }
    } else if (it.kind === 'plant') {
      // a pot, neon leaves swaying
      ctx.fillStyle = '#8a5cff';
      ctx.fillRect(-7, -10, 14, 10);
      ctx.shadowColor = '#36ff7a';
      ctx.shadowBlur = 10;
      ctx.strokeStyle = '#36ff7a';
      ctx.lineWidth = 2;
      const sway = Math.sin(now / 700) * 0.15;
      for (const a of [-0.6, 0, 0.6]) {
        ctx.save();
        ctx.translate(0, -10);
        ctx.rotate(a + sway);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(5, -10, 0, -20); ctx.quadraticCurveTo(-5, -10, 0, 0); ctx.stroke();
        ctx.restore();
      }
    } else {
      // Bit, the robot cat: square head, ears, glowing eyes that blink
      ctx.fillStyle = '#14101c';
      ctx.strokeStyle = '#8a5cff';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-10, 0); ctx.lineTo(-10, -14); ctx.lineTo(-7, -21); ctx.lineTo(-3, -15); ctx.lineTo(3, -15); ctx.lineTo(7, -21); ctx.lineTo(10, -14); ctx.lineTo(10, 0); ctx.closePath();
      ctx.fill(); ctx.stroke();
      // the tail, flicking
      ctx.beginPath(); ctx.moveTo(10, -3); ctx.quadraticCurveTo(18, -6 + Math.sin(now / 400) * 4, 16, -14); ctx.stroke();
      const blink = (now % 4000) < 140;
      ctx.fillStyle = '#36ff7a';
      ctx.shadowColor = '#36ff7a';
      ctx.shadowBlur = 8;
      ctx.fillRect(-6, -10, 3, blink ? 1 : 3);
      ctx.fillRect(3, -10, 3, blink ? 1 : 3);
    }
    ctx.restore();
  }
}
