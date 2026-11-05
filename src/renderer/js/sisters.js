// Her other selves, like in the show: now and then another Capri shows up and they do something
// together. A dance, a squabble over a window, a zap duel, a high-five. Then the other one goes.
// The other self is a second Capri on her own canvas, never clickable, never talking out loud.

import { Capri } from './capri.js';
import { pick, sleep } from './util.js';

const TEXT = {
  fr: {
    hello: ['Oh, salut moi.', 'Tiens, t’es là toi ?', 'Une autre moi ! Preem.'],
    sisterHello: ['Yo.', 'Coucou moi !', 'Je passais.'],
    dance: ['On fait la choré ?', 'Synchro, à trois.'],
    sisterDance: ['Go !', 'Un, deux, trois !'],
    steal: ['Hé ! C’était MA place !', 'Elle m’a piqué ma fenêtre…'],
    sisterSteal: ['Ma fenêtre maintenant.', 'Premier arrivé, premier servi.'],
    duel: ['Duel ! Le premier qui cligne a perdu.', 'Tu me cherches, moi ?'],
    sisterDuel: ['Bzzt !', 'Trop lente !'],
    five: ['Check !', 'Top là, moi.'],
    bye: ['À plus, moi.', 'Bon, elle est repartie dans le réseau.', 'Elle reviendra. On revient toujours.'],
    invasion: ['Oh non. Elles sont TOUTES là.', 'Réunion de famille !', 'C’est l’invasion des moi !'],
    invasionEnd: ['…et elles repartent. Comme d’hab.', 'Bon, retour au calme.', 'Elles ont pas rangé, évidemment.'],
    // little talks between her and her other self, about what you're doing: [other self, her]
    chat: {
      code: [['Il code encore ?', 'Laisse-le, il bosse.'], ['Ça compile, ou pas ?', 'Chut, il se concentre.']],
      claude: [['Il parle encore à Claude ?', 'Ils font une super équipe, tu sais.'], ['Claude, Claude, toujours Claude…', 'Jalouse ?']],
      browser: [['Il cherche quoi sur le Net ?', 'Je regarde pas. Enfin… un peu.'], ['Encore 40 onglets ?', 'C’est sa façon de ranger.']],
      discord: [['Il papote avec qui ?', 'Ses potes. Laisse-le tranquille.']],
      music: [['Il écoute quoi ?', 'Du bon. Je valide.']],
      game: [['Il a gagné, tu crois ?', 'On lui demandera.']],
      idle: [['Il fait quoi, là ?', 'Il réfléchit. Ou il dort.'], ['Il est sympa, lui, non ?', 'Ouais. On le garde.'], ['On le pirate pour rire ?', 'Non. …Peut-être. Non.']],
    },
  },
  en: {
    hello: ['Oh, hi me.', 'Oh, you’re here?', 'Another me! Preem.'],
    sisterHello: ['Yo.', 'Hey me!', 'Just passing by.'],
    dance: ['Shall we do the routine?', 'In sync, on three.'],
    sisterDance: ['Go!', 'One, two, three!'],
    steal: ['Hey! That was MY seat!', 'She stole my window…'],
    sisterSteal: ['My window now.', 'First come, first served.'],
    duel: ['Duel! First to blink loses.', 'Looking for trouble, me?'],
    sisterDuel: ['Bzzt!', 'Too slow!'],
    five: ['High five!', 'Up top, me.'],
    bye: ['See ya, me.', 'Back into the network she goes.', 'She’ll be back. We always are.'],
    invasion: ['Oh no. They’re ALL here.', 'Family reunion!', 'Invasion of the mes!'],
    invasionEnd: ['…and they’re gone. As usual.', 'Back to quiet.', 'They didn’t tidy up, of course.'],
    chat: {
      code: [['Still coding?', 'Leave him, he’s working.'], ['Does it compile or not?', 'Shh, he’s focused.']],
      claude: [['Talking to Claude again?', 'They make a great team, you know.'], ['Claude, Claude, always Claude…', 'Jealous?']],
      browser: [['What’s he looking for?', 'Not looking. Well… a bit.'], ['40 tabs again?', 'That’s how he tidies.']],
      discord: [['Who’s he chatting with?', 'His friends. Leave him be.']],
      music: [['What’s he listening to?', 'Good stuff. Approved.']],
      game: [['Did he win, you think?', 'We’ll ask.']],
      idle: [['What’s he doing?', 'Thinking. Or sleeping.'], ['He’s nice, right?', 'Yeah. We’re keeping him.'], ['Hack him for fun?', 'No. …Maybe. No.']],
    },
  },
};

