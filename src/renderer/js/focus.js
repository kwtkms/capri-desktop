// "Concentre-moi 25 min": focus mode. She goes and sits somewhere, stays quiet (no events, no
// remarks, no pranks), and only speaks up if you drift to something distracting (Discord, a
// video, a launcher), once in a while and kindly. At the end: well done, and a break.
// Everything is local; nothing is counted but the minutes.

import { pick, fmt } from './util.js';

const DISTRACTING = new Set(['discord', 'video', 'launcher', 'chat']);
const NUDGE_EVERY_MS = 5 * 60 * 1000;

const TEXT = {
  fr: {
    start: ['Ok, {m} min de focus. Je me fais toute petite.', 'Mode focus : {m} min. Je bouge plus, promis.', 'C’est parti pour {m} min. Je te laisse bosser.'],
    nudge: ['Hé… t’es en focus, là.', 'Psst, encore {left} min de focus.', 'On avait dit focus, non ?'],
    done: ['{m} min de focus, bien joué ! Pause : lève-toi, bois un coup.', 'Fini ! {m} min propres. Va t’étirer un peu.', 'Et voilà {m} min de boulot. T’as mérité ta pause.'],
    stop: ['Focus arrêté. {m} min quand même, c’est pas rien.', 'Ok, on arrête là. {m} min de faites.'],
    none: 'Y’a pas de focus en cours.',
    left: 'Encore {left} min de focus.',
  },
  en: {
    start: ['Ok, {m} min of focus. I’ll keep quiet.', 'Focus mode: {m} min. Not moving, promise.', 'Here we go, {m} min. Get to work.'],
    nudge: ['Hey… you’re in focus mode.', 'Psst, {left} min of focus left.', 'We said focus, right?'],
    done: ['{m} min of focus, well done! Break: stand up, drink something.', 'Done! {m} clean minutes. Go stretch a bit.', 'That’s {m} min of work. You earned a break.'],
    stop: ['Focus stopped. {m} min still counts.', 'Ok, stopping there. {m} min done.'],
    none: 'No focus running.',
    left: '{left} min of focus left.',
  },
};

export class Focus {
  constructor({ capri, panel, life, lang = 'fr' }) {
    Object.assign(this, { capri, panel, life, lang });
    this.until = 0;
    this.started = 0;
    this.minutes = 0;
    this.lastNudge = 0;
    this.timer = null;
    setInterval(() => this.watch(), 15000);
  }

  get t() {
    return TEXT[this.lang] || TEXT.en;
  }

  get on() {
    return this.until > Date.now();
  }

  get left() {
    return Math.max(1, Math.ceil((this.until - Date.now()) / 60000));
  }

  say(line, face = 'calm', hold = 4000) {
    this.panel.say({ kind: 'info', line, hold, face, focusLine: true });
  }

  start(minutes = 25) {
    const m = Math.max(1, Math.min(180, Math.round(minutes)));
    clearTimeout(this.timer);
    this.minutes = m;
    this.started = Date.now();
    this.until = this.started + m * 60000;
    this.lastNudge = Date.now();
    this.capri.focus = true;
    this.capri.perform('crossArms', this.capri.towardCenter());
    this.say(fmt(pick(this.t.start), { m }), 'smug');
    setTimeout(() => this.onSit?.(), 1800); // she goes and sits somewhere (antics.sitSomewhere)
    this.timer = setTimeout(() => this.done(), m * 60000);
  }

  stop() {
    if (!this.on) return this.say(this.t.none, 'aside', 2500);
    const m = Math.max(1, Math.round((Date.now() - this.started) / 60000));
    this.end();
    this.say(fmt(pick(this.t.stop), { m }), 'aside');
  }

  status() {
    this.say(this.on ? fmt(this.t.left, { left: this.left }) : this.t.none, 'calm', 2500);
  }

  end() {
    clearTimeout(this.timer);
    this.until = 0;
    this.capri.focus = false;
  }

  done() {
    const m = this.minutes;
    this.end();
    this.capri.wake();
    this.capri.celebrate?.();
    this.say(fmt(pick(this.t.done), { m }), 'grin', 7000);
    this.onDone?.(m);
  }

  // drifting to something distracting: a kind word, not more than every 5 min
  watch() {
    if (!this.on || Date.now() - this.lastNudge < NUDGE_EVERY_MS) return;
    if (!DISTRACTING.has(this.life.kind) && !this.life.gaming) return;
    this.lastNudge = Date.now();
    this.capri.perform('glance', this.capri.towardCenter());
    this.say(fmt(pick(this.t.nudge), { left: this.left }), 'look', 3500);
  }
}
