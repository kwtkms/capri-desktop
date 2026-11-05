// Her own mind: decides what a sentence means, on this PC, with no network and no model to
// download. It goes by resemblance (TF-IDF over words and letter groups, nearest sentence wins), so
// it copes with sentences nobody wrote down; it learns from your corrections; and it knows its
// limits. Sure: she acts. Unsure: she asks. Not hers: Claude gets it. She can't reason or invent an
// answer in here, and that's on purpose: everything she says comes from a skill, a fact or a line.

import { parse, norm, fixTypos } from './commands.js';
import { INTENTS, OTHER } from './mind-data.js';
import { calc, convert, timeIn, dateMath, recallFact, worthKeeping } from './skills.js';

const ACT = 0.52;      // this close to a sentence she knows: she does it
const ASK = 0.42;       // this close: she checks first
const MARGIN = 0.05;    // and only if the next best meaning is clearly behind
const LONG = 9;         // a long sentence is rarely an order: it has to be nearly exact
const LONG_ACT = 0.8;
const PENDING_MS = 2 * 60 * 1000;

const stem = (w) => (w.length > 4 ? w.replace(/(?:es|s|e|x)$/, '') : w);

function features(text) {
  const out = new Map();
  const add = (k, w) => out.set(k, (out.get(k) || 0) + w);
  const words = text.split(' ').filter(Boolean);
  words.forEach((w, i) => {
    add(`w:${stem(w)}`, 2);
    if (i) add(`b:${stem(words[i - 1])} ${stem(w)}`, 1.5);
    const padded = `_${w}_`;
    for (let k = 0; k + 3 <= padded.length; k++) add(`c:${padded.slice(k, k + 3)}`, 0.4);
  });
  return out;
}

export class Classifier {
  constructor() {
    this.docs = [];
    this.df = new Map();
  }

  add(text, label) {
    const f = features(text);
    for (const k of f.keys()) this.df.set(k, (this.df.get(k) || 0) + 1);
    this.docs.push({ text, label, f });
    this.vectors = null;
  }

  remove(text) {
    const gone = this.docs.filter((d) => d.text === text);
    if (!gone.length) return;
    this.docs = this.docs.filter((d) => d.text !== text);
    for (const d of gone) for (const k of d.f.keys()) this.df.set(k, this.df.get(k) - 1);
    this.vectors = null;
  }

  // a feature she has never met weighs the most: a sentence full of unknown words is far from everything
  idf(k) {
    return Math.log(1 + this.docs.length / (1 + (this.df.get(k) || 0)));
  }

  vector(f) {
    const v = new Map();
    let sum = 0;
    for (const [k, tf] of f) {
      const w = tf * this.idf(k);
      v.set(k, w);
      sum += w * w;
    }
    const len = Math.sqrt(sum) || 1;
    for (const [k, w] of v) v.set(k, w / len);
    return v;
  }

  // the best meaning, and the distance to the next one
  best(text) {
    this.vectors ??= this.docs.map((d) => ({ label: d.label, v: this.vector(d.f) }));
    const q = this.vector(features(text));
    const top = new Map();
    for (const d of this.vectors) {
      let s = 0;
      for (const [k, w] of q) s += w * (d.v.get(k) || 0);
      if (s > (top.get(d.label) || 0)) top.set(d.label, s);
    }
    const [first, second] = [...top.entries()].sort((a, b) => b[1] - a[1]);
    return first ? { label: first[0], score: first[1], margin: first[1] - (second?.[1] || 0) } : null;
  }
}

