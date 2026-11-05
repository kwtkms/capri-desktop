// Asking her something (Ctrl+Alt+Q or her menu). A box opens at the bottom of the screen; she
// thinks it over through Claude (main/ask.js, one conversation of her own) and answers in her panel.

import { pick } from './util.js';
import { parse } from './commands.js';
import { modeOf, DRAWINGS } from './shapes.js';
import { INTENTS } from './mind-data.js';

const TEXT = {
  fr: {
    placeholder: 'Demande-moi n’importe quoi… (Échap pour fermer)',
    visionPlaceholder: 'Je regarde ton écran : qu’est-ce que je dois voir ? (Entrée = je commente)',
    visionDefault: 'Regarde mon écran : dis-moi ce que tu vois, et aide-moi si tu repères un problème.',
    looking: ['Je regarde…', 'Scan visuel en cours…', 'Mes yeux sont sur ton écran…'],
    thinking: ['Je réfléchis…', 'Je demande à Claude…', 'Tous mes moi se concertent…'],
    confirm: 'Tu veux que je fasse ça : {what} ?',
    yesNo: 'oui / non',
    taught: 'Appris : « {a} » veut dire « {b} ».',
    cantTeach: 'Je ne sais pas faire « {b} » toute seule, donc je ne peux pas l’apprendre.',
    unlearned: 'Oublié : « {a} ».',
    notLearned: 'Tu ne m’as jamais appris « {a} ».',
    learned: 'Ce que tu m’as appris :',
    noLearned: 'Tu ne m’as encore rien appris. Essaie : quand je dis dodo bit tu fais range ton chat.',
    answer: ['Alors :', 'Voilà :', 'Réponse :'],
    busy: 'Je réfléchis déjà à ta question précédente, choom.',
    auth: 'Je ne suis pas connectée à Claude. Ouvre un terminal, lance claude et connecte-toi (/login), puis redemande.',
    error: 'Raté, je n’ai pas pu répondre : {error}',
    launched: ['C’est parti : {what}.', 'J’ouvre {what}.', '{what}, à ton service.'],
    notFound: 'Je trouve pas « {what} » dans tes raccourcis. Essaie avec le nom exact de l’appli.',
    dropped: 'Ok, je touche à rien.',
    city: 'Bienvenue à Night City. Regarde bien le ciel.',
    noOther: 'J’ai qu’un écran sous la main, choom.',
    alreadyHere: 'Je suis déjà là, choom.',
    helpLine: 'Ce que je fais sans demander à Claude :',
    help: [
      '• range ton café / ta plante / Bit / ton siège / tes affaires',
      '• range mon bureau, range mes fenêtres, annule, garde le',
      '• dessine, mode artiste, montre ta ville',
      '• ouvre Spotify, tiens Discord, rends le',
      '• rappelle-moi dans 20 min…, retiens que…, oublie…',
      '• focus 25, chut, stop focus',
      '• va sur l’autre écran, reviens, cache-toi',
      '• bonne nuit, debout, cache-cache, fais une blague',
      '• calculs, conversions, dates, heure à Séoul, pile ou face',
      '• batterie, RAM, disque, musique, volume, capture, verrouiller',
      '• mes rappels, résume ma journée, minuteur 5 min',
      '• quand je dis X tu fais Y, non c’est pas ça',
      '• regarde mon écran (passe par Claude)',
      'Tout le reste, je le demande à Claude (« demande à claude… » pour forcer).',
    ].join('\n'),
  },
  en: {
    placeholder: 'Ask me anything… (Esc to close)',
    visionPlaceholder: 'Looking at your screen: what should I check? (Enter = I’ll comment)',
    visionDefault: 'Look at my screen: tell me what you see, and help if you spot a problem.',
    looking: ['Looking…', 'Visual scan running…', 'Eyes on your screen…'],
    thinking: ['Thinking…', 'Asking Claude…', 'All of me are conferring…'],
    confirm: 'Should I do this: {what}?',
    yesNo: 'yes / no',
    taught: 'Learned: “{a}” means “{b}”.',
    cantTeach: 'I can’t do “{b}” on my own, so I can’t learn it.',
    unlearned: 'Forgotten: “{a}”.',
    notLearned: 'You never taught me “{a}”.',
    learned: 'What you taught me:',
    noLearned: 'You haven’t taught me anything yet.',
    answer: ['So:', 'Here:', 'Answer:'],
    busy: 'Still thinking about your last question, choom.',
    auth: 'I’m not logged in to Claude. Open a terminal, run claude and log in (/login), then ask again.',
    error: 'Missed it, couldn’t answer: {error}',
    launched: ['Here we go: {what}.', 'Opening {what}.', '{what}, at your service.'],
    notFound: 'Can’t find “{what}” in your shortcuts. Try the app’s exact name.',
    dropped: 'Ok, not touching anything.',
    city: 'Welcome to Night City. Watch the sky.',
    noOther: 'I’ve only got one screen, choom.',
    alreadyHere: 'I’m right here, choom.',
    helpLine: 'What I do without asking Claude:',
    help: 'put away your coffee / plant / Bit / seat / things; tidy my desktop, my windows, undo; draw; open Spotify; remind me in 20 min…; focus 25; go to the other screen, come back; good night; look at my screen. Anything else, I ask Claude.',
  },
};

