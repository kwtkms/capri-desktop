// Layouts for your desktop icons, as cells of the icon grid (col, row) on the main screen:
// tidy ones (by theme, alphabetical) and drawings (a circle, a spiral, a wave, a diamond, a smiley,
// a frame, a checkerboard, a staircase, CAPRI written in icons). Every layout gives back exactly
// n distinct cells, in the order the icons should go in.

const FONT = { // 3x5 pixel letters
  C: ['###', '#..', '#..', '#..', '###'],
  A: ['.#.', '#.#', '###', '#.#', '#.#'],
  P: ['##.', '#.#', '##.', '#..', '#..'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
};

export const DRAWINGS = ['circle', 'spiral', 'wave', 'diamond', 'smiley', 'frame', 'checker', 'stairs', 'capri'];
// real tidying, each a different way (tidy.js lays these out, by theme)
export const TIDY = ['themes', 'alpha', 'zones', 'rows', 'center', 'right'];

// words you might use -> layout
export const MODE_WORDS = [
  [/theme|categ|type|genre/, 'themes'],
  [/alpha|ordre|abc/, 'alpha'],
  [/zone|coin|quartier/, 'zones'],
  [/ligne|rangee|horizontal/, 'rows'],
  [/centre|milieu|compact/, 'center'],
  [/droite|right/, 'right'],
  [/cercle|rond|circle/, 'circle'],
  [/spiral/, 'spiral'],
  [/vague|wave|onde/, 'wave'],
  [/losange|diamant|diamond/, 'diamond'],
  [/smiley|sourire|visage|tete/, 'smiley'],
  [/cadre|bord|contour|frame/, 'frame'],
  [/damier|echiquier|checker/, 'checker'],
  [/escalier|marche|stairs|diagonal/, 'stairs'],
  [/capri|nom|ecris|lettre|prenom/, 'capri'],
];

export function modeOf(text) {
  for (const [re, mode] of MODE_WORDS) if (re.test(text)) return mode;
  return null;
}

const key = (c) => `${c.col},${c.row}`;

// exactly n cells out of a drawing's cells: the shape kept readable (evenly thinned out if it has
// too many; if too few, the rest go around it, farthest cells last)
function fit(cells, n, cols, rows) {
  const seen = new Set();
  let out = [];
  for (const c of cells) {
    const col = Math.round(c.col), row = Math.round(c.row);
    if (col < 0 || row < 0 || col >= cols || row >= rows || seen.has(`${col},${row}`)) continue;
    seen.add(`${col},${row}`);
    out.push({ col, row });
  }
  if (out.length > n) {
    const step = out.length / n;
    out = Array.from({ length: n }, (_, k) => out[Math.floor(k * step)]);
  } else if (out.length < n) {
    const cx = out.reduce((s, c) => s + c.col, 0) / (out.length || 1);
    const cy = out.reduce((s, c) => s + c.row, 0) / (out.length || 1);
    const rest = [];
    for (let col = 0; col < cols; col++) for (let row = 0; row < rows; row++) if (!seen.has(`${col},${row}`)) rest.push({ col, row });
    // the extra icons go to the far corners, out of the drawing's way
    rest.sort((a, b) => Math.hypot(b.col - cx, b.row - cy) - Math.hypot(a.col - cx, a.row - cy));
    out = out.concat(rest.slice(0, n - out.length));
  }
  return out;
}

// Concentric outlines (each one a list of points along it, outside first): whole outlines are
// kept while they fit, the last one is spread evenly with what's left, so it stays a clean shape.
function rings(outlines, n, cols, rows) {
  const taken = new Set();
  const out = [];
  for (const outline of outlines) {
    const ring = [];
    for (const p of outline) {
      const col = Math.round(p.col), row = Math.round(p.row);
      const k = `${col},${row}`;
      if (col < 0 || row < 0 || col >= cols || row >= rows || taken.has(k) || ring.some((r) => `${r.col},${r.row}` === k)) continue;
      ring.push({ col, row });
    }
    const room = n - out.length;
    if (room <= 0) break;
    const use = ring.length <= room ? ring : Array.from({ length: room }, (_, i) => ring[Math.floor((i * ring.length) / room)]);
    for (const c of use) {
      taken.add(`${c.col},${c.row}`);
      out.push(c);
    }
  }
  return fit(out, n, cols, rows);
}

// points along an ellipse, or a diamond, of half-sizes a (columns) and b (rows)
const ellipse = (cx, cy, a, b) => {
  const count = Math.ceil(Math.PI * (a + b) * 1.6);
  return Array.from({ length: count }, (_, k) => {
    const t = (k / count) * Math.PI * 2 - Math.PI / 2;
    return { col: cx + Math.cos(t) * a, row: cy + Math.sin(t) * b };
  });
};
const diamondLine = (cx, cy, a, b) => {
  const pts = [];
  const steps = Math.ceil((a + b) * 4);
  for (let k = 0; k < steps; k++) {
    const t = (k / steps) * 4;
    const seg = Math.floor(t), u = t - seg;
    const corners = [[0, -b], [a, 0], [0, b], [-a, 0], [0, -b]];
    const [x0, y0] = corners[seg], [x1, y1] = corners[seg + 1];
    pts.push({ col: cx + x0 + (x1 - x0) * u, row: cy + y0 + (y1 - y0) * u });
  }
  return pts;
};

export function layout(mode, n, cols, rows) {
  const cx = (cols - 1) / 2, cy = (rows - 1) / 2;
  const cells = [];
  switch (mode) {
    case 'circle': {
      // rings, outside in, 2 cells apart
      const outlines = [];
      for (let r = 0; r < 6; r++) outlines.push(ellipse(cx, cy, Math.max(0.5, cx - 1 - r * 2.2), Math.max(0.5, cy - r * 1.4)));
      return rings(outlines, n, cols, rows);
    }
    case 'diamond': {
      const outlines = [];
      for (let r = 0; r < 6; r++) outlines.push(diamondLine(cx, cy, Math.max(0.5, cx - 1 - r * 2.6), Math.max(0.5, cy - r * 1.3)));
      return rings(outlines, n, cols, rows);
    }
    case 'spiral': {
      // a square spiral, one cell between its turns, centered
      const W = Math.min(cols, 13), H = rows;
      let col = Math.floor((cols - W) / 2), row = 0;
      const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
      const lens = [W - 1, H - 1, W - 1];
      for (let k = 3; lens.length < 40; k++) lens.push(lens[k - 2] - 2);
      cells.push({ col, row });
      for (let s = 0; s < lens.length && lens[s] > 0 && cells.length < n; s++) {
        const [dx, dy] = dirs[s % 4];
        for (let k = 0; k < lens[s] && cells.length < n; k++) {
          col += dx;
          row += dy;
          cells.push({ col, row });
        }
      }
      break;
    }
    case 'wave': {
      for (let band = 0; band < 3; band++) {
        for (let col = 0; col < cols; col++) {
          cells.push({ col, row: cy + Math.sin((col / cols) * Math.PI * 2.5) * (rows / 3) + (band - 1) * 1.2 });
        }
      }
      break;
    }
    case 'smiley': {
      const rx = Math.min(cx, cy * 1.9), ry = cy;
      for (let k = 0; k < 60; k++) {
        const a = (k / 60) * Math.PI * 2;
        cells.push({ col: cx + Math.cos(a) * rx, row: cy + Math.sin(a) * ry });
      }
      cells.push({ col: cx - rx * 0.35, row: cy - ry * 0.35 }, { col: cx + rx * 0.35, row: cy - ry * 0.35 }); // eyes
      for (let k = 0; k <= 10; k++) {
        const a = Math.PI * 0.15 + (k / 10) * Math.PI * 0.7;
        cells.push({ col: cx + Math.cos(a) * rx * 0.55, row: cy + Math.sin(a) * ry * 0.5 }); // the smile
      }
      break;
    }
    case 'frame': {
      // frames, outside in, one cell apart
      const outlines = [];
      for (let r = 0; r < 4; r++) {
        const l = r * 2, t = r * 2, ri = cols - 1 - r * 2, b = rows - 1 - r * 2;
        if (ri <= l || b <= t) break;
        const f = [];
        for (let col = l; col <= ri; col++) f.push({ col, row: t });
        for (let row = t + 1; row <= b; row++) f.push({ col: ri, row });
        for (let col = ri - 1; col >= l; col--) f.push({ col, row: b });
        for (let row = b - 1; row > t; row--) f.push({ col: l, row });
        outlines.push(f);
      }
      return rings(outlines, n, cols, rows);
    }
    case 'checker': {
      // a checkerboard just big enough for all of them, centered
      let h = Math.min(rows, Math.max(2, Math.round(Math.sqrt(n * 2 * rows / cols))));
      let w = Math.min(cols, Math.ceil((n * 2) / h));
      while (w * h < n * 2 && h < rows) h += 1;
      w = Math.min(cols, Math.ceil((n * 2) / h));
      const l = Math.floor((cols - w) / 2), t = Math.floor((rows - h) / 2);
      for (let row = t; row < t + h; row++) for (let col = l; col < l + w; col++) if ((col + row) % 2 === 0) cells.push({ col, row });
      return cells.slice(0, n).length === n ? fit(cells.slice(0, n), n, cols, rows) : fit(cells, n, cols, rows);
    }
    case 'stairs': {
      for (let s = 0; s < cols + rows; s++) {
        for (let k = 0; k < 3; k++) cells.push({ col: s, row: rows - 1 - Math.floor(s / 2) + k - 1 });
      }
      break;
    }
    case 'capri': {
      const word = 'CAPRI';
      const width = word.length * 4 - 1;
      const left = Math.max(0, Math.floor((cols - width) / 2)), top = Math.max(0, Math.floor((rows - 5) / 2));
      [...word].forEach((ch, i) => {
        FONT[ch].forEach((line, row) => [...line].forEach((px, col) => {
          if (px === '#') cells.push({ col: left + i * 4 + col, row: top + row });
        }));
      });
      break;
    }
    default: { // 'themes' and 'alpha': straight columns, top to bottom, left to right
      for (let col = 0; col < cols; col++) for (let row = 0; row < rows; row++) cells.push({ col, row });
      return cells.slice(0, n);
    }
  }
  return fit(cells, n, cols, rows);
}
