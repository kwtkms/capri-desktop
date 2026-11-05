'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel) => (fn) => {
  const listener = (_e, payload) => fn(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('host', {
  onClaudeEvent: on('claude:event'),
  onCommand: on('capri:command'),
  onConfig: on('capri:config'),
  onResize: on('overlay:resize'),
  onWindows: on('windows:update'),
  setInteractive: (on) => ipcRenderer.send('overlay:interactive', Boolean(on)),
  cursor: () => ipcRenderer.invoke('overlay:cursor'),
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),
  listSounds: () => ipcRenderer.invoke('sounds:list'),
  hooksStatus: () => ipcRenderer.invoke('hooks:status'),
  demoWindow: (open) => ipcRenderer.invoke('demo:window', Boolean(open)),
  openMenu: () => ipcRenderer.send('menu:open'),
  installHooks: () => ipcRenderer.invoke('hooks:install'),
  claudeFound: () => ipcRenderer.invoke('claude:found'),
  openClaudeHelp: () => ipcRenderer.send('claude:help'),
  windowsNow: () => ipcRenderer.invoke('windows:get'),
  trayPlace: () => ipcRenderer.invoke('guide:tray'),
  openClaudeFolder: () => ipcRenderer.invoke('guide:claudeFolder'),
  ask: (question, context, vision) => ipcRenderer.invoke('ask', { question: String(question), context: String(context || ''), vision: Boolean(vision) }),
  setKeyboard: (on) => ipcRenderer.send('overlay:keyboard', Boolean(on)),
  kickCursor: (dir, power) => ipcRenderer.send('cursor:kick', { dir: Number(dir) || 1, power: Number(power) || 1 }),
  launch: (query) => ipcRenderer.invoke('launch', String(query)),
  pcInfo: () => ipcRenderer.invoke('skill:info'),
  pressKey: (name) => ipcRenderer.invoke('skill:key', String(name)),
  lockPc: () => ipcRenderer.invoke('skill:lock'),
  screenClip: () => ipcRenderer.invoke('skill:clip'),
  onCursor: on('overlay:cursor'),
  // a file dropped on her: its path, for its name (hands.give)
  pathOf: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
  deskIcons: (all) => ipcRenderer.invoke('desk:icons', Boolean(all)),
  snapshotIcons: () => ipcRenderer.invoke('desk:snapshot'),
  takeIcon: (i) => ipcRenderer.invoke('desk:take', Number(i)),
  putIcon: (i, x, y) => ipcRenderer.invoke('desk:put', { i: Number(i), x: Number(x), y: Number(y) }),
  iconImage: (name) => ipcRenderer.invoke('desk:image', String(name)),
  restoreIcons: () => ipcRenderer.invoke('desk:restore'),
  tidyStart: (temporary) => ipcRenderer.invoke('desk:tidyStart', Boolean(temporary)),
  tidyApply: (cells) => ipcRenderer.invoke('desk:tidyApply', cells.map((c) => ({ name: String(c.name), col: Number(c.col), row: Number(c.row) }))),
  tidyUndo: () => ipcRenderer.invoke('desk:tidyUndo'),
  windowsPlan: () => ipcRenderer.invoke('win:plan'),
  placeWindow: (id, r) => ipcRenderer.invoke('win:place', { id: Number(id), x: Number(r.x), y: Number(r.y), w: Number(r.w), h: Number(r.h) }),
  windowsUndo: () => ipcRenderer.invoke('win:undo'),
  findButton: (words) => ipcRenderer.invoke('desk:find', String(words)),
  pressButton: (words) => ipcRenderer.invoke('desk:press', String(words)),
  diag: (msg) => ipcRenderer.send('diag', String(msg).slice(0, 500)),
  awayDone: () => ipcRenderer.send('overlay:away'),
  moveScreen: (where) => ipcRenderer.invoke('screen:move', String(where)),
  nudgeWindow: (id, dx) => ipcRenderer.send('window:nudge', { id: Number(id), dx: Number(dx) || 0 }),
});
