// The fun part: stroking her mane, annoying her (feud.js), throwing her around, hide-and-seek,
// her dancing to your music (in silence), water breaks, the odd fake hack, a wink when Edgerunners
// or Cyberpunk shows up, and your typing rhythm.

import { pick, fmt, sleep } from './util.js';
import { Feud } from './feud.js';
import { Rhythm } from './rhythm.js';
import { moodOfDay } from './mood.js';
import { DRAWINGS } from './shapes.js';

const CHATS = new Set(['whatsapp', 'telegram', 'signal', 'messenger', 'ms-teams', 'teams', 'slack', 'instagram']);

const TEXT = {
  fr: {
    ruffle: ['Hé ! Tu me décoiffes, là.', 'Mes cheveux, c’est des données. Pas touche au code.', 'Ça va, t’as fini de bidouiller ma coupe ?', 'J’ai mis une heure à les régler, ceux-là.'],
    wink: [
      'Edgerunners… Tu sais que je viens de là, hein ?',
      'Night City. Ma ville.',
      'David, Lucy… la Lune. Tu te souviens ?',
      'Cyberpunk ! Enfin un peu de culture.',
      'Ah, tu regardes ma famille ?',
    ],
    winkSong: ['♪ Ce morceau, c’est toute la série en trois minutes.', '♪ Ah, LE son. Monte, monte.', '♪ Edgerunners dans les oreilles. Preem.'],
    typingFast: ['Tu tapes à la vitesse de la lumière !', 'Waouh, t’as des doigts cybernétiques ?', 'Ça chauffe sur le clavier !', 'Même mes moi n’arrivent pas à suivre.'],
    typingLong: ['Ça fait {m} min que tu écris sans t’arrêter. Respire, choom.', '{m} min de frappe non-stop. Pause ?'],
    landed: ['J’ai le tournis…', 'Encore ! …Non, attends.', 'Atterrissage parfait. Ou presque.', 'Hé, doucement !'],
    hideStart: ['Cache-cache ! Ferme les yeux… trouve-moi.', 'On joue ? Je me cache. Cherche bien.'],
    found: ['Trouvée en {s} s !', 'Grillée ! {s} secondes.', '{s} s. Tu me connais trop bien.'],
    record: 'Nouveau record !',
    lost: ['Perdu ! J’étais là depuis le début.', 'Trop forte. Tu m’as pas trouvée.'],
    water: ['Ça fait {h} que tu y es. Va boire un verre d’eau, choom.', 'Pause hydratation ! Même les netrunners boivent.', '{h} non-stop. Lève-toi, bois un coup, reviens.'],
    // DJ of a Night City pirate radio: {artist}, {track} from Spotify's title
    music: [
      '📻 Radio Capri, 98.7 FM : {track}, de {artist}. Restez branchés, choombas.',
      '📻 Vous écoutez Night City Pirate. Là, c’est {artist}. Montez le son.',
      '📻 Petite dédicace au netrunner du bureau : {track}.',
      '📻 Il est {clock} à Night City, et voilà {artist} avec {track}.',
      '📻 Pas de pub, que du son : {artist}, « {track} ».',
      '📻 Celui-là, c’est un classique. {track}. Pas de zapping.',
    ],
    hack: ['BREACH PROTOCOL', 'ROOT ACCESS', 'EXFILTRATION', 'DAEMON UPLOAD'],
    hackDone: ['Je t’ai eu. Rien n’a été touché, c’était pour rire.', 'Hack réussi… ou pas. Je rigole, choom.', 'Ton PC est à moi ! …Non, je plaisante.'],
    shaken: ['WOH ! Arrête de secouer !', 'Séisme dans Night City !', 'J’ai lâché ! Merci, hein.', 'Tu voulais que je tombe, avoue.'],
    copy: ['Je te le garde.', 'Colis récupéré.', 'Je porte, t’inquiète.'],
    paste: ['Livré !', 'Et hop, collé.', 'Livraison express.'],
    flash: {
      discord: ['Discord t’appelle ! Je lis pas, promis.', 'Ça bouge sur Discord.', 'Quelqu’un t’écrit sur Discord.'],
      chat: ['Un message pour toi !', 'Ça clignote là-bas. Un message ?'],
      other: ['{app} réclame ton attention.', 'Hé, {app} clignote.'],
    },
    kickWin: ['Oups. Elle a bougé toute seule, ta fenêtre.', 'Je me mets à l’aise.', 'Elle était pas droite.', 'Petit coup de pied. Rien de grave.'],
  },
  en: {
    ruffle: ['Hey! You’re messing up my hair.', 'My hair is data. Hands off the code.', 'Done fiddling with my hairdo?', 'Took me an hour to tune these.'],
    wink: [
      'Edgerunners… You know that’s where I come from, right?',
      'Night City. My city.',
      'David, Lucy… the Moon. Remember?',
      'Cyberpunk! Finally some culture.',
      'Oh, watching my family?',
    ],
    winkSong: ['♪ This track is the whole show in three minutes.', '♪ Oh, THE song. Turn it up.', '♪ Edgerunners in your ears. Preem.'],
    typingFast: ['You type at light speed!', 'Wow, cyber fingers?', 'Keyboard’s on fire!', 'Not even all of me can keep up.'],
    typingLong: ['{m} min of typing nonstop. Breathe, choom.', '{m} min straight on the keys. Break?'],
    landed: ['I’m dizzy…', 'Again! …No, wait.', 'Perfect landing. Almost.', 'Hey, easy!'],
    hideStart: ['Hide-and-seek! Close your eyes… find me.', 'Wanna play? I’m hiding. Look closely.'],
    found: ['Found me in {s} s!', 'Busted! {s} seconds.', '{s} s. You know me too well.'],
    record: 'New record!',
    lost: ['You lose! I was right there.', 'Too good. You didn’t find me.'],
    water: ['{h} straight, choom. Go drink some water.', 'Hydration break! Even netrunners drink.', '{h} non-stop. Get up, drink, come back.'],
    music: [
      '📻 Radio Capri, 98.7 FM: {track} by {artist}. Stay tuned, choombas.',
      '📻 You’re listening to Night City Pirate. That’s {artist}. Turn it up.',
      '📻 Shout-out to the netrunner at the desk: {track}.',
      '📻 It’s {clock} in Night City, and here’s {artist} with {track}.',
      '📻 No ads, just sound: {artist}, “{track}”.',
      '📻 This one’s a classic. {track}. No skipping.',
    ],
    hack: ['BREACH PROTOCOL', 'ROOT ACCESS', 'EXFILTRATION', 'DAEMON UPLOAD'],
    hackDone: ['Got you. Nothing was touched, just kidding.', 'Hack successful… or not. Kidding, choom.', 'Your PC is mine! …Nah, joking.'],
    shaken: ['WHOA! Stop shaking!', 'Earthquake in Night City!', 'I let go! Thanks a lot.', 'You wanted me to fall, admit it.'],
    copy: ['I’ll hold it for you.', 'Package picked up.', 'I’ve got it.'],
    paste: ['Delivered!', 'And pasted.', 'Express delivery.'],
    flash: {
      discord: ['Discord’s calling! Not reading it, promise.', 'Something’s up on Discord.', 'Someone’s texting you on Discord.'],
      chat: ['A message for you!', 'Something’s blinking over there. A message?'],
      other: ['{app} wants your attention.', 'Hey, {app} is blinking.'],
    },
    kickWin: ['Oops. Your window moved on its own.', 'Getting comfy.', 'It wasn’t straight.', 'Little kick. No harm done.'],
  },
};