export class Sisters {
  constructor({ capri, panel, image, fx, life = null, lang = 'fr' }) {
    Object.assign(this, { capri, panel, image, fx, life, lang });
    this.other = null;
    this.minis = [];
    this.busy = false;
  }

  // a copy of her on a canvas of her own, quiet, not clickable, hidden until used
  makeCopy(className) {
    const root = document.createElement('div');
    root.className = `capri ${className}`;
    const canvas = document.createElement('canvas');
    canvas.className = 'capri__sprite';
    root.append(canvas);
    document.getElementById('capri').before(root);
    const s = new Capri({ root, canvas, image: this.image, fx: this.fx, voice: { play() {}, muted: true } });
    s.wander = false;
    s.nextMove = s.nextGaze = Infinity;
    s.hidden = true;
    root.style.visibility = 'hidden';
    return s;
  }

  // Rarely: lots of little hers all over the screen for a few seconds, then gone.
  async invasion() {
    const c = this.capri;
    if (this.busy || c.busy || c.stowed || c.hidden || c.dormant || c.mode === 'sleep' || c.focus) return;
    this.busy = true;
    try {
      while (this.minis.length < 7) this.minis.push(this.makeCopy('capri--mini'));
      this.say(pick(this.t.invasion), 3000);
      c.perform('startle');
      const { w } = c.view;
      const seats = c.windows.wins.filter((win) => !win.max && win.y > 120);
      await Promise.all(this.minis.map(async (m, i) => {
        await sleep(i * 160);
        m.setScale(c.scale * (0.3 + Math.random() * 0.15));
        m.setView(c.view.w, c.view.h);
        m.windows = c.windows;
        m.hidden = false;
        m.root.style.visibility = '';
        m.p.misreg = [2.2, -2.6];
        const win = seats.length && Math.random() < 0.5 ? pick(seats) : null;
        const at = win ? { x: win.x + 40 + Math.random() * (win.w - 80), y: win.y } : { x: 60 + Math.random() * (w - 120), y: c.floor };
        await m.materialize(at);
        for (let k = 0; k < 3; k++) {
          await sleep(300 + Math.random() * 600);
          await m.perform(pick(['hop', 'spin', 'laugh', 'split', 'juggle']), pick([-1, 1]));
        }
        if (Math.random() < 0.4) this.sisterSays(m, pick(['!', '♪', 'Yo !', 'Hé !', '>_<', 'Preem']));
      }));
      await sleep(800);
      for (const m of this.minis) {
        await sleep(120);
        m.vanish({ beam: false }).then(() => {
          m.hidden = true;
          m.root.style.visibility = 'hidden';
        });
      }
      await sleep(700);
      c.perform('laugh');
      this.say(pick(this.t.invasionEnd), 3000);
    } catch (err) {
      console.error('[capri] invasion:', err);
    } finally {
      this.busy = false;
    }
  }

  // what you're doing, for their little talks
  topic() {
    const app = this.life?.app || '';
    if (/^(code|cursor|windsurf|idea64|pycharm64|webstorm64|devenv|zed)$/.test(app)) return 'code';
    if (app === 'claude') return 'claude';
    if (/^(chrome|msedge|firefox|opera|brave|vivaldi|arc|zen)$/.test(app)) return 'browser';
    if (app.startsWith('discord')) return 'discord';
    if (app === 'spotify') return 'music';
    if (this.life?.gaming) return 'game';
    return 'idle';
  }

  // the other self drops by for a word about you, and goes
  async chatter(s) {
    const [hers, mine] = pick(this.t.chat[this.topic()] || this.t.chat.idle);
    this.sisterSays(s, hers);
    await sleep(1800);
    this.capri.faceToward(s.pos.x);
    this.capri.perform(pick(['look', 'crossArms', 'laugh']), s.pos.x > this.capri.pos.x ? 1 : -1);
    this.say(mine, 3000);
    await sleep(2400);
  }

  get t() {
    return TEXT[this.lang] || TEXT.en;
  }

  // the other self, made once and kept hidden between visits
  sister() {
    this.other ??= this.makeCopy('capri--sister');
    return this.other;
  }

