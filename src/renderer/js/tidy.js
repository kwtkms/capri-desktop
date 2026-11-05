// "Range mon bureau": she lays your desktop icons out, straight away: by theme in columns (games,
// internet & apps, school & dev, projects, the rest), by name, or as a drawing (a circle, a
// spiral, a wave, a smiley, CAPRI written in icons... shapes.js). Now and then she draws one on
// her own and puts everything back a minute later, unless you say "garde le".
// "Range mes fenêtres": she arranges the windows on her screen side by side, pushing each one
// into place. "Annule": the last one of the two is undone, exactly as it was before.
// Nothing here goes through Claude; no file is moved, only icons and windows.

import { pick, sleep, clamp } from './util.js';
import { layout, DRAWINGS, TIDY } from './shapes.js';

// themes, in the order of the columns; first match wins
const THEMES = [
  { key: 'system', fr: 'système', en: 'system', match: /^(corbeille|recycle bin|ce pc|this pc)$/ },
  { key: 'games', fr: 'jeux', en: 'games', match: /cyberpunk|final fantasy|among us|steam|epic games|rockstar|league of legends|riot|valorant|roblox|geoguessr|hollow knight|omori|marvel|spider-man|melonds|overwolf|curseforge|ubisoft|geforce now|battle\.net|minecraft|fortnite|elden|witcher|gog|ea app|xbox|medal/ },
  { key: 'web', fr: 'internet & applis', en: 'web & apps', match: /chrome|edge|firefox|opera|brave|youtube|tiktok|discord|whatsapp|telegram|gemini|google|drive|canva|proton|vpn|spotify|netflix|wallpaper engine|nvidia app|nvidia broadcast|voicemod|tecware|obs|notion/ },
  { key: 'dev', fr: 'cours & dev', en: 'school & dev', match: /stm32|ide|sql|oracle|virtualbox|cisco|packet tracer|scilab|github|copilot|autodesk|fusion|visual studio|vs code|code|matlab|eclipse|intellij|pycharm|android studio|unity|blender|arduino|putty|wireshark/ },
  { key: 'projects', fr: 'projets', en: 'projects', match: /projet|project|prospection|cine-idf|cine idf|abonnements|hakuapp|celestial|mbdev/ },
];
const OTHER = { key: 'other', fr: 'le reste', en: 'the rest' };

const TEXT = {
  fr: {
    nothing: 'Je vois pas tes icônes, là. Affiche ton bureau et redemande.',
    going: ['C’est parti, opération rangement.', 'Rangement en cours. Touche à rien.'],
    done: ['Voilà, rangé. « annule » si tu préfères avant.', 'Bureau rangé ! Pas mal, hein ?'],
    styles: {
      themes: 'Rangé par thème : une colonne par famille, à gauche.',
      alpha: 'Rangé par ordre alphabétique, de A à Z.',
      zones: 'Rangé par zones : chaque thème dans son coin de l’écran.',
      rows: 'Rangé en lignes : une ligne par thème, de haut en bas.',
      center: 'Tout regroupé au centre, bien compact.',
      right: 'Rangé par thème, côté droit cette fois.',
    },
    after: ' « annule » si tu préférais avant.',
    drawing: ['Je te fais un dessin avec tes icônes.', 'Mode artiste activé.'],
    drawn: ['Tadaa. Œuvre d’art. « annule » pour revenir.', 'Exposé au musée du bureau.'],
    doodle: ['J’ai une idée…', 'Petit dessin, deux secondes.'],
    doodleDone: ['Joli, non ? Je remets tout dans une minute. « garde le » si tu veux le garder.', 'Art éphémère. Dans une minute je range.'],
    kept: ['Ok, on le garde !', 'Il reste. Je suis flattée.'],
    noWins: 'Je trouve pas de fenêtres à ranger sur cet écran.',
    winsGoing: ['Je range tes fenêtres.', 'Hop, tout le monde à sa place.'],
    winsDone: ['Fenêtres rangées. « annule » pour remettre comme avant.', 'Et voilà, plus de bazar.'],
    undone: ['C’est remis comme avant.', 'Annulé, tout est à sa place d’origine.'],
    noUndo: 'Il n’y a rien à annuler.',
    failed: 'J’ai pas réussi à ranger proprement, alors j’ai tout remis comme avant.',
  },
  en: {
    nothing: 'I can’t see your icons right now. Show your desktop and ask again.',
    going: ['Here we go, tidying up.', 'Tidying. Don’t touch anything.'],
    done: ['Done, tidied. “undo” if you liked it better before.', 'Desk tidied! Not bad, right?'],
    styles: {
      themes: 'Tidied by theme: a column per family, on the left.',
      alpha: 'Tidied alphabetically, A to Z.',
      zones: 'Tidied in zones: each theme in its own corner.',
      rows: 'Tidied in rows: a row per theme, top down.',
      center: 'All gathered in the middle, nice and compact.',
      right: 'Tidied by theme, on the right this time.',
    },
    after: ' “undo” if you liked it better before.',
    drawing: ['Making you a drawing with your icons.', 'Artist mode on.'],
    drawn: ['Tadaa. Art. “undo” to go back.', 'On display at the desk museum.'],
    doodle: ['I have an idea…', 'Little drawing, one sec.'],
    doodleDone: ['Nice, right? I’ll tidy it back in a minute. “keep it” to keep it.', 'Ephemeral art. Back in a minute.'],
    kept: ['Ok, we keep it!', 'It stays. I’m flattered.'],
    noWins: 'No windows to arrange on this screen.',
    winsGoing: ['Arranging your windows.', 'Everybody to their spot.'],
    winsDone: ['Windows arranged. “undo” to put them back.', 'There, no more mess.'],
    undone: ['Back the way it was.', 'Undone, everything’s where it was.'],
    noUndo: 'Nothing to undo.',
    failed: 'Couldn’t lay it out cleanly, so I put everything back as it was.',
  },
};

