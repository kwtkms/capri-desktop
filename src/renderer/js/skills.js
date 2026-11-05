// What she can answer or do by herself, without any network: arithmetic, conversions, dates, the
// time elsewhere, your PC, your days. The functions at the top are pure (they return text, or null
// when the sentence isn't for them); the class at the bottom does what needs the PC.

import { pick, fmt } from './util.js';
import { norm } from './commands.js';

const num = (v) => {
  if (!Number.isFinite(v)) return null;
  const r = Number(v.toPrecision(12));
  return r.toLocaleString('fr-FR', { maximumFractionDigits: 6 });
};

// --- arithmetic, with a small parser (never eval) ------------------------------------------------

function tokens(src) {
  const out = [];
  const re = /\s*(\d+(?:[.,]\d+)?|sqrt|[-+*/^()%])/y;
  let i = 0;
  while (i < src.length) {
    if (!src.slice(i).trim()) break;
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m) return null;
    out.push(m[1]);
    i = re.lastIndex;
  }
  return out;
}

function evaluate(list) {
  let p = 0;
  const peek = () => list[p];
  const atom = () => {
    const t = list[p++];
    if (t === undefined) throw new Error('end');
    if (t === '(') {
      const v = sum();
      if (list[p++] !== ')') throw new Error('paren');
      return v;
    }
    if (t === 'sqrt') return Math.sqrt(unary());
    if (t === '-') return -unary();
    if (t === '+') return unary();
    if (/^\d/.test(t)) return Number(t.replace(',', '.'));
    throw new Error('token');
  };
  const post = () => {
    let v = atom();
    while (peek() === '%') { p++; v /= 100; }
    return v;
  };
  const unary = () => {
    const v = post();
    return peek() === '^' ? (p++, v ** unary()) : v;
  };
  const product = () => {
    let v = unary();
    while (peek() === '*' || peek() === '/') v = list[p++] === '*' ? v * unary() : v / unary();
    return v;
  };
  const sum = () => {
    let v = product();
    while (peek() === '+' || peek() === '-') v = list[p++] === '+' ? v + product() : v - product();
    return v;
  };
  const v = sum();
  if (p !== list.length) throw new Error('rest');
  return v;
}

// "combien fait 12 x 3", "15% de 240", "racine de 81", "2 puissance 10", "(3+4)*2".
// last: the previous result, for "et fois 2".
export function calc(typed, last = null) {
  let s = String(typed).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, ' ').replace(/[?!=]+\s*$/, '').trim();
  s = s.replace(/^(?:capri\s+)?(?:(?:dis moi|tu peux me dire|tu sais)\s+)?(?:calcule(?:\s+moi)?|combien (?:ca )?f(?:ait|ont)|ca fait combien|c est combien|combien|what is|how much is)\s*:?\s*/, '');
  const asked = s !== String(typed).toLowerCase().trim();
  const followUp = /^(?:et\s+)?(?:fois|divise par|plus|moins|[-+*/x])\s*\d/.test(s);
  s = s.replace(/^et\s+/, '')
    .replace(/(\d+(?:[.,]\d+)?)\s*(?:%|pour ?cent)\s+(?:de|of)\s+/g, '$1/100*')
    .replace(/pour ?cent/g, '%')
    .replace(/(?:la\s+)?racine(?:\s+carree)?\s+de\s+/g, 'sqrt ')
    .replace(/\s+au\s+carre\b/g, '^2').replace(/\s+au\s+cube\b/g, '^3')
    .replace(/\s*(?:puissance|exposant)\s*/g, '^')
    .replace(/\bfois\b/g, '*').replace(/(\d|\))\s*x\s*(?=[\d(])/g, '$1*').replace(/×/g, '*')
    .replace(/\bdivise par\b|÷/g, '/').replace(/(\d)\s+sur\s+(?=\d)/g, '$1/')
    .replace(/\bplus\b/g, '+').replace(/\bmoins\b/g, '-');
  if (followUp) {
    if (last === null) return null;
    s = `(${last})${/^[-+*/]/.test(s) ? '' : '*'}${s.replace(/^x\s*/, '*')}`;
  }
  const list = tokens(s);
  if (!list?.length) return null;
  const operators = list.filter((t) => /^(?:[-+*/^%]|sqrt)$/.test(t)).length;
  // a bare number, or "12-3" read as a date or a score when nobody asked for a sum, isn't a sum
  if (!operators || (!asked && !followUp && /^\d+\s*[-/]\s*\d+$/.test(s))) return null;
  try {
    const value = evaluate(list);
    if (!Number.isFinite(value)) return { value: null, text: null };
    return { value, text: num(value) };
  } catch {
    return null;
  }
}