export class Ask {
  constructor({ form, capri, panel, host, life, lang = 'fr' }) {
    this.form = form;
    this.input = form.querySelector('input');
    this.capri = capri;
    this.panel = panel;
    this.host = host;
    this.life = life;
    this.lang = lang;
    this.thinking = false;

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submit();
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
    this.input.addEventListener('blur', () => setTimeout(() => this.visible && this.close(), 150));
  }

  get t() {
    return TEXT[this.lang] || TEXT.en;
  }

  get visible() {
    return !this.form.hidden;
  }

  contains(x, y) {
    if (!this.visible) return false;
    const r = this.form.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  open({ vision = false, remind = false } = {}) {
    this.capri.touch(); // talking to her: direct
    this.vision = vision;
    this.remind = remind;
    this.input.placeholder = remind && this.reminders ? this.reminders.t.placeholder : vision ? this.t.visionPlaceholder : this.t.placeholder;
    this.form.hidden = false;
    this.host.setKeyboard(true);
    this.capri.wake();
    this.capri.perform('curious', this.capri.towardCenter());
    setTimeout(() => this.input.focus(), 50);
  }

  close() {
    this.form.hidden = true;
    this.input.value = '';
    this.host.setKeyboard(false);
  }

  // what her own mind decided, when it isn't a command of hers or a question for Claude (mind.js)
  async answer(d, typed) {
    const t = this.t;
    const say = (line, reply) => this.panel.say({ kind: 'done', line, ...(reply ? { reply, hold: 15000 } : { hold: 6000 }), face: pick(['grin', 'smug', 'look']) });
    this.close();
    if (d.do === 'reply') say(pick(INTENTS[d.intent].replies[this.lang] || INTENTS[d.intent].replies.en));
    else if (d.do === 'skill') {
      const res = await this.skills.run(d.name, d.args);
      if (res?.reply) say(res.line, res.reply);
      else say(res);
    } else if (d.do === 'confirm') {
      this.panel.hide(); // a lesser panel doesn't replace an answer still showing, and this one must be read
      this.panel.say({ kind: 'done', line: t.confirm.replace('{what}', d.label), hold: 20000, face: 'look' });
      this.open();
      this.input.placeholder = t.yesNo;
    } else if (d.do === 'remember') this.facts?.remember(typed);
    else if (d.do === 'taught') say(t.taught.replace('{a}', d.phrase).replace('{b}', d.what));
    else if (d.do === 'unknownMacro') say(t.cantTeach.replace('{b}', d.what));
    else if (d.do === 'unlearned') say((d.ok ? t.unlearned : t.notLearned).replace('{a}', d.phrase));
    else if (d.do === 'learnedList') {
      if (d.list.length) say(t.learned, d.list.map((l) => `• ${l.text} → ${l.target.replace(/^say:/, '')}`).join('\n'));
      else say(t.noLearned);
    } else if (d.do === 'many') {
      for (const step of d.steps) {
        await this.submit(step.cmd);
        await new Promise((r) => setTimeout(r, 700));
      }
    } else return false;
    return true;
  }

  // preset: a command already understood (one step of several)
  async submit(preset = null) {
    const typed = this.input.value.trim();
    // her own mind first (mind.js): Claude only gets what isn't hers. Ctrl+Alt+R and Ctrl+Alt+V say what the text is for.
    const direct = this.remind || this.vision;
    const decision = preset ? { do: 'cmd', cmd: preset } : typed && !direct ? this.mind.understand(typed, { facts: this.facts?.list }) : null;
    this.host.diag(`mind: ${decision?.do || 'direct'} ${decision?.name || decision?.intent || decision?.cmd?.kind || ''}`);
    if (decision && !['cmd', 'claude'].includes(decision.do) && await this.answer(decision, typed)) return;
    const cmd = decision?.do === 'cmd' ? decision.cmd : null;
    // her things on the screen (props.js)
    if (cmd?.kind === 'props' && this.props) {
      this.close();
      this.panel.say({ kind: 'info', line: this.props.putAway(cmd.what), hold: 3000, face: 'smug' });
      return;
    }
    if (cmd?.kind === 'help') {
      this.close();
      this.panel.say({ kind: 'done', line: this.t.helpLine, reply: this.t.help, hold: null, face: 'grin' });
      return;
    }
    // where she is, and getting her out of the way
    if (cmd?.kind === 'aside' || cmd?.kind === 'comeBack') {
      this.close();
      const moved = await this.host.moveScreen(cmd.kind === 'aside' ? 'aside' : 'home').catch(() => false);
      // when it worked, she says so on arriving (life.relocate)
      if (!moved) this.panel.say({ kind: 'info', line: cmd.kind === 'aside' ? this.t.noOther : this.t.alreadyHere, hold: 3000, face: 'aside' });
      return;
    }
    if (cmd?.kind === 'stow') {
      this.close();
      this.host.moveScreen('stow'); // like Ctrl+Alt+C: that, or the tray, brings her back
      return;
    }
    if (cmd?.kind === 'hideSeek' || cmd?.kind === 'prank') {
      this.close();
      if (cmd.kind === 'hideSeek') this.play?.hide();
      else this.play?.prank();
      return;
    }
    // Ctrl+Alt+R, or "rappelle-moi …": a reminder
    if (this.reminders && (typed || cmd?.rest) && (this.remind || cmd?.kind === 'remind')) {
      this.remind = false;
      this.close();
      // "minuteur 5 min": the mind has already put it the way reminders read it
      const res = this.reminders.add(cmd?.rest && !parse(typed) ? cmd.rest : typed);
      if (res.ok) this.capri.perform('hop');
      this.panel.say({ kind: res.ok ? 'done' : 'info', line: res.line, hold: 5000, face: res.ok ? 'grin' : 'aside' });
      return;
    }
    this.remind = false;
    // what she keeps in mind about you (facts.js)
    if (this.facts && ['remember', 'forget', 'known'].includes(cmd?.kind)) {
      this.close();
      if (cmd.kind === 'remember') this.facts.remember(typed);
      else if (cmd.kind === 'forget') this.facts.forget(typed);
      else this.facts.show();
      return;
    }
    // focus mode (focus.js)
    if (this.focus && ['focus', 'focusStop', 'focusStatus'].includes(cmd?.kind)) {
      this.close();
      if (cmd.kind === 'focus') this.focus.start(cmd.minutes);
      else if (cmd.kind === 'focusStop') this.focus.stop();
      else this.focus.status();
      return;
    }
    // "bonne nuit": to bed now; "debout": up again
    if (cmd?.kind === 'sleep' || cmd?.kind === 'wakeUp') {
      this.close();
      if (cmd.kind === 'sleep') this.life.goToBed();
      else this.capri.touch();
      return;
    }
    if (cmd && this.tidy && ['desk', 'draw', 'windows', 'keep', 'undo'].includes(cmd.kind)) {
      this.close();
      // no way named: a surprise (tidy.surprise)
      if (cmd.kind === 'desk') this.tidy.arrange(modeOf(cmd.rest.replace(/\brange\b.*?\b(bureau|icones?|raccourcis)\b/, '')) || this.tidy.surprise());
      else if (cmd.kind === 'draw') {
        // artist mode: drawings only (a named one, or a surprise)
        const m = modeOf(cmd.rest);
        this.tidy.arrange(m && DRAWINGS.includes(m) ? m : this.tidy.surprise({ drawingsOnly: true }));
      }
      else if (cmd.kind === 'windows') this.tidy.arrangeWindows();
      else if (cmd.kind === 'keep') this.tidy.keepIt();
      else this.tidy.undo();
      return;
    }
    if (cmd?.kind === 'city' && this.decor) {
      this.close();
      this.decor.showcase(25000);
      this.capri.perform('spin', this.capri.towardCenter());
      this.panel.say({ kind: 'info', line: this.t.city, hold: 4000, face: 'grin' });
      return;
    }
    // "tiens discord": she takes that desktop icon and keeps it; "rends le": she puts it back
    if (this.hands && (cmd?.kind === 'give' || cmd?.kind === 'giveBack')) {
      this.close();
      const t = this.hands.t;
      if (cmd.kind === 'give') {
        const res = await this.hands.give(cmd.rest);
        if (!res.ok) this.panel.say({ kind: 'info', line: t.notGiven.replace('{what}', cmd.rest), hold: 4000, face: 'aside' });
      } else {
        const res = await this.hands.giveBack();
        if (!res.ok) this.panel.say({ kind: 'info', line: t.nothingHeld, hold: 3000, face: 'aside' });
      }
      return;
    }
    // "ouvre Spotify", "lance Cyberpunk", "ouvre mes téléchargements": she does it herself
    if (cmd?.kind === 'open') {
      this.close();
      // she goes and presses its button (hands.js), or just opens it
      const res = this.hands ? await this.hands.open(cmd.rest) : await this.host.launch(cmd.rest).catch(() => ({ ok: false }));
      if (res.ok) {
        this.capri.perform('hop');
        this.panel.say({ kind: 'done', line: pick(this.t.launched).replace('{what}', res.what), hold: 3000, face: 'grin' });
      } else {
        this.panel.say({ kind: 'info', line: this.t.notFound.replace('{what}', cmd.rest), hold: 5000, face: 'aside' });
      }
      return;
    }
    // Ctrl+Alt+V, or "regarde mon écran" typed in the box: she looks at the screen for this one
    const vision = this.vision || cmd?.kind === 'vision' || /regarde.*[ée]cran|look at (my|the) screen/i.test(typed);
    const question = (decision?.do === 'claude' && decision.question) || typed || (vision ? this.t.visionDefault : '');
    this.vision = false;
    this.close();
    if (!question) return;
    if (this.thinking) {
      this.panel.say({ kind: 'info', line: this.t.busy, hold: 4000 });
      return;
    }
    this.thinking = true;
    this.capri.setMode('work');
    const showThinking = () => {
      this.panel.setTicker({ verb: vision ? '◉' : '…', target: question.length > 60 ? question.slice(0, 59) + '…' : question });
      this.panel.say({ kind: 'work', line: pick(vision ? this.t.looking : this.t.thinking), quote: typed.slice(0, 140), hold: null });
    };
    // looking at your screen: nothing of hers over it while the capture is taken
    let shown = null;
    if (vision) {
      this.panel.hide();
      shown = setTimeout(showThinking, 1500);
      await new Promise((r) => setTimeout(r, 250));
    } else {
      showThinking();
    }
    let res;
    try {
      const context = [this.life.context(), this.props?.context(), this.facts?.context()].filter(Boolean).join('. ');
      res = await this.host.ask(question, context, vision);
    } catch (err) {
      res = { ok: false, error: err.message };
    }
    clearTimeout(shown);
    this.thinking = false;
    this.panel.setTicker(null);
    this.capri.setMode('idle');
    this.panel.hide();
    if (res.ok) {
      this.onAnswered?.();
      this.capri.perform('hop');
      this.panel.say({ kind: 'done', line: pick(this.t.answer), reply: res.text, hold: null, face: pick(['grin', 'smug', 'look']) });
    } else if (res.error === 'busy') {
      this.panel.say({ kind: 'info', line: this.t.busy, hold: 4000 });
    } else {
      this.capri.hurt();
      const line = res.auth ? this.t.auth : this.t.error.replace('{error}', String(res.error || '').slice(0, 160));
      this.panel.say({ kind: 'error', line, hold: 12000, face: 'wide' });
    }
  }
}