const STROKE_NEEDED = 420;          // px of pointer travel over her mane for a stroke
const WATER_EVERY_MS = 75 * 60 * 1000;
const HIDE_TIMEOUT_MS = 120 * 1000;
const WINK_EVERY_MS = 20 * 60 * 1000;
// Edgerunners songs (Spotify titles)
const EDGE_SONGS = /i really want to stay at your house|let you down|resist and disorder|rosa walton|dawid podsiad|stay at your house|this fffire|franz ferdinand/i;

export class Play {
  constructor({ capri, panel, voice, host, life, brain, config, lang = 'fr' }) {
    Object.assign(this, { capri, panel, voice, host, life, brain, lang });
    this.bestHide = Number(config.bestHide) || 0;
    this.stroke = { dist: 0, last: null, since: 0 };
    this.nextPurr = 0;
    this.clicks = [];
    this.feud = new Feud({ capri, panel, voice, host, lang });
    this.playing = false;     // your music
    this.song = '';
    this.lastSongTalk = 0;
    this.sessionStart = Date.now(); // since your last break
    // her events (a prank, hide-and-seek, another her, an invasion...): one every few minutes
    this.nextEvent = Date.now() + rand(1, 2) * 60000;

    this.sisters = null;      // app.js: her other selves (sisters.js)
    this.props = null;        // app.js: her things on your windows (props.js)
    this.chase = null;        // app.js: running after your pointer (chase.js)
    this.clip = null;         // the clipboard counter last seen (windows.ps1)
    this.paste = null;
    this.cube = null;         // what she's carrying for you
    this.lastFlash = 0;
    this.rhythm = new Rhythm();
    this.rhythm.onBeat = (k) => this.beat(k);
    this.onLevel = null;      // app.js: the decor's neons pulse with the music
    this.rhythm.onLevel = (v) => this.onLevel?.(v);

    capri.onPointerNear = (x, y) => this.pointer(x, y);
    capri.onLanded = () => this.landed();
    capri.onShaken = () => this.shaken();
    setInterval(() => this.tick(), 30000);
    setInterval(() => this.groove(), 2600);
  }

