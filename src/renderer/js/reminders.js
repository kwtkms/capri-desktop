// Reminders (Ctrl+Alt+R): "dans 20 min le linge", "à 18h30 appeler maman", "demain à 9h cours".
// Understood right here, no Claude involved; kept in her config so they survive a restart.
// When it's time she tells you, or Windows does if she's put away or you're in a game.

import { pick, fmt } from './util.js';
import { norm } from './commands.js';

const TEXT = {
  fr: {
    placeholder: 'Rappel : « dans 20 min le linge », « à 18h30 appeler Paul », « demain à 9h cours »',
    set: ['Noté. Je te le rappelle {when}.', 'C’est dans ma mémoire. {when}, promis.', 'Ok, {when}. Compte sur moi.'],
    huh: 'Je n’ai pas compris quand. Essaie « dans 20 min … » ou « à 18h30 … ».',
    ring: ['Hé ! Tu m’avais demandé : {what}', 'C’est l’heure, choom : {what}', 'Rappel ! {what}'],
    in: 'dans {m} min',
    at: 'à {hm}',
    tomorrow: 'demain à {hm}',
  },
  en: {
    placeholder: 'Reminder: “in 20 min laundry”, “at 6:30pm call Paul”, “tomorrow at 9 class”',
    set: ['Got it. I’ll remind you {when}.', 'Stored in my memory. {when}, promise.', 'Ok, {when}. Count on me.'],
    huh: 'I didn’t get when. Try “in 20 min …” or “at 18:30 …”.',
    ring: ['Hey! You asked me: {what}', 'It’s time, choom: {what}', 'Reminder! {what}'],
    in: 'in {m} min',
    at: 'at {hm}',
    tomorrow: 'tomorrow at {hm}',
  },
};

const hm = (d) => `${String(d.getHours()).padStart(2, '0')}h${String(d.getMinutes()).padStart(2, '0')}`;

// "dans 1h30 x", "dans 20 min x", "in 2 hours x", "à 18h30 x", "a 18:30 x", "demain à 9h x"
export function parseReminder(text, now = new Date()) {
  // typed any old way: no accents, SMS words ("ds 20mn", "rapel moi", "dmain 9h")
  let s = norm(text).replace(/^(rappelle moi|rappelle|remind me|reminder|fais moi penser|fait moi penser)\s*/, '');
  let at = null;
  let m = s.match(/^(?:dans|in)\s+(\d+)\s*(?:heures?|hours?|h)\s*(\d+)?\s*(?:min(?:utes?)?)?\s*/i);
  if (m) {
    at = new Date(now.getTime() + (Number(m[1]) * 60 + Number(m[2] || 0)) * 60000);
  } else if ((m = s.match(/^(?:dans|in)\s+(\d+)\s*(?:min(?:utes?)?|mn|m)\b\s*/i))) {
    at = new Date(now.getTime() + Number(m[1]) * 60000);
  } else if ((m = s.match(/^(demain\s+|tomorrow\s+)?(?:(?:a|at|vers)\s+)?(\d{1,2})\s*(?:h|:)\s*(\d{2})?\s*(am|pm)?\s*/i))) {
    let h = Number(m[2]);
    if (m[4]?.toLowerCase() === 'pm' && h < 12) h += 12;
    at = new Date(now);
    at.setHours(h, Number(m[3] || 0), 0, 0);
    if (m[1]) at.setDate(at.getDate() + 1);
    else if (at <= now) at.setDate(at.getDate() + 1); // that time has passed today: tomorrow
  }
  if (!at || h24Invalid(at)) return null;
  s = s.slice(m[0].length).replace(/^(de|d|que|qu|to|that)\s+/i, '')
    .replace(/^d(?=(appel|aller|envoy|ecri|achet|eteindr|arros|etudi|ouvr))/, '').trim(); // "dappeler" typed fast
  return { at: at.getTime(), what: s || '…' };
}

function h24Invalid(d) {
  return Number.isNaN(d.getTime());
}

export class Reminders {
  constructor({ capri, panel, host, voice, life, list = [], lang = 'fr' }) {
    Object.assign(this, { capri, panel, host, voice, life, lang });
    this.list = list.filter((r) => r && r.at > Date.now() - 6 * 3600000); // missed while off: kept a few hours
    setInterval(() => this.check(), 15000);
    setTimeout(() => this.check(), 5000);
  }

  get t() {
    return TEXT[this.lang] || TEXT.en;
  }

  save() {
    this.host.setConfig({ reminders: this.list });
  }

  // returns the line she says back
  add(text) {
    const r = parseReminder(text);
    if (!r) return { ok: false, line: this.t.huh };
    this.list.push(r);
    this.save();
    const d = new Date(r.at);
    const mins = Math.round((r.at - Date.now()) / 60000);
    const tomorrow = d.getDate() !== new Date().getDate();
    const when = mins < 90 ? fmt(this.t.in, { m: mins }) : fmt(tomorrow ? this.t.tomorrow : this.t.at, { hm: hm(d) });
    return { ok: true, line: fmt(pick(this.t.set), { when }) };
  }

  check() {
    const now = Date.now();
    const due = this.list.filter((r) => r.at <= now);
    if (!due.length) return;
    this.list = this.list.filter((r) => r.at > now);
    this.save();
    for (const r of due) this.ring(r);
  }

  ring(r) {
    const c = this.capri;
    const line = fmt(pick(this.t.ring), { what: r.what });
    // put away, or in a game: Windows says it for her
    if (c.stowed || c.hidden || this.life?.gaming) {
      try { new Notification('Capri', { body: line }); } catch { /* notifications off */ }
      // on your other screen, she can still say it there
      if (c.stowed || c.hidden || !this.life?.away) return;
    }
    c.wake();
    this.voice.play('alert');
    c.perform('alarm', c.towardCenter());
    const h = c.head();
    c.fx.ring(h.x, h.y - 40 * c.scale, { size: 1 });
    c.fx.lines(c.pos.x, c.pos.y - 140 * c.scale, { inner: 110, life: 600 });
    this.panel.say({ kind: 'alert', line, hold: 15000, face: 'wide' });
  }
}
