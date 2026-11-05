// What you tell her to remember ("retiens que je pars en Corée en janvier"), kept on this PC
// in her config. She uses them when you ask her something (ask.js passes them to Claude with
// the question), tells you what she knows ("qu'est-ce que tu sais sur moi"), and forgets on
// demand ("oublie le truc sur la Corée", "oublie tout").

import { pick, fmt } from './util.js';
import { norm } from './commands.js';

const MAX = 60;

const TEXT = {
  fr: {
    saved: ['Noté : « {f} ».', 'C’est dans ma mémoire : « {f} ».', 'Retenu. « {f} »'],
    known: 'Ce que je sais sur toi :',
    empty: 'Tu m’as encore rien dit à retenir. Dis-moi « retiens que… ».',
    forgot: ['Oublié : « {f} ».', 'Pouf, effacé : « {f} ».'],
    forgotAll: 'J’ai tout oublié. Page blanche.',
    notFound: 'Je trouve rien qui ressemble à « {q} » dans ce que je sais.',
    full: 'Ma mémoire est pleine, j’ai oublié le plus vieux truc pour faire de la place.',
  },
  en: {
    saved: ['Noted: “{f}”.', 'It’s in my memory: “{f}”.', 'Got it. “{f}”'],
    known: 'What I know about you:',
    empty: 'You haven’t told me anything to remember yet. Say “remember that…”.',
    forgot: ['Forgotten: “{f}”.', 'Poof, erased: “{f}”.'],
    forgotAll: 'Forgot everything. Clean slate.',
    notFound: 'Nothing like “{q}” in what I know.',
    full: 'My memory is full, I dropped the oldest thing to make room.',
  },
};

export class Facts {
  constructor({ host, panel, capri, saved = [], lang = 'fr' }) {
    Object.assign(this, { host, panel, capri, lang });
    this.list = Array.isArray(saved) ? saved.filter((f) => f && typeof f.text === 'string') : [];
  }

  get t() {
    return TEXT[this.lang] || TEXT.en;
  }

  save() {
    this.host.setConfig({ facts: this.list }).catch(() => {});
  }

  say(line, face = 'grin', hold = 5000) {
    this.panel.say({ kind: 'done', line, hold, face });
  }

  // "retiens que X", "souviens toi que X", "n'oublie pas que X", "note que X": X, as you typed it
  remember(typed) {
    const text = String(typed).replace(/^\s*(retiens|retient|souviens[- ]toi|rappelle[- ]toi|n['’ ]?oublie pas|note|remember)( bien)?( que| qu['’]| de| :)?\s*/i, '').trim();
    if (!text) return this.show();
    let line = fmt(pick(this.t.saved), { f: text });
    if (this.list.length >= MAX) {
      this.list.shift();
      line += ` ${this.t.full}`;
    }
    this.list.push({ text, at: Date.now() });
    this.save();
    this.capri.perform('hop');
    this.say(line);
  }

  show() {
    if (!this.list.length) return this.say(this.t.empty, 'aside');
    const items = this.list.slice(-12).map((f) => `• ${f.text}`).join('\n');
    this.panel.say({ kind: 'done', line: this.t.known, reply: items, hold: 15000, face: 'smug' });
  }

  // "oublie tout" / "oublie <words>": the fact that shares the most words with what you typed
  forget(typed) {
    const q = norm(typed).replace(/^(oublie|forget)( ca| le truc| la chose| ce que je t ai dit)?( sur| a propos de| que| qu| about)?\s*/, '').trim();
    if (/^(tout|everything|all)$/.test(q)) {
      this.list = [];
      this.save();
      return this.say(this.t.forgotAll, 'aside');
    }
    const words = q.split(' ').filter((w) => w.length > 2);
    let best = -1, score = 0;
    this.list.forEach((f, i) => {
      const n = norm(f.text);
      const s = words.filter((w) => n.includes(w)).length;
      if (s > score) {
        score = s;
        best = i;
      }
    });
    if (best < 0) return this.say(fmt(this.t.notFound, { q: q || typed }), 'aside');
    const [gone] = this.list.splice(best, 1);
    this.save();
    this.say(fmt(pick(this.t.forgot), { f: gone.text }), 'aside');
  }

  // for her questions to Claude: what she knows about you, in a few lines
  context() {
    if (!this.list.length) return '';
    return `Ce que Mehdi m'a demandé de retenir : ${this.list.map((f) => f.text).join(' ; ')}`;
  }
}