// --- conversions ---------------------------------------------------------------------------------

const UNITS = {
  length: { km: 1000, kilometre: 1000, kilometres: 1000, m: 1, metre: 1, metres: 1, cm: 0.01, centimetre: 0.01, centimetres: 0.01, mm: 0.001, mile: 1609.344, miles: 1609.344, pied: 0.3048, pieds: 0.3048, feet: 0.3048, ft: 0.3048, pouce: 0.0254, pouces: 0.0254, inch: 0.0254, inches: 0.0254, yard: 0.9144, yards: 0.9144 },
  mass: { kg: 1000, kilo: 1000, kilos: 1000, g: 1, gramme: 1, grammes: 1, mg: 0.001, tonne: 1e6, tonnes: 1e6, livre: 453.59237, livres: 453.59237, lb: 453.59237, lbs: 453.59237, once: 28.349523, onces: 28.349523, oz: 28.349523 },
  data: { o: 1, octet: 1, octets: 1, ko: 1024, mo: 1024 ** 2, go: 1024 ** 3, to: 1024 ** 4, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4 },
  time: { s: 1, sec: 1, seconde: 1, secondes: 1, min: 60, minute: 60, minutes: 60, h: 3600, heure: 3600, heures: 3600, jour: 86400, jours: 86400, semaine: 604800, semaines: 604800, mois: 2629800, an: 31557600, ans: 31557600, annee: 31557600, annees: 31557600 },
  volume: { l: 1, litre: 1, litres: 1, cl: 0.01, ml: 0.001, gallon: 3.785411784, gallons: 3.785411784 },
};
const TEMP = { c: 'c', celsius: 'c', degre: 'c', degres: 'c', f: 'f', fahrenheit: 'f', k: 'k', kelvin: 'k' };

// "10 km en miles", "30 degres en fahrenheit", "combien de cm dans 3 pouces", "2 go en mo"
export function convert(typed) {
  const s = String(typed).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’'?]/g, ' ').replace(/°/g, ' ').trim()
    .replace(/^(?:convertis|convertir|converti|ca fait combien|combien font|combien fait|convert)\s+/, '');
  let m = s.match(/^(\d+(?:[.,]\d+)?)\s*([a-z]+)(?: de)?\s+(?:en|to|in|ca fait combien de)\s+([a-z]+)(?:\s+ca fait)?$/);
  let value, from, to;
  if (m) [, value, from, to] = m;
  else if ((m = s.match(/^combien (?:de |d )?([a-z]+) (?:dans|pour|font|fait|in) (\d+(?:[.,]\d+)?)\s*([a-z]+)$/))) [, to, value, from] = m;
  else return null;
  const v = Number(value.replace(',', '.'));
  if (TEMP[from] && TEMP[to]) {
    const c = TEMP[from] === 'c' ? v : TEMP[from] === 'f' ? (v - 32) * 5 / 9 : v - 273.15;
    const out = TEMP[to] === 'c' ? c : TEMP[to] === 'f' ? c * 9 / 5 + 32 : c + 273.15;
    return `${value} ${from} = ${num(out)} ${to}`;
  }
  for (const table of Object.values(UNITS)) {
    if (table[from] && table[to]) return `${value} ${from} = ${num(v * table[from] / table[to])} ${to}`;
  }
  return null;
}

// --- dates and time zones ------------------------------------------------------------------------

const ZONES = {
  coree: 'Asia/Seoul', seoul: 'Asia/Seoul', busan: 'Asia/Seoul', japon: 'Asia/Tokyo', tokyo: 'Asia/Tokyo', chine: 'Asia/Shanghai', pekin: 'Asia/Shanghai', shanghai: 'Asia/Shanghai',
  paris: 'Europe/Paris', france: 'Europe/Paris', londres: 'Europe/London', angleterre: 'Europe/London', madrid: 'Europe/Madrid', espagne: 'Europe/Madrid', rome: 'Europe/Rome', italie: 'Europe/Rome', berlin: 'Europe/Berlin', allemagne: 'Europe/Berlin', moscou: 'Europe/Moscow',
  'new york': 'America/New_York', 'los angeles': 'America/Los_Angeles', montreal: 'America/Toronto', canada: 'America/Toronto', dubai: 'Asia/Dubai', sydney: 'Australia/Sydney',
  alger: 'Africa/Algiers', algerie: 'Africa/Algiers', tunis: 'Africa/Tunis', tunisie: 'Africa/Tunis', maroc: 'Africa/Casablanca', casablanca: 'Africa/Casablanca',
};

