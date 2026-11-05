// Bored, she goes after your pointer: she eyes it, then runs along the bottom of the screen
// after it, leaving neon footprints, and jumps at it when it's in reach. She never zaps it here,
// it's a game: catch it and she's proud, lose it and she gives up with a shrug.

import { pick, sleep } from './util.js';

const TEXT = {
  fr: {
    start: ['Hé… ta souris, là. Elle bouge bizarre.', 'Je vais l’attraper, celle-là.', 'Cible verrouillée : ta souris.'],
    caught: ['Attrapée ! …ah non, elle t’appartient.', 'Je l’ai eue ! Un point pour moi.', 'Trop facile.'],
    lost: ['Elle est trop rapide…', 'Bon, j’abandonne. Pour cette fois.', 'Pff. Elle triche.'],
  },
  en: {
    start: ['Hey… your mouse. It’s moving funny.', 'I’m gonna catch that one.', 'Target locked: your mouse.'],
    caught: ['Got it! …oh wait, it’s yours.', 'Caught it! Point for me.', 'Too easy.'],
    lost: ['It’s too fast…', 'Fine, I give up. This time.', 'Pff. It cheats.'],
  },
};

const SPEED = 520;      // px/s
const GIVE_UP_MS = 9000;
const REACH = 120;

export class Chase {
  constructor({ capri, panel, host, lang = 'fr' }) {
    Object.assign(this, { capri, panel, host, lang });
    this.running = false;
  }

  get t() {
    return TEXT[this.lang] || TEXT.en;
  }

  say(line, face = 'grin') {
    this.panel.say({ kind: 'info', line, hold: 2600, face });
  }

  async start() {
    const c = this.capri;
    if (this.running || c.busy || c.stowed || c.hidden || c.dormant || c.asleep || c.focus) return;
    // where your pointer really is, asked to Windows a few times a second
    const where = async () => {
      const p = await this.host.cursor().catch(() => null);
      c.mouse = p && p.inside ? { x: p.x, y: p.y } : null;
    };
    await where();
    if (!c.mouse) return;
    this.running = true;
    const poll = setInterval(where, 60);
    try {
      // down to the floor first if she's up on a window
      if (c.stance !== 'stand' || c.pos.y < c.floor - 4) await c.teleport({ x: c.pos.x, y: c.floor });
      c.faceToward(c.mouse.x);
      await c.perform('curious', c.mouse.x > c.pos.x ? 1 : -1);
      this.say(pick(this.t.start), 'smug');
      await sleep(700);
      this.panel.hide();
      c.busy = true;
      const t0 = performance.now();
      let last = t0;
      let trail = 0;
      let caught = false;
      await new Promise((done) => {
        const step = (now) => {
          const dt = Math.min(0.05, (now - last) / 1000);
          last = now;
          const m = c.mouse;
          // (busy false: she was rescued or carried off meanwhile, this run is over)
          if (!m || !c.busy || now - t0 > GIVE_UP_MS || c.stowed || c.hidden) return done();
          const dx = Math.min(Math.max(m.x, 40), c.view.w - 40) - c.pos.x;
          const dir = Math.sign(dx) || 1;
          const h = c.head();
          if (Math.abs(dx) < REACH * 0.5 && Math.abs(m.y - h.y) < REACH * 2.2) {
            caught = true;
            return done();
          }
          const move = Math.min(Math.abs(dx), SPEED * dt) * dir;
          c.pos = { x: c.pos.x + move, y: c.floor };
          c.facing = dir > 0 ? -1 : 1; // the reaching side toward it
          c.runLean = -dir * 9;
          trail += Math.abs(move);
          if (trail > 46 * c.scale) {
            trail = 0;
            c.fx.print(c.pos.x, c.pos.y - 1, { dir: -c.facing, size: c.scale * 1.3 });
          }
          c.place();
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
      c.runLean = 0;
      c.busy = false;
      const m = c.mouse;
      if (caught && m) {
        // the jump at it
        await c.perform('alarm', m.x > c.pos.x ? 1 : -1);
        c.fx.ring(m.x, m.y, { size: 0.6 });
        c.fx.burst(m.x, m.y, { count: 12, power: 0.5, spread: 20 });
        c.voice.play('done');
        c.perform('laugh');
        this.say(pick(this.t.caught), 'laugh');
      } else {
        await c.perform('crossArms', c.towardCenter());
        this.say(pick(this.t.lost), 'aside');
      }
    } finally {
      clearInterval(poll);
      c.busy = false;
      c.runLean = 0;
      this.running = false;
    }
  }
}
