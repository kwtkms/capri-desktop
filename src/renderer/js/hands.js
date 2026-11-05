// Her hands on your desktop (main/desktop.js): she picks up one of your desktop icons, walks
// around with it, leaves it somewhere for a bit and then puts it back where it was. And when you
// ask her to open an app, she goes to its button on the taskbar (or its icon on the desktop),
// zaps it, and that's what opens it.

import { pick, sleep, rand, clamp } from './util.js';

const TEXT = {
  fr: {
    grab: ['Oh, il est à qui, ce raccourci ?', 'Je t’emprunte ça deux secondes.', 'Celui-là, je le range ailleurs.', 'Petit déménagement.'],
    drop: ['Voilà. C’est mieux là, non ?', 'Je te l’ai rangé. Enfin, déplacé.', 'Nouveau feng shui de bureau.'],
    back: ['Bon, je te le remets à sa place.', 'Je rigole, je le remets.', 'Retour à l’envoyeur.'],
    press: ['J’appuie !', 'Clic.', 'Bzzt, ouvert.'],
    given: ['Pour moi ? Merci ! Je te garde {what}.', '{what}, je le tiens. Dis « rends le » quand tu le veux.', 'Je surveille {what} pour toi.'],
    returned: ['Tiens, je te le rends. Pile à sa place.', 'Rendu ! Comme neuf.', 'Remis à sa place, chef.'],
    notGiven: 'Je trouve pas « {what} » sur ton bureau.',
    nothingHeld: 'Je tiens rien, là.',
  },
  en: {
    grab: ['Oh, whose shortcut is this?', 'Borrowing this for a sec.', 'This one goes somewhere else.', 'Little move.'],
    drop: ['There. Better here, right?', 'Tidied it for you. Well, moved it.', 'New desk feng shui.'],
    back: ['Fine, putting it back.', 'Kidding, putting it back.', 'Return to sender.'],
    press: ['Pressing it!', 'Click.', 'Bzzt, open.'],
    given: ['For me? Thanks! I’ll hold {what}.', 'Got {what}. Say “give it back” when you want it.', 'Keeping an eye on {what} for you.'],
    returned: ['Here, giving it back. Right where it was.', 'Returned! Good as new.', 'Back in its spot, boss.'],
    notGiven: 'Can’t find “{what}” on your desktop.',
    nothingHeld: 'I’m not holding anything.',
  },
};

const loadImage = (src) => new Promise((resolve) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => resolve(null);
  img.src = src;
});

const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

export class Hands {
  constructor({ capri, panel, voice, host, lang = 'fr' }) {
    Object.assign(this, { capri, panel, voice, host, lang });
    this.carrying = false;
    this.holding = null; // an icon you gave her: { icon, held, timer }
  }

  get t() {
    return TEXT[this.lang] || TEXT.en;
  }

  say(line, face = 'grin', hold = 2800) {
    if (!this.panel.visible) this.panel.say({ kind: 'info', line, hold, face });
  }

  // an icon you can see: not under one of your windows
  visible(icon) {
    const cx = icon.x + icon.w / 2, cy = icon.y + icon.h / 2;
    return !this.capri.windows.wins.some((w) => cx > w.x && cx < w.x + w.w && cy > w.y && cy < w.y + w.h);
  }

  free() {
    const c = this.capri;
    return !this.carrying && !this.holding && !c.busy && !c.stowed && !c.hidden && !c.hiding && !c.dormant && c.stance !== 'fall' && c.stance !== 'peek';
  }

