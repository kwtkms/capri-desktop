// When you annoy her: she takes offense and the fight goes on. Every burst of clicks pushes her
// one step further (5 of them), and for a minute after the last one she stays wound up: she keeps
// an eye on your pointer, grumbles, snaps at it when it gets close and answers every poke.
// Two strokes on her mane make peace.

import { pick, sleep } from './util.js';

const TEXT = {
  fr: {
    steps: [
      ['Arrête de me cliquer dessus !', 'Hé ! Je suis pas un bouton.', 'Tu cherches les ennuis, choom ?'],
      ['Tu l’auras voulu !', 'Deuxième avertissement !', 'Bzzzt. Ça, c’est pour toi.'],
      ['Tu crois que tu peux m’échapper ?', 'Je te vois, choom.', 'Cours, petite souris.'],
      ['Je suis partout.', 'Tous mes moi sont contre toi.', 'Bienvenue dans mon réseau.'],
      ['OK. Là je suis VRAIMENT fâchée.', 'Protocole de riposte totale.', 'Flatline imminent, choom.'],
    ],
    poke: ['Encore ?!', 'Tu le fais exprès.', 'Arrête ça !', 'Je t’entends cliquer.', 'Même pas mal.', 'Grr.'],
    mutter: ['Je t’ai à l’œil.', 'Vas-y, clique encore. Pour voir.', 'Je note tout, choom.', 'Hmpf.', 'J’oublie pas, moi.'],
    tooClose: ['Pas si près !', 'Recule.', 'Bas les pattes.'],
    refuse: ['Nan nan, t’excuser comme ça c’est trop facile.', 'Tu crois que ça va suffire ? Encore une fois.'],
    peace: ['Ok ok, on est quittes.', 'Bon, trêve. Mais tu me dois une revanche.'],
    cooled: ['Bon… on fait la paix ? Mais je t’ai à l’œil.', 'Je me calme. Mais j’oublie rien.'],
  },
  en: {
    steps: [
      ['Stop clicking me!', 'Hey! I’m not a button.', 'Looking for trouble, choom?'],
      ['You asked for it!', 'Second warning!', 'Bzzzt. That one’s for you.'],
      ['Think you can run from me?', 'I see you, choom.', 'Run, little mouse.'],
      ['I’m everywhere.', 'All of me are against you.', 'Welcome to my network.'],
      ['OK. NOW I’m really mad.', 'Full retaliation protocol.', 'Flatline incoming, choom.'],
    ],
    poke: ['Again?!', 'You’re doing it on purpose.', 'Stop it!', 'I can hear you clicking.', 'Didn’t even hurt.', 'Grr.'],
    mutter: ['I’ve got my eye on you.', 'Go on, click again. I dare you.', 'I’m keeping score, choom.', 'Hmpf.', 'I don’t forget.'],
    tooClose: ['Not so close!', 'Back off.', 'Hands off.'],
    refuse: ['Nope, sorry isn’t that easy.', 'Think that’s enough? Once more.'],
    peace: ['Ok ok, we’re even.', 'Fine, truce. But you owe me a rematch.'],
    cooled: ['Fine… truce? But I’m watching you.', 'Calming down. Not forgetting.'],
  },
};

const GRUDGE_MS = 60 * 1000;
const RED = [1, 0.13, 0.32];
const INK = [0.08, 0.06, 0.11];

const rand = (a, b) => a + Math.random() * (b - a);

export class Feud {
  constructor({ capri, panel, voice, host, lang = 'fr' }) {
    Object.assign(this, { capri, panel, voice, host, lang });
    this.level = 0;
    this.until = 0;
    this.nextPoke = 0;
    this.nextMutter = 0;
    this.nextSnap = 0;
    this.strokes = 0;
    this.busy = false;
    setInterval(() => this.watch(), 1500);
  }

  get t() {
    return TEXT[this.lang] || TEXT.en;
  }

  get active() {
    return Date.now() < this.until;
  }

  say(line, kind = 'error', face = 'smug', hold = 3200) {
    this.panel.say({ kind, line, hold, face });
  }

  cutin(kind, dir) {
    const [x, y, d] = this.capri.cutinAt(dir);
    this.capri.fx.cutin(x, y, d, { kind });
  }

