// Investigation prototype, not a supported feature: see docs/reports/code-first-effects.md.
//
// A meteor strike written the way a game's draw loop states it (seconds, floating-point positions, radii and heat),
// rendered twice from that one description: a smooth Canvas-style reference with additive glow and alpha, and a pixel
// version whose "glow adapter" maps heat onto an authored palette ramp in seeded clusters and writes an ordinary
// version-1 recipe. The recipe validates, inspects, patches and exports with the existing CLI.
//
//   node scripts/prototype-code-first-fx.mjs --out output/code-first-fx [--radius 40] [--force]
//
// Writes meteor.recipe.json, compare.apng (smooth left, pixel right, 30 fps) and compare.png (five key moments).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { random, sinDeg, cosDeg } from '../src/craft.js';
import { renderProject, scalePixels } from '../src/core.js';
import { encodePNG, encodeAPNG } from '../src/png.js';
import { formatJSON } from '../src/export.js';

const argv = process.argv.slice(2), option = name => { const i = argv.indexOf(`--${name}`); return i < 0 ? undefined : argv[i + 1]; };
const OUT = option('out'), FORCE = argv.includes('--force');
if (!OUT) throw new Error('usage: node scripts/prototype-code-first-fx.mjs --out <new folder> [--radius 40] [--force]');
if (existsSync(OUT) && !FORCE) throw new Error(`${OUT} exists; choose a new folder or pass --force`);

// ---- The effect as game code states it -----------------------------------------------------------------------------
const FALL = 0.5, AFTERMATH = 0.8, RADIUS = Number(option('radius') ?? 40); // seconds, seconds, game pixels
const UNIT = 0.5;                                                            // art pixels per game pixel
const W = 112, H = 72, START = [38, -8], IMPACT = [66, 55], SQUASH = 0.36;   // native canvas; ground ellipse ry/rx
const R = RADIUS * UNIT;
const clamp01 = v => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = t => { const u = 1 - t; return 1 - u * u * u; };
const smooth = t => t * t * (3 - 2 * t);
const length = (x, y) => Math.sqrt(x * x + y * y);

// Seeded embers shed along the fall and sparks thrown at impact. Each position follows from time alone, so any
// moment can be sampled at any rate.
const EMBERS = Array.from({ length: 44 }, (_, i) => ({ born: random(7, i, 1) * FALL * 0.95, life: 0.1 + random(7, i, 2) * 0.22, jx: random(7, i, 3) - 0.5, jy: random(7, i, 4) - 0.5, rise: 6 + random(7, i, 5) * 10, heat: 0.45 + random(7, i, 6) * 0.35 }));
const SPARKS = Array.from({ length: 16 }, (_, i) => {
  const angle = 200 + random(9, i, 1) * 140, speed = 30 + random(9, i, 2) * 45;
  return { vx: cosDeg(angle) * speed, vy: sinDeg(angle) * speed * 0.8 - 10, life: 0.25 + random(9, i, 3) * 0.3, heat: 0.7 + random(9, i, 4) * 0.4 };
});
const fallAt = u => [lerp(START[0], IMPACT[0], u * u), lerp(START[1], IMPACT[1], u * u)];