  get mood() {
    return moodOfDay();
  }

  // ---------- the window under her ----------

  shaken() {
    this.capri.voice.play('rise');
    setTimeout(() => this.capri.perform('pout'), 900); // after the landing: a pout
    setTimeout(() => this.say(pick(this.t.shaken), { hold: 3000, face: pick(['wide', 'laugh']) }), 500);
  }

  // she kicks the window she's sitting on a few pixels, and acts innocent
  async kickWindow() {
    const c = this.capri;
    const win = c.stance === 'sit' && c.windows.wins.find((w) => w.id === c.perch?.id);
    if (c.asleep) return false;
    if (win?.fake) return this.crate?.kick(); // her own seat: that one she kicks for real
    if (!win || win.max || c.busy) return false;
    await c.perform('hop');
    const dir = Math.random() < 0.5 ? -1 : 1;
    this.host.nudgeWindow(win.id, dir * rand(25, 45));
    c.fx.burst(c.pos.x, c.pos.y - 10, { count: 6, power: 0.3, spread: 20 });
    this.voice.play('land', { soft: true });
    await sleep(500);
    c.perform('look');
    this.say(pick(this.t.kickWin), { hold: 3000, face: pick(['smug', 'aside']) });
    return true;
  }

  // ---------- copy and paste: her little data cube ----------

  onClip(clip, paste) {
    const c = this.capri;
    const firstTime = this.clip === null;
    const copied = !firstTime && clip !== this.clip;
    const pasted = !firstTime && paste !== this.paste;
    this.clip = clip;
    this.paste = paste;
    if (firstTime || c.stowed || c.hidden || c.hiding || this.life.gaming) return;
    if (pasted && this.cube) {
      // she throws it to where you pasted (your pointer)
      const to = c.mouse || { x: c.view.w / 2, y: c.view.h / 2 };
      c.perform('alarm', to.x > c.pos.x ? 1 : -1);
      this.cube.throwTo(to.x, to.y);
      this.cube = null;
      clearTimeout(this.cubeTimer);
      this.voice.play('bolt', { soft: true });
      if (!this.panel.visible && Math.random() < 0.35) this.say(pick(this.t.paste), { hold: 2000, face: 'grin' });
    } else if (copied) {
      this.cube?.drop();
      // floating at her side, on the screen's middle side
      const h = () => {
        const hd = c.head();
        return { x: hd.x + c.towardCenter() * 110 * c.scale, y: hd.y + 20 * c.scale };
      };
      c.perform('hop');
      this.cube = c.fx.cube(h);
      this.voice.play('blip');
      if (!this.panel.visible && Math.random() < 0.25) this.say(pick(this.t.copy), { hold: 1800, face: 'calm' });
      // nobody pasted: she drops it after a while
      clearTimeout(this.cubeTimer);
      this.cubeTimer = setTimeout(() => {
        this.cube?.drop();
        this.cube = null;
      }, 3 * 60000);
    }
  }

  // ---------- an app flashing in the taskbar ----------