  // Lightning onto your pointer; kick: your real mouse gets jolted away (power 1 or 2)
  zapCursor({ kick = 1, bolts = 1 } = {}) {
    const c = this.capri;
    const p = c.mouse || c.head();
    const away = Math.sign(p.x - c.pos.x) || c.facing || 1;
    const h = c.head();
    for (let i = 0; i < bolts; i++) {
      setTimeout(() => {
        const q = c.mouse || p;
        c.fx.bolt({ x: h.x, y: h.y - 50 * c.scale }, { x: q.x + rand(-25, 25), y: q.y + rand(-25, 25) }, { life: 400, forks: 3, width: 3 });
        this.voice.play('bolt', { soft: i > 0 });
      }, i * 150);
    }
    c.fx.crackle(p, { life: 650, radius: 46, count: 3 });
    c.fx.ring(p.x, p.y, { size: 0.5 });
    if (kick) this.host.kickCursor(away, kick);
    setTimeout(() => { if (c.mouse) c.fx.crackle(c.mouse, { life: 450, radius: 32, count: 2 }); }, 260);
  }

  // 4 quick clicks on her
  async burst() {
    this.level = Math.min(5, this.level + 1);
    this.until = Date.now() + GRUDGE_MS;
    this.strokes = 0;
    await this.escalate(this.level);
  }

  // one click while she's wound up: she answers every time
  poke() {
    const now = Date.now();
    this.until = now + GRUDGE_MS;
    if (now < this.nextPoke || this.busy) return;
    this.nextPoke = now + 1800;
    const c = this.capri;
    c.perform('alarm', Math.sign((c.mouse?.x ?? c.pos.x) - c.pos.x) || 1);
    this.zapCursor({ kick: 1 });
    this.say(pick(this.t.poke), 'error', pick(['smug', 'wide']), 2200);
  }