// Everything visible at time t (seconds), as continuous primitives. Both renderers read only this.
function scene(t) {
  const shapes = [];
  if (t < FALL) {
    const u = t / FALL, [hx, hy] = fallAt(u), [px, py] = fallAt(Math.max(0, u - 0.18));
    const dx = hx - px, dy = hy - py, len = length(dx, dy) || 1, tail = 9 + 26 * u;
    shapes.push({ kind: 'marker', x: IMPACT[0], y: IMPACT[1], rx: R, ry: R * SQUASH, heat: 0.3 + 0.2 * u });
    shapes.push({ kind: 'streak', x1: hx, y1: hy, x2: hx - dx / len * tail, y2: hy - dy / len * tail, w1: 2.2, w2: 0.5, h1: 0.92, h2: 0.3, flicker: true });
    shapes.push({ kind: 'glow', x: hx, y: hy, r: 2.2, heat: 1.1 });
    shapes.push({ kind: 'glow', x: hx, y: hy, r: 6.5, heat: 0.42, halo: true });
    for (const e of EMBERS) {
      const age = t - e.born;
      if (age < 0 || age > e.life) continue;
      const [bx, by] = fallAt(e.born / FALL);
      shapes.push({ kind: 'spark', x: bx + e.jx * 3, y: by + e.jy * 3 - e.rise * age, heat: e.heat * (1 - age / e.life) + 0.2 });
    }
  } else {
    const a = t - FALL, [cx, cy] = IMPACT, ring = R * (0.25 + 0.75 * easeOut(clamp01(a / 0.32)));
    // A flash and a molten pool at contact, then a ring that thins and cools as it spreads, leaving a scorch mark.
    if (a < 0.2) shapes.push({ kind: 'glow', x: cx, y: cy - 1, r: 3 + 5 * easeOut(a / 0.2), squash: 0.6, heat: 1.15 * (1 - a / 0.2) });
    if (a < 0.16) shapes.push({ kind: 'disc', x: cx, y: cy, rx: ring, ry: ring * SQUASH, heat: 0.72 * (1 - a / 0.16), flicker: true });
    shapes.push({ kind: 'ring', x: cx, y: cy, rx: ring, ry: ring * SQUASH, thick: lerp(3.2, 1.1, clamp01(a / 0.45)), heat: 0.86 * (1 - smooth(clamp01((a - 0.05) / 0.6))), flicker: true });
    shapes.push({ kind: 'scorch', x: cx, y: cy, rx: R, ry: R * SQUASH, thick: 1.6, amount: clamp01((a - 0.16) / 0.12) * (1 - smooth(clamp01((a - 0.4) / 0.4))) });
    for (const s of SPARKS) {
      if (a > s.life) continue;
      shapes.push({ kind: 'spark', x: cx + s.vx * a, y: cy - 2 + s.vy * a + 80 * a * a, heat: s.heat * (1 - a / s.life) + 0.15 });
    }
  }
  return shapes;
}

// Heat (or scorch amount, or marker strength) that one primitive contributes at a point.
function sample(s, x, y) {
  if (s.kind === 'glow') {
    const d = length(x - s.x, (y - s.y) / (s.squash ?? 1)) / s.r;
    if (d >= 1.6) return 0;
    const k = 1 - d / 1.6;
    return s.heat * (s.halo ? k * k : 1 - d * d / 2.56);
  }
  if (s.kind === 'streak') {
    const vx = s.x2 - s.x1, vy = s.y2 - s.y1, k = clamp01(((x - s.x1) * vx + (y - s.y1) * vy) / (vx * vx + vy * vy));
    const d = length(x - (s.x1 + vx * k), y - (s.y1 + vy * k)) / lerp(s.w1, s.w2, k);
    return d >= 1 ? 0 : lerp(s.h1, s.h2, k) * (1 - d * d);
  }
  if (s.kind === 'ring' || s.kind === 'marker' || s.kind === 'scorch') {
    // Distance to a flat ellipse, approximated by scaling it to a circle: adequate for ground rings.
    const q = length((x - s.x) / s.rx, (y - s.y) / s.ry), d = Math.abs(q - 1) * Math.min(s.rx, s.ry * 2.2) / (s.thick ?? 0.7);
    return d >= 1 ? 0 : (s.kind === 'scorch' ? s.amount : s.heat) * (1 - d * d);
  }
  if (s.kind === 'disc') {
    const q = length((x - s.x) / s.rx, (y - s.y) / s.ry);
    return q >= 1 ? 0 : s.heat * (1 - q * q * 0.6);
  }
  if (s.kind === 'spark') return length(x - s.x, y - s.y) < 0.75 ? s.heat : 0;
  return 0;
}
function field(shapes, x, y) {
  let heat = 0, scorch = 0, marker = 0, flicker = false;
  for (const s of shapes) {
    const v = sample(s, x, y);
    if (!v) continue;
    if (s.kind === 'scorch') scorch = Math.max(scorch, v);
    else if (s.kind === 'marker') marker = Math.max(marker, v);
    else if (v > heat) { heat = v; flicker = !!s.flicker; }
  }
  return { heat, scorch, marker, flicker };
}