  say(line, hold = 2600) {
    this.panel.say({ kind: 'info', line, hold, face: pick(['grin', 'smug', 'laugh']) });
  }

  sisterSays(s, line) {
    this.fx.tag(() => s.head(), line, { life: 2400 });
  }

  // a visit: she pops in near Capri, they do one thing together, she goes
  async visit(kind = pick(['dance', 'steal', 'duel', 'five', 'chatter', 'chatter'])) {
    const c = this.capri;
    if (this.busy || c.busy || c.stowed || c.hidden || c.dormant || c.mode === 'sleep' || c.focus) return;
    this.busy = true;
    const s = this.sister();
    try {
      s.setScale(c.scale * 0.92);
      s.setView(c.view.w, c.view.h);
      s.windows = c.windows;
      const side = c.pos.x > c.view.w / 2 ? -1 : 1;
      const at = { x: Math.max(80, Math.min(c.view.w - 80, c.pos.x + side * 230 * c.scale)), y: c.floor };
      s.hidden = false;
      s.root.style.visibility = '';
      s.p.alpha = 1;
      s.p.misreg = [2.2, -2.6]; // her colours a hair off, so you can tell them apart
      await s.materialize(at);
      s.faceToward(c.pos.x);
      c.faceToward(s.pos.x);
      this.sisterSays(s, pick(this.t.sisterHello));
      await sleep(900);
      this.say(pick(this.t.hello));
      await sleep(1800);
      await this[kind](s);
      await sleep(1200);
      await s.vanish({ beam: false });
      this.say(pick(this.t.bye), 3000);
    } catch (err) {
      console.error('[capri] sisters:', err);
    } finally {
      s.hidden = true;
      s.root.style.visibility = 'hidden';
      this.busy = false;
    }
  }

  async dance(s) {
    const c = this.capri;
    this.say(pick(this.t.dance));
    await sleep(900);
    this.sisterSays(s, pick(this.t.sisterDance));
    for (const act of ['spin', 'groove', 'split', 'hop']) {
      c.perform(act, c.towardCenter());
      await s.perform(act, s.towardCenter());
      await sleep(150);
    }
    this.fx.burst((c.pos.x + s.pos.x) / 2, c.pos.y - 150 * c.scale, { count: 26, power: 0.8 });
  }

  async steal(s) {
    const c = this.capri;
    const seat = c.pickSeat({ any: true });
    if (!seat) return this.five(s);
    if (!(c.stance === 'sit' && c.perch?.id === seat.win.id)) await c.hopTo(seat);
    await sleep(1200);
    await s.hopTo({ win: seat.win, dx: seat.dx });
    // she lands right where Capri was: Capri is bumped off
    c.fall();
    c.vx = (c.pos.x > s.pos.x ? 1 : -1) * 700;
    this.sisterSays(s, pick(this.t.sisterSteal));
    await sleep(1400);
    this.say(pick(this.t.steal));
    await sleep(1500);
    s.perform('spin');
    await sleep(600);
    // and she leaves from up there
    await s.vanish({ beam: false });
    await s.materialize({ x: s.pos.x, y: c.floor });
  }

  async duel(s) {
    const c = this.capri;
    this.say(pick(this.t.duel));
    await sleep(1200);
    for (let i = 0; i < 3; i++) {
      const a = i % 2 ? s : c;
      const b = i % 2 ? c : s;
      await a.perform('alarm', b.pos.x > a.pos.x ? 1 : -1);
      const ha = a.head(), hb = b.head();
      this.fx.bolt({ x: ha.x, y: ha.y - 40 }, { x: hb.x, y: hb.y }, { life: 380, forks: 3, width: 3 });
      this.fx.crackle({ x: hb.x, y: hb.y }, { life: 500, radius: 40 });
      b.perform('turn');
      if (i === 1) this.sisterSays(s, pick(this.t.sisterDuel));
      await sleep(700);
    }
  }

  async five(s) {
    const c = this.capri;
    // they float to each other and clap
    const mid = (c.pos.x + s.pos.x) / 2;
    c.perform('hop');
    s.perform('hop');
    await sleep(500);
    this.say(pick(this.t.five));
    const y = c.pos.y - 170 * c.scale;
    this.fx.ring(mid, y, { size: 0.8 });
    this.fx.burst(mid, y, { count: 18, power: 0.6 });
    await sleep(600);
  }
}