  flash(app) {
    const c = this.capri;
    const now = Date.now();
    if (now - this.lastFlash < 3 * 60000 || c.mode === 'sleep' || c.nightSleep || c.stowed || c.hidden || c.hiding || this.life.gaming || this.panel.visible) return;
    if (app === 'claude' || app === 'electron' || app === 'explorer') return;
    this.lastFlash = now;
    const kind = app.startsWith('discord') ? 'discord' : CHATS.has(app) ? 'chat' : 'other';
    const name = app.charAt(0).toUpperCase() + app.slice(1);
    c.wake();
    c.perform('alarm', 0);
    // a little ping straight down, toward the taskbar
    const h = c.head();
    c.fx.streak(h.x, h.y, h.x, c.view.h + 20, { life: 160 });
    c.fx.ring(h.x, h.y - 50 * c.scale, { size: 0.5 });
    this.say(fmt(pick(this.t.flash[kind]), { app: name }), { hold: 3500, face: 'look' });
  }

  // ---------- the beat of your music ----------

  beat(k) {
    const c = this.capri;
    if (!this.playing || c.busy || c.stowed || c.hidden || c.hiding || c.dormant || c.stance === 'fall' || c.stance === 'peek' || c.mode === 'sleep') return; // asleep: she stays lying down
    if (c.act && c.act.player.priority > 0) return;
    c.perform('beat');
    if (k > 0.5 && Math.random() < 0.3) c.shed();
  }

  get t() {
    return TEXT[this.lang] || TEXT.en;
  }

  free() {
    const c = this.capri;
    // Claude working doesn't count: it works nearly all the time, she'd never play
    return !c.busy && !c.stowed && !c.dormant && !c.hidden && !c.hiding && !this.panel.visible && c.mode !== 'alert';
  }

  say(line, { kind = 'info', hold = 4000, face } = {}) {
    this.panel.say({ kind, line, hold, ...(face ? { face } : {}) });
  }

  // her face, big, in a cut-in by her head (like in the show)
  cutin(kind, dir = this.capri.towardCenter()) {
    const [x, y, d] = this.capri.cutinAt(dir);
    this.capri.fx.cutin(x, y, d, { kind });
  }

  // ---------- stroking her mane ----------

  pointer(x, y) {
    const c = this.capri;
    if (c.hiding || c.stance === 'fall') return;
    const h = c.head();
    const near = Math.hypot(x - h.x, y - (h.y - 20 * c.scale)) < 95 * c.scale;
    const now = performance.now();
    const st = this.stroke;
    if (!near) {
      st.last = null;
      return;
    }
    if (!st.last || now - st.since > 1800) {
      st.dist = 0;
      st.since = now;
    } else {
      st.dist += Math.hypot(x - st.last.x, y - st.last.y);
    }
    st.last = { x, y };
    if (st.dist < STROKE_NEEDED || now < this.nextPurr) return;
    st.dist = 0;
    st.since = now;
    this.nextPurr = now + 6000;
    c.touch(); // a hand in her hair: direct (wakes her at night)
    if (this.feud.stroke()) return; // angry: refused the first time, peace the second
    c.wake();
    c.perform('ruffle');
    // she shakes it back into place: shards flying off her mane, a bit of static
    for (let i = 0; i < 6; i++) c.shed();
    c.fx.burst(h.x, h.y - 30 * c.scale, { count: 8, power: 0.35, spread: 50 * c.scale });
    this.voice.play('blip');
    if (!this.panel.visible && Math.random() < 0.5) this.say(pick(this.t.ruffle), { hold: 2600, face: pick(['smug', 'laugh', 'aside']) });
  }

  // ---------- clicks: found her, or too many of them ----------

  // Returns true when the click was hers to take.
  click() {
    const c = this.capri;
    if (c.hiding) {
      // a click still on its way as she hid doesn't count
      if (Date.now() - this.hideStart > 1500) this.found();
      return true;
    }
    const now = Date.now();
    this.clicks = this.clicks.filter((t) => now - t < 2500);
    this.clicks.push(now);
    // already angry, it takes less to push her further
    if (this.clicks.length >= (this.feud.active ? 3 : 4)) {
      // one click too many: she takes offense, and it escalates (feud.js)
      this.clicks = [];
      this.feud.burst();
      return true;
    }
    // already wound up: every single click is a provocation she answers
    if (this.feud.active) {
      this.feud.poke();
      return true;
    }
    return false;
  }