// ---- Renderer 1: the smooth draw loop (anti-aliased colour, additive bloom, alpha) --------------------------------
const BG = [34, 39, 44];
const STOPS = [[0, [120, 20, 40]], [0.35, [214, 52, 52]], [0.6, [246, 104, 64]], [0.8, [250, 184, 104]], [1, [255, 246, 220]]];
function gradient(v) {
  for (let i = 1; i < STOPS.length; i++) if (v <= STOPS[i][0]) {
    const [a, ca] = STOPS[i - 1], [b, cb] = STOPS[i];
    return ca.map((c, j) => lerp(c, cb[j], (v - a) / (b - a)));
  }
  return STOPS.at(-1)[1];
}
function smoothFrame(t, S) {
  const shapes = scene(t), w = W * S, h = H * S, data = new Uint8Array(w * h * 4);
  const glowing = shapes.filter(s => ['glow', 'ring', 'streak', 'disc'].includes(s.kind));
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    const x = (px + 0.5) / S, y = (py + 0.5) / S, f = field(shapes, x, y);
    let c = [...BG], bloom = 0;
    if (f.scorch) c = c.map((v, j) => lerp(v, [70, 26, 34][j], f.scorch * 0.8));
    if (f.marker) c = c.map((v, j) => lerp(v, [150, 40, 56][j], f.marker));
    for (const s of glowing) {
      const flat = s.kind === 'ring' || s.kind === 'disc' ? 2 : 1, reach = (s.r ?? s.rx ?? 4) * 2.2 + 6;
      const d = length(x - (s.x ?? s.x1), (y - (s.y ?? s.y1)) * flat);
      if (d < reach) { const k = 1 - d / reach; bloom += (s.heat ?? s.h1) * 0.35 * k * k; }
    }
    if (bloom) c = c.map((v, j) => Math.min(255, v + [230, 50, 50][j] * bloom));
    if (f.heat > 0.02) { const g = gradient(clamp01(f.heat)), a = clamp01(f.heat * 1.6); c = c.map((v, j) => lerp(v, g[j], a)); }
    data.set([...c.map(Math.round), 255], (py * w + px) * 4);
  }
  return data;
}

// ---- Renderer 2: the pixel adapter -------------------------------------------------------------------------------------
// Heat becomes palette steps rather than alpha: a glow ends in hard bands, a fade cools down the ramp, and seeded
// two-pixel clusters break up the too-regular geometry. No ordered dither: on fire it reads as a screen pattern.
const RAMP = ['d', 'r', 'o', 'y', 'w'], FLOOR = 0.2, BREAKUP = 0.55, CLUSTER = 2;
const PALETTE = { d: '#7a1a2c', r: '#d23a3c', o: '#f46a40', y: '#f8b468', w: '#fff0cc', s: '#462630', S: '#5e2632', m: '#6a2434' };
function pixelLayers(t, frame) {
  const shapes = scene(t), fire = [], scorch = [];
  for (let y = 0; y < H; y++) {
    let row = '', mark = '';
    for (let x = 0; x < W; x++) {
      const f = field(shapes, x + 0.5, y + 0.5), cx = Math.floor(x / CLUSTER), cy = Math.floor(y / CLUSTER);
      let heat = f.heat;
      if (heat > 0) {
        // Flickering fire reshuffles its clusters every frame; everything else keeps one stable breakup.
        const seed = f.flicker ? frame : 0, n = 0.65 * random(31, seed, cx, cy) + 0.35 * random(32, seed, x, y);
        heat *= 1 + (n - 0.5) * 2 * BREAKUP;
      }
      const step = heat <= 0 ? -1 : Math.min(RAMP.length - 1, Math.floor((heat - FLOOR) / (1 - FLOOR) * RAMP.length));
      row += step >= 0 ? RAMP[step] : '.';
      // A fading mark loses whole clusters, the same ones first, instead of thinning to a checkerboard.
      const keep = f.scorch > 0.12 && 0.75 * random(41, cx, cy) + 0.25 * random(42, x, y) < f.scorch;
      mark += keep ? (f.scorch > 0.6 && random(43, cx, y) < 0.45 ? 'S' : 's') : '.';
    }
    fire.push(row); scorch.push(mark);
  }
  return { fire, scorch };
}
function crop(rows) {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  rows.forEach((row, y) => [...row].forEach((c, x) => { if (c !== '.') { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } }));
  return x1 < 0 ? null : { op: 'grid', x: x0, y: y0, rows: rows.slice(y0, y1 + 1).map(r => r.slice(x0, x1 + 1)) };
}

