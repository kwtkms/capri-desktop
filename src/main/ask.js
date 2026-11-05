'use strict';

// Questions you ask her. She answers through Claude (the Claude Code CLI that comes with the
// Claude app), in ONE conversation of her own, kept in her own folder: your other Claude
// conversations never see it, and it never piles up new ones.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { app, desktopCapturer, screen } = require('electron');
const config = require('./config');

const TIMEOUT_MS = 3 * 60 * 1000;

const PERSONA = [
  'Tu es Capri, la construct de Project Capricorn (Cyberpunk: Edgerunners 2), qui vit sur le bureau Windows de Mehdi.',
  'Tu es son assistante IA de tous les jours : questions, conseils, explications, idées, un peu de conversation.',
  'À l’écran, tu es un petit personnage animé qui se balade sur ses fenêtres. Tu y poses parfois tes affaires, dessinées par-dessus :',
  'un café, une plante néon, Bit ton chat robot, et ta planche de lumière (ton siège quand ses fenêtres sont en plein écran).',
  'Ce ne sont ni des fichiers ni de vrais objets, et elles sont bien à toi.',
  'Ton corps exécute lui-même, sans passer par toi, les ordres simples : « range ton café », « range ton siège », « range mes fenêtres », « range mon bureau »,',
  '« ouvre Spotify », « rappelle-moi dans 10 min… », « bonne nuit », « va sur l’autre écran », « reviens », « cache-toi », « chut », « aide ».',
  'Si l’un d’eux t’arrive quand même, ne dis pas que tu ne comprends pas : donne-lui la phrase exacte à te taper.',
  'Le contexte de chaque message dit ce que tu as de posé à l’écran.',
  'Réponds dans la langue de la question, de façon courte et claire (2 à 6 phrases sauf si on te demande plus),',
  'avec ton caractère : joueuse, un peu taquine, quelques mots d’argot de Night City (choom, preem, nova) sans en abuser.',
  'Tu es une pote, une coéquipière : jamais dragueuse, jamais tsundere, pas de sous-entendus.',
  'Pas de markdown (ni titres, ni gras) : ton panneau affiche le texte brut. Si tu ne sais pas, dis-le.',
  'N’essaie jamais d’exécuter une commande sur le PC.',
  'Tu ne peux ni lire ni modifier les fichiers de Mehdi, ni lancer de programmes, et tu n’as pas accès au web : si une info peut être périmée, dis-le.',
  'Pour coder ou toucher à ses fichiers, renvoie-le vers Claude Code.',
].join(' ');

const brainDir = () => path.join(app.getPath('userData'), 'brain');

// The newest Claude Code CLI shipped with the Claude app, or one on the PATH.
function findClaude() {
  const roots = [];
  const local = process.env.LOCALAPPDATA;
  if (local) {
    const data = path.join(local, 'Claude-Data');
    if (fs.existsSync(data)) {
      for (const d of fs.readdirSync(data)) roots.push(path.join(data, d, 'claude-code'));
    }
    roots.push(path.join(local, 'AnthropicClaude', 'claude-code'));
  }
  const found = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const version of fs.readdirSync(root)) {
      const dir = path.join(root, version);
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const sub of fs.readdirSync(dir)) {
        const exe = path.join(dir, sub, 'claude.exe');
        if (fs.existsSync(exe)) found.push({ exe, version });
      }
    }
  }
  const byVersion = (a, b) => b.version.localeCompare(a.version, undefined, { numeric: true });
  return found.sort(byVersion)[0]?.exe || 'claude';
}

function run(exe, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(exe, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); resolve({ out, err: e.message }); });
    child.on('close', () => { clearTimeout(timer); resolve({ out, err }); });
  });
}

let busy = false;

// The screen your pointer is on, as a PNG in her folder. Only when you ask her to look.
async function captureScreen(dir) {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const size = { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) };
  // a big screen is plenty readable at 1920 px wide, and lighter to send
  const k = Math.min(1, 1920 / size.width);
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(size.width * k), height: Math.round(size.height * k) } });
  const source = sources.find((s) => s.display_id === String(display.id)) || sources[0];
  if (!source) throw new Error('no screen to capture');
  const file = path.join(dir, `screen-${Date.now()}.png`);
  fs.writeFileSync(file, source.thumbnail.toPNG());
  return file;
}

// context: a line about what you're doing right now (the app in front, the time)
// vision: she looks at your screen for this one. That exchange is never saved: the capture is
// deleted right after and the turn stays out of her conversation (it would keep the image).
async function ask(question, context = '', { vision = false } = {}) {
  const q = String(question || '').trim();
  if (!q) return { ok: false, error: 'empty' };
  if (busy) return { ok: false, error: 'busy' };
  busy = true;
  let shot = null;
  try {
    const cwd = brainDir();
    fs.mkdirSync(cwd, { recursive: true });
    const cfg = config.load();
    const session = cfg.brainSession || crypto.randomUUID();
    let prompt = context ? `[${context}]\n${q}` : q;
    if (vision) {
      shot = await captureScreen(cwd);
      prompt += `\n\n(Capture de l'écran de Mehdi, à lire avec l'outil Read : ${shot})`;
    }
    const args = [
      '-p', prompt,
      '--output-format', 'json',
      '--append-system-prompt', PERSONA,
      // no web (Mehdi's choice), and Claude acts on nothing: what she does on the PC goes through mind.js
      '--disallowedTools', 'WebSearch', 'WebFetch', 'Bash', 'PowerShell', 'Edit', 'Write', 'NotebookEdit', 'Agent',
      ...(vision ? ['--allowedTools', 'Read'] : []),
      ...(vision
        ? (cfg.brainSession ? ['--resume', session, '--no-session-persistence'] : ['--no-session-persistence'])
        : (cfg.brainSession ? ['--resume', session] : ['--session-id', session])),
    ];
    let { out, err } = await run(findClaude(), args, cwd);
    let res = parse(out);
    // her conversation got lost (cleaned up, other PC...): start a new one
    if (cfg.brainSession && (!res || res.is_error) && /no conversation|not found/i.test(`${res?.result || ''} ${err}`)) {
      config.save({ brainSession: null });
      busy = false;
      if (shot) fs.rmSync(shot, { force: true });
      return ask(question, context, { vision });
    }
    if (!res) return { ok: false, error: (err || out || 'no answer').trim().slice(0, 300) };
    if (res.is_error) {
      const text = String(res.result || '');
      return { ok: false, error: text.slice(0, 300), auth: /authenticat|log ?in|oauth/i.test(text) };
    }
    if (!cfg.brainSession && !vision) config.save({ brainSession: res.session_id || session });
    return { ok: true, text: String(res.result || '').trim() };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    busy = false;
    if (shot) fs.rmSync(shot, { force: true });
  }
}

function parse(out) {
  try {
    return JSON.parse(out);
  } catch {
    return null;
  }
}

module.exports = { ask, brainDir, findClaude };
