// What you type in her box, understood the way you type it: no accents needed, capitals or not,
// SMS spelling ("ds 20mn", "rapel moi", "ouvr spotify", "range mes fenetre", "vazy"), a slip of the
// fingers ("range mon bureua"). Everything here is matched locally; only what isn't a command goes
// to Claude, so a sentence that merely contains a word of hers ("je bosse sur un projet, tu m'aides")
// must not trigger anything.

// words written the quick way -> the word she looks for
const SMS = {
  ds: 'dans', dan: 'dans', dns: 'dans',
  rapel: 'rappelle', rappel: 'rappelle', rapelle: 'rappelle', rappele: 'rappelle', rapele: 'rappelle', rappeles: 'rappelle', rapl: 'rappelle',
  ouvr: 'ouvre', ouvres: 'ouvre', ouvere: 'ouvre', ouve: 'ouvre', ouvrir: 'ouvre', ouvert: 'ouvre',
  lanc: 'lance', lances: 'lance', lancer: 'lance', lence: 'lance',
  demare: 'demarre', demarrer: 'demarre',
  rang: 'range', ranges: 'range', ranger: 'range', rangez: 'range', rnage: 'range', ragne: 'range', rang3: 'range', organise: 'range', organiser: 'range', trie: 'range', arrange: 'range',
  fenetre: 'fenetres', fentre: 'fenetres', fenetr: 'fenetres', fenetrs: 'fenetres', fen: 'fenetres',
  burau: 'bureau', bureu: 'bureau', buro: 'bureau',
  annul: 'annule', annuler: 'annule', anule: 'annule', annules: 'annule',
  vasy: 'vas y', vazy: 'vas y', vzy: 'vas y', go: 'vas y',
  dmain: 'demain', dem1: 'demain', '2main': 'demain',
  mn: 'min', mins: 'min', minute: 'min', minutes: 'min',
  heure: 'h', heures: 'h', hr: 'h',
  stp: '', svp: '', please: '', pls: '', plz: '', steuplait: '',
  pr: 'pour', pk: 'pourquoi', ekran: 'ecran',
  cb: 'combien', cmb: 'combien', bcp: 'beaucoup', jsuis: 'je suis', chui: 'je suis', jai: 'j ai', tes: 'tes', jveux: 'je veux', jvais: 'je vais', koi: 'quoi', qd: 'quand', tjr: 'toujours',
  rgd: 'regarde', regard: 'regarde', regardes: 'regarde',
  tn: 'ton', kafe: 'cafe', caffe: 'cafe', cafee: 'cafe',
};

// lowercase, no accents, no punctuation (except what times need), SMS words spelled out
export function norm(text) {
  const base = String(text).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[’'`]/g, ' ').replace(/[^a-z0-9:+ -]/g, ' ')
    // "20min", "1h30" stay together; "moi-meme" etc. lose their dash
    .replace(/(\D)-(\D)/g, '$1 $2');
  return base.split(/\s+/).map((w) => (w in SMS ? SMS[w] : w)).filter(Boolean).join(' ').trim();
}

// The long words her commands turn on, for a typo: one letter off, or two swapped. Short words stay
// out of it, there are too many neighbours ("orange" isn't "range").
const FUZZY = ['bureau', 'fenetres', 'icones', 'raccourcis', 'affaires', 'planche', 'plante', 'concentre', 'pomodoro'];

function oneOff(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a[i + 1] === b[i] && a[i] === b[i + 1] && a.slice(i + 2) === b.slice(i + 2)) return true; // swapped
  return a.slice(i + 1) === b.slice(i + 1) || a.slice(i + 1) === b.slice(i) || a.slice(i) === b.slice(i + 1);
}

export const fixTypos = (n) => n.split(' ').map((w) => (w.length < 5 ? w : FUZZY.find((f) => oneOff(w, f)) || w)).join(' ');