export function themeOf(name) {
  const n = String(name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return THEMES.find((t) => t.match.test(n)) || OTHER;
}

export class Tidy {
  constructor({ capri, panel, voice, host, hands, lang = 'fr' }) {
    Object.assign(this, { capri, panel, voice, host, hands, lang });
    this.lastDone = null; // 'desk' | 'windows': what "annule" undoes
    this.working = false;
  }

  get t() {
    return TEXT[this.lang] || TEXT.en;
  }

  say(line, kind = 'info', hold = 5000, face = 'grin') {
    this.panel.say({ kind, line, hold, face });
  }

  // ---- your desktop ----

  // your icons grouped by theme, in the themes' order, each sorted by name
  groups(icons) {
    const groups = new Map();
    for (const icon of icons) {
      const th = themeOf(icon.name);
      if (!groups.has(th.key)) groups.set(th.key, { theme: th, icons: [] });
      groups.get(th.key).icons.push(icon);
    }
    for (const g of groups.values()) g.icons.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    return [...THEMES, OTHER].map((t) => groups.get(t.key)).filter(Boolean);
  }

  // the cells for each icon: a real tidying (by theme, by name, in zones, in rows, compact in the
  // middle, on the right), or a drawing (shapes.js)
  cells(mode, icons, cols, rows) {
    const groups = this.groups(icons);
    if (mode === 'right') {
      // the theme columns, against the right edge instead of the left
      return this.cells('themes', icons, cols, rows).map((c) => ({ ...c, col: cols - 1 - c.col }));
    }
    if (mode === 'rows') {
      // a row per theme (or more), left to right, top down
      const cells = [];
      let row = 0, col = 0;
      for (const [k, g] of groups.entries()) {
        if (k > 0 && col !== 0) {
          row += 1;
          col = 0;
        }
        for (const icon of g.icons) {
          if (col >= cols) {
            row += 1;
            col = 0;
          }
          cells.push({ name: icon.name, col, row: Math.min(row, rows - 1) });
          col += 1;
        }
      }
      return cells;
    }
    if (mode === 'zones') {
      // each theme in its own corner of the screen: games top left, the next top right, then
      // bottom left, bottom right, the rest in the middle
      const cells = [];
      const used = new Set();
      // the bin keeps the top left corner to itself
      const sys = groups.find((g) => g.theme.key === 'system');
      for (const icon of sys?.icons || []) {
        cells.push({ name: icon.name, col: 0, row: used.size });
        used.add(`0,${used.size}`);
      }
      const zoned = groups.filter((g) => g.theme.key !== 'system');
      const zx = zoned.length > 4 ? 3 : 2, zy = 2;
      const zw = Math.floor(cols / zx), zh = Math.floor(rows / zy);
      const order = zx === 3 ? [[0, 0], [2, 0], [0, 1], [2, 1], [1, 0], [1, 1]] : [[0, 0], [1, 0], [0, 1], [1, 1]];
      zoned.forEach((g, k) => {
        const [gx, gy] = order[k % order.length];
        const left = gx * zw + (gx === zx - 1 ? cols - zx * zw : 0), top = gy * zh + (gy === zy - 1 ? rows - zy * zh : 0);
        let i = 0;
        for (const icon of g.icons) {
          // column by column inside its zone; a full zone spills into the next free cell
          let col, row;
          do {
            // zones on the right side fill from the right edge inward, so they sit against it
            col = gx === zx - 1 ? cols - 1 - Math.floor(i / zh) : left + Math.floor(i / zh);
            row = top + (i % zh);
            i += 1;
          } while (used.has(`${col},${row}`) && i < cols * rows);
          if (col >= cols) {
            // no room left in its corner: the first free cell anywhere
            outer: for (let c2 = 0; c2 < cols; c2++) for (let r2 = 0; r2 < rows; r2++) if (!used.has(`${c2},${r2}`)) { col = c2; row = r2; break outer; }
          }
          used.add(`${col},${row}`);
          cells.push({ name: icon.name, col, row });
        }
      });
      return cells;
    }
    if (mode === 'center') {
      // a compact block in the middle of the screen, theme after theme
      const n = icons.length;
      const h = Math.min(rows, Math.max(3, Math.round(Math.sqrt(n / 1.8))));
      const w = Math.ceil(n / h);
      const left = Math.max(0, Math.floor((cols - w) / 2)), top = Math.max(0, Math.floor((rows - h) / 2));
      return groups.flatMap((g) => g.icons).map((icon, k) => ({ name: icon.name, col: left + Math.floor(k / h), row: top + (k % h) }));
    }
    if (mode === 'themes') {
      const plan = this.groups(icons);
      const cells = [];
      let col = 0, row = 0;
      for (const [k, group] of plan.entries()) {
        // every theme starts a new column, except the one right after the bin (it goes under it)
        const underBin = k === 1 && plan[0].theme.key === 'system';
        if (row !== 0 && !underBin) {
          col += 1;
          row = 0;
        }
        for (const icon of group.icons) {
          if (row >= rows) {
            col += 1;
            row = 0;
          }
          cells.push({ name: icon.name, col, row });
          row += 1;
        }
      }
      return cells;
    }
    // alphabetical, or a drawing: themes stay together along the drawing, so it reads in colours
    const ordered = mode === 'alpha'
      ? [...icons].sort((a, b) => a.name.localeCompare(b.name, 'fr'))
      : this.groups(icons).flatMap((g) => g.icons);
    const spots = layout(mode, ordered.length, cols, rows);
    return ordered.map((icon, k) => ({ name: icon.name, ...spots[k] }));
  }

  // "range mon bureau [en cercle / par thème / écris capri…]": she does it, straight away.
  // temporary: one of her own drawings (an event), she puts it all back by herself after a bit.
  async arrange(mode = 'themes', { temporary = false } = {}) {
    if (this.working) return false;
    // you asked for something: her own drawing's put-back-in-a-minute no longer applies
    if (!temporary) clearTimeout(this.revertTimer);
    // one of your icons in her hands: back where it was first (or, for her own drawings, not now)
    if (this.hands?.carrying) return false;
    if (this.hands?.holding) {
      if (temporary) return false;
      await this.hands.giveBack({ quiet: true });
    }
    // all of them, on the main screen, even when she's on your other screen
    const icons = await this.host.deskIcons(true).catch(() => []);
    if (!icons.length) {
      if (!temporary) this.say(this.t.nothing, 'info', 5000, 'aside');
      return false;
    }
    this.working = true;
    const c = this.capri;
    try {
      const drawing = DRAWINGS.includes(mode);
      this.say(pick(drawing ? (temporary ? this.t.doodle : this.t.drawing) : this.t.going), 'work', 3000);
      const start = await this.host.tidyStart(temporary);
      if (!start.ok) return false;
      const cells = this.cells(mode, icons, start.cols, start.rows);
      // she zaps away while it's being laid out
      const h0 = c.head();
      const spark = setInterval(() => {
        const h = c.head();
        c.fx.bolt({ x: h.x, y: h.y - 30 * c.scale }, { x: h0.x + (Math.random() - 0.5) * 600, y: Math.random() * c.view.h * 0.8 }, { life: 160, forks: 1, width: 2 });
      }, 260);
      c.perform('alarm', -1);
      const res = await this.host.tidyApply(cells).catch(() => ({ ok: false }));
      clearInterval(spark);
      if (!res.ok) {
        this.say(this.t.failed, 'error', 6000, 'wide');
        return false;
      }
      // then a little spark on each icon, in the order she laid them out
      for (const at of res.at) {
        c.fx.ring(at.x + 38, at.y + 38, { size: 0.3 });
        await sleep(25);
      }
      this.lastDone = 'desk';
      c.perform('laugh');
      if (temporary) {
        this.say(pick(this.t.doodleDone), 'done', 6000, 'laugh');
        // she puts it back by herself, unless you said to keep it
        this.keep = false;
        clearTimeout(this.revertTimer);
        this.revertTimer = setTimeout(() => {
          if (!this.keep && this.lastDone === 'desk') this.undo({ quiet: false });
        }, this.revertAfter || 70000);
      } else {
        // a tidying: she says which way she did it
        const line = drawing ? pick(this.t.drawn) : this.t.styles[mode] ? this.t.styles[mode] + this.t.after : pick(this.t.done);
        this.say(line, 'done', 6500, 'laugh');
      }
      return true;
    } finally {
      this.working = false;
    }
  }

  // a way to lay them out, picked at random among the real tidyings, or among the drawings
  // (artist mode), never the same as the last time
  surprise({ drawingsOnly = false } = {}) {
    const all = drawingsOnly ? DRAWINGS : TIDY;
    const last = drawingsOnly ? this.lastDrawing : this.lastTidy;
    const mode = pick(all.filter((m) => m !== last));
    if (drawingsOnly) this.lastDrawing = mode;
    else this.lastTidy = mode;
    return mode;
  }

  // she's bored and your desktop is in front: a drawing of her own, put back a minute later
  // (not more than one every few minutes)
  async doodle() {
    const now = Date.now();
    if (this.working || now - (this.lastDoodle || 0) < 4 * 60000) return false;
    this.lastDoodle = now;
    return this.arrange(this.surprise({ drawingsOnly: true }), { temporary: true });
  }

  // "garde le": the drawing stays
  keepIt() {
    this.keep = true;
    clearTimeout(this.revertTimer);
    this.say(pick(this.t.kept), 'done', 3500, 'grin');
  }

  // ---- your windows ----

  async arrangeWindows() {
    if (this.working) return;
    const c = this.capri;
    const plan = await this.host.windowsPlan().catch(() => []);
    if (!plan.length) return this.say(this.t.noWins, 'info', 4000, 'aside');
    this.working = true;
    try {
      this.say(pick(this.t.winsGoing), 'work', 2500);
      for (const p of plan) {
        // next to the window, a push, and it slides into its slot
        const side = p.from.x + p.from.w / 2 < c.view.w / 2 ? -1 : 1;
        const by = { x: clamp(p.from.x + p.from.w / 2 + side * (p.from.w / 2 + 60), 80, c.view.w - 80), y: clamp(p.from.y + p.from.h * 0.6, 300, c.floor) };
        await c.teleport(by);
        await c.perform('alarm', -side);
        const h = c.head();
        c.fx.bolt({ x: h.x, y: h.y - 30 * c.scale }, { x: p.from.x + p.from.w / 2, y: p.from.y + 20 }, { life: 260, forks: 2, width: 3 });
        this.voice.play('bolt', { soft: true });
        const steps = 6;
        for (let k = 1; k <= steps; k++) {
          const u = 1 - Math.pow(1 - k / steps, 3);
          const r = {
            x: p.from.x + (p.to.x - p.from.x) * u, y: p.from.y + (p.to.y - p.from.y) * u,
            w: p.from.w + (p.to.w - p.from.w) * u, h: p.from.h + (p.to.h - p.from.h) * u,
          };
          await this.host.placeWindow(p.id, r);
          await sleep(30);
        }
        c.fx.ring(p.to.x + p.to.w / 2, p.to.y + 20, { size: 0.5 });
        await sleep(200);
      }
      this.lastDone = 'windows';
      c.perform('laugh');
      this.say(pick(this.t.winsDone), 'done', 5000, 'laugh');
    } finally {
      this.working = false;
    }
  }

  // ---- "annule" ----

  async undo({ quiet = false } = {}) {
    clearTimeout(this.revertTimer);
    // still busy tidying: she finishes, then undoes it
    for (let k = 0; this.working && k < 300; k++) await sleep(100);
    if (this.working) return;
    // undoing is a desktop operation too: nothing else starts meanwhile
    this.working = true;
    try {
      await this.undoNow(quiet);
    } finally {
      this.working = false;
    }
  }

  async undoNow(quiet) {
    const what = this.lastDone;
    let res = { ok: false };
    if (what === 'windows') res = await this.host.windowsUndo().catch(() => ({ ok: false }));
    else if (what === 'desk') res = await this.host.tidyUndo().catch(() => ({ ok: false }));
    else {
      // after a restart: whichever was saved
      res = await this.host.windowsUndo().catch(() => ({ ok: false }));
      if (!res.ok) res = await this.host.tidyUndo().catch(() => ({ ok: false }));
    }
    // back from one of her drawings to a tidying of yours: "annule" again undoes that one
    this.lastDone = res.more ? 'desk' : null;
    if (!res.ok) return this.say(this.t.noUndo, 'info', 3000, 'aside');
    this.capri.perform('hop');
    this.say(pick(this.t.undone), 'done', 4000, 'calm');
  }
}
