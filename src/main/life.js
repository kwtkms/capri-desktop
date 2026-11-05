'use strict';

// What happens on the PC besides Claude, for her to react to: the screen locking and unlocking,
// the PC waking up, the charger, and you coming back after a while away from the keyboard.

const { powerMonitor } = require('electron');

const AWAY_AFTER_S = 10 * 60; // this long without touching anything counts as a break
const POLL_MS = 15000;

function startLifeWatch({ onLife }) {
  const send = (type, extra = {}) => onLife({ type, ...extra });

  powerMonitor.on('lock-screen', () => send('lock'));
  powerMonitor.on('unlock-screen', () => send('unlock'));
  powerMonitor.on('resume', () => send('resume'));
  powerMonitor.on('on-battery', () => send('battery'));
  powerMonitor.on('on-ac', () => send('charging'));

  let wasAway = false;
  let longestIdle = 0;
  setInterval(() => {
    const idle = powerMonitor.getSystemIdleTime();
    if (idle >= AWAY_AFTER_S) {
      wasAway = true;
      longestIdle = Math.max(longestIdle, idle);
    } else if (wasAway && idle < POLL_MS / 1000) {
      wasAway = false;
      send('back', { minutes: Math.round(longestIdle / 60) });
      longestIdle = 0;
    }
  }, POLL_MS).unref?.();
}

module.exports = { startLifeWatch };