// "il est quelle heure en coree", "heure a seoul"
export function timeIn(typed, now = new Date()) {
  const n = norm(typed);
  if (!/\bheure\b|\bh\b|what time/.test(n) || n.split(' ').length > 8) return null;
  const m = n.match(/\b(?:en|a|au|in|at)\s+(?:la\s+|l\s+)?([a-z]+(?: [a-z]+)?)\s*$/);
  const zone = m && ZONES[m[1]];
  if (!zone) return null;
  const clock = now.toLocaleTimeString('fr-FR', { timeZone: zone, hour: '2-digit', minute: '2-digit' });
  const day = now.toLocaleDateString('fr-FR', { timeZone: zone, weekday: 'long' });
  return { place: m[1].charAt(0).toUpperCase() + m[1].slice(1), clock: clock.replace(':', 'h'), day };
}

const MONTHS = { janvier: 0, fevrier: 1, mars: 2, avril: 3, mai: 4, juin: 5, juillet: 6, aout: 7, septembre: 8, octobre: 9, novembre: 10, decembre: 11 };
const NAMED = { noel: [11, 25], 'nouvel an': [0, 1], 'jour de l an': [0, 1], halloween: [9, 31], 'saint valentin': [1, 14], 'la saint valentin': [1, 14] };

function nextOf(month, day, now) {
  const d = new Date(now.getFullYear(), month, day);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (d < today) d.setFullYear(d.getFullYear() + 1);
  return d;
}

function parseDay(n, now) {
  const m = n.match(/\b(\d{1,2}|1er) (janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)(?: (\d{4}))?\b/);
  if (m) {
    const day = m[1] === '1er' ? 1 : Number(m[1]);
    const d = m[3] ? new Date(Number(m[3]), MONTHS[m[2]], day) : nextOf(MONTHS[m[2]], day, now);
    return d.getMonth() === MONTHS[m[2]] ? d : null; // not "31 fevrier"
  }
  const name = Object.keys(NAMED).find((k) => new RegExp(`\\b${k}\\b`).test(n));
  return name ? nextOf(...NAMED[name], now) : null;
}

const longDay = (d) => d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

// "dans combien de jours noel", "combien de jours avant le 15 janvier", "quel jour dans 3 semaines",
// "le 14 juillet c'est quel jour"
export function dateMath(typed, now = new Date()) {
  const n = norm(typed).replace(/\bl an\b/g, 'l an');
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let m;
  if (/\b(combien de jours?|dans combien|combien de temps|ca fait combien de jours|il reste combien)\b/.test(n)) {
    const d = parseDay(n, now);
    if (d) {
      const days = Math.round((d - today) / 86400000);
      return days === 0 ? `C’est aujourd’hui : ${longDay(d)}.` : days > 0 ? `Dans ${days} jour${days > 1 ? 's' : ''} : ${longDay(d)}.` : `C’était il y a ${-days} jour${days < -1 ? 's' : ''}.`;
    }
  }
  if (/\bquel jour\b|\bon sera\b|\bquelle date\b/.test(n) && (m = n.match(/\bdans (\d+) (jour|jours|semaine|semaines|mois|an|ans)\b/))) {
    const d = new Date(today);
    const k = Number(m[1]);
    if (m[2].startsWith('jour')) d.setDate(d.getDate() + k);
    else if (m[2].startsWith('semaine')) d.setDate(d.getDate() + k * 7);
    else if (m[2] === 'mois') d.setMonth(d.getMonth() + k);
    else d.setFullYear(d.getFullYear() + k);
    return `Dans ${k} ${m[2]} : ${longDay(d)}.`;
  }
  if (/\b(quel jour|c est quel jour|tombe)\b/.test(n)) {
    const d = parseDay(n, now);
    if (d) return `${longDay(d).charAt(0).toUpperCase()}${longDay(d).slice(1)}.`;
  }
  return null;
}

// --- what you told her ---------------------------------------------------------------------------