const YES = /^(oui|ouais|ouep|yes|yep|ok|okay|vas y|exact|c est ca|voila|dac|d accord|grave|carrement)( \S+)?$/;
const NO = /^(non|nope|no|nan|pas ca|laisse tomber|annule|bof)( \S+)?$/;
const WRONG = /^(non )?(c est pas ca|c est pas ce que je voulais|t as pas compris|tu as pas compris|tu t es trompee|pas ca|mauvaise reponse|that s wrong|wrong)$/;
const TEACH = /^\s*(?:quand je (?:dis|dit|tape|te dis)|si je (?:dis|dit|tape)|when i say)\s+[«"“]?(.+?)[»"”]?\s*(?:,|:|\s)\s*(?:ca veut dire|ca signifie|tu fais|fais|c est|it means|do)\s+[«"“]?(.+?)[»"”]?\s*$/i;
const FORGET_PHRASE = /^(?:oublie|desapprends|forget)\s+(?:la phrase|ce que je t ai appris sur|le raccourci|l expression)\s+(.+)$/;
const LEARNED = /^(?:qu est ce que|ce que|t as|tu as|c est quoi ce que)?\s*(?:je t ai appris|t as appris|tu as appris|ce que tu as appris|les phrases apprises|tes raccourcis)(?: quoi)?$/;
const FORCE_CLAUDE = /^\s*(?:capri[ ,]+)?(?:demande(?:r)?\s+[àa]\s+claude|claude\s*[:,]|ask claude)\s*:?\s*/i;
const CHOOSE = /^\s*(?:capri[ ,]+)?(?:choisis|choisi|tu choisis|tu prendrais quoi|pick|choose)(?:\s+(?:entre|pour moi|between))*\s*:?\s+(.+?)\s+(?:ou|et|or|and)\s+(.+?)\s*\??$/i;
const TIMER = /^(?:mets?|met|lance|mets moi|lance moi|fais)?\s*(?:un |une )?(?:minuteur|timer|chrono|compte a rebours|alarme)(?: de| pour| dans)?\s*(\d+\s*(?:h|min|s)?\s*\d*)/;
const WAKE_ME = /^(?:reveille moi|mets une alarme|mets moi une alarme|alarme|wake me)(?: up)?(?: a| at| pour| dans)?\s+(.+)$/;
const RAPPEL_NOUN = /^(?:mets|met|mets moi|fais|cree|ajoute)\s+(?:moi\s+)?(?:un\s+)?rappel\s+(.+)$/;
const SPLIT = /\s*(?:,\s*)?\b(?:et|puis|ensuite|apres|and then)\b\s+|\s*,\s+/i;

// A plain command, by her strict rules. A question mark makes it a question, except a polite order.
function strict(typed) {
  const parsed = parse(typed);
  return parsed && (parsed.asked || ['props', 'help'].includes(parsed.kind) || !/[?]\s*$/.test(typed)) ? parsed : null;
}

export class Mind {
  constructor({ learned = [], host } = {}) {
    this.host = host;
    this.learned = Array.isArray(learned) ? learned.filter((l) => l?.text && l.target) : [];
    this.net = new Classifier();
    for (const [name, intent] of Object.entries(INTENTS)) for (const s of intent.say) this.net.add(norm(s), name);
    for (const s of OTHER) this.net.add(norm(s), 'other');
    for (const l of this.learned) this.net.add(l.text, l.target);
    this.taught = new Set(this.learned.map((l) => l.text));
    this.pending = null;  // { typed, intent, at }: the question she just asked you
    this.last = null;     // { typed, at }: what she just handled herself, for "non c'est pas ça"
    this.lastValue = null;
  }

  save() {
    this.host?.setConfig({ mindLearned: this.learned }).catch?.(() => {});
  }

  learn(text, target) {
    this.net.remove(text);
    this.learned = this.learned.filter((l) => l.text !== text);
    this.learned.push({ text, target, at: Date.now() });
    this.taught.add(text);
    this.net.add(text, target);
    this.save();
  }

  unlearn(text) {
    const had = this.learned.some((l) => l.text === text);
    if (!had) return false;
    this.learned = this.learned.filter((l) => l.text !== text);
    this.taught.delete(text);
    this.net.remove(text);
    // back to what she knew before: a sentence from her own list may have been replaced
    for (const [name, intent] of Object.entries(INTENTS)) if (intent.say.some((s) => norm(s) === text)) this.net.add(text, name);
    if (OTHER.some((s) => norm(s) === text)) this.net.add(text, 'other');
    this.save();
    return true;
  }