  // She picks up one of your desktop icons, carries it, sets it down somewhere free, and later
  // puts it back. Your layout is saved first and checked at the end (main/desktop.js).
  async carry() {
    const c = this.capri;
    if (!this.free() || this.tidy?.working || this.capri.asleep) return false; // not in the middle of a tidying, not asleep
    this.carrying = true;
    const s = c.scale;
    let held = null;
    let icon = null;
    try {
      const icons = (await this.host.snapshotIcons().catch(() => [])).filter((i) => this.visible(i) && !/corbeille|recycle/i.test(i.name));
      if (!icons.length) return false;
      icon = pick(icons);
      const picture = await this.host.iconImage(icon.name).catch(() => null);
      const img = picture ? await loadImage(picture) : null;
      if (!img) return false;
      // next to it, its side toward the middle of the screen
      const side = icon.x + icon.w / 2 < c.view.w / 2 ? 1 : -1;
      const at = { x: clamp(icon.x + icon.w / 2 + side * 110 * s, 80, c.view.w - 80), y: clamp(icon.y + icon.h + 170 * s, 300 * s, c.floor) };
      await c.teleport(at);
      c.faceToward(icon.x + icon.w / 2);
      this.say(pick(this.t.grab), 'smug');
      await c.perform('alarm', -side);
      c.fx.crackle({ x: icon.x + icon.w / 2, y: icon.y + icon.h / 2 }, { life: 500, radius: 40 });
      this.voice.play('bolt', { soft: true });
      // the real one goes where no screen shows it, and she holds its picture
      const took = await this.host.takeIcon(icon.i).catch(() => ({ ok: false }));
      if (!took.ok) return false;
      c.fx.burst(icon.x + icon.w / 2, icon.y + icon.h / 2, { count: 10, power: 0.4, spread: 20 });
      held = c.fx.held(img, () => {
        const h = c.head();
        return { x: h.x + c.towardCenter() * 50 * s, y: h.y - 90 * s };
      }, { size: Math.max(32, icon.w * 0.65) });
      // a walk somewhere else, on the floor
      if (c.pos.y < c.floor - 4) await c.teleport({ x: c.pos.x, y: c.floor });
      const to = clamp(c.pos.x + side * rand(c.view.w * 0.2, c.view.w * 0.45), 120, c.view.w - 120);
      await c.walkTo(to, { speed: 170 });
      // she sets it down by her, on a free spot
      const h = c.head();
      const put = await this.host.putIcon(icon.i, h.x + c.towardCenter() * 110 * s - icon.w / 2, c.floor - icon.h - 20).catch(() => ({ ok: false }));
      held.drop();
      held = null;
      if (!put.ok) return true; // nowhere free: the finally puts it straight back
      c.perform('plop');
      c.fx.burst(put.x + icon.w / 2, put.y + icon.h / 2, { count: 10, power: 0.4, spread: 30 });
      this.say(pick(this.t.drop), 'laugh');
      await sleep(rand(15000, 30000));
      // and back where it was, in a zap
      if (!c.stowed && !c.hidden) {
        this.say(pick(this.t.back), 'calm');
        c.perform('alarm', 0);
        c.fx.streak(put.x + icon.w / 2, put.y + icon.h / 2, icon.x + icon.w / 2, icon.y + icon.h / 2, { life: 220 });
        await sleep(250);
      }
    } finally {
      held?.drop();
      await this.host.restoreIcons().catch(() => {});
      if (icon) c.fx.ring(icon.x + icon.w / 2, icon.y + icon.h / 2, { size: 0.5 });
      this.carrying = false;
    }
    return true;
  }

  // You give her one of your desktop icons (dropped on her, or "tiens discord"): she takes it and
  // keeps it with her, floating by her hand wherever she goes, until you ask for it back ("rends
  // le") or after a few minutes. Your layout is saved first, as when she carries one herself.
  async give(name) {
    const c = this.capri;
    if (this.holding) await this.giveBack({ quiet: true });
    if (this.carrying || this.tidy?.working) return { ok: false, busy: true };
    const q = norm(name);
    const icons = await this.host.snapshotIcons().catch(() => []);
    const icon = icons.find((i) => norm(i.name) === q) || icons.find((i) => norm(i.name).startsWith(q)) || icons.find((i) => q.length >= 3 && norm(i.name).includes(q));
    if (!icon) {
      await this.host.restoreIcons().catch(() => {});
      return { ok: false };
    }
    this.carrying = true;
    const s = c.scale;
    const picture = await this.host.iconImage(icon.name).catch(() => null);
    const img = picture ? await loadImage(picture) : null;
    const took = await this.host.takeIcon(icon.i).catch(() => ({ ok: false }));
    if (!took.ok || !img) {
      await this.host.restoreIcons().catch(() => {});
      this.carrying = false;
      return { ok: false };
    }
    // it flies from its spot into her hand
    const h = c.head();
    c.fx.streak(icon.x + icon.w / 2, icon.y + icon.h / 2, h.x, h.y - 60 * s, { life: 200 });
    c.perform('hop');
    this.voice.play('done');
    const held = c.fx.held(img, () => {
      const hd = c.head();
      return { x: hd.x + c.towardCenter() * 50 * s, y: hd.y - 90 * s };
    }, { size: Math.max(32, icon.w * 0.65) });
    this.holding = { icon, held, timer: setTimeout(() => this.giveBack(), 5 * 60000) };
    this.carrying = false;
    this.say(pick(this.t.given).replace('{what}', icon.name), 'laugh', 3500);
    return { ok: true, what: icon.name };
  }

