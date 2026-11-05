'use strict';

// "Ouvre Spotify", "lance Cyberpunk", "ouvre mes téléchargements", "ouvre YouTube": she finds it
// herself, no Claude involved. Your folders first, then the shortcuts on your desktop and in your
// Start menu (only shortcuts, the same thing you'd click), then Store apps, then a few websites.

const fs = require('node:fs');
const path = require('node:path');
const { app, shell } = require('electron');

const FOLDERS = {
  documents: 'documents', document: 'documents', docs: 'documents',
  telechargements: 'downloads', telechargement: 'downloads', downloads: 'downloads',
  bureau: 'desktop', desktop: 'desktop',
  images: 'pictures', photos: 'pictures', pictures: 'pictures',
  musique: 'music', music: 'music',
  videos: 'videos', video: 'videos',
};

const SITES = {
  youtube: 'https://www.youtube.com', netflix: 'https://www.netflix.com', crunchyroll: 'https://www.crunchyroll.com',
  gmail: 'https://mail.google.com', github: 'https://github.com', twitch: 'https://www.twitch.tv',
  'google drive': 'https://drive.google.com', drive: 'https://drive.google.com', maps: 'https://maps.google.com',
  'google maps': 'https://maps.google.com', nexus: 'https://www.nexusmods.com', 'nexus mods': 'https://www.nexusmods.com',
  claude: 'https://claude.ai', 'prime video': 'https://www.primevideo.com', 'disney+': 'https://www.disneyplus.com',
};

// apps from the Microsoft Store have no shortcut file: their own links open them
const URIS = {
  spotify: 'spotify:', whatsapp: 'whatsapp:', parametres: 'ms-settings:', settings: 'ms-settings:',
  calculatrice: 'calculator:', calculator: 'calculator:', store: 'ms-windows-store:', 'microsoft store': 'ms-windows-store:',
  xbox: 'xbox:', 'courrier': 'outlookmail:', mail: 'outlookmail:', meteo: 'bingweather:', weather: 'bingweather:',
};

const SHORTCUT = /\.(lnk|url|appref-ms)$/i;

const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/^(mes|mon|ma|les|le|la|l'|l’|my|the)\s+/, '').replace(/[^a-z0-9+ ]/g, ' ').replace(/\s+/g, ' ').trim();

function shortcutDirs() {
  const env = process.env;
  return [
    app.getPath('desktop'),
    env.PUBLIC && path.join(env.PUBLIC, 'Desktop'),
    env.APPDATA && path.join(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    env.ProgramData && path.join(env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
  ].filter(Boolean);
}

function listShortcuts(dir, depth = 0, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory() && depth < 3) listShortcuts(full, depth + 1, out);
    else if (SHORTCUT.test(e.name)) out.push({ name: e.name.replace(SHORTCUT, ''), full });
  }
  return out;
}

// the best shortcut for what was asked: exact name, then starts with it, then contains it
function findShortcut(query) {
  const q = norm(query);
  if (!q) return null;
  const all = shortcutDirs().flatMap((d) => listShortcuts(d))
    .filter((s) => !/uninstall|desinstall|readme|help|aide|website|site web/i.test(s.name));
  const scored = all.map((s) => {
    const n = norm(s.name);
    const score = n === q ? 3 : n.startsWith(q) ? 2 : n.includes(q) || q.includes(n) ? 1 : 0;
    return { ...s, score, len: n.length };
  }).filter((s) => s.score > 0 && s.len > 1);
  scored.sort((a, b) => b.score - a.score || a.len - b.len);
  return scored[0] || null;
}

// returns { ok, what } or { ok: false }
async function launch(query) {
  const q = norm(query);
  if (!q) return { ok: false };
  const folder = FOLDERS[q.replace(/ /g, '')];
  if (folder) {
    const err = await shell.openPath(app.getPath(folder));
    return err ? { ok: false } : { ok: true, what: query };
  }
  const found = findShortcut(q);
  if (found) {
    const err = await shell.openPath(found.full);
    return err ? { ok: false, error: err } : { ok: true, what: found.name };
  }
  const uri = URIS[q];
  if (uri) {
    await shell.openExternal(uri);
    return { ok: true, what: query };
  }
  const site = SITES[q];
  if (site) {
    await shell.openExternal(site);
    return { ok: true, what: query };
  }
  return { ok: false };
}

module.exports = { launch, findShortcut };