const STOP = new Set('je j me m moi mon ma mes tu t te toi ton ta tes il elle on nous vous ils le la les l un une des du de d au aux a et ou en dans sur pour par avec que qu qui quoi quel quelle quels quelles quand comment combien pourquoi est ce c ca sais dit dis dire deja t as ai as y ne pas sais-tu capri stp'.split(' '));
const stem = (w) => (w.length > 4 ? w.replace(/(?:es|s|e|x)$/, '') : w);
const content = (text) => norm(text).split(' ').filter((w) => w && !STOP.has(w)).map(stem);

// "je pars quand en coree" against what you asked her to remember: the fact itself, never a guess.
// Only about you ("je", "mon"...): "c'est quoi la capitale de la coree" isn't about your trip.
export function recallFact(typed, facts = []) {
  const n = norm(typed);
  if (!facts.length || !/\b(je|j|mon|ma|mes|m)\b/.test(n)) return null;
  if (!/\?\s*$/.test(typed) && !/\b(quand|quoi|ou|comment|combien|quel|quelle|qui|est ce que)\b/.test(n)) return null;
  const words = content(typed);
  if (!words.length) return null;
  let best = null;
  let score = 0;
  for (const f of facts) {
    const have = new Set(content(f.text));
    const s = words.filter((w) => have.has(w)).length / words.length;
    if (s > score) {
      score = s;
      best = f;
    }
  }
  return score >= 0.6 ? best.text : null;
}

// "je m'appelle kwtkms", "ma couleur préférée c'est le bleu": worth keeping, without being asked
export const worthKeeping = (typed) => /^\s*(je m['’ ]?appelle |mon (?:\S+ ){1,3}pr[ée]f[ée]r[ée] (?:c['’ ]?est|est) |ma (?:\S+ ){1,3}pr[ée]f[ée]r[ée]e (?:c['’ ]?est|est) |mes (?:\S+ ){1,3}pr[ée]f[ée]r[ée]s? (?:ce sont|sont) |mon anniversaire (?:c['’ ]?est|est) )/i.test(typed);

// --- the part that needs the PC ------------------------------------------------------------------

const TEXT = {
  fr: {
    time: ['Il est {t}.', '{t}, choom.'],
    date: ['On est {d}.'],
    timeIn: 'À {place}, il est {clock} ({day}).',
    noBattery: 'Je ne vois pas de batterie.',
    battery: 'Batterie à {p} %, {state}.',
    charging: 'sur secteur',
    draining: 'sur batterie',
    system: 'RAM : {used} Go utilisés sur {total} Go. Processeur : {cpu} %.',
    disk: 'Disque C : {free} Go libres sur {total} Go.',
    uptime: 'Ton PC tourne depuis {t}.',
    app: 'T’es sur {app}.',
    noApp: 'Je ne vois rien de spécial devant toi.',
    day: 'Aujourd’hui : {list}.',
    yesterday: 'Hier : {list}.',
    noDay: 'Je n’ai encore rien noté pour cette journée.',
    noReminder: 'Aucun rappel en attente.',
    reminders: 'Tes rappels :',
    cleared: ['{n} rappel(s) supprimé(s).'],
    keys: { play: 'Lecture/pause.', next: 'Morceau suivant.', prev: 'Morceau précédent.', volUp: 'Son monté.', volDown: 'Son baissé.', mute: 'Son coupé ou remis.', desktop: 'Voilà le bureau.' },
    lock: 'Je verrouille.',
    shot: 'Choisis la zone à capturer.',
    failed: 'Raté, je n’ai pas réussi à le faire.',
    coin: ['Pile.', 'Face.'],
    dice: 'Un {n}.',
    choose: ['{x}.', 'Je dirais {x}.', 'Va pour {x}.'],
    calc: '{e} = {r}',
    calcBad: 'Ce calcul n’a pas de résultat.',
    unknownFact: 'D’après ce que tu m’as dit : « {f} »',
  },
  en: {
    time: ['It’s {t}.'],
    date: ['It’s {d}.'],
    timeIn: 'In {place}, it’s {clock} ({day}).',
    noBattery: 'I don’t see a battery.',
    battery: 'Battery at {p}%, {state}.',
    charging: 'plugged in',
    draining: 'on battery',
    system: 'RAM: {used} GB used of {total} GB. CPU: {cpu}%.',
    disk: 'Disk C: {free} GB free of {total} GB.',
    uptime: 'Your PC has been up for {t}.',
    app: 'You’re on {app}.',
    noApp: 'Nothing special in front of you.',
    day: 'Today: {list}.',
    yesterday: 'Yesterday: {list}.',
    noDay: 'Nothing noted for that day yet.',
    noReminder: 'No reminders pending.',
    reminders: 'Your reminders:',
    cleared: ['{n} reminder(s) removed.'],
    keys: { play: 'Play/pause.', next: 'Next track.', prev: 'Previous track.', volUp: 'Volume up.', volDown: 'Volume down.', mute: 'Mute toggled.', desktop: 'Here’s the desktop.' },
    lock: 'Locking.',
    shot: 'Pick the area to capture.',
    failed: 'Missed, I couldn’t do that.',
    coin: ['Heads.', 'Tails.'],
    dice: 'A {n}.',
    choose: ['{x}.', 'I’d say {x}.'],
    calc: '{e} = {r}',
    calcBad: 'That sum has no result.',
    unknownFact: 'From what you told me: “{f}”',
  },
};

