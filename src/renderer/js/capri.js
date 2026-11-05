// Capri herself: where she is, how she moves, how she reacts.
// She acts with her head and her mane like in the show, and she's timed like cel animation:
// pose-to-pose acts (acting.js) drawn on twos, on ones for the action beats.
//
// Stances: floating ("stand"), perched on a window ("sit"), peeking in from a screen edge
// ("peek"), and falling ("fall") when the window under her goes away or you drop her.

import { SpriteRenderer, SPRITE } from './sprite.js';
import { ACTS, NEUTRAL, Player } from './acting.js';
import { sleep, rand, pick, clamp, lerp, ease, tween, reducedMotion } from './util.js';

const ON_TWOS = 1000 / 12;
const ON_ONES = 1000 / 24;
const ASLEEP = 1000 / 6;
const SLEEP_AFTER = 10 * 60 * 1000;
const BEDTIME_AFTER = 5 * 60 * 1000; // after midnight, this long without you touching her: bed
const GRAVITY = 2600; // px/s²
const THIGH = 73;     // hip to knee, sprite px (see sprite.js)

const UPLINK_DAY = 'capri.uplinkDay'; // the last day she sent the red light up

// the local date, YYYY-MM-DD
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// the pose fields drawn halfway on an inbetween (animate)
// lying down asleep (animate): body turned this many degrees, arms down along it, lower legs
// both swung the same way (knees bent), thighs kept a little folded, mane pulled in
const LIE = { tilt: 84, armL: -1.2, armR: -1.2, kickL: -0.3, kickR: 0.3, sit: 0.2, head: -0.1, mane: -1.5 };

const BLENDED = ['head', 'mane', 'hair', 'tilt', 'bob', 'sx', 'sy', 'armL', 'armR', 'longL', 'longR', 'kickL', 'kickR'];

const GREEN = [0.21, 1, 0.48];
const INK = [0.08, 0.06, 0.11];
const RED = [1, 0.13, 0.32];

