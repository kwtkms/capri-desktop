// Her place: when your desktop itself is in front (no window), the whole screen turns into a bit
// of Night City behind her. A skyline in three depths with its lit windows, a tower with its
// beacon, rooftop screens, a holographic koi swimming over the roofs, searchlights sweeping,
// the elevated train going by, flying cars, fog, neon signs buzzing, a red Moon and its
// satellite, and rain some nights (with lightning). It fades in when you show the desktop, and
// away as soon as a window comes back. Nothing is clickable: it's all on its own layer under her.
// The buildings are drawn once per arrangement; only what moves is redrawn every frame.

import { reducedMotion } from './util.js';

const SIGNS = [
  { text: 'NIGHT CITY', color: '#ff2a55' },
  { text: 'PROJECT CAPRICORN', color: '#36ff7a' },
  { text: '夜の街', color: '#ff2a55' },
  { text: 'PREEM', color: '#8a5cff' },
  { text: 'CAPRI', color: '#36ff7a' },
  { text: 'NO FUTURE', color: '#8a5cff' },
  { text: 'AFTERLIFE', color: '#ffd166' },
  { text: 'ラーメン', color: '#36d6ff' },
];
const ADS = [
  { text: 'CAPRI', bg: '#ff2a55' }, { text: 'KIROSHI', bg: '#36d6ff' }, { text: 'NCART', bg: '#ffd166' },
  { text: '鹿', bg: '#8a5cff' }, { text: 'BD WREATH', bg: '#36ff7a' }, { text: 'TRAUMA', bg: '#ff2a55' },
];
const GLYPHS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789ABCDEF';
const LIGHTS = ['#ffd166', '#ffd166', '#ffe9b0', '#36d6ff', '#ff2a55', '#8a5cff'];
const FADE_IN_MS = 1200;
const FADE_OUT_MS = 350;
const SHOW_AFTER_MS = 1500; // the desktop stays in front this long before she decorates

const rand = (a, b) => a + Math.random() * (b - a);
const pickOne = (list) => list[Math.floor(Math.random() * list.length)];