const span = (s) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor(s / 60) % 60;
  if (h >= 24) return `${Math.floor(h / 24)} j ${h % 24} h`;
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
};

export class Skills {
  constructor({ host, life, reminders, lang = 'fr' }) {
    Object.assign(this, { host, life, reminders, lang });
  }

  get t() {
    return TEXT[this.lang] || TEXT.en;
  }

  // what she says for that skill: a line, or { line, reply } when it needs a list
  async run(name, args = {}) {
    const t = this.t;
    const locale = this.lang === 'fr' ? 'fr-FR' : 'en-GB';
    switch (name) {
      case 'time':
        return fmt(pick(t.time), { t: new Date().toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }).replace(':', this.lang === 'fr' ? 'h' : ':') });
      case 'date':
        return fmt(pick(t.date), { d: new Date().toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) });
      case 'timeIn':
        return fmt(t.timeIn, args);
      case 'text':
        return args.text;
      case 'fact':
        return fmt(t.unknownFact, { f: args.text });
      case 'calc':
        return args.text === null ? t.calcBad : fmt(t.calc, { e: args.expr, r: args.text });
      case 'choose':
        return fmt(pick(t.choose), { x: pick(args.options) });
      case 'coin':
        return pick(t.coin);
      case 'dice':
        return fmt(t.dice, { n: 1 + Math.floor(Math.random() * 6) });
      case 'battery': {
        const b = await navigator.getBattery?.().catch(() => null);
        if (!b || (b.charging && b.level === 1 && b.chargingTime === 0 && !b.dischargingTime)) return t.noBattery;
        return fmt(t.battery, { p: Math.round(b.level * 100), state: b.charging ? t.charging : t.draining });
      }
      case 'system': {
        const s = await this.host.pcInfo();
        return fmt(t.system, { used: s.ramUsed, total: s.ramTotal, cpu: s.cpu });
      }
      case 'disk': {
        const s = await this.host.pcInfo();
        return s.diskFree === null ? t.failed : fmt(t.disk, { free: s.diskFree, total: s.diskTotal });
      }
      case 'uptime': {
        const s = await this.host.pcInfo();
        return fmt(t.uptime, { t: span(s.uptime) });
      }
      case 'whatApp':
        return this.life.app ? fmt(t.app, { app: this.life.app }) : t.noApp;
      case 'myDay': {
        const yesterday = /\b(hier|yesterday)\b/.test(norm(args.typed || ''));
        const line = this.memory?.summary(yesterday);
        return line ? fmt(yesterday ? t.yesterday : t.day, { list: line }) : t.noDay;
      }
      case 'remindersList': {
        const list = this.reminders.list.slice().sort((a, b) => a.at - b.at);
        if (!list.length) return t.noReminder;
        return { line: t.reminders, reply: list.map((r) => `• ${new Date(r.at).toLocaleString(locale, { weekday: 'short', hour: '2-digit', minute: '2-digit' })} : ${r.what}`).join('\n') };
      }
      case 'remindersClear': {
        const n = this.reminders.list.length;
        if (!n) return t.noReminder;
        this.reminders.list = [];
        this.reminders.save();
        return fmt(pick(t.cleared), { n });
      }
      case 'key':
        return (await this.host.pressKey(args.key).catch(() => false)) ? t.keys[args.key] : t.failed;
      case 'lock':
        return (await this.host.lockPc().catch(() => false)) ? t.lock : t.failed;
      case 'shot':
        return (await this.host.screenClip().catch(() => false)) ? t.shot : t.failed;
      default:
        return t.failed;
    }
  }
}