  // "rends le": the icon she's holding goes back exactly where it was
  async giveBack({ quiet = false } = {}) {
    const hold = this.holding;
    if (!hold) return { ok: false };
    this.holding = null;
    clearTimeout(hold.timer);
    const c = this.capri;
    const { icon } = hold;
    hold.held.drop();
    const h = c.head();
    c.perform('alarm', icon.x + icon.w / 2 > c.pos.x ? 1 : -1);
    c.fx.streak(h.x, h.y - 60 * c.scale, icon.x + icon.w / 2, icon.y + icon.h / 2, { life: 220 });
    await this.host.restoreIcons().catch(() => {});
    c.fx.ring(icon.x + icon.w / 2, icon.y + icon.h / 2, { size: 0.5 });
    if (!quiet) this.say(pick(this.t.returned), 'calm', 3000);
    return { ok: true };
  }

  // "ouvre Spotify": to its button on the taskbar, or its icon on your desktop, a zap, it opens.
  // Returns { ok, what } like host.launch.
  async open(words) {
    const c = this.capri;
    const q = norm(words);
    let target = null;
    let how = null;
    const button = await this.host.findButton(words).catch(() => null);
    if (button) {
      target = { x: button.x + button.w / 2, y: Math.min(c.view.h - 2, button.y + button.h / 2) };
      how = 'taskbar';
    } else {
      const icons = await this.host.deskIcons().catch(() => []);
      const icon = icons.find((i) => norm(i.name) === q) || icons.find((i) => norm(i.name).startsWith(q)) || icons.find((i) => q.length >= 4 && norm(i.name).includes(q));
      if (icon && this.visible(icon)) {
        target = { x: icon.x + icon.w / 2, y: icon.y + icon.h / 2, name: icon.name };
        how = 'desktop';
      }
    }
    if (target && this.free()) {
      const s = c.scale;
      const side = target.x < c.view.w / 2 ? 1 : -1;
      const near = how === 'taskbar'
        ? { x: clamp(target.x + side * 70 * s, 80, c.view.w - 80), y: c.floor }
        : { x: clamp(target.x + side * 110 * s, 80, c.view.w - 80), y: clamp(target.y + 170 * s, 300 * s, c.floor) };
      await c.teleport(near);
      c.faceToward(target.x);
      await c.perform('alarm', target.x > c.pos.x ? 1 : -1);
      const h = c.head();
      c.fx.bolt({ x: h.x, y: h.y - 30 * s }, { x: target.x, y: target.y }, { life: 380, forks: 3, width: 3 });
      c.fx.ring(target.x, Math.min(target.y, c.view.h - 4), { size: 0.6 });
      this.voice.play('bolt');
      await sleep(250);
      if (how === 'taskbar') {
        const res = await this.host.pressButton(words).catch(() => ({ ok: false }));
        if (res.ok) {
          this.say(pick(this.t.press), 'laugh', 2000);
          return { ok: true, what: words };
        }
      }
      const res = await this.host.launch(target.name || words).catch(() => ({ ok: false }));
      if (res.ok) return res;
    }
    return this.host.launch(words).catch(() => ({ ok: false }));
  }
}