  // What to do with a sentence. ctx.facts: what you asked her to remember.
  //   { do: 'cmd', cmd }                a command of hers
  //   { do: 'skill', name, args }       an answer or an action
  //   { do: 'reply', intent }           one of her lines
  //   { do: 'confirm', label }          she checks with you first
  //   { do: 'remember' }                keep this sentence as a fact
  //   { do: 'taught' | 'unlearned' | 'learnedList' | 'unknownMacro', ... }
  //   { do: 'many', steps }             several things in one sentence
  //   { do: 'claude', question, forced? }
  understand(typed, ctx = {}) {
    const raw = String(typed || '').trim();
    if (!raw) return { do: 'claude', question: '' };
    const decision = this.decide(raw, ctx);
    if (decision.do !== 'claude' && decision.do !== 'confirm') this.last = { typed: raw, at: Date.now() };
    return decision;
  }

  decide(raw, ctx) {
    const n = fixTypos(norm(raw));
    const now = Date.now();

    if (FORCE_CLAUDE.test(raw)) {
      const question = raw.replace(FORCE_CLAUDE, '').trim();
      if (question) return { do: 'claude', question, forced: true };
    }

    // she just asked you something
    const pending = this.pending && now - this.pending.at < PENDING_MS ? this.pending : null;
    this.pending = null;
    if (pending) {
      if (YES.test(n)) {
        this.learn(norm(pending.typed), pending.intent);
        return this.act(pending.intent, pending.typed);
      }
      if (NO.test(n)) {
        // "tu veux que je verrouille ?" "non": you meant it, just not now. Nothing to learn, nothing for Claude.
        if (INTENTS[pending.intent]?.risky) return { do: 'reply', intent: 'yesNo' };
        this.learn(norm(pending.typed), 'other');
        return { do: 'claude', question: pending.typed };
      }
    }

    // you tell her she got it wrong: she won't again, and Claude gets the sentence
    if (WRONG.test(n) && this.last && now - this.last.at < PENDING_MS) {
      const { typed } = this.last;
      this.last = null;
      this.learn(norm(typed), 'other');
      return { do: 'claude', question: typed, corrected: true };
    }

    // teaching her your words
    const taught = raw.match(TEACH) || norm(raw).match(TEACH);
    if (taught) {
      const phrase = norm(taught[1]);
      const target = this.resolve(taught[2]);
      if (!phrase || !target) return { do: 'unknownMacro', what: taught[2] };
      this.learn(phrase, target);
      return { do: 'taught', phrase: taught[1], what: taught[2] };
    }
    let m;
    if ((m = n.match(FORGET_PHRASE))) return { do: 'unlearned', ok: this.unlearn(norm(m[1])), phrase: m[1] };
    if (LEARNED.test(n)) return { do: 'learnedList', list: this.learned.filter((l) => l.target !== 'other') };

    // what you taught her comes first, word for word
    const own = this.learned.find((l) => l.text === norm(raw));
    if (own) {
      if (own.target === 'other') return { do: 'claude', question: raw };
      return this.act(own.target, raw);
    }

    const whole = strict(raw);
    // "rappelle-moi d'appeler Paul et de manger": the "et" belongs to the sentence
    if (whole && ['remind', 'remember', 'forget'].includes(whole.kind)) return { do: 'cmd', cmd: whole };
    const many = this.several(raw);
    if (many) return many;
    if (whole) return { do: 'cmd', cmd: whole };

    // what she can work out
    const value = calc(raw, this.lastValue);
    if (value) {
      if (value.value !== null) this.lastValue = value.value;
      return { do: 'skill', name: 'calc', args: { expr: raw.replace(/^\s*(?:calcule(?:\s+moi)?|combien\s+(?:ca\s+)?f(?:ait|ont)|ca fait combien|c'?est combien|combien)\s*:?\s*/i, '').replace(/[?=]+\s*$/, '').trim(), text: value.text } };
    }
    const converted = convert(raw);
    if (converted) return { do: 'skill', name: 'text', args: { text: converted } };
    const zone = timeIn(raw);
    if (zone) return { do: 'skill', name: 'timeIn', args: zone };
    const date = dateMath(raw);
    if (date) return { do: 'skill', name: 'text', args: { text: date } };
    if ((m = raw.match(CHOOSE))) return { do: 'skill', name: 'choose', args: { options: [m[1], m[2]] } };

    // reminders said another way
    if ((m = n.match(TIMER))) return { do: 'cmd', cmd: { kind: 'remind', rest: `dans ${/^\d+$/.test(m[1].trim()) ? `${m[1].trim()} min` : m[1].trim()} minuteur` } };
    if ((m = n.match(WAKE_ME)) && /\d/.test(m[1])) return { do: 'cmd', cmd: { kind: 'remind', rest: `${/^\d+ ?(h|min)/.test(m[1]) && /\bdans\b/.test(n) ? 'dans ' : ''}${m[1]} reveil` } };
    if ((m = n.match(RAPPEL_NOUN)) && /\d|demain/.test(m[1])) return { do: 'cmd', cmd: { kind: 'remind', rest: m[1] } };

    // what you told her
    if (worthKeeping(raw) && !/[?]\s*$/.test(raw)) return { do: 'remember' };
    const fact = recallFact(raw, ctx.facts);
    if (fact) return { do: 'skill', name: 'fact', args: { text: fact } };

    return this.guess(raw, n);
  }

  // by resemblance
  guess(raw, n) {
    const hit = this.net.best(n);
    if (!hit || hit.label === 'other') return { do: 'claude', question: raw };
    ctxLog?.(hit);
    const words = n.split(' ').length;
    const sure = hit.score >= (words > LONG ? LONG_ACT : ACT) && hit.margin >= MARGIN;
    const taught = this.taught.has(n);
    const intent = INTENTS[hit.label];
    if (sure && (taught || !intent?.risky)) return this.act(hit.label, raw);
    if (hit.score >= ASK && words <= LONG && (hit.margin >= MARGIN || intent?.risky) && intent) {
      this.pending = { typed: raw, intent: hit.label, at: Date.now() };
      return { do: 'confirm', label: intent.label };
    }
    return { do: 'claude', question: raw };
  }

  // the decision for a meaning: one of hers, or a sentence you taught her to replace by another
  act(target, typed) {
    if (target.startsWith('say:')) return this.decide(target.slice(4), {});
    const intent = INTENTS[target];
    if (!intent) return { do: 'claude', question: typed };
    if (intent.replies) return { do: 'reply', intent: target };
    if (intent.skill) return { do: 'skill', name: intent.skill, args: { ...intent.args, typed } };
    return { do: 'cmd', cmd: slots(intent.cmd, typed) };
  }

  // what a taught sentence should do: a sentence she handles herself, as you typed it
  resolve(raw) {
    const before = this.pending;
    const last = this.last;
    const d = this.decide(String(raw).trim(), {});
    this.pending = before;
    this.last = last;
    return ['cmd', 'skill', 'reply', 'many'].includes(d.do) ? `say:${String(raw).trim()}` : null;
  }

  // "range ton cafe et ouvre spotify", "ouvre spotify et discord", "range ton cafe et ta plante"
  several(raw) {
    if (!SPLIT.test(raw)) return null;
    const parts = raw.split(SPLIT).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2 || parts.length > 4) return null;
    const first = strict(parts[0]);
    if (!first) return null;
    const verb = norm(parts[0]).split(' ')[0];
    const steps = [];
    for (const part of parts) {
      let cmd = strict(part);
      // the verb is shared: "ta plante" after "range ton cafe", "discord" after "ouvre spotify"
      if (!cmd && (first.kind === 'props' || first.kind === 'open') && part.split(' ').length <= 3) cmd = strict(`${verb} ${part}`);
      if (!cmd) return null;
      steps.push({ do: 'cmd', cmd, typed: part });
    }
    return { do: 'many', steps };
  }
}

// Filled in for tests or the journal
let ctxLog = null;
export const logGuesses = (fn) => { ctxLog = fn; };

// the details a sentence gives: which of her things, how many minutes
const HERS = { cafe: 'coffee', tasse: 'coffee', plante: 'plant', chat: 'cat', bit: 'cat', siege: 'seat', planche: 'seat' };

function slots(cmd, typed) {
  const n = norm(typed);
  if (cmd.kind === 'props') {
    const word = n.split(' ').find((w) => HERS[w]);
    return { kind: 'props', what: word ? HERS[word] : null };
  }
  if (cmd.kind === 'focus' && cmd.minutes === 25) {
    const m = n.match(/(\d+) ?(min|h)?\b/);
    if (m) return { kind: 'focus', minutes: m[2] === 'h' ? Number(m[1]) * 60 : Number(m[1]) };
  }
  if ('rest' in cmd) return { ...cmd, rest: n };
  return cmd;
}