  async escalate(level) {
    // still playing the last step: this one comes right after, never lost
    if (this.busy) {
      this.queued = Math.max(this.queued || 0, level);
      return;
    }
    this.busy = true;
    const c = this.capri;
    const m = c.mouse || c.head();
    const dir = Math.sign(m.x - c.pos.x) || 1;
    try {
      c.wake();
      this.panel.hide();
      this.voice.play('alert');
      if (level >= 3) {
        // she comes after you: right next to your pointer
        const s = c.scale;
        const x = Math.max(80, Math.min(c.view.w - 80, m.x - dir * 160 * s));
        const y = Math.max(c.floor * 0.5, Math.min(c.floor, m.y + 260 * s));
        await c.teleport({ x, y });
      }
      c.flash(level >= 4 ? [RED, INK, RED, INK, RED] : [RED, INK, RED]);
      this.cutin(level >= 4 ? 'many' : level >= 2 ? 'laugh' : 'grin', dir);
      if (level >= 2) c.fx.lines(c.pos.x, c.pos.y - 140 * c.scale, { inner: 110 + level * 10, life: 520 });
      if (level >= 4) {
        c.fx.vortex(m.x, m.y, { radius: 150, life: 420 });
        this.storm(level); // the whole screen
      }
      await c.perform('alarm', Math.sign((c.mouse?.x ?? m.x) - c.pos.x) || dir);
      this.zapCursor({ kick: level >= 2 ? 2 : 1, bolts: Math.min(4, level) });
      if (level >= 4) {
        await sleep(650);
        this.zapCursor({ kick: 2, bolts: 2 });
      }
      if (level >= 5) {
        await this.meltdown();
        // lightning closing in on your pointer from all sides
        const p = c.mouse || m;
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          c.fx.bolt({ x: p.x + Math.cos(a) * 220, y: p.y + Math.sin(a) * 220 }, p, { life: 380, forks: 2, width: 2 });
        }
        c.fx.ring(p.x, p.y, { size: 1 });
        this.voice.play('bolt');
        await sleep(300);
        this.zapCursor({ kick: 2, bolts: 1 });
      }
      this.say(pick(this.t.steps[level - 1]), 'error', level >= 3 ? 'laugh' : 'smug', 3600);
    } finally {
      this.busy = false;
    }
    const next = this.queued;
    this.queued = 0;
    if (next > level) await this.escalate(next);
  }

  // Level 5: she breaks your screen. The whole thing goes black-red, cracks run out from your
  // pointer like glass, FLATLINE slams across the middle, and your mouse gets thrown around.
  async meltdown() {
    const c = this.capri;
    const { w, h } = c.view;
    const p = () => c.mouse || { x: w / 2, y: h / 2 };
    c.fx.storm({ life: 4200, power: 1.25 });
    await sleep(500);
    this.voice.play('bolt');
    c.fx.crack(p().x, p().y, { life: 3600 });
    c.fx.ring(p().x, p().y, { size: 1.6 });
    this.host.kickCursor(1, 2);
    await sleep(350);
    c.fx.banner(pick(['FLATLINE', 'ACCÈS REFUSÉ', 'SYSTÈME COMPROMIS']), { life: 1900 });
    this.voice.play('possess');
    for (let i = 0; i < 3; i++) {
      await sleep(420);
      const q = p();
      c.fx.crack(q.x + rand(-200, 200), q.y + rand(-150, 150), { life: 2600, size: 0.6 });
      this.host.kickCursor(i % 2 ? 1 : -1, 2);
      this.voice.play('bolt', { soft: true });
    }
    await sleep(500);
  }

  // Too much: she zaps the whole screen. It goes dark and red, lightning rains down from the top
  // all over it, everything glitches; at 5 she also takes over the windows you have open.
  storm(level) {
    const c = this.capri;
    const { w, h } = c.view;
    const life = level >= 5 ? 3200 : 2200;
    c.fx.storm({ life, power: level >= 5 ? 1 : 0.8 });
    this.voice.play('possess');
    const strikes = level >= 5 ? 22 : 13;
    for (let i = 0; i < strikes; i++) {
      setTimeout(() => {
        const x = rand(0, w);
        // one in three goes for your pointer, the rest hit anywhere
        const to = i % 3 === 0 && c.mouse ? c.mouse : { x: x + rand(-300, 300), y: rand(h * 0.3, h) };
        c.fx.bolt({ x, y: -10 }, to, { life: 320, forks: 3, width: rand(2, 5) });
        if (Math.random() < 0.35) c.fx.beam(rand(0, w), h, { life: 180, width: rand(14, 34) });
        c.fx.slices(rand(0, w * 0.8), rand(0, h * 0.8), rand(300, 700), rand(80, 260), { count: 6, life: 200 });
        if (i % 4 === 0) this.voice.play('bolt', { soft: true });
      }, 120 + i * (life * 0.75) / strikes);
    }
    if (level >= 5) {
      // her eyes on every window you have open
      const wins = c.windows.wins.filter((win) => !win.max && win.w > 260 && win.h > 160).slice(0, 4);
      const taken = wins.map((win) => {
        const rect = () => c.windows.wins.find((o) => o.id === win.id) || null;
        const covers = () => {
          const front = [];
          for (const o of c.windows.wins) {
            if (o.id === win.id) break;
            front.push(o);
          }
          return front;
        };
        return c.fx.possess(rect, { covers, entry: win.w / 2, look: () => c.mouse });
      });
      setTimeout(() => taken.forEach((t) => t.leave()), life - 600);
    }
  }

  // Every 1.5 s while wound up: watch your pointer, grumble, snap when it comes close.
  watch() {
    const c = this.capri;
    if (!this.level) return;
    const now = Date.now();
    if (!this.active) {
      // a minute without trouble: she lets it go
      this.level = 0;
      this.strokes = 0;
      if (!c.stowed && !c.hidden) {
        c.perform('crossArms', c.towardCenter());
        this.say(pick(this.t.cooled), 'info', 'aside', 4500);
      }
      return;
    }
    if (this.busy || c.busy || c.stowed || c.hidden || c.stance === 'fall') return;
    const m = c.mouse;
    if (m && c.stance === 'stand' && !c.act) {
      const want = m.x < c.pos.x ? 1 : -1;
      if (want !== c.facing) c.perform('turn'); // she keeps her eyes on it
    }
    const h = c.head();
    if (m && Math.hypot(m.x - h.x, m.y - h.y) < 220 && now > this.nextSnap) {
      this.nextSnap = now + 5000;
      this.zapCursor({ kick: 0 });
      if (!this.panel.visible) this.say(pick(this.t.tooClose), 'error', 'wide', 1800);
      return;
    }
    if (now > this.nextMutter && !this.panel.visible && Math.random() < 0.3) {
      this.nextMutter = now + 9000;
      c.perform('curious', c.towardCenter());
      this.say(pick(this.t.mutter), 'info', pick(['smug', 'aside', 'look']), 2600);
    }
  }

  // A stroke on her mane while she's angry: refused the first time, peace the second.
  // Returns true when the stroke was hers to take.
  stroke() {
    if (!this.level) return false;
    const c = this.capri;
    this.strokes += 1;
    if (this.strokes < 2) {
      c.perform('turn');
      this.zapCursor({ kick: 0 });
      this.say(pick(this.t.refuse), 'error', 'aside', 2600);
      return true;
    }
    this.level = 0;
    this.until = 0;
    this.strokes = 0;
    c.perform('hop');
    c.fx.ring(c.head().x, c.head().y, { size: 0.6 });
    this.say(pick(this.t.peace), 'done', 'calm', 4000);
    return true;
  }
}