export class Capri {
  constructor({ root, canvas, image, fx, voice }) {
    this.root = root;
    this.canvas = canvas;
    this.sprite = new SpriteRenderer(canvas, image);
    this.fx = fx;
    this.voice = voice;

    this.scale = 0.6;
    this.view = { w: innerWidth, h: innerHeight };
    this.pos = { x: innerWidth - 200, y: innerHeight - 6 }; // her feet
    this.facing = 1; // 1: as drawn (reaching left), -1: mirrored
    this.mode = 'idle'; // idle | work | alert | sleep
    this.stance = 'stand';
    this.perch = null;    // { id, dx }: the window she sits on, and where along it
    this.peekSide = null; // left | right | top
    this.windows = { fg: 0, wins: [] };
    this.busy = false;
    this.hidden = false;
    this.stowed = false;  // folded away in her biochip (Ctrl+Alt+C)
    this.dormant = false; // asleep, down to her mask
    this.wander = true;
    this.moveRate = 1; // > 1: she moves less often (her mood of the day)
    this.possessWindows = true; // tray: "Possess my windows"
    this.dragging = false;

    this.p = {
      seed: 0, boil: 0.9, hair: 0, head: 0, mane: 0, armL: 0, armR: 0, longL: 1, longR: 1, sit: 0, kickL: 0, kickR: 0,
      smear: [0, 0], echo: [0, 0],
      glitch: 0, glitchSeed: 0, split: 0, collapse: 0, dissolve: 0, sparkle: 1, grade: 1,
      sil: INK, silAmount: 0, misreg: [-2.6, 2.2], alpha: 1,
    };
    this.bob = 0;
    this.tilt = 0;
    this.sx = 1;
    this.sy = 1;
    this.base = new Player('stand');
    this.act = null;
    this.lastDraw = 0;

    const now = performance.now();
    this.lastActivity = now;
    this.lastDirect = now;    // the last time you touched her (touch)
    this.nightSleep = false;  // asleep for the night: only you touching her wakes her
    this.nextTwitch = now + rand(4000, 9000);
    this.nextIdle = now + rand(5000, 9000);
    this.nextMove = now + rand(40000, 80000);
    this.nextGaze = now + rand(40000, 90000);
    this.nextShed = now + rand(3000, 8000);
    this.nextNotice = 0;
    this.peekUntil = 0;
    this.lastGlyph = 0;
    this.sleptAt = 0;
    this.uplinkDue = false;
    this.pointing = null; // what she's showing you: { rect, aim, dir, side, reach, label, pointer }
    this.mouse = null; // last pointer position seen

    this.onMove = null;     // her head moved on screen
    this.onTeleport = null; // ('start' | 'end')
    this.onClick = null;
    this.onMenu = null;   // right-click on her
    this.onGaze = null;
    this.onMode = null;   // (mode, previous)
    this.onStow = null;   // she's in her biochip
    this.onUnstow = null; // she's coming out of it
    this.chipAt = null;   // () => the biochip's middle on screen
    this.onDoze = null;   // ('start', face) | 'waking' | 'end': down to her mask and back

    this.alphaMap = this.buildAlphaMap(image);
    this.setScale(this.scale);
    this.bindPointer();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  // ---------- geometry ----------

  // Her silhouette at rest, for hit tests: the cut-out plus the mirrored right arm the shader adds.
  buildAlphaMap(image) {
    const { width: w, height: h, mirror } = SPRITE;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, w, h).data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!SPRITE.armL(x, y) || mirror - x >= w) continue;
        const to = (y * w + mirror - x) * 4 + 3;
        data[to] = Math.max(data[to], data[(y * w + x) * 4 + 3]);
      }
    }
    return data;
  }

  setScale(scale) {
    this.scale = scale;
    this.sprite.resize(scale);
    this.pivot();
    this.place();
  }

  // Flip, lean and squash all pivot on her feet, or on her seat when she sits on a ledge
  // (so a squash presses her onto it instead of pulling her down through it).
  pivot() {
    const s = this.scale;
    const fx = (SPRITE.pad + SPRITE.feet.x) * s;
    const fy = (SPRITE.pad + (this.stance === 'sit' ? SPRITE.hip : SPRITE.feet.y)) * s;
    this.canvas.style.transformOrigin = `${fx}px ${fy}px`;
  }

  // Her screen changed size (moved to your other screen, which is smaller at 200 %): she must
  // land inside it, whatever she was doing. She used to keep her old spot, off the right edge
  // and under the taskbar of the other screen.
  setView(w, h) {
    this.view = { w, h };
    if (this.stance === 'peek') this.setStance('stand');
    if (this.stance === 'sit') {
      // her ledge: kept if it's still on this screen (setWindows moves her along), else she stands
      const win = this.windows.wins.find((o) => o.id === this.perch?.id);
      if (!win || win.x > w - 40 || win.x + win.w < 40 || win.y > h - 20) this.setStance('stand');
    }
    if (this.stance !== 'sit') {
      this.pos.x = clamp(this.pos.x, 60, w - 60);
      this.pos.y = clamp(this.pos.y, SPRITE.height * this.scale, this.floor);
    }
    this.place();
  }

  // She's on another screen now: what she was sitting on, pointing at or about to go to was on the
  // old one.
  changedScreen() {
    this.pending = null;
    this.stopPointing();
    if (this.stance !== 'stand' && !this.asleep) this.setStance('stand');
  }

  // asleep (or on her way to bed for the night): nothing spontaneous happens to her
  get asleep() {
    return this.mode === 'sleep' || this.nightSleep;
  }

  get upside() {
    return this.stance === 'peek' && this.peekSide === 'top';
  }

  place() {
    const s = this.scale;
    const left = this.pos.x - (SPRITE.pad + SPRITE.feet.x) * s;
    const top = this.pos.y - (SPRITE.pad + SPRITE.feet.y) * s + this.bob;
    const turn = (this.upside ? 180 : 0) + this.tilt;
    this.root.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
    this.canvas.style.transform = `rotate(${turn.toFixed(2)}deg) scale(${(this.facing * this.sx).toFixed(3)}, ${this.sy.toFixed(3)})`;
    this.onMove?.(this.head());
  }

  // her face on screen, plus `top`: the tips of her mane
  head(at = this.pos, facing = this.facing) {
    const s = this.scale;
    const bob = at === this.pos ? this.bob : 0;
    const dx = (SPRITE.head.x - SPRITE.feet.x) * s * facing;
    const dy = (SPRITE.feet.y - SPRITE.head.y) * s;
    // lying down: her head turned around her hips, the way she's drawn (place)
    if (at === this.pos && this.lieK > 0.3) {
      const a = (this.tilt * Math.PI) / 180;
      const px = at.x, py = at.y + bob - (SPRITE.feet.y - SPRITE.hip) * s;
      const vx = (SPRITE.head.x - SPRITE.feet.x) * s * facing, vy = (SPRITE.head.y - SPRITE.hip) * s;
      const x = px + vx * Math.cos(a) - vy * Math.sin(a);
      const y = py + vx * Math.sin(a) + vy * Math.cos(a);
      return { x, y, top: y - 60 * s };
    }
    if (at === this.pos && this.upside) {
      const y = at.y + dy + bob;
      return { x: at.x - dx, y, top: y - 30 * s };
    }
    return { x: at.x + dx, y: at.y - dy + bob, top: at.y - SPRITE.feet.y * s + bob };
  }

  // Is this screen point on her body? Uses the cut-out's alpha so empty space stays click-through.
  hit(x, y) {
    if (this.hidden || this.p.alpha < 0.5) return false;
    const s = this.scale;
    const fy = this.pos.y + this.bob;
    // lying down (asleep on a ledge): the point turned back around her hips, the way she's drawn
    if (this.lieK > 0.3) {
      const px = this.pos.x, py = fy - (SPRITE.feet.y - SPRITE.hip) * s;
      const a = (-this.tilt * Math.PI) / 180;
      const dx = x - px, dy = y - py;
      x = px + dx * Math.cos(a) - dy * Math.sin(a);
      y = py + dx * Math.sin(a) + dy * Math.cos(a);
    }
    if (this.upside) {
      x = 2 * this.pos.x - x;
      y = 2 * fy - y;
    }
    const sx = SPRITE.feet.x + ((x - this.pos.x) / s) * this.facing;
    let sy = SPRITE.feet.y - (fy - y) / s;
    if (this.p.sit > 0 && sy > SPRITE.hip) {
      // same fold as the shader: short thighs, legs ridden up
      const c = lerp(1, 0.3, this.p.sit);
      sy = sy <= SPRITE.hip + THIGH * c ? SPRITE.hip + (sy - SPRITE.hip) / c : sy + THIGH * (1 - c);
    }
    for (const [dx, dy] of [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4]]) {
      const px = Math.round(sx + dx), py = Math.round(sy + dy);
      if (px < 0 || py < 0 || px >= SPRITE.width || py >= SPRITE.height) continue;
      if (this.alphaMap[(py * SPRITE.width + px) * 4 + 3] > 40) return true;
    }
    return false;
  }

  faceCenter() {
    this.facing = this.pos.x > this.view.w / 2 ? 1 : -1;
  }

  // Which way is the middle of the screen from her, -1 or 1.
  towardCenter() {
    return this.pos.x > this.view.w / 2 ? -1 : 1;
  }

  // the reaching side of the cut-out points toward screen x
  faceToward(x) {
    this.facing = x < this.pos.x ? 1 : -1;
  }

  get floor() {
    return this.view.h - 6;
  }

  spot(name) {
    const { w } = this.view;
    const s = this.scale;
    const side = 150 * s + 30;
    switch (name) {
      case 'post':
        return { x: w - side - 30, y: this.floor };
      case 'stage':
        return { x: w * 0.5 + rand(-w * 0.12, w * 0.12), y: this.floor };
      case 'chip': // next to her biochip, bottom left
        return { x: side + 30, y: this.floor };
      default: {
        const y = Math.random() < 0.65 ? this.floor : rand(SPRITE.height * s + 200, this.floor);
        let x = rand(side, w - side);
        if (Math.abs(x - this.pos.x) < w * 0.2) x = clamp(w - x, side, w - side);
        return { x, y };
      }
    }
  }

  // ---------- windows ----------

  setWindows(data) {
    this.rawWindows = data;
    // her own seat (crate.js) counts as a window, in front of all the others
    const extra = this.extraSeats?.() || [];
    if (extra.length) data = { ...data, wins: [...extra, ...data.wins] };
    this.windows = data;
    if (this.stance !== 'sit' || this.busy || this.dragging) return;
    const win = data.wins.find((w) => w.id === this.perch.id);
    const room = win && this.ledge(win);
    const dx = win ? clamp(this.perch.dx, room.lo, room.hi) : 0;
    if (!win || !this.canSit(win) || this.covered(win, win.x + dx)) {
      this.fall(); // the ledge is gone (closed, minimized, maximized or covered)
      return;
    }
    const to = this.seat(win, dx);
    if (to.x !== this.pos.x || to.y !== this.pos.y) {
      this.feelRide(to.x - this.pos.x, to.y - this.pos.y);
      if (this.stance !== 'sit') return; // shaken off
      this.pos = to; // ride along with the window
      this.place();
    }
  }

  // You're moving the window she sits on: she leans against the motion, and if you shake it
  // (back and forth, hard) she falls off.
  feelRide(dx, dy) {
    const now = performance.now();
    this.lean = clamp((this.lean || 0) - dx * 0.12, -16, 16);
    this.rides = (this.rides || []).filter((r) => now - r.t < 1200);
    if (Math.abs(dx) > 12) this.rides.push({ t: now, dir: Math.sign(dx), d: Math.abs(dx) });
    let turns = 0;
    for (let i = 1; i < this.rides.length; i++) if (this.rides[i].dir !== this.rides[i - 1].dir) turns++;
    if (turns >= 3 && !this.busy && !this.dragging) {
      this.rides = [];
      this.lean = 0;
      this.fall();
      this.vx = dx * 18; // flung the way it was going
      this.onShaken?.();
    } else if (Math.abs(dy) > 40 && dy < 0 && !this.act) {
      this.perform('hop'); // yanked up: a little bounce
    }
  }

  // Where her feet go so that her hips rest on the window's top edge.
  seat(win, dx) {
    return { x: win.x + dx, y: win.y + 3 + (SPRITE.feet.y - SPRITE.hip) * this.scale };
  }

  // The part of a window's top edge she can really be on, as distances from its left end. A window
  // can run past the edge of her screen, or across both screens: she used to sit down on the part
  // that isn't there, and get pulled back again and again.
  ledge(win) {
    if (win.fake) return { lo: 10, hi: Math.max(10, win.w - 10) };
    return { lo: Math.max(50, 60 - win.x), hi: Math.min(win.w - 60, this.view.w - 60 - win.x) };
  }

  canSit(win) {
    const roomAbove = SPRITE.hip * this.scale + 12;
    // her own hoverboard (crate.js) is small, and can hover low
    if (win.fake) return win.y > roomAbove && win.y < this.view.h - 20;
    const { lo, hi } = this.ledge(win);
    return !win.max && win.w > 260 && hi - lo >= 120 && win.y > roomAbove && win.y < this.view.h - 80;
  }

  // Is her spot on that ledge hidden under a window that's above it?
  covered(win, x) {
    const half = 34 * this.scale;
    const { wins } = this.windows;
    for (const o of wins) {
      if (o === win || o.id === win.id) return false; // reached it: everything after is below
      if (o.x < x + half && o.x + o.w > x - half && o.y <= win.y && o.y + o.h >= win.y) return true;
    }
    return false; // window not in the list any more
  }

  // A window she could sit on, the one in front first. Returns { win, dx } or null.
  // any: any of them at random (climbing around), not the front one first.
  pickSeat({ frontOnly = false, except = null, any = false } = {}) {
    const options = [];
    for (const win of this.windows.wins) {
      if (win.id === except || !this.canSit(win)) continue;
      const { lo, hi } = this.ledge(win);
      const dx = clamp(clamp(rand(win.w * 0.18, win.w * 0.6), 60, Math.max(60, win.w - 190)), lo, hi);
      if (this.covered(win, win.x + dx)) continue;
      options.push({ win, dx });
    }
    const front = options.find((o) => o.win.id === this.windows.fg);
    if (frontOnly) return front || null;
    if (any && options.length) return pick(options);
    return front || options[0] || null;
  }

  // ---------- frame loop ----------

  interval() {
    if (this.busy || this.stance === 'fall' || this.act?.player.act.fps === 24) return ON_ONES;
    return this.mode === 'sleep' ? ASLEEP : ON_TWOS;
  }

  loop(now) {
    requestAnimationFrame(this.loop);
    if (this.hidden) return;
    if (now - this.lastDraw < this.interval() - 1) return;
    this.drawFrame(now);
    this.behave(now);
  }

  drawFrame(now = performance.now()) {
    this.lastDraw = now;
    this.animate(now);
    this.sprite.draw(this.p);
    this.place();
  }

  // Pick the drawing: the stance's cycle underneath, the current act on top.
  animate(now) {
    const p = this.p;
    p.seed = Math.random() * 100; // a fresh drawing, so the line boils

    const under = this.base.sample(now);
    const base = under ? this.base.resolve(under.pose, this.facing) : {};
    let act = null;
    let cue = null;
    if (under && under.index !== this.baseIndex) {
      this.baseIndex = under.index;
      if (!this.act) cue = under.cue; // the stance's own cues, when no act is on top
    }
    if (this.act) {
      const drawing = this.act.player.sample(now);
      if (drawing) {
        act = this.act.player.resolve(drawing.pose, this.facing);
        if (drawing.index !== this.act.index) {
          this.act.index = drawing.index;
          cue = drawing.cue;
        }
      } else {
        this.endAct(true);
      }
    }
    const pose = { ...NEUTRAL, ...base, ...act };
    // Asleep on a ledge (a window, her board): she lies down along it, rolling over slowly, knees
    // a little bent, arms along her body, her mane settled flat, head toward the middle of it,
    // breathing slowly (her chest rising, the mane following). Wakes up: she rolls back.
    const lie = this.mode === 'sleep' && this.stance === 'sit' && !this.act && !this.busy && !this.dragging;
    if (lie && !this.lieK) {
      const win = this.windows.wins.find((w) => w.id === this.perch?.id);
      this.lieSide = win && this.pos.x - win.x > win.w / 2 ? -1 : 1;
    }
    this.lieK = (this.lieK || 0) + ((lie ? 1 : 0) - (this.lieK || 0)) * 0.12;
    if (this.lieK < 0.01) this.lieK = 0;
    if (this.lieK) {
      const k = this.lieK;
      const T = { ...LIE, ...this.lieTune };
      if (lie) this.facing = -this.lieSide; // the side her knees bend to: up, never through the ledge
      // one breath every ~4.5 s, held a beat at the bottom
      const b = Math.max(0, Math.sin((now / 4500) * Math.PI * 2));
      pose.tilt = (pose.tilt || 0) * (1 - k) + this.lieSide * (T.tilt - b * 1.2) * k;
      pose.kickL = pose.kickL * (1 - k) + T.kickL * k;
      pose.kickR = pose.kickR * (1 - k) + T.kickR * k;
      pose.armL = pose.armL * (1 - k) + (T.armL + b * 0.04) * k;
      pose.armR = pose.armR * (1 - k) + (T.armR + b * 0.04) * k;
      pose.head = pose.head * (1 - k) + (T.head - b * 0.03) * k * this.lieSide * this.facing;
      pose.mane = pose.mane * (1 - k) + (T.mane + b * 0.18) * k;
      pose.sx *= 1 + b * 0.03 * k;
      if (k > 0.5) pose.smear = [0, 0]; // no jolts lying down
      this.lieSitK = T.sit;
    }
    // An inbetween: when one act hands over to another (or to her resting cycle), the first
    // drawing of the new one is drawn halfway from the last one, so she doesn't snap.
    const key = this.act ? this.act.player : this.base;
    if (key !== this.poseKey && this.lastPose && !reducedMotion.matches) {
      for (const f of BLENDED) pose[f] = (pose[f] + this.lastPose[f]) / 2;
      this.poseKey = key;
    } else {
      this.poseKey = key;
    }
    this.lastPose = pose;

    // inertia: moving (walking, jumping, falling, gliding), her hair trails behind and her mane
    // lifts, more the faster she goes; it swings back when she stops
    const dtm = Math.max(0.016, Math.min(0.2, (now - (this.inertiaAt || now)) / 1000));
    this.inertiaAt = now;
    const jx = this.lastPos ? this.pos.x - this.lastPos.x : 0;
    const jy = this.lastPos ? this.pos.y - this.lastPos.y : 0;
    const blink = Math.hypot(jx, jy) > 160; // a teleport, not a motion
    const vx = blink ? 0 : jx / dtm;
    const vy = blink ? 0 : jy / dtm;
    this.lastPos = { x: this.pos.x, y: this.pos.y };
    const speed = Math.min(2500, Math.hypot(vx, vy));
    const want = clamp(-vx / 140, -7, 7);
    this.trailing = (this.trailing || 0) + (want - (this.trailing || 0)) * 0.35; // lags, then swings back
    if (Math.abs(this.trailing) < 0.05) this.trailing = 0;
    p.head = pose.head;
    p.mane = pose.mane + Math.min(0.22, speed / 4000);
    p.hair = pose.hair + this.trailing * this.facing;
    p.armL = pose.armL;
    p.armR = pose.armR;
    p.longL = pose.longL;
    p.longR = pose.longR;
    p.kickL = pose.kickL;
    p.kickR = pose.kickR;
    p.smear = pose.smear;
    p.echo = pose.echo;
    // on a ledge she stays seated: no lifting off it, no sinking through it
    const bob = this.stance === 'sit' ? clamp(pose.bob, -3, 2) : pose.bob;
    // lying down: legs straight, and lifted so her side rests on the ledge instead of sinking in
    p.sit = this.stance === 'sit' ? 1 - (this.lieK || 0) * (1 - (this.lieSitK ?? 0)) : 0;
    this.bob = this.dragging ? 0 : bob - (this.lieK || 0) * (this.lieTune?.lift ?? 42) * this.scale;
    // lean: the window under her moving (feelRide), settling back
    this.lean = (this.lean || 0) * 0.82;
    if (Math.abs(this.lean) < 0.2) this.lean = 0;
    // runLean: running after your pointer (chase.js)
    this.tilt = this.dragging ? 0 : pose.tilt + (this.stance === 'sit' ? this.lean : 0) + (this.runLean || 0);
    this.sx = pose.sx;
    this.sy = pose.sy;
    if (this.debug) Object.assign(p, this.debug); // --dev pose overrides
    if (cue) this.onCue(cue);
  }

  behave(now) {
    if (this.stance === 'fall') {
      this.updateFall(now);
      return;
    }
    if (this.busy || this.dragging) return;
    if (this.hiding) return; // hide-and-seek (play.js): she keeps perfectly still

    if (now > this.nextTwitch) {
      this.nextTwitch = now + rand(5000, 13000);
      if (!reducedMotion.matches && this.mode !== 'sleep') this.twitch();
    }

    // a shard of her mane breaks off now and then and drifts away
    if (now > this.nextShed) {
      this.nextShed = now + rand(4000, 11000) * (this.mode === 'sleep' ? 2.5 : 1);
      if (!reducedMotion.matches && this.stance !== 'peek') this.shed();
    }

    if (this.mode === 'idle' && this.stance !== 'peek' && now > this.nextGaze) {
      this.nextGaze = now + rand(90000, 180000);
      this.gaze();
    }

    if (this.mode === 'idle' && now - this.lastActivity > SLEEP_AFTER) this.setMode('sleep');
    // (she used to come apart down to her mask after DOZE_AFTER asleep: from a distance it looked
    // like she'd vanished, so she now stays as she is, lying down)

    // After midnight, 5 minutes without you touching her (a click, a drag, a throw, ruffling her
    // hair, talking to her in her box): she goes to bed. Her own antics don't count.
    const hour = new Date().getHours();
    if (hour < 6 && this.mode !== 'sleep' && !this.nightSleep && now - this.lastDirect > BEDTIME_AFTER
      && !this.busy && !this.stowed && !this.hidden && !this.hiding && !this.dragging) {
      this.nightSleep = true;
      this.onBedtime?.();
    }

    if (this.stance === 'peek' && now > this.peekUntil) {
      this.unpeek();
      return;
    }

    // the little things she does all the time, every few seconds (antics.js: looking around, a few
    // steps, juggling, stretching, a dance step...)
    if ((this.mode === 'idle' || this.mode === 'work') && now > this.nextIdle && !this.act) {
      this.nextIdle = now + rand(3500, 8000) * this.moveRate;
      if (now < this.nextMove - 2500) this.onIdle?.(); // not right before she goes somewhere
    }

    // moveRate: her mood of the day (mood.js), lazy days are slower
    if (this.mode === 'idle' && now > this.nextMove) {
      this.nextMove = now + rand(15000, 35000) * this.moveRate;
      if (!this.focus) this.wanderStep(); // focus mode (focus.js): she stays put
    }
    // while Claude works she stays around the windows, but still climbs from one to another
    if (this.mode === 'work' && now > this.nextMove) {
      this.nextMove = now + rand(20000, 45000) * this.moveRate;
      this.workStep();
    }

    if (this.mode === 'work' && now - this.lastGlyph > 420) {
      this.lastGlyph = now;
      const h = this.head();
      this.fx.glyph(h.x, h.y - 30);
    }
  }

  // What she does with herself when nobody needs her.
  wanderStep() {
    if (!this.wander || this.stance === 'peek') {
      if (this.stance !== 'peek') this.flourish();
      return;
    }
    // now and then something of her own instead (antics.js: walking about, boredom, size...)
    if (Math.random() < 0.4 && this.onAntic?.()) return;
    // windows are where she likes to be: she mostly sits on them, and hops from one to another
    if (this.stance === 'sit') {
      const r = Math.random();
      const other = r >= 0.3 && r < 0.75 ? this.pickSeat({ except: this.perch?.id, any: true }) : null;
      if (r < 0.2) this.flourish();
      else if (r < 0.3 && this.canPossess()) this.possess();
      else if (other) this.hopTo(other); // climbing from ledge to ledge
      else if (r < 0.85) this.fall(); // just hops off the ledge
      else this.teleport(this.spot('random'));
      return;
    }
    const seat = this.pickSeat({ any: Math.random() < 0.5 });
    const r = Math.random();
    if (seat && r < 0.75) this.hopTo(seat); // jumps up onto it (teleports if it's far)
    else if (r < 0.75) this.peek();
    else if (r < 0.92) this.teleport(this.spot('random'));
    else this.flourish();
  }

  workStep() {
    if (!this.wander || this.stance === 'peek') return;
    const seat = this.pickSeat({ except: this.perch?.id, any: true });
    if (seat && Math.random() < 0.7) this.hopTo(seat);
    else this.flourish();
  }

  flourish() {
    if (this.stance === 'sit') this.perform(pick(['look', 'look', 'split']));
    else this.perform(pick(['spin', 'look', 'hop', 'curious', 'split']), this.towardCenter());
  }

  // ---------- acting ----------

  // Play an act from acting.js. Resolves when it's over (or cut off by a stronger one).
  perform(name, dir = 0, { reach = 1 } = {}) {
    if (this.stowed || this.dormant) return Promise.resolve(); // nobody to act: she's in her biochip, or just her mask
    // asleep, she doesn't react to anything (a notification, a window, an event): only to you
    // touching her, which wakes her first. Her own moves (busy: going to bed) still play.
    if (this.mode === 'sleep' && !this.busy) return Promise.resolve();
    const act = ACTS[name];
    if (reducedMotion.matches && act.fps === 24) {
      if (act.flip) this.facing *= -1;
      return Promise.resolve();
    }
    const next = new Player(name, { dir, reach });
    if (this.act && this.act.player.priority > next.priority) return Promise.resolve();
    this.endAct(false);
    return new Promise((done) => {
      this.act = { player: next, done };
    });
  }

  endAct(completed) {
    const current = this.act;
    if (!current) return;
    this.act = null;
    if (completed && current.player.act.flip) this.facing *= -1;
    current.done();
  }

  setStance(stance, { perch = null, peekSide = null, dir = 0 } = {}) {
    this.stance = stance;
    this.perch = perch;
    this.peekSide = peekSide;
    this.p.sit = stance === 'sit' ? 1 : 0;
    this.base = this.restBase(dir);
    this.pivot();
  }

  // The cycle under her acts: her stance's, or holding her arm out at what she's showing you.
  restBase(dir = 0) {
    const pt = this.pointing;
    if (pt && (this.stance === 'stand' || this.stance === 'sit')) return new Player('pointing', { dir: pt.dir, reach: pt.reach });
    return new Player(this.baseAct(), { dir });
  }

  baseAct() {
    if (this.stance === 'sit') return this.mode === 'sleep' ? 'sleep' : 'sit'; // asleep on a ledge: lying down (animate)
    if (this.stance === 'peek') return 'peek';
    if (this.stance === 'fall') return 'fall';
    return this.mode === 'sleep' ? 'sleep' : 'stand';
  }

  // You touched her: a click, a drag, a throw, a hand in her hair, a word in her box. At night,
  // that's the only thing that wakes her up.
  touch() {
    this.lastDirect = performance.now();
    if (this.nightSleep) {
      this.nightSleep = false;
      if (this.mode === 'sleep') {
        this.setMode('idle');
        this.onWokenAtNight?.();
      }
    }
  }

  setMode(mode) {
    const now = performance.now();
    // asleep for the night: Claude working, a notification, her own antics don't wake her
    if (this.nightSleep && mode !== 'sleep') return;
    if (mode !== 'sleep') this.lastActivity = now;
    // Claude sends events all the time while it works: only a real change of mode holds her
    // in place for a bit, otherwise she would never move
    if (this.mode === mode) return;
    this.nextMove = Math.max(this.nextMove, now + rand(15000, 30000));
    this.nextGaze = Math.max(this.nextGaze, now + rand(30000, 70000));
    const prev = this.mode;
    this.mode = mode;
    if (mode === 'sleep') this.sleptAt = now;
    this.onMode?.(mode, prev);
    if (this.stance === 'stand' || this.stance === 'sit') this.base = this.restBase();
    // falling asleep standing: she'd rather go and lie down somewhere (antics.js)
    if (mode === 'sleep' && this.stance === 'stand') this.onWantBed?.();
    const p = this.p;
    if (mode === 'sleep') tween(p, { alpha: 0.85, sparkle: 0.35, boil: 0.4 }, 900, ease.inOut);
    else tween(p, { alpha: 1, sparkle: 1, boil: 0.9 }, 250, ease.out);
  }

  wake() {
    if (this.nightSleep) return; // only you, touching her (touch), wake her up at night
    if (this.mode === 'sleep') this.setMode('idle');
    this.lastActivity = performance.now();
    if (this.dormant) this.rouse(); // down to her mask: she comes back
  }

  // Somewhere to be while Claude works: on the window in front if she can sit on it, else her corner.
  goToWork() {
    this.setMode('work');
    const seat = this.pickSeat({ frontOnly: true });
    if (seat) {
      if (this.stance === 'sit' && this.perch?.id === seat.win.id) return;
      this.hopTo(seat);
      return;
    }
    const post = this.spot('post');
    if (this.stance !== 'stand' || Math.hypot(post.x - this.pos.x, post.y - this.pos.y) > 320) this.teleport(post);
  }

  // Claude did something: come out of hiding.
  attend() {
    this.wake();
    if (this.stance === 'peek' && !this.busy) this.teleport(this.spot('post'));
  }

  twitch() {
    const p = this.p;
    p.glitchSeed = Math.random() * 100;
    p.glitch = rand(0.15, 0.3);
    p.split = 2;
    setTimeout(() => {
      p.glitch = 0;
      p.split = 0;
    }, ON_TWOS * 2);
  }

  // a small jolt each time Claude touches something
  pulse() {
    if (this.busy || reducedMotion.matches) return;
    const p = this.p;
    p.glitchSeed = Math.random() * 100;
    p.glitch = 0.12;
    setTimeout(() => { p.glitch = 0; }, ON_TWOS);
  }

  shed() {
    const s = this.scale;
    const h = this.head();
    const a = rand(-Math.PI * 0.95, -Math.PI * 0.05); // somewhere on the upper rim of the mane
    const r = rand(70, 100) * s;
    this.fx.drift(h.x + Math.cos(a) * r, h.y - 40 * s + Math.sin(a) * r * 0.85, a);
  }

  // A point of the sprite (sprite px) on screen, where she stands, the way she faces.
  toScreen(sx, sy) {
    const s = this.scale;
    return {
      x: this.pos.x + (sx - SPRITE.feet.x) * s * this.facing,
      y: this.pos.y - (SPRITE.feet.y - sy) * s + this.bob,
    };
  }

  // Which arm points to screen side `dir`: 'L' or 'R' (the sprite may be mirrored).
  armToward(dir) {
    return dir * this.facing < 0 ? 'L' : 'R';
  }

  // Shoulder and hand of one arm on screen, at the arm's current angle (same turn as the shader).
  limb(side) {
    const { shoulder, hand, mirror } = SPRITE;
    const a = side === 'L' ? this.p.armL : this.p.armR;
    const k = side === 'L' ? this.p.longL : this.p.longR;
    const vx = (hand.x - shoulder.x) * k, vy = (hand.y - shoulder.y) * k;
    let hx = shoulder.x + Math.cos(a) * vx - Math.sin(a) * vy;
    const hy = shoulder.y + Math.sin(a) * vx + Math.cos(a) * vy;
    let sx = shoulder.x;
    if (side === 'R') {
      hx = mirror - hx;
      sx = mirror - sx;
    }
    return { shoulder: this.toScreen(sx, shoulder.y), hand: this.toScreen(hx, hy) };
  }

  // The satellite. It crosses high over the open side of the screen, slowly, and her hand
  // follows it. Mostly she just looks at it ("gaze"). She sends the red light up to it
  // ("uplink") only when it means something: the first time of the day, and a little while
  // after Claude finishes a long job (earnUplink). The cues in onCue do the sky.
  gaze({ big } = {}) {
    if (this.busy || this.hidden || this.act || this.stance === 'peek' || this.stance === 'fall') return false;
    big ??= this.uplinkDue || this.lastUplinkDay() !== today();
    if (reducedMotion.matches) big = false; // no strobing bolt
    if (big) {
      this.uplinkDue = false;
      try {
        localStorage.setItem(UPLINK_DAY, today());
      } catch {
        // no storage: she'll just do it again next launch
      }
    }
    const dir = this.towardCenter();
    const { w } = this.view;
    const side = this.armToward(dir);
    const { shoulder } = this.limb(side);
    // up and well off to the side, so her arm points at it clear of her mane
    const y = clamp(shoulder.y - rand(280, 400), 50, shoulder.y - 180);
    const x = clamp(shoulder.x + dir * rand(380, 520), 40, w - 40);
    const to = { x: clamp(x + dir * rand(170, 260), 30, w - 30), y: y - rand(10, 40) };
    const sat = this.fx.satellite({ x, y }, to, { duration: 9500 });
    // how far up the arm must come to point at it right now (it hangs ~30 degrees low at rest)
    const reach = () => {
      const at = sat.pos();
      const sh = this.limb(side).shoulder;
      return clamp(Math.atan2(sh.y - at.y, Math.abs(at.x - sh.x)) + 0.52, 0.5, 1.6);
    };
    // from her fingertips to it
    const road = () => [this.limb(side).hand, sat.pos()];
    this.sky = { sat, road, dir, side, motes: null, surge: null, head: null };
    if (!big) this.onGaze?.('start');
    this.perform(big ? 'uplink' : 'gaze', dir, { reach }).then(() => {
      this.clearSky();
      if (big) this.onGaze?.('end');
    });
    return true;
  }

  lastUplinkDay() {
    try {
      return localStorage.getItem(UPLINK_DAY);
    } catch {
      return null;
    }
  }

  // Claude just finished a long job: the next time she looks up, once things have settled, it's the whole thing.
  earnUplink() {
    this.uplinkDue = true;
    this.nextGaze = performance.now() + rand(25000, 40000);
  }

  clearSky() {
    if (!this.sky) return;
    const { sat, motes, surge } = this.sky;
    surge?.break();
    motes?.home(...this.moved());
    sat.fade();
    this.sky = null;
    tween(this.p, { sparkle: this.mode === 'sleep' ? 0.35 : 1 }, 400, ease.out);
  }

  // How far her head has moved since her stars lifted off it.
  moved() {
    const was = this.sky?.head;
    if (!was) return [0, 0];
    const h = this.head();
    return [h.x - was.x, h.y - was.y];
  }

  // Points on her mane, where her white specks are (for the stars that lift off it).
  manePoints(n) {
    const s = this.scale;
    const h = this.head();
    return Array.from({ length: n }, () => {
      const a = rand(0, Math.PI * 2), r = Math.sqrt(Math.random());
      return { x: h.x + Math.cos(a) * r * 92 * s, y: h.y - 44 * s + Math.sin(a) * r * 66 * s };
    });
  }

  // Red sparks off her fingers: she's hacking something. On a window, she jacks into it:
  // the sparks go down into the ledge and run along it.
  spark() {
    if (this.busy || this.hidden || reducedMotion.matches || this.stance === 'peek' || this.stance === 'fall') return;
    const s = this.scale;
    const side = Math.random() < 0.5 ? 'L' : 'R';
    const { hand } = this.limb(side);
    const out = (side === 'L' ? -1 : 1) * this.facing;
    if (this.stance === 'sit') {
      const ledge = this.pos.y - (SPRITE.feet.y - SPRITE.hip) * s - 3;
      const at = { x: hand.x + out * rand(10, 40) * s, y: ledge };
      const run = { x: at.x + out * rand(90, 200), y: ledge + rand(-2, 2) };
      this.fx.bolt(hand, at, { life: 200, forks: 1, width: 2 });
      this.fx.bolt(at, run, { life: 260, forks: 2, width: 2 });
    } else {
      for (let i = 0; i < 2; i++) {
        const to = { x: hand.x + out * rand(30, 80) * s, y: hand.y + rand(-50, 30) * s };
        this.fx.bolt(hand, to, { life: rand(140, 220), forks: 1, width: 2 });
      }
    }
    this.voice.play('bolt', { soft: true });
  }

  // The menace: a jolt of red lightning at your pointer, and a grin.
  // force: she means it (play.js, when you annoy her): whatever she's doing, it goes. Sitting or
  // peeking, there's no arm to swing: the lightning comes straight out of her head.
  zap(x, y, { force = false } = {}) {
    if (force && !this.busy && !this.hidden && !reducedMotion.matches) {
      if (this.act) this.endAct(false);
      if (this.stance !== 'stand') {
        const h = this.head();
        this.fx.bolt({ x: h.x, y: h.y - 30 * this.scale }, { x, y }, { life: 420, forks: 3, width: 3 });
        this.fx.crackle({ x, y }, { life: 600, radius: 40, count: 3 });
        this.voice.play('bolt');
        return true;
      }
    }
    if (this.busy || this.hidden || this.act || reducedMotion.matches || this.stance !== 'stand') return false;
    const dir = x < this.pos.x ? -1 : 1;
    const side = this.armToward(dir);
    const reach = () => {
      const sh = this.limb(side).shoulder;
      return clamp(Math.atan2(sh.y - y, Math.abs(x - sh.x)) + 0.52, -0.3, 1.6);
    };
    this.zapAt = { x, y, side, dir };
    this.perform('zap', dir, { reach });
    return true;
  }

  // Where a cut-in goes, as fx.cutin's (x, y, dir): next to her head on the `dir` side, else on
  // the other side (unless `flip` is off because something is going on there), else over her mane.
  cutinAt(dir, { flip = true } = {}) {
    const s = this.scale;
    const h = this.head();
    const gap = 85 * s + 24, width = 274; // the band plus its slant, see fx.js
    const fits = (d) => (d > 0 ? h.x + gap + width < this.view.w - 8 : h.x - gap - width > 8);
    if (fits(dir)) return [h.x + dir * gap, h.y - 18, dir];
    if (flip && fits(-dir)) return [h.x - dir * gap, h.y - 18, -dir];
    return [clamp(h.x - width / 2, 8, this.view.w - width - 8), Math.max(56, h.top - 58), 1];
  }

  // Flat-colour impact frames, one drawing each.
  async flash(colors) {
    const p = this.p;
    for (const color of colors) {
      p.sil = color;
      p.silAmount = 1;
      this.drawFrame();
      await sleep(ON_ONES);
    }
    p.silAmount = 0;
  }

  // Effects and sounds pinned to drawings of an act (the third item of a key in acting.js).
  onCue(cue) {
    const s = this.scale;
    const h = this.head();
    const mane = { x: h.x, y: h.y - 40 * s };
    switch (cue) {
      case 'zzz': // asleep: a little z floats up from her
        if (this.mode === 'sleep') this.fx.zee(h.x + (this.lieK > 0.3 ? this.lieSide * 10 * s : this.facing * -20 * s), h.y - (this.lieK > 0.3 ? 70 : 50) * s);
        break;
      case 'toss': // juggling: sparks of data going up from her hands
        this.fx.burst(h.x + rand(-30, 30) * s, h.y + 40 * s, { count: 3, power: 0.25, spread: 10 });
        this.fx.glyph(h.x + rand(-40, 40) * s, h.y + 10 * s);
        break;
      case 'trace': { // drawing in the air: a spark left where the fingertip goes
        const d = this.act?.player.dir || this.towardCenter();
        this.fx.ring(h.x + d * rand(90, 140) * s, h.y + rand(-20, 40) * s, { size: 0.15 });
        break;
      }
      case 'gather': // shards sucked into the mane before it blows
        this.fx.burst(mane.x, mane.y, { count: 18, inward: true, power: 0.7, spread: 170 * s });
        break;
      case 'launch':
        this.voice.play('rise');
        this.fx.slices(h.x - 70 * s, h.y - 40 * s, 170 * s, 300 * s, { count: 5 });
        break;
      case 'peak':
        this.voice.play('done');
        this.fx.lines(mane.x, mane.y, { inner: 150 * s + 30 });
        this.fx.ring(mane.x, mane.y);
        this.fx.burst(mane.x, mane.y, { count: 34, power: 1.2, spread: 140 * s });
        setTimeout(() => this.flash([GREEN, INK, GREEN]), 0);
        break;
      case 'speak':
        this.fireSpeak();
        break;
      case 'laugh':
        this.fx.cutin(...this.cutinAt(this.act?.player.dir || this.towardCenter()), { kind: pick(['laugh', 'grin']) });
        break;
      case 'stare': // every eye she has, on you
        this.fx.cutin(...this.cutinAt(this.act?.player.dir || this.towardCenter()), { kind: 'many', life: 640 });
        break;
      case 'notice':
        this.twitch();
        break;
      case 'zap':
        if (this.zapAt) {
          const { x, y, side } = this.zapAt;
          this.fx.bolt(this.limb(side).hand, { x, y }, { life: 240, forks: 2, width: 3 });
          this.fx.burst(x, y, { count: 8, power: 0.35, spread: 16 });
          this.fx.ring(x, y, { size: 0.22 });
          this.voice.play('bolt');
        }
        break;
      case 'grin':
        if (this.zapAt && Math.random() < 0.6) this.fx.cutin(...this.cutinAt(-this.zapAt.dir), { kind: 'look', life: 560 });
        this.zapAt = null;
        break;
      // pointing at something (pointAt)
      case 'spot': // her head snaps to it: a glint where she's looking
        if (this.pointing) {
          const { aim } = this.pointing;
          this.fx.ring(aim.x, aim.y, { size: 0.18 });
          this.voice.play('tick');
        }
        break;
      case 'coil': // winding up: shards pulled into her, a crackle
        this.fx.burst(h.x, h.y + 40 * s, { count: 10, inward: true, power: 0.45, spread: 90 * s });
        this.voice.play('bolt', { soft: true });
        break;
      case 'lock': { // the strike: lightning off her fingertip, the reticle slams onto it
        const pt = this.pointing;
        if (pt && !pt.pointer) {
          const hand = this.limb(pt.side).hand;
          pt.pointer = this.fx.pointer(() => this.limb(pt.side).hand, pt.rect, pt.aim, { label: pt.label });
          if (!reducedMotion.matches) {
            this.fx.bolt(hand, pt.aim, { life: 260, forks: 3, width: 3 });
            this.fx.ring(pt.aim.x, pt.aim.y, { size: 0.55 });
            this.fx.burst(pt.aim.x, pt.aim.y, { count: 12, power: 0.5, spread: 20 });
            // her eyes lock on, on the side away from it
            this.fx.cutin(...this.cutinAt(-pt.dir, { flip: false }), { kind: 'eyes', life: 480 });
          }
          this.voice.play('bolt');
        }
        break;
      }
      case 'tap':
        this.pointing?.pointer?.tap();
        break;
      case 'minds':
        this.twitch();
        break;
      case 'snap':
        this.twitch();
        this.voice.play('tick');
        break;
      default:
        if (this.sky) this.skyCue(cue);
        break;
    }
  }

  // The satellite's cues (acting.js "gaze" and "uplink").
  skyCue(cue) {
    const s = this.scale;
    const sky = this.sky;
    const hand = () => this.limb(sky.side).hand;
    switch (cue) {
      case 'glint':
        this.voice.play('star');
        break;
      case 'starlight': // her specks catch its light
        tween(this.p, { sparkle: 1.8 }, 500, ease.out);
        break;
      case 'stars': // they lift off and become a sky; her mane goes dark without them
        sky.head = this.head();
        sky.motes = this.fx.motes(this.manePoints(30), { lift: 230 * s + 60, spread: 320 * s + 80 });
        tween(this.p, { sparkle: 0.15 }, 500, ease.out);
        break;
      case 'align': // into a road, from her fingers to it
        sky.motes?.align(sky.road);
        this.voice.play('tick');
        break;
      case 'charge': {
        this.fx.crackle(hand, { life: 640, radius: 70 * s + 14, count: 3 });
        const at = hand();
        this.fx.burst(at.x, at.y, { count: 14, inward: true, power: 0.5, spread: 90 * s });
        this.fx.cutin(...this.cutinAt(-sky.dir, { flip: false }), { kind: 'eyes', life: 600 }); // never over the road
        this.voice.play('charge');
        break;
      }
      case 'surge': { // the red light goes up
        const at = hand();
        sky.surge = this.fx.surge(sky.road, {
          onHit: () => {
            const top = sky.sat.pos();
            sky.sat.twinkle(1.25);
            this.fx.ring(top.x, top.y, { size: 0.55 });
            this.fx.lines(top.x, top.y, { inner: 60, life: 460 });
            this.voice.play('star');
          },
        });
        sky.motes?.light(125);
        this.fx.ring(at.x, at.y, { size: 0.6 });
        this.flash([INK, RED]);
        this.voice.play('bolt');
        this.voice.play('rise');
        break;
      }
      case 'break':
        sky.surge?.break();
        sky.surge = null;
        sky.motes?.dim();
        this.voice.play('tick');
        break;
      case 'twinkle': { // and it answers
        const at = sky.sat.pos();
        sky.sat.twinkle(1);
        this.fx.ring(at.x, at.y, { size: 0.4 });
        this.voice.play('star');
        break;
      }
      case 'glimmer':
        sky.sat.twinkle(0.55);
        if (!sky.motes) this.voice.play('star');
        break;
      case 'home': // her stars come back to her, and her mane lights up with them
        sky.motes?.home(...this.moved());
        sky.motes = null;
        tween(this.p, { sparkle: 1.7 }, 400, ease.out).then(() => tween(this.p, { sparkle: 1 }, 700, ease.inOut));
        break;
    }
  }

  fireSpeak() {
    const fn = this.onSpeak;
    this.onSpeak = null;
    fn?.();
  }

  async hurt() {
    this.perform('flinch');
    if (reducedMotion.matches) return;
    const p = this.p;
    p.sil = RED;
    p.silAmount = 1;
    this.drawFrame();
    await sleep(ON_TWOS);
    p.silAmount = 0;
    p.glitchSeed = Math.random() * 100;
    p.glitch = 0.7;
    p.split = 7;
    await tween(p, { glitch: 0, split: 0 }, 450, ease.out);
  }

  // Job done: the victory sequence (acting.js), its effects on cue. onSpeak runs when she
  // comes back down (that's when the "done" panel comes in), or at the end if anything cut it short.
  async celebrate({ onSpeak } = {}) {
    this.onSpeak = onSpeak;
    if (reducedMotion.matches || this.stowed || this.dormant) {
      this.voice.play('done');
      this.fireSpeak();
      return;
    }
    await this.perform('victory', this.towardCenter());
    this.fireSpeak();
  }

  // ---------- moving around ----------

  // Collapse into a line of light and go. Leaves her invisible; the caller puts her somewhere.
  async vanish({ beam = true } = {}) {
    const p = this.p;
    const s = this.scale;
    const from = { ...this.pos };
    const head = this.head();
    if (this.sky) this.endAct(false); // the satellite stays here, she doesn't
    this.stopPointing(); // nor does what she was showing you
    if (reducedMotion.matches) {
      await tween(p, { alpha: 0 }, 160, ease.linear);
      return head;
    }
    this.voice.play('teleport-out');
    p.glitchSeed = Math.random() * 100;
    await tween(p, { glitch: 0.35, split: 3 }, 90, ease.linear);
    this.fx.burst(head.x, head.y + 70 * s, { count: 22, spread: 150 * s });
    this.fx.slices(head.x - 70 * s, head.y - 40 * s, 170 * s, 320 * s);
    await tween(p, { collapse: 1, glitch: 1, dissolve: 0.5, split: 9 }, 170, ease.in);
    p.alpha = 0;
    const ground = from.y - (this.p.sit ? (SPRITE.feet.y - SPRITE.hip) * s : 0);
    if (!this.upside) {
      // the void she leaves behind, like in the show: a black slit with a red line in it
      this.fx.slit(from.x - 10 * s * this.facing, head.top, ground, { width: 56 * s + 10 });
      if (beam) this.fx.beam(from.x, ground, { width: 40 * s + 8 });
    }
    return head;
  }

  // Come back at `to`: a column of light down to her, the body unfolding, two impact frames.
  async arrive(to, { face = null, stance = 'stand', perch = null, peekSide = null, dir = 0, fromHead = null, beam = true } = {}) {
    const p = this.p;
    const s = this.scale;
    // wherever she was headed, she lands on the screen: the spot may date from before a move
    to = { x: clamp(to.x, 40, this.view.w - 40), y: stance === 'sit' ? to.y : Math.min(to.y, this.floor) };
    this.lastGoal = `${Math.round(to.x)},${Math.round(to.y)}`; // for the journal, if she's ever lost again
    const facing = face ?? (to.x > this.view.w / 2 ? 1 : -1);
    const toHead = this.head(to, facing);
    if (fromHead && !reducedMotion.matches) {
      this.fx.streak(fromHead.x, fromHead.y, toHead.x, toHead.y);
      await sleep(60);
    }
    this.pos = { ...to };
    this.facing = facing;
    this.setStance(stance, { perch, peekSide, dir });
    this.place();

    if (reducedMotion.matches) {
      p.collapse = 0;
      p.dissolve = 0;
      await tween(p, { alpha: this.mode === 'sleep' ? 0.85 : 1 }, 160, ease.linear);
      return;
    }
    const ground = stance === 'sit' ? to.y - (SPRITE.feet.y - SPRITE.hip) * s : to.y;
    if (beam) this.fx.beam(to.x, ground, { down: true, width: 40 * s + 8 });
    // her pieces spiral back in, mane shards and green eye-stars
    this.fx.vortex(toHead.x, toHead.y + 30 * s, { radius: 170 * s + 40 });
    this.voice.play('teleport-in');
    await sleep(50);

    p.alpha = this.mode === 'sleep' ? 0.85 : 1;
    p.glitchSeed = Math.random() * 100;
    await tween(p, { collapse: 0, dissolve: 0, glitch: 0.6, split: 6 }, 200, ease.out);

    // two impact frames, the anime way
    p.sil = GREEN;
    p.silAmount = 1;
    this.drawFrame();
    await sleep(ON_ONES);
    p.sil = INK;
    this.drawFrame();
    await sleep(ON_ONES);
    p.silAmount = 0;
    this.fx.burst(toHead.x, toHead.y + 60 * s, { count: 10, power: 0.55, spread: 110 * s });
    if (stance === 'sit') this.perform('plop');
    await tween(p, { glitch: 0, split: 0 }, 220, ease.out);
  }

  // Leave in a column of light, reappear somewhere else.
  async teleport(to, opts = {}) {
    if (this.stowed) return; // put away: she stays in her biochip
    if (this.busy || this.dormant) {
      this.pending = { to, opts };
      if (this.dormant) this.rouse(); // asleep, down to her mask: she comes back first, then goes
      return;
    }
    this.busy = true;
    this.wake();
    this.onTeleport?.('start');
    const fromHead = await this.vanish();
    await sleep(70);
    await this.arrive(to, { ...opts, fromHead });
    await this.settle();
  }

  // After a move: free again, stay put a while, the panel back, and the move that was waiting, if any.
  async settle() {
    this.busy = false;
    this.nextMove = Math.max(this.nextMove, performance.now() + rand(25000, 60000));
    this.onTeleport?.('end');
    if (this.pending) {
      const next = this.pending;
      this.pending = null;
      await this.teleport(next.to, next.opts);
    }
  }

  // Ctrl+Alt+C: she folds herself into her biochip in the corner (she pulls in, collapses, and
  // a streak runs from her to the chip). Asleep down to her mask, it's the mask that goes.
  async stow() {
    if (this.stowed || this.stowing) return;
    this.stowing = true;
    for (let i = 0; this.busy && i < 30; i++) await sleep(100); // let a move finish
    this.busy = true;
    this.endAct(false);
    this.onTeleport?.('start');
    let from = null;
    if (this.dormant) {
      from = this.head();
      this.dormant = false;
      this.onDoze?.('end');
    }
    if (reducedMotion.matches) {
      await tween(this.p, { alpha: 0 }, 160, ease.linear);
    } else {
      if (!from) {
        await this.perform('fold');
        from = await this.vanish({ beam: false });
      }
      const chip = this.chipAt();
      this.fx.streak(from.x, from.y, chip.x, chip.y);
      await sleep(60);
      this.fx.burst(chip.x, chip.y, { count: 12, inward: true, power: 0.45, spread: 40 });
      this.fx.ring(chip.x, chip.y, { size: 0.3 });
      this.voice.play('land');
    }
    this.setStance('stand');
    this.stowed = true;
    this.stowing = false;
    this.hidden = true;
    this.root.hidden = true;
    this.onStow?.();
    this.busy = false;
    if (this.unstowAfter) this.unstow(); // called back out while she was folding herself away
  }

  // Already in it, no show (put away last time, she starts in it).
  stowNow() {
    this.stowed = true;
    this.hidden = true;
    this.root.hidden = true;
    this.p.alpha = 0;
    this.onTeleport?.('start');
    this.onStow?.();
  }

  // Asleep a while: her mane and her body come apart (shards drifting down, the drawing
  // dissolving) and all that's left is her mask, floating there, eyes shut (chip.js Mask).
  async doze() {
    if (this.busy || this.dormant || this.stowed || this.hidden) return;
    this.busy = true;
    this.endAct(false);
    this.onTeleport?.('start');
    this.dozedOn = this.stance === 'sit' ? { ...this.perch } : null;
    const s = this.scale;
    const h = this.head();
    if (!reducedMotion.matches) {
      for (let i = 0; i < 10; i++) this.shed();
      this.fx.burst(h.x, h.y + 60 * s, { count: 10, power: 0.3, spread: 120 * s });
      this.p.glitchSeed = Math.random() * 100;
      await tween(this.p, { dissolve: 0.9, glitch: 0.25, sparkle: 0 }, 700, ease.in);
    }
    this.setStance('stand'); // no ledge to fall off while she's away
    Object.assign(this.p, { alpha: 0, dissolve: 0, glitch: 0 });
    this.hidden = true;
    this.root.hidden = true;
    this.dormant = true;
    this.onDoze?.('start', h);
    this.busy = false;
  }

  // Back from her mask: her eyes snap open, then she comes back together around it,
  // on her ledge again if it's still there.
  async rouse() {
    if (!this.dormant) return;
    this.dormant = false;
    this.busy = true;
    this.onDoze?.('waking');
    if (this.mode === 'sleep') this.setMode('idle');
    this.lastActivity = performance.now();
    await sleep(reducedMotion.matches ? 0 : 280);
    this.onDoze?.('end');
    this.hidden = false;
    this.root.hidden = false;
    Object.assign(this.p, { alpha: 0, collapse: 0.6, dissolve: 0.5, glitch: 0, split: 0, sparkle: 1 });
    const win = this.dozedOn && this.windows.wins.find((w) => w.id === this.dozedOn.id);
    if (win && this.canSit(win) && !this.covered(win, win.x + this.dozedOn.dx)) {
      await this.arrive(this.seat(win, this.dozedOn.dx), { face: this.facing, stance: 'sit', perch: this.dozedOn, beam: false });
    } else {
      await this.arrive({ x: this.pos.x, y: this.dozedOn ? this.floor : this.pos.y }, { face: this.facing, beam: false });
    }
    this.dozedOn = null;
    await this.settle();
  }

  // Out of her biochip: a streak from the chip, and she arrives next to it.
  async unstow() {
    this.unstowAfter = this.stowing;
    if (!this.stowed) return;
    this.stowed = false;
    this.busy = true;
    this.onUnstow?.();
    this.hidden = false;
    this.root.hidden = false;
    if (this.mode === 'sleep') this.setMode('idle');
    this.lastActivity = performance.now();
    Object.assign(this.p, { alpha: 0, collapse: 1, dissolve: 0.5, glitch: 0, split: 0 });
    const chip = this.chipAt();
    const to = this.spot('chip');
    const face = to.x > this.view.w / 2 ? 1 : -1;
    if (!reducedMotion.matches) {
      const toHead = this.head(to, face);
      this.fx.burst(chip.x, chip.y, { count: 10, power: 0.5, spread: 30 });
      this.fx.streak(chip.x, chip.y, toHead.x, toHead.y);
      await sleep(60);
    }
    await this.arrive(to, { face, beam: false });
    await this.settle();
  }

  // Climbing: a real jump, in an arc, from where she is onto that window's ledge
  // (too far away, she teleports instead).
  async hopTo({ win, dx }) {
    if (this.mode === 'sleep' && this.stance === 'sit') return; // lying down asleep: she stays put
    const to = this.seat(win, dx);
    const dist = Math.hypot(to.x - this.pos.x, to.y - this.pos.y);
    if (this.busy || this.hidden || dist > 1700 || reducedMotion.matches || this.stance === 'peek' || this.stance === 'fall') {
      return this.sitOn({ win, dx });
    }
    this.busy = true;
    this.endAct(false);
    this.onTeleport?.('start');
    const s = this.scale;
    // sitting on a ledge, she first gets up onto it: her feet where her hips were
    if (this.stance === 'sit') this.pos = { x: this.pos.x, y: this.pos.y - (SPRITE.feet.y - SPRITE.hip) * s };
    const from = { ...this.pos };
    this.facing = to.x >= from.x ? 1 : -1;
    // the crouch, then the push off
    this.setStance('stand');
    this.place();
    await this.perform('hop');
    this.fx.burst(from.x, from.y - 10 * s, { count: 8, power: 0.4, spread: 30 * s });
    this.footprints(from.x, from.y);
    this.voice.play('rise', { soft: true });
    // a long jump: now and then a spin in the air
    if (dist > 450 && Math.random() < 0.35) this.perform('spin');
    const apex = Math.max(SPRITE.height * s * 0.6, Math.min(from.y, to.y) - (130 + Math.abs(to.x - from.x) * 0.12) * s);
    const dur = clamp(380 + dist * 0.35, 420, 950);
    const t0 = performance.now();
    await new Promise((resolve) => {
      const step = () => {
        const t = Math.min(1, (performance.now() - t0) / dur);
        const u = 1 - t;
        this.pos = { x: lerp(from.x, to.x, t), y: u * u * from.y + 2 * u * t * apex + t * t * to.y };
        this.place();
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
    this.pos = to;
    this.setStance('sit', { perch: { id: win.id, dx } });
    this.place();
    this.perform('plop');
    this.voice.play('land');
    this.fx.burst(to.x, to.y - (SPRITE.feet.y - SPRITE.hip) * s, { count: 10, power: 0.5, spread: 50 * s });
    this.footprints(to.x, win.y);
    this.busy = false;
    this.onTeleport?.('end');
    this.nextMove = Math.max(this.nextMove, performance.now() + rand(25000, 60000));
  }

  // Walking, for real: step by step to x, along the floor or the ledge she stands on, footprints
  // behind her. Resolves when she's there (or something more important cut in).
  async walkTo(x, { speed = 150 } = {}) {
    if (this.busy || this.stance === 'fall' || this.stance === 'peek' || this.mode === 'sleep') return false;
    const s = this.scale;
    const target = clamp(x, 60, this.view.w - 60);
    if (Math.abs(target - this.pos.x) < 8) return false;
    this.busy = true;
    this.endAct(false);
    const dir = Math.sign(target - this.pos.x);
    const facing = dir > 0 ? -1 : 1;
    // facing the wrong way: she turns around first
    if (this.facing !== facing && !reducedMotion.matches) await this.perform('turn');
    this.facing = facing;
    const vmax = speed * s * 1.6;
    let v = 0;
    let last = performance.now();
    let trail = 0;
    let steps = 0;
    await new Promise((done) => {
      const tick = (now) => {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        const dx = target - this.pos.x;
        if (Math.abs(dx) < 2 || this.stowed || this.hidden || this.dragging) return done();
        // gets going, cruises, slows down for the last stretch
        const want = Math.min(vmax, Math.max(vmax * 0.25, Math.abs(dx) * 3));
        v += (want - v) * Math.min(1, dt * 6);
        const k = v / vmax;
        this.runLean = -dir * (1.5 + 2.5 * k);
        this.drag = -dir * 5 * k; // her hair and mane trail behind
        const move = Math.min(Math.abs(dx), v * dt) * dir;
        this.pos = { x: this.pos.x + move, y: this.pos.y };
        trail += Math.abs(move);
        if (trail > 38 * s) {
          trail = 0;
          steps += 1;
          this.fx.print(this.pos.x + (steps % 2 ? -6 : 6) * s, this.pos.y - 1, { dir: -this.facing, size: s * 1.2 });
        }
        if (!this.act) this.act = { player: new Player('step'), done: () => {} };
        this.place();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    this.runLean = 0;
    this.drag = 0;
    this.endAct(false);
    this.busy = false;
    // the stop: a little sway back and settling
    if (!reducedMotion.matches) this.perform('halt');
    return true;
  }

  // Sitting on a window, she gets up, walks along its top edge and sits back down further on.
  async ledgeWalk() {
    if (this.stance !== 'sit' || this.busy || this.mode === 'sleep') return false;
    const win = this.windows.wins.find((w) => w.id === this.perch?.id);
    if (!win || win.w < 360) return false;
    const s = this.scale;
    let dx = clamp(rand(60, win.w - 190), 60, win.w - 60);
    if (Math.abs(win.x + dx - this.pos.x) < 120 * s) dx = clamp(win.w - (this.pos.x - win.x), 60, win.w - 60);
    const { lo, hi } = this.ledge(win);
    dx = clamp(dx, lo, hi);
    if (this.covered(win, win.x + dx)) return false;
    // up on her feet on the ledge
    this.setStance('stand');
    this.pos = { x: this.pos.x, y: win.y };
    this.place();
    await this.perform('stretch');
    await this.walkTo(win.x + dx);
    const now = this.windows.wins.find((w) => w.id === win.id);
    if (!now || !this.canSit(now)) {
      this.fall();
      return true;
    }
    this.pos = this.seat(now, this.pos.x - now.x);
    this.setStance('sit', { perch: { id: now.id, dx: this.pos.x - now.x } });
    this.place();
    this.perform('plop');
    return true;
  }

  // two neon prints where her feet touched (a ledge, the floor), fading
  footprints(x, y) {
    if (reducedMotion.matches) return;
    const s = this.scale;
    this.fx.print(x - 14 * s, y - 1, { dir: -this.facing, size: s * 1.3 });
    setTimeout(() => this.fx.print(x + 14 * s, y - 1, { dir: -this.facing, size: s * 1.3 }), 90);
  }

  sitOn({ win, dx }) {
    return this.teleport(this.seat(win, dx), { stance: 'sit', perch: { id: win.id, dx }, face: this.facing });
  }

  canPossess() {
    return this.possessWindows && !this.busy && !this.hidden && this.stance === 'sit' && this.mode !== 'sleep' && !reducedMotion.matches
      && this.windows.wins.some((w) => w.id === this.perch?.id && !w.fake); // not her own seat (crate.js)
  }

  // Like in the show, she gets into things: she dives into the window she sits on and takes it
  // over (fx.possess: its frame crackles, it glitches, it looks at you with her eyes), then comes
  // out of another window, or further along this one if there's no other.
  async possess() {
    if (!this.canPossess()) return false;
    const s = this.scale;
    const id = this.perch.id;
    const win = this.windows.wins.find((w) => w.id === id);
    const entry = this.pos.x - win.x;
    this.busy = true;
    this.wake();
    this.onTeleport?.('start');
    await this.perform('dive');
    const head = await this.vanish({ beam: false });
    this.fx.streak(head.x, head.y, this.pos.x, win.y + 40 * s);

    const rect = () => this.windows.wins.find((w) => w.id === id) || null;
    const covers = () => {
      const front = [];
      for (const o of this.windows.wins) {
        if (o.id === id) break;
        front.push(o);
      }
      return front;
    };
    const taken = this.fx.possess(rect, { covers, entry, look: () => this.mouse });
    this.voice.play('bolt');
    await sleep(300);
    this.voice.play('possess');
    await sleep(1600);
    taken.leave();
    await sleep(260);

    const here = rect();
    let seat = this.pickSeat({ except: id });
    if (!seat && here && this.canSit(here)) {
      const { lo, hi } = this.ledge(here);
      const dx = clamp(clamp(here.w - entry + rand(-60, 60), 60, Math.max(60, here.w - 190)), lo, hi); // the other end of it
      if (!this.covered(here, here.x + dx)) seat = { win: here, dx };
    }
    const to = seat ? this.seat(seat.win, seat.dx) : this.spot('random');
    const toHead = this.head(to);
    if (here) {
      // out through the system, from the middle of the window to where she comes out
      this.fx.streak(here.x + here.w / 2, here.y + here.h * 0.46, toHead.x, toHead.y);
      await sleep(60);
    }
    if (seat) this.fx.slit(to.x, toHead.top, seat.win.y, { width: 56 * s + 10 }); // the void she climbs out of
    await this.arrive(to, seat ? { stance: 'sit', perch: { id: seat.win.id, dx: seat.dx }, beam: false } : {});
    await this.settle();
    return true;
  }

  // Lean in from an edge of the screen: vanish, then slide in on twos, three drawings.
  async peek(side = pick(['left', 'right', 'top'])) {
    if (this.busy || this.mode === 'sleep') return;
    const s = this.scale;
    const { w, h } = this.view;
    let at, from, facing, dir;
    if (side === 'left') {
      const y = rand(h * 0.55, this.floor);
      facing = -1;
      dir = 1;
      at = { x: 14 * s, y };
      from = { x: -170 * s, y };
    } else if (side === 'right') {
      const y = rand(h * 0.55, this.floor);
      facing = 1;
      dir = -1;
      at = { x: w - 14 * s, y };
      from = { x: w + 170 * s, y };
    } else {
      // hanging upside down from the top edge, only the head and the mane showing
      const x = rand(w * 0.2, w * 0.8);
      facing = pick([1, -1]);
      dir = x > w / 2 ? -1 : 1;
      at = { x, y: -226 * s };
      from = { x, y: -470 * s };
    }

    this.busy = true;
    this.wake();
    this.onTeleport?.('start');
    if (this.p.alpha > 0) await this.vanish();
    this.pos = { ...from };
    this.facing = facing;
    this.setStance('peek', { peekSide: side, dir });
    this.p.collapse = 0;
    this.p.dissolve = 0;
    this.p.glitch = 0;
    this.p.split = 0;
    this.p.alpha = this.mode === 'sleep' ? 0.85 : 1;
    if (reducedMotion.matches) {
      this.pos = at;
    } else {
      for (const k of [0.45, 0.8, 1]) {
        this.pos = { x: lerp(from.x, at.x, k), y: lerp(from.y, at.y, k) };
        this.drawFrame();
        await sleep(ON_TWOS);
      }
    }
    this.peekFrom = from;
    this.peekUntil = performance.now() + rand(15000, 40000);
    this.busy = false;
    this.onTeleport?.('end');
  }

  // Duck back out of view, then show up somewhere else (or peek from another edge, if shy).
  async unpeek({ shy = false } = {}) {
    if (this.busy || this.stance !== 'peek') return;
    this.busy = true;
    const at = { ...this.pos };
    const from = this.peekFrom || at;
    if (!reducedMotion.matches) {
      for (const k of [0.4, 0.8, 1]) {
        this.pos = { x: lerp(at.x, from.x, k), y: lerp(at.y, from.y, k) };
        this.drawFrame();
        await sleep(ON_TWOS);
      }
    }
    this.p.alpha = 0;
    this.p.collapse = 1;
    this.p.dissolve = 0.5;
    this.busy = false;
    const side = this.peekSide;
    this.setStance('stand');
    if (shy && Math.random() < 0.6) {
      this.peek(pick(['left', 'right', 'top'].filter((x) => x !== side)));
      return;
    }
    this.busy = true;
    this.onTeleport?.('start');
    const seat = this.wander ? this.pickSeat() : null;
    if (seat && Math.random() < 0.4) {
      await this.arrive(this.seat(seat.win, seat.dx), { stance: 'sit', perch: { id: seat.win.id, dx: seat.dx } });
    } else {
      await this.arrive(this.spot('random'));
    }
    this.busy = false;
    this.onTeleport?.('end');
  }

  // Where she'd end up falling straight down from here: a free ledge under her, or the floor.
  landing() {
    const hip = this.pos.y - (SPRITE.feet.y - SPRITE.hip) * this.scale;
    let best = null;
    for (const win of this.windows.wins) {
      if (!this.canSit(win) || win.y < hip - 4) continue;
      if (this.pos.x < win.x + 40 || this.pos.x > win.x + win.w - 40) continue;
      if (this.covered(win, this.pos.x)) continue;
      if (!best || win.y < best.y) best = win;
    }
    if (best) {
      const dx = this.pos.x - best.x;
      return { y: this.seat(best, dx).y, stance: 'sit', perch: { id: best.id, dx } };
    }
    return { y: this.floor, stance: 'stand', perch: null };
  }

  fall() {
    if (this.stance === 'fall') return;
    if (this.sky) this.endAct(false);
    this.pos.x = clamp(this.pos.x, 40, this.view.w - 40);
    this.landingSpot = this.landing();
    this.setStance('fall');
    this.vy = 0;
    this.vx = 0;
    this.lastFall = performance.now();
    if (reducedMotion.matches) this.updateFall(this.lastFall + 10000);
  }

  // Thrown (drop): she flies off with the pointer's speed, bounces off the screen's sides,
  // its top and the floor, and can land on a window ledge on the way down.
  throw(v) {
    if (this.sky) this.endAct(false);
    this.setStance('fall');
    this.vx = clamp(v.x, -3200, 3200);
    this.vy = clamp(v.y, -3000, 2400);
    this.bounces = 0;
    this.thrown = true;
    this.trailAt = 0;
    this.landingSpot = this.landing();
    this.lastFall = performance.now();
    this.p.glitch = 0.2;
    this.fx.lines(this.pos.x, this.pos.y - 120 * this.scale, { inner: 90, life: 300 });
    this.voice.play('teleport-out');
    this.onThrown?.();
  }

  bump(x, y) {
    const s = this.scale;
    this.fx.burst(x, y, { count: 8, power: 0.5, spread: 40 * s });
    this.fx.crackle({ x, y }, { life: 380, radius: 30, count: 2 });
    this.fx.ring(x, y, { size: 0.35 });
    this.p.glitchSeed = Math.random() * 100;
    this.p.glitch = 0.35;
    setTimeout(() => { this.p.glitch = 0; }, ON_ONES * 3);
    this.voice.play('land');
  }

  updateFall(now) {
    const dt = Math.min(0.05, (now - this.lastFall) / 1000);
    this.lastFall = now;
    this.vy = Math.min(this.vy + GRAVITY * dt, 1900);
    if (this.vx) {
      const m = 50 * this.scale;
      let x = this.pos.x + this.vx * dt;
      if (x < m || x > this.view.w - m) {
        x = clamp(x, m, this.view.w - m);
        this.vx = -this.vx * 0.6;
        this.bump(x, this.pos.y - 120 * this.scale);
      }
      // flying fast: a streak of light behind her, like her teleports
      if (Math.hypot(this.vx, this.vy) > 1100 && now - this.trailAt > 45) {
        this.trailAt = now;
        const tail = 110 * this.scale;
        this.fx.streak(this.pos.x, this.pos.y - tail, x, this.pos.y - tail + this.vy * dt, { life: 140 });
      }
      this.pos.x = x;
      this.vx *= Math.pow(0.55, dt); // air drag
      if (Math.abs(this.vx) < 25) this.vx = 0;
      this.landingSpot = this.landing(); // she's moving across: what's under her changes
    }
    const target = this.landingSpot;
    let y = reducedMotion.matches ? target.y : this.pos.y + this.vy * dt;
    const ceiling = SPRITE.height * this.scale * 0.55;
    if (y < ceiling) {
      y = ceiling;
      this.vy = Math.abs(this.vy) * 0.35;
      this.bump(this.pos.x, 10);
    }
    if (y < target.y || this.vy < 0) {
      this.pos.y = y;
      return;
    }
    // thrown hard onto the floor: one more bounce before she lands
    if (target.stance === 'stand' && this.vy > 1100 && (this.bounces || 0) < 2) {
      this.bounces = (this.bounces || 0) + 1;
      this.pos.y = target.y;
      this.vy = -this.vy * 0.38;
      this.bump(this.pos.x, target.y - 20 * this.scale);
      this.perform('land');
      return;
    }
    this.vx = 0;
    this.pos.y = target.y;
    if (this.thrown) {
      this.thrown = false;
      setTimeout(() => this.onLanded?.(), 350);
    }
    this.setStance(target.stance, { perch: target.perch });
    const s = this.scale;
    if (target.stance === 'sit') {
      this.perform('plop');
    } else {
      this.perform('land');
      this.fx.burst(this.pos.x, this.pos.y - 20 * s, { count: 12, power: 0.6, spread: 60 * s });
      this.footprints(this.pos.x, this.pos.y);
    }
    this.voice.play('land');
    const p = this.p;
    p.glitchSeed = Math.random() * 100;
    p.glitch = 0.3;
    setTimeout(() => { p.glitch = 0; }, ON_ONES * 3);
  }

  // First appearance: drop in from the top of the screen.
  async materialize(at) {
    const p = this.p;
    this.pos = { ...at };
    this.faceCenter();
    this.setStance('stand');
    if (reducedMotion.matches) {
      p.alpha = 0;
      this.place();
      await tween(p, { alpha: 1 }, 300, ease.linear);
      return;
    }
    this.busy = true;
    p.alpha = 0;
    p.collapse = 1;
    p.dissolve = 0.5;
    this.place();
    await sleep(250);
    this.fx.beam(at.x, at.y, { down: true, width: 40 * this.scale + 8, life: 260 });
    this.voice.play('teleport-in');
    await sleep(80);
    p.alpha = 1;
    await tween(p, { collapse: 0, dissolve: 0, glitch: 0.5, split: 5 }, 240, ease.out);
    await tween(p, { glitch: 0, split: 0 }, 260, ease.out);
    this.busy = false;
  }

  // Her intro, when she starts: her face big in the top right corner of the screen says hi,
  // then dives down to where she stands and her body unfolds from it (fx.intro).
  // `still`: no motion, it comes and goes where it is (Windows' animations off).
  async intro(at, { label = 'hi', caption = 'PROJECT CAPRICORN', still = reducedMotion.matches } = {}) {
    const p = this.p;
    this.pos = { ...at };
    this.faceCenter();
    this.setStance('stand');
    this.busy = true;
    this.onTeleport?.('start'); // the panel waits for her
    p.alpha = 0;
    p.collapse = 1;
    p.dissolve = 0.5;
    this.place();
    const head = this.head(at, this.facing);
    await this.fx.intro({
      to: { x: head.x, y: head.y, size: 100 * this.scale },
      label,
      caption,
      still,
      onCue: (cue) => {
        if (cue === 'open') this.voice.play('charge'); // her pieces coming in
        else if (cue === 'tear') this.voice.play('teleport-in');
        else if (cue === 'hi') this.voice.play('hello');
        else if (cue === 'dive') this.voice.play('teleport-out');
      },
    });
    await this.arrive(at, { face: this.facing, beam: false });
    this.busy = false;
    this.onTeleport?.('end');
  }

  // ---------- showing you things ----------

  // The point of `rect` (overlay coordinates) she aims at from where she is: its closest point,
  // a little inside. Off her screen (the tray, down in the taskbar), the edge of her screen.
  aimPoint(rect) {
    const { w, h } = this.view;
    const sh = this.limb(this.armToward(rect.x + rect.w / 2 < this.pos.x ? -1 : 1)).shoulder;
    const inset = Math.min(24, rect.w / 3, rect.h / 3);
    return {
      x: clamp(clamp(sh.x, rect.x + inset, rect.x + rect.w - inset), 6, w - 6),
      y: clamp(clamp(sh.y, rect.y + inset, rect.y + rect.h - inset), 6, h - 4),
    };
  }

  // Where to stand to point at `rect`: beside it, on the side with more room, her shoulder a bit
  // below its middle (on the floor for things low on the screen).
  spotNear(rect) {
    const s = this.scale;
    const { w, h } = this.view;
    const side = 150 * s + 30;
    const reach = 230 * s + 90; // from her feet to what she points at: room for the arm to shoot out
    const roomLeft = rect.x, roomRight = w - (rect.x + rect.w);
    let x;
    if (Math.max(roomLeft, roomRight) >= side + 40) {
      x = roomRight >= roomLeft ? rect.x + rect.w + reach : rect.x - reach;
    } else {
      x = rect.x + rect.w / 2 < w / 2 ? w - side : side; // nowhere beside it: the far side of the screen
    }
    x = clamp(x, side, w - side);
    const cy = clamp(rect.y + rect.h / 2, 0, h);
    const shoulderToFeet = (SPRITE.feet.y - SPRITE.shoulder.y) * s;
    const y = cy > h * 0.6 ? this.floor : clamp(cy + shoulderToFeet + 50, SPRITE.height * s + 40, this.floor);
    return { x, y, face: rect.x + rect.w / 2 < x ? 1 : -1 };
  }

  // Go and point at `rect`, and keep pointing (a dashed line from her finger, brackets, `label`)
  // until stopPointing(). Resolves once she's there with her arm out.
  async pointAt(rect, { label = '' } = {}) {
    if (this.stowed) return false;
    this.stopPointing();
    const spot = this.spotNear(rect);
    if (this.stance !== 'stand' || Math.hypot(spot.x - this.pos.x, spot.y - this.pos.y) > 140) {
      await this.teleport({ x: spot.x, y: spot.y }, { face: spot.face });
    }
    if (this.stowed || this.hidden) return false;
    const aim = this.aimPoint(rect);
    const dir = aim.x < this.pos.x ? -1 : 1;
    const side = this.armToward(dir);
    // how far up the arm comes to point at it (it hangs ~30 degrees low at rest)
    const reach = () => {
      const sh = this.limb(side).shoulder;
      return clamp(Math.atan2(sh.y - aim.y, Math.abs(aim.x - sh.x)) + 0.52, -0.6, 1.7);
    };
    this.pointing = { rect, aim, dir, side, reach, label, pointer: null };
    this.base = this.restBase();
    await this.perform('point', dir, { reach });
    if (this.pointing && !this.pointing.pointer) this.onCue('lock'); // the act was cut short
    return true;
  }

  // Done showing: the line reels back into her finger, the reticle lets go, the arm snaps back.
  stopPointing() {
    const pt = this.pointing;
    if (!pt) return;
    this.pointing = null;
    pt.pointer?.retract();
    this.base = this.restBase();
    if (!this.busy && !this.hidden && this.stance === 'stand') this.perform('unpoint', pt.dir);
  }

  // Can she point at this window so you'd see it: not maximized, its top not under other windows.
  canPoint(win) {
    return Boolean(win && !win.max && win.w > 120 && win.y > -10 && !this.covered(win, win.x + win.w / 2));
  }

  // Show up next to the mouse pointer (used when Claude needs you).
  async summon(cursor) {
    const { w, h } = this.view;
    const s = this.scale;
    const side = 150 * s + 30;
    const dx = cursor.x > w / 2 ? -260 : 260;
    const to = {
      x: clamp(cursor.x + dx, side, w - side),
      y: clamp(cursor.y + SPRITE.height * s * 0.45, SPRITE.height * s + 120, h - 6),
    };
    if (this.stance === 'stand' && Math.hypot(to.x - this.pos.x, to.y - this.pos.y) < 160) {
      this.facing = cursor.x < this.pos.x ? 1 : -1;
      return;
    }
    await this.teleport(to, { face: cursor.x < to.x ? 1 : -1 });
  }

  setHidden(hidden) {
    this.hidden = hidden;
    this.root.hidden = hidden;
  }

  // ---------- pointer ----------

  bindPointer() {
    let down = null;
    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.hit(e.clientX, e.clientY)) this.onMenu?.(); // right-click: her menu
    });
    let trail = []; // the pointer's last positions while dragging her: how hard she gets thrown
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || !this.hit(e.clientX, e.clientY)) return;
      this.touch(); // a direct touch, even while she's busy
      if (this.busy) return;
      down = { x: e.clientX, y: e.clientY, pos: { ...this.pos } };
      trail = [];
    });
    window.addEventListener('mousemove', (e) => {
      // a window she's in watches it (never further than her screen: nothing to look at or run to out there)
      if (e.clientX >= 0 && e.clientX <= this.view.w && e.clientY >= 0 && e.clientY <= this.view.h) this.mouse = { x: e.clientX, y: e.clientY };
      if (down) {
        const dx = e.clientX - down.x, dy = e.clientY - down.y;
        if (!this.dragging && Math.hypot(dx, dy) > 5 && !this.busy) {
          this.dragging = true;
          if (this.upside) {
            // flip back upright under the pointer
            down.pos = { x: down.pos.x, y: down.y + (SPRITE.feet.y - SPRITE.head.y) * this.scale };
          }
          this.endAct(false);
          this.setStance('stand');
          this.p.glitch = 0.18;
          this.p.split = 2;
          this.onTeleport?.('start');
        }
        if (this.dragging) {
          this.pos = {
            x: clamp(down.pos.x + dx, 40, this.view.w - 40),
            y: clamp(down.pos.y + dy, SPRITE.height * this.scale * 0.5, this.floor),
          };
          this.p.glitchSeed = Math.random() * 100;
          this.place();
          const t = performance.now();
          trail.push({ x: e.clientX, y: e.clientY, t });
          while (trail.length > 2 && t - trail[0].t > 90) trail.shift();
        }
        return;
      }
      this.notice(e.clientX, e.clientY);
    });
    window.addEventListener('mouseup', () => {
      if (!down) return;
      const wasDragging = this.dragging;
      down = null;
      this.dragging = false;
      if (wasDragging) {
        tween(this.p, { glitch: 0, split: 0 }, 200, ease.out);
        this.onTeleport?.('end');
        // let go while moving fast: thrown
        const a = trail[0];
        const b = trail[trail.length - 1];
        const dt = a && b ? (performance.now() - a.t) / 1000 : 0;
        const v = dt > 0.01 && dt < 0.2 ? { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt } : null;
        trail = [];
        if (v && Math.hypot(v.x, v.y) > 900 && !reducedMotion.matches) this.throw(v);
        else this.drop();
      } else {
        this.onClick?.();
      }
    });
  }

  // Let go of her: onto a ledge if her hips are right at one, otherwise she falls.
  drop() {
    const s = this.scale;
    const hip = this.pos.y - (SPRITE.feet.y - SPRITE.hip) * s;
    for (const win of this.windows.wins) {
      if (!this.canSit(win) || Math.abs(hip - win.y) > 26) continue;
      if (this.pos.x < win.x + 40 || this.pos.x > win.x + win.w - 40 || this.covered(win, this.pos.x)) continue;
      const dx = this.pos.x - win.x;
      this.pos = this.seat(win, dx);
      this.setStance('sit', { perch: { id: win.id, dx } });
      this.perform('plop');
      this.voice.play('land');
      return;
    }
    if (this.pos.y < this.floor - 2) this.fall();
    else this.perform('land');
  }

  // When the pointer comes close she turns around to face it and cocks her head;
  // if she's peeking, she's shy and ducks away.
  notice(x, y) {
    if (this.busy || this.hidden || this.stance === 'fall' || this.sky) return; // the satellite has all her attention
    this.onPointerNear?.(x, y); // play.js: strokes on her mane
    if (this.hiding) return; // hide-and-seek: no giving herself away
    const h = this.head();
    if (Math.hypot(x - h.x, y - h.y) > 230) return;
    const now = performance.now();
    if (this.mode === 'sleep') this.wake();
    if (now < this.nextNotice) return;
    this.nextNotice = now + 15000;
    if (this.stance === 'peek') {
      this.unpeek({ shy: true });
      return;
    }
    const wanted = x < this.pos.x ? 1 : -1;
    if (wanted !== this.facing && this.stance === 'stand') {
      this.perform('turn');
      return;
    }
    if (this.mode !== 'idle') return;
    // now and then she's a little menace about it
    if (Math.random() < 0.3 && this.zap(x, y)) return;
    this.perform('curious', x < h.x ? -1 : 1);
  }
}