const HELP = /^(aide|help|tu sais faire quoi|tu fais quoi|tu peux faire quoi|que sais tu faire|quelles? commandes?|c est quoi les commandes|les commandes|liste des commandes)$/;
const HERS = { cafe: 'coffee', tasse: 'coffee', coffee: 'coffee', plante: 'plant', plant: 'plant', chat: 'cat', cat: 'cat', bit: 'cat', siege: 'seat', planche: 'seat', board: 'seat', hoverboard: 'seat', seat: 'seat' };

// a time in it: "rappelle-moi le théorème de Pythagore" is a question
const WHEN = /\d|\b(demain|apres demain|ce soir|ce matin|cet apres midi|midi|minuit|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|une h|un quart|une demi|tomorrow|tonight)\b/;
// "tu peux ranger ton cafe ?" is an order, whatever the question mark says
const ASKING = /^(?:tu peux|tu pourrais|peux tu|pourrais tu|can you|could you|vas y|allez) /;

// What she's asked to do. Returns { kind, rest } or null for a plain question.
// asked: it was put as a polite question.
export function parse(text) {
  // "capri range ton cafe", "range ton cafe capri": her name isn't part of the order
  const n = fixTypos(norm(text)).replace(/^(?:(?:hey|he|eh|dis|ok) )?capri /, '').replace(/ capri$/, '');
  if (!n) return null;
  if (HELP.test(n)) return { kind: 'help' };
  const order = n.replace(ASKING, '');
  const cmd = command(order);
  return cmd && order !== n ? { ...cmd, asked: true } : cmd;
}

