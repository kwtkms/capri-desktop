// What she remembers about you, kept on this PC only (her config): for each day, how long you
// were on each app, until when you were up, and whether you played. Days run 6 am to 6 am, so
// a late night counts with the evening before. She brings it up now and then:
// "Hier tu t'es couché à 3h", "2h40 de Cyberpunk hier", "trois jours de suite sur Roblox".

import { pick, fmt } from './util.js';

const KEEP_DAYS = 14;

const NAMES = {
  cyberpunk2077: 'Cyberpunk', robloxplayerbeta: 'Roblox', code: 'VS Code', chrome: 'Chrome', msedge: 'Edge',
  discord: 'Discord', spotify: 'Spotify', claude: 'Claude', 'league of legends': 'League of Legends', valorant: 'Valorant',
};
const GAMES = new Set(['cyberpunk2077', 'robloxplayerbeta', 'league of legends', 'valorant-win64-shipping', 'eldenring', 'witcher3', 'cs2', 'r5apex', 'minecraft.windows', 'javaw']);

const TEXT = {
  fr: {
    late: ['Hier tu t’es couché vers {h}. Ce soir on fait mieux ?', 'Couché à {h} hier… Les netrunners aussi dorment, tu sais.'],
    early: ['Hier t’as fini tôt, vers {h}. Bonne nuit de sommeil, ça.'],
    game: ['{t} de {game} hier. Ça avance ?', 'Hier : {t} sur {game}. T’as gagné au moins ?'],
    streak: ['{n} jours de suite sur {game}. Accro ?', '{game}, {n} jours d’affilée. Je note.'],
    top: ['Hier t’as passé {t} sur {app}.', 'Ton appli d’hier : {app}, {t}.'],
    today: ['Ça fait déjà {t} sur {app} aujourd’hui.'],
  },
  en: {
    late: ['You went to bed around {h} yesterday. Better tonight?', 'Bed at {h} yesterday… Netrunners sleep too, you know.'],
    early: ['You called it early yesterday, around {h}. Good night’s sleep.'],
    game: ['{t} of {game} yesterday. Making progress?', 'Yesterday: {t} on {game}. Did you at least win?'],
    streak: ['{n} days in a row on {game}. Hooked?', '{game}, {n} days straight. Noted.'],
    top: ['You spent {t} on {app} yesterday.', 'Yesterday’s app: {app}, {t}.'],
    today: ['Already {t} on {app} today.'],
  },
};

const dayKey = (d = new Date()) => {
  const x = new Date(d.getTime() - 6 * 3600000); // days start at 6 am
  return `${x.getFullYear()}-${x.getMonth() + 1}-${x.getDate()}`;
};
const hm = (ms) => {
  const d = new Date(ms);
  return `${d.getHours()}h${String(d.getMinutes()).padStart(2, '0')}`;
};
const span = (min) => (min >= 60 ? `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}` : `${min} min`);
const nice = (app) => NAMES[app] || (app ? app.charAt(0).toUpperCase() + app.slice(1) : '?');

export class Memory {
  constructor({ host, life, saved = {}, lang = 'fr' }) {
    Object.assign(this, { host, life, lang });
    this.days = saved && typeof saved === 'object' ? saved : {};
    this.paused = false; // screen locked, asleep
    setInterval(() => this.minute(), 60000);
    setInterval(() => this.save(), 5 * 60000);
  }

  get t() {
    return TEXT[this.lang] || TEXT.en;
  }

  onLife(evt) {
    if (evt.type === 'lock') this.paused = true;
    if (evt.type === 'unlock' || evt.type === 'resume' || evt.type === 'back') this.paused = false;
  }

  minute() {
    if (this.paused) return;
    const key = dayKey();
    const day = (this.days[key] ??= { apps: {}, last: 0, first: Date.now() });
    const app = this.life.app;
    if (app) day.apps[app] = (day.apps[app] || 0) + 1;
    day.last = Date.now();
  }

  save() {
    const keys = Object.keys(this.days).sort((a, b) => (this.days[b].first || 0) - (this.days[a].first || 0));
    for (const k of keys.slice(KEEP_DAYS)) delete this.days[k];
    this.host.setConfig({ memories: this.days });
  }

  yesterday() {
    return this.days[dayKey(new Date(Date.now() - 24 * 3600000))] || null;
  }

  // "résume ma journée": your top apps that day, or null when she noted nothing
  summary(yesterday = false) {
    const d = yesterday ? this.yesterday() : this.days[dayKey()];
    const top = Object.entries(d?.apps || {}).sort((a, b) => b[1] - a[1]).slice(0, 4);
    return top.length ? top.map(([app, min]) => `${nice(app)} ${span(min)}`).join(', ') : null;
  }

  // one thing she remembers, or null when there's nothing worth saying
  recall() {
    const y = this.yesterday();
    const lines = [];
    if (y?.last) {
      const h = new Date(y.last).getHours();
      if (h >= 0 && h < 6) lines.push(fmt(pick(this.t.late), { h: hm(y.last) }));
      else if (h < 22) lines.push(fmt(pick(this.t.early), { h: hm(y.last) }));
      const games = Object.entries(y.apps).filter(([a, m]) => GAMES.has(a) && m >= 20).sort((a, b) => b[1] - a[1]);
      if (games.length) {
        const [game, min] = games[0];
        const n = this.streak(game);
        if (n >= 3) lines.push(fmt(pick(this.t.streak), { n, game: nice(game) }));
        else lines.push(fmt(pick(this.t.game), { t: span(min), game: nice(game) }));
      }
      const top = Object.entries(y.apps).sort((a, b) => b[1] - a[1])[0];
      if (top && top[1] >= 45) lines.push(fmt(pick(this.t.top), { t: span(top[1]), app: nice(top[0]) }));
    }
    const today = this.days[dayKey()];
    const now = today && Object.entries(today.apps).sort((a, b) => b[1] - a[1])[0];
    if (now && now[1] >= 90) lines.push(fmt(pick(this.t.today), { t: span(now[1]), app: nice(now[0]) }));
    return lines.length ? pick(lines) : null;
  }

  // days in a row (up to yesterday) with at least 20 min of that game
  streak(game) {
    let n = 0;
    for (let i = 1; i <= KEEP_DAYS; i++) {
      const d = this.days[dayKey(new Date(Date.now() - i * 24 * 3600000))];
      if (!d || (d.apps[game] || 0) < 20) break;
      n++;
    }
    return n;
  }
}
