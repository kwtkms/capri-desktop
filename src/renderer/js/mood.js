// Her mood of the day: picked once a day from the date (same all day, a new one tomorrow).
// It changes how much she moves, how often she plays tricks, and how she says hello.

const MOODS = {
  joueuse: {
    move: 0.7, pranks: 1.6, sisters: 1.5,
    fr: ['Je suis d’humeur joueuse aujourd’hui. Attention.', 'Journée fun. Prépare-toi.'],
    en: ['Feeling playful today. Watch out.', 'Fun day. Brace yourself.'],
  },
  flemmarde: {
    move: 1.8, pranks: 0.5, sisters: 0.6,
    fr: ['Mode économie d’énergie aujourd’hui…', 'Flemme. Je squatte une fenêtre et je bouge plus.'],
    en: ['Power saving mode today…', 'Lazy day. I’ll camp on a window.'],
  },
  taquine: {
    move: 1, pranks: 2, sisters: 1,
    fr: ['J’ai des idées de blagues plein la tête aujourd’hui.', 'Aujourd’hui je te fais des coups. Petits. Promis.'],
    en: ['Head full of pranks today.', 'Today I’m pulling tricks on you. Small ones. Promise.'],
  },
  energique: {
    move: 0.55, pranks: 1, sisters: 1.3,
    fr: ['Batteries à 200 % aujourd’hui !', 'Overclockée ce matin. On y va !'],
    en: ['Batteries at 200% today!', 'Overclocked this morning. Let’s go!'],
  },
  pose: {
    move: 1.3, pranks: 0.7, sisters: 0.8,
    fr: ['Journée tranquille. Je suis là si besoin.', 'Calme plat aujourd’hui. J’aime bien.'],
    en: ['Quiet day. I’m here if you need me.', 'Calm today. I like it.'],
  },
};

function dayIndex(date = new Date()) {
  const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  let h = 7;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

export function moodOfDay(date = new Date()) {
  const names = Object.keys(MOODS);
  const name = names[dayIndex(date) % names.length];
  return { name, ...MOODS[name] };
}

export function moodLine(lang = 'fr') {
  const m = moodOfDay();
  const lines = m[lang] || m.en;
  return lines[Math.floor(Math.random() * lines.length)];
}