function command(n) {
  let m;
  if (/^(annule|undo|cancel|remets? (comme avant|tout|mes fenetres|mon bureau)|reviens en arriere|ctrl z)( ca| tout| le rangement)?$/.test(n)) return { kind: 'undo' };
  if (/^(garde le|garde la|gardes le|garde ca|laisse comme ca|laisse le|keep it)$/.test(n)) return { kind: 'keep' };
  // "dessine", "fais un dessin", "dessine un cercle", "ecris capri": a drawing with your icons
  if (/^(dessine|fais (moi )?un dessin|fait (moi )?un dessin|draw|ecris capri|ecrit capri)\b|^(mode )?artiste$|^art mode$/.test(n)) return { kind: 'draw', rest: n };
  // things to keep in mind about you (facts.js): before reminders, "rappelle toi" isn't "rappelle moi"
  if (/^(retiens|retient|souviens toi|souvien toi|rappelle toi|n oublie pas|noublie pas|note que|remember)\b/.test(n)) return { kind: 'remember' };
  if (/^(oublie|forget)\b/.test(n)) return { kind: 'forget' };
  if (/^(tu )?(sais|connais)( quoi)?( sur| de)? moi$|^(ce que|qu est ce que) tu sais( sur| de)? moi$|^(ta memoire|tu te souviens de quoi|t as retenu quoi|tu as retenu quoi|what do you know about me)$/.test(n)) return { kind: 'known' };
  // focus mode (focus.js): "concentre moi 25 min", "focus 45", "pomodoro", "stop focus"
  if (/^(stop|arrete|fin|fini|termine|end)( le| du| de| la| ce| mon| ton| ta)* (focus|concentration|pomodoro)$|^(focus|pomodoro) (stop|fini|off)$/.test(n)) return { kind: 'focusStop' };
  if (/\b(combien|reste|left)\b.*\b(focus|concentration|pomodoro)$/.test(n)) return { kind: 'focusStatus' };
  if ((m = n.match(/^(?:mode )?(?:focus|concentre(?: moi)?|concentration|pomodoro|je bosse|laisse moi (?:bosser|travailler))(?: (?:pendant|pour|de))?(?: (\d+) ?(min|h)?)?$/))) {
    const k = Number(m[1]) || 25;
    return { kind: 'focus', minutes: m[2] === 'h' ? k * 60 : k };
  }
  // leave me alone: the same quiet, for an hour
  if (/^(chut|silence|tais toi|ta gueule|ferme la|laisse moi tranquille|laisse moi|calme toi|lache moi|moins de bruit)$/.test(n)) return { kind: 'focus', minutes: 60 };
  // bed now (life.bedtime), and up again
  if (/^(dors|va dormir|va te coucher|bonne nuit|au lit|dodo|good night|go to sleep|sleep)( \S+)?$/.test(n)) return { kind: 'sleep' };
  if (/^(debout|reveille toi|reveil|wake up|leve toi)( \S+)?$/.test(n)) return { kind: 'wakeUp' };
  if (/^(rappelle moi|rappelle|remind me|reminder|fais moi penser|fait moi penser)\b/.test(n) && WHEN.test(n)) return { kind: 'remind', rest: n };
  // "montre ta ville", "night city", "ton quartier": her city, for a while, over everything
  if (/^(montre|fais voir|affiche|show)( moi)?( ta| ton| la| le| your)* (ville|quartier|city|night city)$|^night city$|^ta ville$/.test(n)) return { kind: 'city' };
  // where she is
  if (/^(va|vas|aller|passe|file|bouge|move)( toi)?( sur| a| vers| dans)? ?(l |mon |ton )?(autre|2e|2eme|deuxieme|second|other) ?(ecran|screen)?$|^(pousse toi|bouge toi|degage|va t en|va ten|get out of the way)$/.test(n)) return { kind: 'aside' };
  if (/^(reviens|revenir|rentre|viens)( ici| sur (cet|ce|mon) ecran| a la maison)?$|^come back$/.test(n)) return { kind: 'comeBack' };
  if (/^(cache toi|va te cacher|disparais|range toi|hide)$/.test(n)) return { kind: 'stow' };
  // games, on demand
  if (/^((on )?(joue|jouer) a )?(cache cache)$|^hide and seek$/.test(n)) return { kind: 'hideSeek' };
  if (/^((fais|fait) (moi )?une (blague|farce)|une blague|blague|pirate moi|hack moi)$/.test(n)) return { kind: 'prank' };
  // her own things (props.js, crate.js): "range ton cafe", "enleve ta plante", "range ton siege",
  // "range tes affaires"; "mes fenetres" and "mon bureau" below are yours
  if ((m = n.match(/^(?:range|enleve|retire|vire|recupere|reprends?|put away|remove)\s+(?:tout\s+)?(?:(?:ton|ta|tes|le|la|les|l|your|the)\s+)?(cafe|tasse|coffee|plante|plant|chat|cat|bit|siege|planche|hoverboard|board|seat|affaires|trucs?|bazar|stuff|things)(?: \S+){0,2}$/))) {
    return { kind: 'props', what: HERS[m[1]] || null };
  }
  if (/^range (?:\S+ ){0,2}fenetres\b|^(tidy|arrange) (?:\S+ ){0,2}windows?\b/.test(n)) return { kind: 'windows' };
  if (/^range (?:\S+ ){0,2}(bureau|icones?|raccourcis)\b|^tidy (?:\S+ ){0,2}(desk|desktop)\b/.test(n)) return { kind: 'desk', rest: n };
  if (/^((rends|rend|redonne|redonnes)( moi)?( le| la| les| l| mon| ma| mes| ca| icone| raccourci| truc)*|give (it )?back)$/.test(n)) return { kind: 'giveBack' };
  if ((m = n.match(/^(?:tiens|tien|prends|prend|garde|attrape|take|hold)\s+(?:moi\s+)?(?:le |la |les |l |mon |ma |mes )?((?!.*\b(?:toi|moi|un|une|du|des|de|ton|ta|tes)\b)\S+(?: \S+){0,2})$/))) return { kind: 'give', rest: m[1] };
  if ((m = n.match(/^(?:ouvre|lance|demarre|open|launch|start)\s+(?:moi\s+)?(?!un |une |des )(.+)$/))) return { kind: 'open', rest: m[1] };
  if (/\bregarde\b.*\becran\b|look at (my|the) screen/.test(n)) return { kind: 'vision' };
  return null;
}