  // ---------- thrown: back on her feet ----------

  landed() {
    const c = this.capri;
    if (c.stowed || c.hidden) return;
    c.perform(Math.random() < 0.4 ? 'laugh' : 'look'); // shaking it off (or laughing it off)
    const h = c.head();
    for (let i = 0; i < 3; i++) setTimeout(() => c.fx.glyph(h.x + rand(-40, 40), h.y - 70 * c.scale), i * 150);
    if (!this.panel.visible && Math.random() < 0.7) this.say(pick(this.t.landed), { hold: 2600, face: pick(['wide', 'laugh']) });
  }

  // ---------- hide-and-seek ----------

  async hide() {
    const c = this.capri;
    if (c.hiding || c.stowed || c.dormant) return;
    if (c.busy) await sleep(800);
    this.say(pick(this.t.hideStart), { hold: 2600, face: 'smug' });
    await sleep(2800);
    this.panel.hide();
    this.scaleBefore = c.scale;
    await c.vanish({ beam: false });
    c.hiding = true;
    c.setStance('stand');
    c.setScale(this.scaleBefore * 0.38);
    const { w } = c.view;
    c.pos = { x: rand(70, w - 70), y: rand(c.floor * 0.45, c.floor) };
    Object.assign(c.p, { collapse: 0, dissolve: 0, glitch: 0, split: 0, alpha: 0.55 });
    c.facing = pick([1, -1]);
    c.place();
    this.hideStart = Date.now();
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.reveal(), HIDE_TIMEOUT_MS);
  }

  unhideBody() {
    const c = this.capri;
    clearTimeout(this.hideTimer);
    c.hiding = false;
    c.setScale(this.scaleBefore || c.scale);
    c.p.alpha = 1;
    c.place();
    const h = c.head();
    c.fx.vortex(h.x, h.y, { radius: 120, life: 420 });
    c.fx.burst(c.pos.x, c.pos.y - 60 * c.scale, { count: 18, power: 0.7, spread: 90 });
    c.perform('hop');
  }

  // she has to leave this screen: the game's off, no fuss
  cancelHide() {
    const c = this.capri;
    if (!c.hiding) return;
    clearTimeout(this.hideTimer);
    c.hiding = false;
    c.setScale(this.scaleBefore || c.scale);
    c.p.alpha = 1;
  }

  found() {
    const s = Math.round((Date.now() - this.hideStart) / 1000);
    this.unhideBody();
    this.voice.play('done');
    this.cutin('laugh');
    const record = !this.bestHide || s < this.bestHide;
    if (record) {
      this.bestHide = s;
      this.host.setConfig({ bestHide: s });
    }
    const line = fmt(pick(this.t.found), { s }) + (record ? ` ${this.t.record}` : '');
    this.say(line, { kind: 'done', hold: 5000, face: 'laugh' });
  }

  reveal() {
    if (!this.capri.hiding) return;
    this.unhideBody();
    this.cutin('grin');
    setTimeout(() => this.capri.perform('laugh'), 500);
    this.say(pick(this.t.lost), { hold: 4500, face: 'smug' });
  }

  // ---------- music (Spotify, its window title) ----------

  onWindows({ music, wink, typing, clip, paste }) {
    this.onWink(Boolean(wink));
    this.onTyping(Number(typing) || 0);
    this.onClip(clip, paste);
    const title = String(music || '');
    if (EDGE_SONGS.test(title) && title !== this.song) this.onWink(true, 'song');
    const playing = title.includes(' - ') && !/^spotify/i.test(title);
    if (playing !== this.playing) {
      this.playing = playing;
      this.voice.hushed = playing; // she keeps quiet while your music plays
      // she listens for the beat only while it plays
      if (playing) this.rhythm.start();
      else this.rhythm.stop();
    }
    if (!playing || title === this.song) return;
    this.song = title;
    const now = Date.now();
    if (now - this.lastSongTalk < 6 * 60000 || Math.random() > 0.5 || !this.free() || this.life.gaming) return;
    this.lastSongTalk = now;
    // Spotify's title is "Artist - Track"
    const cut = (s) => (s.length > 40 ? s.slice(0, 39) + '…' : s);
    const [artist, ...rest] = title.split(' - ');
    const track = cut(rest.join(' - ') || artist);
    const clock = new Date().toLocaleTimeString(this.lang, { hour: '2-digit', minute: '2-digit' });
    this.capri.perform('spin', this.capri.towardCenter());
    this.say(fmt(pick(this.t.music), { artist: cut(artist), track, clock }), { hold: 5000, face: 'grin' });
  }

  // ---------- a wink: Edgerunners or Cyberpunk in front of you ----------

  onWink(on, kind = 'title') {
    const was = this.winking;
    this.winking = on;
    if (!on || was) return;
    const now = Date.now();
    if (now - (this.lastWink || 0) < WINK_EVERY_MS) return;
    const c = this.capri;
    if (c.stowed || c.hidden || c.hiding || this.feud.active || c.mode === 'sleep' || c.nightSleep) return;
    this.lastWink = now;
    setTimeout(async () => {
      c.wake();
      this.panel.hide();
      // the show's own moment: her face big, her stars going up
      this.cutin('look');
      c.fx.vortex(c.head().x, c.head().y, { radius: 140, life: 500 });
      await sleep(700);
      this.say(pick(kind === 'song' ? this.t.winkSong : this.t.wink), { kind: 'done', hold: 5500, face: pick(['look', 'grin', 'calm']) });
      // now and then, the satellite with it (the Moon, for them)
      if (Math.random() < 0.5 && c.mode === 'idle') setTimeout(() => c.gaze({ big: true }), 3000);
    }, 1500);
  }

  // ---------- your typing rhythm (never the keys, see windows.ps1) ----------

  onTyping(level) {
    const now = Date.now();
    const c = this.capri;
    // typing hard: little glyphs fly off her, as when Claude works
    if (level >= 5 && now - (this.lastGlyph || 0) > 500 && this.free()) {
      this.lastGlyph = now;
      const h = c.head();
      c.fx.glyph(h.x + rand(-40, 40), h.y - 50 * c.scale);
    }
    // a fast burst held for 20 s: she cheers you on
    if (level >= 6) {
      this.fastSince = this.fastSince || now;
      if (now - this.fastSince > 20000 && now - (this.lastFast || 0) > 15 * 60000 && this.free()) {
        this.lastFast = now;
        this.fastSince = 0;
        c.perform('spin', c.towardCenter());
        for (let i = 0; i < 2; i++) setTimeout(() => c.spark(), i * 300);
        this.say(pick(this.t.typingFast), { hold: 3500, face: pick(['wide', 'grin']) });
      }
    } else {
      this.fastSince = 0;
    }
    // a long stretch of writing without a pause (a few seconds off don't break it)
    if (level >= 2) {
      this.writeSince = this.writeSince || now;
      this.writeSeen = now;
    } else if (this.writeSince && now - (this.writeSeen || 0) > 60000) {
      this.writeSince = 0;
    }
    const minutes = this.writeSince ? Math.floor((now - this.writeSince) / 60000) : 0;
    if (minutes >= 25 && now - (this.lastLong || 0) > 40 * 60000 && this.free()) {
      this.lastLong = now;
      this.writeSince = now;
      c.perform('curious', c.towardCenter());
      this.say(fmt(pick(this.t.typingLong), { m: minutes }), { hold: 5000, face: 'look' });
    }
  }

  groove() {
    const c = this.capri;
    // with her ears on (rhythm.js) she dances to the real beat instead
    if (this.rhythm.on || !this.playing || c.mode !== 'idle' || c.act || !this.free() || c.stance === 'peek') return;
    if (Math.random() < 0.7) c.perform(pick(['groove', 'groove', 'grooveArms', 'grooveBounce']));
  }

  // ---------- every 30 s: water breaks, pranks, hide-and-seek ----------

  onLife(evt) {
    if (evt.type === 'back' || evt.type === 'unlock' || evt.type === 'resume') this.sessionStart = Date.now();
  }

  tick() {
    const now = Date.now();
    if (now - this.sessionStart > WATER_EVERY_MS) {
      this.sessionStart = now;
      const line = fmt(pick(this.t.water), { h: `${Math.round(WATER_EVERY_MS / 60000)} min` });
      // hidden for a game or busy elsewhere: a Windows notification instead
      if (this.capri.stowed || this.capri.hidden) {
        try { new Notification('Capri', { body: line, silent: true }); } catch { /* notifications off */ }
      } else if (this.capri.mode !== 'sleep' && !this.capri.nightSleep) { // asleep: not now
        this.capri.wake();
        this.capri.perform('curious', this.capri.towardCenter());
        this.say(line, { kind: 'alert', hold: 7000, face: 'look' });
      }
    }
    const quiet = this.free() && !this.life.gaming && this.capri.mode !== 'sleep' && !this.feud.active;
    if (now > this.nextEvent && quiet) this.event();
    // her seat, a while after she's done with it
    const cr = this.crate;
    if (cr?.up && now - (cr.builtAt || now) > 6 * 60000 && !(this.capri.stance === 'sit' && this.capri.perch?.id === 'capri-crate') && quiet) cr.dismiss();
  }

  // One of her events, picked by weight; playful days (mood.js) bring them sooner.
  event() {
    if (this.capri.mode === 'sleep' || this.capri.nightSleep || this.capri.focus) return; // asleep, or focus mode: nothing happens
    const mood = this.mood;
    const lively = (mood.pranks + mood.sisters) / 2;
    this.nextEvent = Date.now() + rand(1.5, 2.8) * 60000 / lively; // about one every 2 min
    const sitting = this.capri.stance === 'sit';
    // with one every couple of minutes, the big ones (a prank, an invasion) stay the rarer ones
    const desk = Boolean(this.capri.windows.desk); // your desktop in front: your icons are visible
    const options = [
      ['prank', 5 * mood.pranks, () => this.prank()],
      ['hide', 3, () => this.hide()],
      ['sister', 12 * mood.sisters, () => this.sisters?.visit()],
      ['invasion', 2 * mood.sisters, () => this.sisters?.invasion()],
      ['chase', 9, () => this.chase?.start()],
      ['kick', sitting ? 8 * mood.pranks : 0, () => this.kickWindow()],
      ['prop', sitting ? 9 : 0, () => this.props?.place()],
      ['carry', desk && this.hands ? 22 : 0, () => this.hands.carry()],
      // a drawing with your icons, put back by herself a minute later (tidy.js)
      ['draw', desk && this.tidy && !this.tidy.working ? 12 : 0, () => this.tidy.doodle()],
      // everything maximized, nowhere to sit: she makes herself a seat (crate.js)
      ['crate', this.crate && !this.crate.up && !this.crate.resting && !this.crate.roomOnWindows() ? 14 : 0, () => this.crate.build()],
      ['crateFun', this.crate?.up ? 10 : 0, () => pick([() => this.crate.ride(), () => this.crate.ride(), () => this.crate.kick(), () => this.crate.push()])()],
      ['antic', this.antics ? 16 : 0, () => this.antics.pickOne() || this.antics.walk()],
    ].filter(([, w]) => w > 0);
    let r = Math.random() * options.reduce((n, [, w]) => n + w, 0);
    for (const [, w, run] of options) {
      r -= w;
      if (r <= 0) return run();
    }
  }

  // ---------- the fake hack ----------

  async prank() {
    const c = this.capri;
    if (c.stowed || c.hiding) return;
    const seat = c.pickSeat({ frontOnly: true });
    if (seat && c.possessWindows) {
      await c.sitOn(seat);
      await sleep(400);
    }
    const label = pick(this.t.hack);
    c.fx.lines(c.pos.x, c.pos.y - 140 * c.scale, { inner: 100, life: 600 });
    for (const pct of [12, 37, 64, 89, 100]) {
      this.panel.setTicker({ verb: label, target: `${pct}%` });
      c.spark();
      await sleep(550);
    }
    c.flash([[1, 0.13, 0.32], [0.21, 1, 0.48], [1, 0.13, 0.32]]);
    if (c.canPossess()) await c.possess();
    this.panel.setTicker(null);
    this.cutin('laugh');
    this.capri.perform('laugh');
    this.say(pick(this.t.hackDone), { hold: 5000, face: 'laugh' });
  }
}

function rand(a, b) {
  return a + Math.random() * (b - a);
}