export class Decor {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.alpha = 0;
    this.target = 0;
    this.running = false;
    this.deskSince = 0;
    this.level = 0;
    this.onShown = null; // app.js: a word from her, now and then
    this.resize(innerWidth, innerHeight);
  }

  resize(w, h) {
    const dpr = devicePixelRatio || 1;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.build();
  }

  // a new arrangement each time the scene comes up
  build() {
    const { w, h } = this;
    const pool = [...SIGNS].sort(() => Math.random() - 0.5).slice(0, 3);
    // signs up in the sky and on the sides, never in the middle where things happen
    // (on the roofs' level, low, not across your wallpaper)
    const slots = [
      { x: w * 0.3, y: h * 0.68 }, { x: w * 0.78, y: h * 0.66 },
      { x: w * 0.06, y: h * 0.62 }, { x: w * 0.92, y: h * 0.6 },
    ].sort(() => Math.random() - 0.5);
    this.signs = pool.map((s, i) => ({
      ...s,
      x: slots[i].x + rand(-30, 30),
      y: slots[i].y + rand(-20, 20),
      size: rand(20, 30),
      vertical: i >= 2 && Math.random() < 0.6,
      flicker: 0,
      nextFlicker: performance.now() + rand(800, 4000),
      sway: rand(0, Math.PI * 2),
    }));
    this.rain = Array.from({ length: Math.round(w / 150) }, () => ({
      x: rand(0, w), y: rand(-h, h * 0.6), speed: rand(30, 80), len: Math.round(rand(6, 14)),
      chars: Array.from({ length: 14 }, () => pickOne(GLYPHS)),
    }));
    this.shards = Array.from({ length: 10 }, () => ({
      x: rand(0, w), y: rand(0, h), vx: rand(-8, 8), vy: rand(-14, -4), r: rand(2, 6), rot: rand(0, 6), vr: rand(-1, 1),
      color: pickOne(['#ff2a55', '#36ff7a', '#8a5cff']),
    }));
    this.moon = { x: w * rand(0.6, 0.7), y: h * 0.12, r: Math.min(w, h) * 0.06 };
    this.cars = Array.from({ length: 9 }, () => this.newCar(rand(0, w)));
    const hour = new Date().getHours();
    const night = hour >= 20 || hour < 6;
    // rain, some nights (and now and then by day): the city's weather, made up, not looked up
    this.rainy = Math.random() < (night ? 0.4 : 0.15);
    this.drops = this.rainy ? Array.from({ length: Math.round(w / 8) }, () => ({ x: rand(0, w), y: rand(0, h), len: rand(10, 26), speed: rand(700, 1100) })) : [];
    this.nextBolt = performance.now() + rand(4000, 12000);
    this.flash = 0;
    // the koi starts on screen, so you see it; now and then a little one follows it
    this.koi = { x: rand(w * 0.2, w * 0.8), y: h * rand(0.4, 0.55), dir: Math.random() < 0.5 ? 1 : -1, size: Math.min(w, h) * 0.11, t: rand(0, 10), buddy: Math.random() < 0.4 };
    this.train = null;
    this.nextTrain = performance.now() + rand(2000, 5000); // the first one soon after the city comes up
    this.sparks = [];
    // stars on clear nights, only up high
    this.stars = night && !this.rainy ? Array.from({ length: 40 }, () => ({ x: rand(0, w), y: rand(0, h * 0.35), r: Math.random() < 0.2 ? 2 : 1, a: rand(0.3, 0.8), tw: rand(400, 1400), p: rand(0, 6) })) : [];
    this.blimp = Math.random() < 0.6 ? { x: rand(0, w), y: h * rand(0.2, 0.3), dir: Math.random() < 0.5 ? 1 : -1 } : null;
    this.buildSkyline();
  }

  // The buildings, drawn once on a canvas of their own: far, middle and near rows, lit windows,
  // the tower. What blinks or moves on them (beacons, screens, a few windows) is kept apart.
  buildSkyline() {
    const { w, h, dpr } = this;
    const sky = document.createElement('canvas');
    sky.width = Math.round(w * dpr);
    sky.height = Math.round(h * dpr);
    const g = sky.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.beacons = [];
    this.screens = [];
    this.flickers = [];
    this.lamps = [];

    const row = ({ minH, maxH, minW, maxW, body, lit, edge, gap }) => {
      let x = -rand(0, 40);
      const out = [];
      while (x < w + 40) {
        const bw = rand(minW, maxW);
        const bh = h * rand(minH, maxH);
        out.push({ x, w: bw, top: h - bh });
        x += bw + rand(0, gap);
      }
      for (const b of out) {
        g.fillStyle = body;
        g.fillRect(b.x, b.top, b.w, h - b.top);
        // a stepped roof now and then
        if (Math.random() < 0.4) g.fillRect(b.x + b.w * 0.2, b.top - h * 0.02, b.w * 0.6, h * 0.02 + 1);
        if (edge) {
          g.fillStyle = edge;
          g.fillRect(b.x, b.top, 1.5, h - b.top);
        }
        // windows, in a grid, some lit
        const cw = lit.size, ch = lit.size * 1.4;
        for (let wy = b.top + 10; wy < h - 8; wy += ch + lit.gap) {
          for (let wx = b.x + 6; wx < b.x + b.w - 6 - cw; wx += cw + lit.gap) {
            if (Math.random() > lit.share) continue;
            const color = pickOne(LIGHTS);
            g.globalAlpha = rand(0.35, 0.9) * lit.alpha;
            g.fillStyle = color;
            g.fillRect(wx, wy, cw, ch);
            g.globalAlpha = 1;
            if (Math.random() < 0.03) this.flickers.push({ x: wx, y: wy, w: cw, h: ch, color, on: true, next: 0 });
          }
        }
        if (b.top < h * 0.72 && Math.random() < 0.35) this.beacons.push({ x: b.x + b.w / 2, y: b.top - h * 0.02 - 6, phase: rand(0, 6) });
      }
      return out;
    };

    // far: hazy violet blocks, a few lights
    row({ minH: 0.07, maxH: 0.17, minW: 40, maxW: 110, gap: 6, body: 'rgba(46, 26, 78, 0.55)', lit: { size: 2, gap: 5, share: 0.18, alpha: 0.6 } });
    // the tower, tall and thin, toward the right, with its beacon
    const tx = w * rand(0.58, 0.7);
    const tw = Math.max(46, w * 0.03);
    const ttop = h * 0.56;
    g.fillStyle = 'rgba(20, 10, 34, 0.9)';
    g.beginPath();
    g.moveTo(tx, h); g.lineTo(tx + tw * 0.15, ttop + 40); g.lineTo(tx + tw / 2, ttop); g.lineTo(tx + tw * 0.85, ttop + 40); g.lineTo(tx + tw, h);
    g.closePath();
    g.fill();
    g.fillStyle = 'rgba(255, 42, 85, 0.55)';
    for (let y = ttop + 60; y < h; y += 26) g.fillRect(tx + tw * 0.48, y, 2, 12);
    this.tower = { x: tx + tw / 2, y: ttop };
    this.beacons.push({ x: tx + tw / 2, y: ttop - 4, phase: 0, big: true });
    // middle row
    const mid = row({ minH: 0.05, maxH: 0.14, minW: 50, maxW: 140, gap: 4, body: 'rgba(16, 9, 30, 0.82)', edge: 'rgba(138, 92, 255, 0.35)', lit: { size: 3, gap: 5, share: 0.3, alpha: 0.85 } });
    // flat tops she can stand on (citylife.js)
    this.roofs = mid.filter((b) => b.w > 70).map((b) => ({ x0: b.x + 12, x1: b.x + b.w - 12, y: b.top }));
    // near: a few big dark slabs, mostly on the sides
    const near = [];
    for (const side of [0, 1]) {
      let x = side ? w - rand(80, 160) : -rand(10, 40);
      const n = 2 + Math.floor(Math.random() * 2);
      for (let i = 0; i < n; i++) {
        const bw = rand(90, 170);
        const bh = h * rand(0.12, 0.24);
        near.push({ x: side ? x - i * bw * 0.85 : x + i * bw * 0.85, w: bw, top: h - bh });
      }
    }
    this.walls = near; // the big ones up front: where her graffiti goes
    for (const b of near) {
      this.roofs.push({ x0: b.x + 12, x1: b.x + b.w - 12, y: b.top });
      g.fillStyle = 'rgba(7, 4, 13, 0.92)';
      g.fillRect(b.x, b.top, b.w, h - b.top);
      // neon strips down the corners
      g.fillStyle = pickOne(['rgba(255, 42, 85, 0.6)', 'rgba(54, 214, 255, 0.55)', 'rgba(138, 92, 255, 0.6)']);
      g.fillRect(b.x + 2, b.top, 2, h - b.top);
      g.fillRect(b.x + b.w - 4, b.top, 2, h - b.top);
      for (let wy = b.top + 14; wy < h - 10; wy += 16) {
        for (let wx = b.x + 10; wx < b.x + b.w - 14; wx += 12) {
          if (Math.random() > 0.22) continue;
          g.globalAlpha = rand(0.4, 0.9);
          g.fillStyle = pickOne(LIGHTS);
          g.fillRect(wx, wy, 5, 7);
        }
      }
      g.globalAlpha = 1;
      // a rooftop screen on some of them
      if (Math.random() < 0.7) {
        const sw = b.w * 0.7, sh = sw * 0.42;
        this.screens.push({ x: b.x + (b.w - sw) / 2, y: b.top - sh - 8, w: sw, h: sh, ad: ADS[this.screens.length % ADS.length], next: performance.now() + rand(2000, 8000), glitch: 0 });
        g.fillStyle = 'rgba(7, 4, 13, 0.92)';
        g.fillRect(b.x + b.w * 0.3, b.top - 8, 3, 8);
        g.fillRect(b.x + b.w * 0.7, b.top - 8, 3, 8);
      }
      this.beacons.push({ x: b.x + b.w / 2, y: b.top - 4, phase: rand(0, 6) });
    }
    // searchlights from two of the roofs
    const roofs = mid.filter((b) => b.x > w * 0.15 && b.x < w * 0.85);
    this.searchlights = [0, 1].map((i) => {
      const b = roofs[Math.floor((i + 0.3) * roofs.length / 2)] || { x: w * (0.3 + i * 0.4), top: h * 0.75, w: 40 };
      return { x: b.x + b.w / 2, y: b.top, phase: rand(0, 6), speed: rand(0.25, 0.45), color: i ? '255, 209, 102' : '54, 214, 255' };
    });
    // the elevated train's track, low across the city
    this.trackY = h * 0.86;
    // steam vents on a few roofs
    this.vents = (this.roofs || []).filter(() => Math.random() < 0.25).slice(0, 5).map((r) => ({ x: rand(r.x0, r.x1), y: r.y, puffs: [] }));
    g.fillStyle = 'rgba(10, 6, 18, 0.95)';
    g.fillRect(0, this.trackY + 9, w, 5);
    for (let x = rand(20, 80); x < w; x += rand(160, 260)) g.fillRect(x, this.trackY + 14, 8, h - this.trackY);
    this.skyline = sky;
  }

  // ---- her graffiti: tagged on the big walls up front, kept for the day ----

  loadGraffiti() {
    const day = new Date().toDateString();
    try {
      const saved = JSON.parse(localStorage.getItem('capri.graffiti') || 'null');
      if (saved && saved.day === day) return saved.items;
    } catch { /* storage off: none */ }
    return [];
  }

  // where the next one goes (she walks there first), or null with no wall to paint on
  graffitiSpot() {
    if (!this.walls?.length) return null;
    this.graffiti ??= this.loadGraffiti();
    const i = this.graffiti.length;
    const wall = this.walls[i % this.walls.length];
    const y = wall.top + (this.h - wall.top) * (0.3 + 0.22 * (Math.floor(i / this.walls.length) % 3));
    return { x: wall.x + wall.w / 2, y, foot: this.h - 6 };
  }

  addGraffiti(text, color) {
    this.graffiti ??= this.loadGraffiti();
    this.graffiti.push({ text, color, tilt: rand(-0.12, 0.08), born: Date.now() });
    try {
      localStorage.setItem('capri.graffiti', JSON.stringify({ day: new Date().toDateString(), items: this.graffiti }));
    } catch { /* storage off: today only */ }
  }

  drawGraffiti(ctx) {
    if (!this.walls?.length) return;
    this.graffiti ??= this.loadGraffiti();
    this.graffiti.forEach((g, i) => {
      const wall = this.walls[i % this.walls.length];
      const y = wall.top + (this.h - wall.top) * (0.3 + 0.22 * (Math.floor(i / this.walls.length) % 3));
      const reveal = Math.min(1, (Date.now() - g.born) / 1600); // sprayed on, left to right
      ctx.save();
      ctx.translate(wall.x + wall.w / 2, y);
      ctx.rotate(g.tilt);
      const size = Math.min(28, wall.w / (g.text.length * 0.62));
      ctx.font = `italic 800 ${size}px "Chakra Petch", sans-serif`;
      const tw = ctx.measureText(g.text).width;
      ctx.beginPath();
      ctx.rect(-tw / 2 - 4, -size, (tw + 8) * reveal, size * 2);
      ctx.clip();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.globalAlpha = this.alpha * 0.85;
      ctx.shadowColor = g.color;
      ctx.shadowBlur = 12;
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#07040d';
      ctx.strokeText(g.text, 0, 0);
      ctx.fillStyle = g.color;
      ctx.fillText(g.text, 0, 0);
      // a drip or two
      ctx.shadowBlur = 0;
      ctx.fillRect(-tw * 0.3, size * 0.4, 2, size * 0.5);
      ctx.fillRect(tw * 0.18, size * 0.4, 2, size * 0.3);
      ctx.restore();
    });
  }

  newCar(x = null) {
    const dir = Math.random() < 0.5 ? 1 : -1;
    return {
      dir,
      x: x ?? (dir > 0 ? -40 : this.w + 40),
      y: this.h * pickOne([0.55, 0.6, 0.66, 0.72]) + rand(-8, 8),
      speed: rand(60, 190),
      color: pickOne(['#ff2a55', '#ffd166', '#8a5cff', '#36ff7a', '#36d6ff']),
    };
  }

  // the music's loudness, 0..1 (rhythm.js): the neons and screens pulse with it
  setLevel(v) {
    this.level = v;
  }

  // the sky's tint for the hour: dawn orange, washed-out day, violet dusk, deep night
  sky() {
    const h = new Date().getHours();
    // light: it's your wallpaper under it, the city only tints it
    if (h >= 6 && h < 9) return { top: 'rgba(255, 140, 80, 0.05)', bottom: 'rgba(255, 90, 120, 0.14)' };
    if (h >= 9 && h < 17) return { top: 'rgba(120, 200, 255, 0.03)', bottom: 'rgba(138, 92, 255, 0.1)' };
    if (h >= 17 && h < 21) return { top: 'rgba(255, 42, 85, 0.05)', bottom: 'rgba(138, 92, 255, 0.16)' };
    return { top: 'rgba(20, 10, 40, 0.08)', bottom: 'rgba(138, 92, 255, 0.14)' };
  }

  // the windows on screen (overlay coordinates): the scene is erased under them, so it only
  // ever shows on the bare desktop, never over what you have open
  setWindows(wins) {
    this.wins = wins || [];
  }

  // windows.ps1: is the desktop itself in front?
  setDesk(desk, { allowed = true } = {}) {
    const now = performance.now();
    if (desk && allowed) {
      if (!this.deskSince) this.deskSince = now;
      clearTimeout(this.showTimer);
      this.showTimer = setTimeout(() => {
        if (this.deskSince && this.target !== 1) this.show();
      }, Math.max(0, SHOW_AFTER_MS - (now - this.deskSince)));
    } else {
      this.deskSince = 0;
      clearTimeout(this.showTimer);
      this.target = 0;
    }
  }

  // "montre ta ville": the city up for a while even over your windows, then back to normal
  showcase(ms = 25000) {
    this.holdWins = true;
    this.wins = [];
    this.show();
    clearTimeout(this.showcaseTimer);
    this.showcaseTimer = setTimeout(() => {
      this.holdWins = false;
      this.target = 0;
      this.deskSince = 0;
    }, ms);
  }

  show() {
    if (this.alpha === 0) this.build();
    this.target = 1;
    this.onShown?.();
    if (!this.running) {
      this.running = true;
      this.last = performance.now();
      requestAnimationFrame((t) => this.frame(t));
    }
  }

  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const step = this.target > this.alpha ? dt * 1000 / FADE_IN_MS : -dt * 1000 / FADE_OUT_MS;
    this.alpha = Math.max(0, Math.min(1, this.alpha + step));
    this.draw(now, reducedMotion.matches ? 0 : dt);
    if (this.alpha === 0 && this.target === 0) {
      this.ctx.clearRect(0, 0, this.w, this.h);
      this.running = false;
      return;
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  draw(now, dt) {
    const { ctx, w, h } = this;
    const pump = this.level ? 0.75 + this.level * 1.2 : 1; // the music
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.globalAlpha = this.alpha;

    // the sky for the hour
    const sky = this.sky();
    const top = ctx.createLinearGradient(0, 0, 0, h * 0.6);
    top.addColorStop(0, sky.top);
    top.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = top;
    ctx.fillRect(0, 0, w, h * 0.6);

    // lightning, on rainy nights: the sky lights up for a blink
    if (this.rainy && now > this.nextBolt) {
      this.nextBolt = now + rand(6000, 16000);
      this.flash = now;
      this.boltPath = this.makeBolt(rand(w * 0.1, w * 0.9));
    }
    const sinceFlash = now - (this.flash || 0);
    if (sinceFlash < 260) {
      const k = sinceFlash < 60 ? 1 : sinceFlash < 120 ? 0.3 : sinceFlash < 180 ? 0.8 : 0.2;
      ctx.fillStyle = `rgba(210, 200, 255, ${0.18 * k})`;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.9 * k})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      this.boltPath.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    }

    this.drawStars(ctx, now);
    this.drawBlimp(ctx, now, dt);

    // the Moon (it's theirs), red, and the satellite blinking by it
    const m = this.moon;
    ctx.save();
    ctx.shadowColor = '#ff2a55';
    ctx.shadowBlur = 40;
    ctx.fillStyle = 'rgba(255, 42, 85, 0.35)';
    ctx.beginPath();
    ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    if (Math.sin(now / 420) > 0.6) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(m.x + m.r * 1.6, m.y - m.r * 0.8, 3, 3);
    }

    // searchlights sweeping the clouds, behind the buildings
    for (const s of this.searchlights) {
      const a = -Math.PI / 2 + Math.sin(now / 1000 * s.speed + s.phase) * 0.6;
      const len = h * 0.9;
      const spread = 0.06;
      const grad = ctx.createLinearGradient(s.x, s.y, s.x + Math.cos(a) * len, s.y + Math.sin(a) * len);
      grad.addColorStop(0, `rgba(${s.color}, 0.1)`);
      grad.addColorStop(1, `rgba(${s.color}, 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x + Math.cos(a - spread) * len, s.y + Math.sin(a - spread) * len);
      ctx.lineTo(s.x + Math.cos(a + spread) * len, s.y + Math.sin(a + spread) * len);
      ctx.closePath();
      ctx.fill();
    }

    // the holographic koi, swimming slowly over the roofs
    this.drawKoi(ctx, now, dt);

    // flying cars, between the towers
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      car.x += car.dir * car.speed * dt;
      if (car.x < -60 || car.x > w + 60) {
        this.cars[i] = this.newCar();
        continue;
      }
      const trail = ctx.createLinearGradient(car.x, 0, car.x - car.dir * 70, 0);
      trail.addColorStop(0, car.color);
      trail.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = trail;
      ctx.globalAlpha = this.alpha * 0.55;
      ctx.fillRect(Math.min(car.x, car.x - car.dir * 70), car.y, 70, 2);
      ctx.globalAlpha = this.alpha;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(car.x - 2, car.y - 1, 4, 4);
    }

    // the city: see-through enough that your desktop icons still show under it
    ctx.globalAlpha = this.alpha * 0.5;
    ctx.drawImage(this.skyline, 0, 0, w, h);
    ctx.globalAlpha = this.alpha;

    // a few windows going on and off
    for (const f of this.flickers) {
      if (now > f.next) {
        f.on = !f.on;
        f.next = now + (f.on ? rand(3000, 15000) : rand(400, 4000));
      }
      if (!f.on) {
        ctx.fillStyle = 'rgba(12, 7, 22, 0.95)';
        ctx.fillRect(f.x, f.y, f.w, f.h);
      }
    }
    // beacons on the roofs, blinking red
    for (const b of this.beacons) {
      const on = Math.sin(now / 600 + b.phase) > 0.3;
      if (!on) continue;
      ctx.save();
      ctx.shadowColor = '#ff2a55';
      ctx.shadowBlur = b.big ? 18 : 8;
      ctx.fillStyle = '#ff2a55';
      ctx.fillRect(b.x - (b.big ? 3 : 1.5), b.y - (b.big ? 3 : 1.5), b.big ? 6 : 3, b.big ? 6 : 3);
      ctx.restore();
    }
    // rooftop screens: an ad, now and then glitching to the next one
    for (const s of this.screens) {
      if (now > s.next) {
        s.next = now + rand(4000, 9000);
        s.glitch = now;
        // the next ad, one no other screen is showing
        const shown = new Set(this.screens.map((o) => o.ad));
        s.ad = pickOne(ADS.filter((a) => !shown.has(a))) || s.ad;
      }
      const glitching = now - s.glitch < 220;
      ctx.save();
      ctx.globalAlpha = this.alpha * Math.min(0.7, 0.5 * pump);
      ctx.fillStyle = '#07040d';
      ctx.fillRect(s.x - 3, s.y - 3, s.w + 6, s.h + 6);
      ctx.fillStyle = s.ad.bg;
      ctx.globalAlpha *= glitching ? 0.4 + Math.random() * 0.5 : 0.85;
      ctx.fillRect(s.x, s.y, s.w, s.h);
      ctx.globalAlpha = this.alpha;
      ctx.fillStyle = '#07040d';
      ctx.font = `800 ${Math.round(s.h * 0.48)}px "Chakra Petch", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(s.ad.text, s.x + s.w / 2 + (glitching ? rand(-6, 6) : 0), s.y + s.h / 2);
      // scanlines
      ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
      for (let y = s.y; y < s.y + s.h; y += 3) ctx.fillRect(s.x, y, s.w, 1);
      ctx.restore();
    }

    // her tags
    this.drawGraffiti(ctx);

    // the elevated train, now and then
    this.drawTrain(ctx, now, dt);
    this.drawBits(ctx, dt);

    // fog at street level, and the city's glow in it
    const fog = ctx.createLinearGradient(0, h, 0, h * 0.62);
    fog.addColorStop(0, sky.bottom);
    fog.addColorStop(0.5, 'rgba(255, 42, 85, 0.06)');
    fog.addColorStop(1, 'rgba(138, 92, 255, 0)');
    ctx.fillStyle = fog;
    ctx.fillRect(0, h * 0.62, w, h * 0.38);

    // rain
    if (this.rainy) {
      ctx.strokeStyle = 'rgba(180, 200, 255, 0.24)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const d of this.drops) {
        d.y += d.speed * dt;
        d.x -= d.speed * 0.18 * dt;
        if (d.y > h) {
          d.y = rand(-40, 0);
          d.x = rand(0, w * 1.2);
        }
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x + d.len * 0.18, d.y - d.len);
      }
      ctx.stroke();
    }

    // digital rain, high in the sky only
    ctx.font = '600 14px "JetBrains Mono", monospace';
    for (const d of this.rain) {
      d.y += d.speed * dt;
      if (d.y - d.len * 16 > h * 0.6) {
        d.y = rand(-200, 0);
        d.x = rand(0, w);
      }
      if (Math.random() < 0.02) d.chars[Math.floor(Math.random() * d.chars.length)] = pickOne(GLYPHS);
      for (let i = 0; i < d.len; i++) {
        const a = (1 - i / d.len) * 0.1;
        ctx.fillStyle = i === 0 ? `rgba(200, 255, 220, ${a + 0.12})` : `rgba(54, 255, 122, ${a})`;
        ctx.fillText(d.chars[i], d.x, d.y - i * 16);
      }
    }

    // drifting shards of her mane
    for (const s of this.shards) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.rot += s.vr * dt;
      if (s.y < -10) { s.y = h + 10; s.x = rand(0, w); }
      if (s.x < -10) s.x = w + 10;
      if (s.x > w + 10) s.x = -10;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.rot);
      ctx.globalAlpha = this.alpha * 0.5;
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.moveTo(0, -s.r * 1.6);
      ctx.lineTo(s.r * 0.6, 0);
      ctx.lineTo(0, s.r * 1.6);
      ctx.lineTo(-s.r * 0.6, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // neon signs, buzzing: now and then one cuts out for a few frames. They light up as she
    // goes by, and when she's angry they all sputter.
    const her = this.her?.();
    for (const s of this.signs) {
      if (now > s.nextFlicker) {
        s.flicker = rand(80, 260);
        s.flickerAt = now;
        s.nextFlicker = now + (her?.angry ? rand(300, 1200) : rand(2000, 9000));
      }
      const out = s.flicker && now - s.flickerAt < s.flicker && Math.sin(now / 30) > 0;
      const near = her ? Math.max(0, 1 - Math.hypot(her.x - s.x, her.y - s.y) / 320) : 0;
      const pump = (this.level ? 0.75 + this.level * 1.2 : 1) + near * 0.9;
      ctx.save();
      ctx.translate(s.x, s.y + Math.sin(now / 1600 + s.sway) * 3);
      if (s.vertical) ctx.rotate(Math.PI / 2);
      ctx.font = `700 ${s.size}px "Chakra Petch", sans-serif`;
      ctx.globalAlpha = this.alpha * Math.min(0.75, (out ? 0.12 : 0.6) * pump);
      ctx.shadowColor = s.color;
      ctx.shadowBlur = out ? 3 : 14 * pump;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2;
      ctx.strokeText(s.text, 0, 0);
      ctx.fillStyle = out ? 'rgba(0,0,0,0)' : `${s.color}55`;
      ctx.fillText(s.text, 0, 0);
      ctx.restore();
    }
    ctx.restore();

    // wiped out wherever a window is
    if (this.wins?.length) {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = '#000';
      for (const win of this.wins) ctx.fillRect(win.x - 2, win.y - 2, win.w + 4, win.h + 4);
      ctx.restore();
    }
  }

  makeBolt(x) {
    const pts = [[x, 0]];
    let y = 0;
    while (y < this.h * 0.45) {
      y += rand(20, 50);
      x += rand(-40, 40);
      pts.push([x, y]);
    }
    return pts;
  }

  // The city's hologram koi, swimming over the roofs: a real fish shape (a smooth body that
  // ripples from head to tail, koi colours, a holographic edge), fins and a tail that flutter,
  // and now and then the hologram skips. Sometimes a smaller one follows it.
  drawKoi(ctx, now, dt) {
    const k = this.koi;
    const { w } = this;
    k.t += dt;
    // startled by her (citylife.js): it darts off for a moment
    const boost = k.dash && performance.now() - k.dash < 1500 ? 5 : 1;
    k.x += k.dir * k.size * 0.4 * boost * dt;
    k.size = Math.max(k.size, Math.min(this.w, this.h) * 0.11);
    if (k.x > w + k.size * 3) { k.x = -k.size * 3; k.y = this.h * rand(0.4, 0.55); }
    if (k.x < -k.size * 3) { k.x = w + k.size * 3; k.y = this.h * rand(0.4, 0.55); }
    const y = k.y + Math.sin(k.t * 0.4) * k.size * 0.35;
    this.fish(ctx, now, k.x, y, k.size, k.dir, k.t, 1);
    if (k.buddy) this.fish(ctx, now, k.x - k.dir * k.size * 2.6, y + k.size * 0.5, k.size * 0.6, k.dir, k.t + 1.3, 0.8);
  }

  fish(ctx, now, x, y, size, dir, t, strength) {
    const n = 12;
    const len = size * 2.4;
    // the spine: head first, a wave running down it, bigger toward the tail
    const spine = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      spine.push({ x: x - dir * u * len, y: y + Math.sin(t * 4 - u * 4) * size * 0.12 * u * u, u });
    }
    // half-width along the body: round head, thick middle, thin peduncle
    const half = (u) => size * 0.36 * Math.sin(Math.PI * Math.min(1, 0.12 + u * 1.05)) * (1 - u * 0.55);
    const left = [], right = [];
    for (let i = 0; i <= n; i++) {
      const p = spine[i], q = spine[Math.min(n, i + 1)], o = spine[Math.max(0, i - 1)];
      const dx = q.x - o.x, dy = q.y - o.y, l = Math.hypot(dx, dy) || 1;
      const nx = -dy / l, ny = dx / l, r = half(p.u);
      left.push({ x: p.x + nx * r, y: p.y + ny * r });
      right.push({ x: p.x - nx * r, y: p.y - ny * r });
    }
    const tail = spine[n];
    const flap = Math.sin(t * 4 - 4) * 0.5;
    const skip = Math.random() < 0.03 ? rand(-10, 10) : 0; // the hologram skipping a frame
    ctx.save();
    ctx.translate(skip, 0);
    ctx.globalAlpha = this.alpha * 0.5 * strength;
    // the tail: two soft lobes
    ctx.fillStyle = 'rgba(255, 150, 90, 0.55)';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(tail.x, tail.y);
      ctx.quadraticCurveTo(tail.x - dir * size * 0.5, tail.y + s * size * (0.2 + flap * 0.15), tail.x - dir * size * 0.8, tail.y + s * size * (0.55 + flap * 0.2));
      ctx.quadraticCurveTo(tail.x - dir * size * 0.45, tail.y + s * size * 0.1, tail.x, tail.y);
      ctx.fill();
    }
    // pectoral fins, sweeping
    const fin = spine[3];
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(fin.x, fin.y);
      ctx.quadraticCurveTo(fin.x - dir * size * 0.2, fin.y + s * size * 0.55, fin.x - dir * size * (0.5 + Math.sin(t * 5) * 0.08), fin.y + s * size * 0.5);
      ctx.quadraticCurveTo(fin.x - dir * size * 0.35, fin.y + s * size * 0.2, fin.x, fin.y);
      ctx.fill();
    }
    // the body, white with orange patches (a kohaku), lit from inside
    const body = new Path2D();
    body.moveTo(left[0].x, left[0].y);
    for (let i = 1; i <= n; i++) body.lineTo(left[i].x, left[i].y);
    for (let i = n; i >= 0; i--) body.lineTo(right[i].x, right[i].y);
    body.closePath();
    const g = ctx.createLinearGradient(spine[0].x, 0, tail.x, 0);
    g.addColorStop(0, 'rgba(255, 245, 240, 0.95)');
    g.addColorStop(0.25, 'rgba(255, 120, 60, 0.9)');
    g.addColorStop(0.45, 'rgba(255, 245, 240, 0.9)');
    g.addColorStop(0.62, 'rgba(255, 90, 50, 0.9)');
    g.addColorStop(1, 'rgba(255, 230, 220, 0.8)');
    ctx.shadowColor = '#36d6ff';
    ctx.shadowBlur = 18;
    ctx.fillStyle = g;
    ctx.fill(body);
    // holographic edge and scanlines through it
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(120, 230, 255, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.stroke(body);
    ctx.save();
    ctx.clip(body);
    ctx.fillStyle = 'rgba(54, 214, 255, 0.25)';
    const top = y - size, roll = (now / 50) % 5;
    for (let sy = top + roll; sy < y + size; sy += 5) ctx.fillRect(Math.min(spine[0].x, tail.x) - size, sy, len + size * 2, 1.5);
    ctx.restore();
    // the eye
    const eye = spine[1];
    ctx.fillStyle = 'rgba(10, 10, 20, 0.9)';
    ctx.beginPath();
    ctx.arc(eye.x + dir * size * 0.05, eye.y - size * 0.08, Math.max(1.5, size * 0.05), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // NCART going by on its track: lit cars with a neon stripe, a headlight, sparks off the rail.
  drawTrain(ctx, now, dt) {
    const { w } = this;
    if (!this.train && now > this.nextTrain) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      this.train = { dir, x: dir > 0 ? -1100 : w + 60, speed: rand(200, 290), cars: 5 + Math.floor(Math.random() * 3) };
      this.onTrain?.(this.train);
    }
    const t = this.train;
    if (!t) return;
    t.x += t.dir * t.speed * dt;
    const carW = 150, carH = 26, gap = 6, len = t.cars * (carW + gap);
    if ((t.dir > 0 && t.x > w + 60) || (t.dir < 0 && t.x + len < -60)) {
      this.train = null;
      this.nextTrain = now + rand(10000, 22000);
      return;
    }
    const y = this.trackY - carH + 2;
    ctx.save();
    for (let i = 0; i < t.cars; i++) {
      const x = t.x + i * (carW + gap);
      // the body, rounded at the two ends of the train
      ctx.fillStyle = 'rgba(18, 12, 30, 0.97)';
      ctx.beginPath();
      const r0 = (i === 0 && t.dir < 0) || (i === t.cars - 1 && t.dir > 0) ? 12 : 3;
      ctx.roundRect ? ctx.roundRect(x, y, carW, carH, [r0, r0, 3, 3]) : ctx.rect(x, y, carW, carH);
      ctx.fill();
      // windows, a few dark ones
      for (let k = 0, wx = x + 10; wx < x + carW - 16; wx += 17, k++) {
        const lit = (i * 7 + k * 3) % 9 !== 0;
        ctx.fillStyle = lit ? 'rgba(255, 220, 140, 0.95)' : 'rgba(60, 50, 80, 0.9)';
        ctx.fillRect(wx, y + 6, 11, 8);
      }
      // the neon stripe and the roof light
      ctx.fillStyle = '#ff2a55';
      ctx.shadowColor = '#ff2a55';
      ctx.shadowBlur = 8;
      ctx.fillRect(x + 2, y + carH - 6, carW - 4, 2);
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(138, 92, 255, 0.8)';
      ctx.fillRect(x + 6, y - 2, carW - 12, 2);
      // sparks off the rail now and then
      if (Math.random() < 0.04) this.sparks.push({ x: x + rand(10, carW - 10), y: this.trackY + 2, vx: rand(-60, 60) - t.dir * 80, vy: rand(-80, -20), life: 0.4 });
    }
    // the headlight
    const head = t.dir > 0 ? t.x + len - gap : t.x;
    const beam = ctx.createLinearGradient(head, 0, head + t.dir * 180, 0);
    beam.addColorStop(0, 'rgba(255, 240, 200, 0.6)');
    beam.addColorStop(1, 'rgba(255, 240, 200, 0)');
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(head, y + 8);
    ctx.lineTo(head + t.dir * 180, y - 6);
    ctx.lineTo(head + t.dir * 180, y + 26);
    ctx.lineTo(head, y + 14);
    ctx.fill();
    ctx.restore();
  }

  // little things that need no layout: sparks, steam
  drawBits(ctx, dt) {
    ctx.save();
    this.sparks = this.sparks.filter((s) => (s.life -= dt) > 0);
    ctx.fillStyle = '#ffd166';
    for (const s of this.sparks) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy += 400 * dt;
      ctx.globalAlpha = this.alpha * Math.min(1, s.life * 3);
      ctx.fillRect(s.x, s.y, 2, 2);
    }
    // steam rising off some roofs
    for (const v of this.vents) {
      if (Math.random() < 0.08) v.puffs.push({ x: v.x + rand(-3, 3), y: v.y, r: rand(2, 4), life: 1 });
      v.puffs = v.puffs.filter((p) => (p.life -= dt * 0.5) > 0);
      for (const p of v.puffs) {
        p.y -= 18 * dt;
        p.x += 5 * dt;
        p.r += 3 * dt;
        ctx.globalAlpha = this.alpha * p.life * 0.09;
        ctx.fillStyle = '#c8c0e0';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // stars, on clear nights: a few, faint, some twinkling
  drawStars(ctx, now) {
    if (!this.stars.length) return;
    ctx.save();
    ctx.fillStyle = '#ffffff';
    for (const s of this.stars) {
      ctx.globalAlpha = this.alpha * s.a * (0.6 + 0.4 * Math.sin(now / s.tw + s.p));
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }
    ctx.restore();
  }

  // an airship drifting across, high up, with a screen on its side
  drawBlimp(ctx, now, dt) {
    const b = this.blimp;
    if (!b) return;
    b.x += b.dir * 14 * dt;
    if (b.x < -300 || b.x > this.w + 300) b.x = b.dir > 0 ? -280 : this.w + 280;
    const y = b.y + Math.sin(now / 3000) * 4;
    ctx.save();
    ctx.globalAlpha = this.alpha * 0.7;
    ctx.fillStyle = 'rgba(20, 14, 34, 0.95)';
    ctx.beginPath();
    ctx.ellipse(b.x, y, 110, 26, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(b.x - 20, y + 22, 40, 10); // gondola
    // the screen
    ctx.fillStyle = ['#ff2a55', '#36d6ff', '#8a5cff'][Math.floor(now / 4000) % 3];
    ctx.globalAlpha = this.alpha * 0.55;
    ctx.fillRect(b.x - 55, y - 10, 110, 20);
    ctx.fillStyle = '#07040d';
    ctx.font = '700 12px "Chakra Petch", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(['NIGHT CITY', '夜の街', 'NCPD'][Math.floor(now / 4000) % 3], b.x, y + 1);
    // nav lights
    if (Math.sin(now / 400) > 0) {
      ctx.globalAlpha = this.alpha;
      ctx.fillStyle = '#ff2a55';
      ctx.fillRect(b.x - 112, y - 2, 3, 3);
      ctx.fillStyle = '#36ff7a';
      ctx.fillRect(b.x + 109, y - 2, 3, 3);
    }
    ctx.restore();
  }
}