// Pixel timing: about 12 poses a second instead of the draw loop's 60, with boundaries on the game's own times, so the
// contact frame starts at exactly FALL and the last pose ends at FALL + AFTERMATH. Contact gets two quick 50 ms poses.
const fallMs = FALL * 1000, endMs = (FALL + AFTERMATH) * 1000;
const MS = [...Array.from({ length: 6 }, (_, k) => Math.round(k * fallMs / 6)), ...[0, 50, 100, 167, 250, 333, 417, 500, 583, 667, 750].map(ms => fallMs + ms), endMs];
// Thin strokes are not sampled from the field (they break into dashes); they use the renderer's own ellipse.
const marker = { op: 'ellipse', x: IMPACT[0] - Math.round(R), y: IMPACT[1] - Math.round(R * SQUASH), w: 2 * Math.round(R) + 1, h: 2 * Math.round(R * SQUASH) + 1, color: 'm', filled: false };
const frames = MS.slice(0, -1).map((ms, i) => {
  const { fire, scorch } = pixelLayers(ms / 1000, i), layers = [];
  if (ms < fallMs) layers.push({ name: 'marker', ops: [marker] });
  for (const [name, rows] of [['scorch', scorch], ['fire', fire]]) { const grid = crop(rows); if (grid) layers.push({ name, ops: [grid] }); }
  return { name: `strike-${i}`, duration: MS[i + 1] - ms, anchor: [...IMPACT], ...(ms === fallMs && { points: { impact: [...IMPACT] } }), ...(layers.length && { layers }) };
});
const recipe = { version: 1, name: 'meteor', width: W, height: H, palette: PALETTE, frames, animations: { strike: { frames: frames.map(f => f.name), loop: false } } };
const pixels = renderProject(recipe);

// ---- Outputs -----------------------------------------------------------------------------------------------------------
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'meteor.recipe.json'), formatJSON(recipe));
const canvas = (w, h, rgb) => { const d = new Uint8Array(w * h * 4); for (let i = 0; i < d.length; i += 4) d.set([...rgb, 255], i); return d; };
function pixelFrame(t, S) {
  const out = canvas(W, H, BG), i = MS.findLastIndex(ms => ms <= t * 1000 + 1e-6);
  if (t * 1000 < endMs) { const data = pixels.frames[i].data; for (let p = 0; p < data.length; p += 4) if (data[p + 3]) out.set(data.subarray(p, p + 4), p); }
  return scalePixels(out, W, H, S);
}
function paste(target, tw, source, sw, sh, ox, oy, [cx, cy, cw, ch] = [0, 0, sw, sh]) {
  for (let y = 0; y < ch; y++) target.set(source.subarray(((cy + y) * sw + cx) * 4, ((cy + y) * sw + cx + cw) * 4), ((oy + y) * tw + ox) * 4);
}
// Side by side at 30 fps with a pause before each repeat, as in the original post.
{
  const S = 4, gap = 8, w = W * S * 2 + gap, h = H * S, fps = 30, count = Math.round((endMs + 350) / 1000 * fps), list = [];
  for (let k = 0; k < count; k++) {
    const t = k / fps, frame = canvas(w, h, [16, 18, 22]);
    paste(frame, w, t * 1000 < endMs ? smoothFrame(t, S) : canvas(W * S, H * S, BG), W * S, H * S, 0, 0);
    paste(frame, w, pixelFrame(t, S), W * S, H * S, W * S + gap, 0);
    list.push({ data: frame, duration: Math.round((k + 1) * 1000 / fps) - Math.round(k * 1000 / fps) });
  }
  writeFileSync(join(OUT, 'compare.apng'), encodeAPNG(list, w, h));
}
// Five key moments on pixel-pose boundaries, smooth above and pixel below, cropped to the action.
{
  const S = 3, moments = [0.417, 0.55, 0.667, 0.917, 1.167], region = [26 * S, 18 * S, 80 * S, 50 * S], gap = 6;
  const [, , cw, ch] = region, w = moments.length * cw + (moments.length - 1) * gap, h = ch * 2 + gap, sheet = canvas(w, h, [16, 18, 22]);
  moments.forEach((t, i) => {
    paste(sheet, w, smoothFrame(t, S), W * S, H * S, i * (cw + gap), 0, region);
    paste(sheet, w, pixelFrame(t, S), W * S, H * S, i * (cw + gap), ch + gap, region);
  });
  writeFileSync(join(OUT, 'compare.png'), encodePNG(sheet, w, h));
}
const used = new Set(frames.flatMap(f => (f.layers ?? []).flatMap(l => l.ops.flatMap(op => op.rows ?? [op.color]))).join('').replaceAll('.', ''));
console.log(JSON.stringify({ out: OUT, frames: frames.length, durations: frames.map(f => f.duration), totalMs: MS.at(-1), contactFrame: frames.find(f => f.points)?.name, colours: used.size, recipeBytes: formatJSON(recipe).length }));
