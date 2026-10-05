// Code-first animation: a draw loop, written the way game code draws (a Canvas 2D context, continuous coordinates,
// time in seconds), runs against a pixel-art context instead of a browser canvas and compiles into an ordinary recipe.
// The same function can still draw into a real canvas. The context keeps the drawing calls and translates what pixel
// art cannot use:
//   - geometry is sampled at pixel centres, never anti-aliased; strokes under 1.5 pixels are traced one pixel wide
//     without doubled corners;
//   - colours are palette keys: a CSS colour must equal an opaque palette colour or be mapped in `colors`, because
//     nothing is quantized; unmapped colours are reported together rather than guessed;
//   - soft values (alpha, gradients, shadow blur) become pixel-art decisions: solid keys dither (or threshold) by
//     coverage, while keys on a `ramp` behave as light, adding up under 'lighter' and banding along the ramp, so a
//     glow ends in hard bands and a fade cools instead of turning translucent;
//   - drawImage keeps an authored sprite's pixels: whole-pixel placement, nearest-neighbour size, RotSprite rotation;
//   - time is sampled on a millisecond timeline whose named cues each start a frame.
// Browser-compatible and deterministic for deterministic draw code: polynomial trigonometry and seeded noise.
import { PixelError, renderProject } from './core.js';
import { traceLine, ditherThreshold, patternProblem, rampRows, rampProblem, rotateRows, sinDeg, cosDeg } from './craft.js';
import { layoutText } from './font.js';
import { fields } from './authoring.js';
import { readTimeline } from './fx.js';

const fail = (path, message) => { throw new PixelError(path, message); };
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const DEGREES = 180 / 3.141592653589793, TAU = 2 * 3.141592653589793;
const sin = radians => sinDeg(radians * DEGREES), cos = radians => cosDeg(radians * DEGREES);
const finite = (...values) => values.every(Number.isFinite);
const distance = ([x0, y0], [x1, y1]) => Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0));

// ---- Colours ------------------------------------------------------------------------------------------------------
// [r, g, b, alpha 0–1] for #hex, rgb()/rgba() and hsl()/hsla(); null for anything else, such as a named colour, which
// can still be mapped by its exact text in `colors`.
function cssColor(value) {
  const text = value.trim().toLowerCase();
  if (text === 'transparent') return [0, 0, 0, 0];
  let match = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/.exec(text);
  if (match) {
    let hex = match[1];
    if (hex.length < 5) hex = [...hex].map(c => c + c).join('');
    if (hex.length === 6) hex += 'ff';
    const [r, g, b, a] = [0, 2, 4, 6].map(i => parseInt(hex.slice(i, i + 2), 16));
    return [r, g, b, a / 255];
  }
  match = /^(rgba?|hsla?)\(([^()]*)\)$/.exec(text);
  if (!match) return null;
  const parts = match[2].split(/[\s,/]+/).filter(Boolean), number = part => (part.endsWith('%') ? parseFloat(part) / 100 : parseFloat(part));
  if (parts.length < 3 || parts.length > 4) return null;
  const alpha = parts[3] === undefined ? 1 : number(parts[3]);
  let rgb;
  if (match[1].startsWith('rgb')) rgb = parts.slice(0, 3).map(part => (part.endsWith('%') ? parseFloat(part) * 2.55 : parseFloat(part)));
  else {
    const h = parseFloat(parts[0]), s = number(parts[1]), l = number(parts[2]), a = s * Math.min(l, 1 - l);
    rgb = [0, 8, 4].map(n => { const k = (((n + h / 30) % 12) + 12) % 12; return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))); });
  }
  if (!finite(...rgb, alpha)) return null;
  return [...rgb.map(v => Math.max(0, Math.min(255, Math.round(v)))), clamp01(alpha)];
}
const hexOf = ([r, g, b]) => `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;

// ---- Options shared by every frame --------------------------------------------------------------------------------
const RAMP_FIELDS = ['keys', 'floor', 'breakup', 'cluster', 'seed', 'flicker', 'dither', 'pattern', 'surface'];
const CONTEXT_FIELDS = ['width', 'height', 'palette', 'colors', 'ramps', 'soft', 'pattern', 'units', 'snap', 'symbols'];
const PARSED = Symbol('parsed options');
function readOptions(options, path) {
  if (!isObject(options)) fail(path, 'expected { width, height, palette }');
  const { width, height, palette = {} } = options;
  if (!Number.isInteger(width) || width < 1 || width > 256 || !Number.isInteger(height) || height < 1 || height > 256) fail(path, 'width and height must be whole numbers from 1 to 256');
  if (!isObject(palette)) fail(`${path}.palette`, 'expected palette keys mapped to colours');
  for (const key of Object.keys(palette)) if (key.length !== 1 || key === '.' || key === ' ') fail(`${path}.palette.${key}`, 'draw loops write grid rows, so palette keys are single characters other than dot or space');
  const keyOf = (value, p) => (typeof value === 'string' && Object.hasOwn(palette, value) ? value : fail(p, `expected a palette key, not ${JSON.stringify(value)}`));
  const colors = options.colors ?? {};
  if (!isObject(colors)) fail(`${path}.colors`, 'expected CSS colours mapped to palette keys');
  for (const [css, key] of Object.entries(colors)) keyOf(key, `${path}.colors.${css}`);
  if (!Array.isArray(options.ramps ?? [])) fail(`${path}.ramps`, 'expected a list of ramps');
  const ramps = (options.ramps ?? []).map((entry, r) => {
    const rp = `${path}.ramps[${r}]`, ramp = Array.isArray(entry) ? { keys: entry } : entry;
    if (!isObject(ramp)) fail(rp, 'expected palette keys coolest first, or { keys, floor, breakup, cluster, seed, flicker }');
    fields(ramp, RAMP_FIELDS, rp);
    if (!Array.isArray(ramp.keys) || !ramp.keys.length || ramp.keys.length > 64) fail(`${rp}.keys`, 'expected 1–64 palette keys, coolest first');
    ramp.keys.forEach((key, i) => keyOf(key, `${rp}.keys[${i}]`));
    if (new Set(ramp.keys).size !== ramp.keys.length) fail(`${rp}.keys`, 'each key appears once; a key is one step of the ramp');
    for (const flag of ['flicker', 'surface']) if (ramp[flag] !== undefined && typeof ramp[flag] !== 'boolean') fail(`${rp}.${flag}`, 'expected a boolean');
    const { keys, flicker = false, surface = false, ...rest } = ramp, problem = rampProblem({ ramp: keys, ...rest });
    if (problem) fail(`${rp}${problem[0] === '.ramp' ? '.keys' : problem[0]}`, problem[1]);
    // Light under a tenth of full is invisible by default, so a blur's faint tail does not flood the canvas.
    const floor = rest.floor ?? 0.1, levels = new Map(keys.map((key, i) => [key, floor + (1 - floor) * (i + 0.5) / keys.length]));
    return { keys, flicker, surface, seed: rest.seed ?? 0, options: { floor, breakup: rest.breakup ?? 0, cluster: rest.cluster ?? 1, dither: rest.dither ?? 0, pattern: rest.pattern ?? 'bayer4' }, levels };
  });
  const rampOf = new Map();
  ramps.forEach((ramp, r) => ramp.keys.forEach(key => {
    if (rampOf.has(key)) fail(`${path}.ramps[${r}]`, `key ${JSON.stringify(key)} is already on ramp ${rampOf.get(key)}; a key belongs to one ramp`);
    rampOf.set(key, r);
  }));
  const soft = options.soft ?? 'dither';
  if (!['dither', 'threshold'].includes(soft)) fail(`${path}.soft`, 'expected dither (ordered pattern by coverage) or threshold (drawn at half coverage and above)');
  const pattern = options.pattern ?? 'bayer4', patternIssue = patternProblem(pattern);
  if (patternIssue) fail(`${path}.pattern${patternIssue[0]}`, patternIssue[1]);
  const units = options.units ?? 1;
  if (typeof units !== 'number' || !Number.isFinite(units) || units <= 0 || units > 256) fail(`${path}.units`, 'expected pixels per drawing unit, above 0 and at most 256');
  if (options.snap !== undefined && typeof options.snap !== 'boolean') fail(`${path}.snap`, 'expected a boolean');
  const symbols = options.symbols ?? {};
  if (!isObject(symbols)) fail(`${path}.symbols`, 'expected named rows of palette keys');
  for (const [name, rows] of Object.entries(symbols)) readRows(rows, `${path}.symbols.${name}`, palette);
  // Opaque palette colours map themselves; `colors` maps by its exact text and, when parseable, by RGB.
  const exact = new Map(), byText = new Map(), byRGB = new Map();
  for (const [key, value] of Object.entries(palette)) { const c = typeof value === 'string' ? cssColor(value) : null; if (c && c[3] === 1 && !exact.has(hexOf(c))) exact.set(hexOf(c), key); }
  for (const [css, key] of Object.entries(colors)) { byText.set(css.trim().toLowerCase(), key); const c = cssColor(css); if (c) byRGB.set(hexOf(c), key); }
  return { [PARSED]: true, width, height, palette, ramps, rampOf, soft, pattern, threshold: ditherThreshold(pattern), units, snap: options.snap ?? false, symbols, exact, byText, byRGB };
}
function readRows(rows, path, palette) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 256 || typeof rows[0] !== 'string' || !rows[0].length || rows[0].length > 256) fail(path, 'expected 1–256 rows of 1–256 characters');
  rows.forEach((row, y) => {
    if (typeof row !== 'string' || row.length !== rows[0].length) fail(`${path}[${y}]`, `all rows must be ${rows[0].length} characters wide`);
    for (const char of row) if (char !== '.' && char !== ' ' && !Object.hasOwn(palette, char)) fail(`${path}[${y}]`, `unknown palette key ${JSON.stringify(char)}`);
  });
  return rows;
}

// ---- Matrices (canvas order: x' = a x + c y + e, y' = b x + d y + f) -----------------------------------------------
const multiply = ([a, b, c, d, e, f], [A, B, C, D, E, F]) => [a * A + c * B, b * A + d * B, a * C + c * D, b * C + d * D, a * E + c * F + e, b * E + d * F + f];
function invert([a, b, c, d, e, f]) {
  const det = a * d - b * c;
  if (!det) return null;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}
const scaleOf = m => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

// ---- Masks ----------------------------------------------------------------------------------------------------------
// Pixels whose centres lie inside the subpaths (each implicitly closed), by the nonzero or even-odd rule.
function fillMask(subpaths, rule, width, height) {
  const mask = new Uint8Array(width * height), edges = [];
  for (const { points } of subpaths) if (points.length > 2) for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i], [x1, y1] = points[(i + 1) % points.length];
    if (y0 !== y1) edges.push([x0, y0, x1, y1]);
  }
  if (!edges.length) return mask;
  const top = Math.max(0, Math.floor(Math.min(...edges.map(e => Math.min(e[1], e[3]))) - 0.5)), bottom = Math.min(height - 1, Math.ceil(Math.max(...edges.map(e => Math.max(e[1], e[3])))));
  for (let y = top; y <= bottom; y++) {
    const yc = y + 0.5, crossings = [];
    for (const [x0, y0, x1, y1] of edges) {
      if ((y0 <= yc && yc < y1) || (y1 <= yc && yc < y0)) crossings.push([x0 + (yc - y0) * (x1 - x0) / (y1 - y0), y1 > y0 ? 1 : -1]);
    }
    crossings.sort((p, q) => p[0] - q[0]);
    let winding = 0;
    for (let k = 0; k + 1 < crossings.length; k++) {
      winding += rule === 'evenodd' ? 1 : crossings[k][1];
      if (rule === 'evenodd' ? winding % 2 === 0 : winding === 0) continue;
      const from = Math.max(0, Math.ceil(crossings[k][0] - 0.5)), to = Math.min(width - 1, Math.ceil(crossings[k + 1][0] - 0.5) - 1);
      for (let x = from; x <= to; x++) mask[y * width + x] = 1;
    }
  }
  return mask;
}
// A one-pixel line: the pixels whose inscribed diamond the path crosses (the rule GPUs use for lines), then every pixel
// that only fills the inside of an L between two diagonal neighbours is dropped ("pixel perfect"). Both steps ignore
// the drawing direction, so mirrored paths give mirrored pixels. A tiny nudge settles exact ties toward +x and +y.
function thinStrokeMask(subpaths, width, height) {
  const mask = new Uint8Array(width * height), nudge = [1e-7, 2e-7];
  for (const { points, closed } of subpaths) {
    const route = closed ? [...points, points[0]] : points;
    for (let s = 0; s + 1 < route.length; s++) {
      const x0 = route[s][0] + nudge[0], y0 = route[s][1] + nudge[1], x1 = route[s + 1][0] + nudge[0], y1 = route[s + 1][1] + nudge[1], dx = x1 - x0, dy = y1 - y0;
      if (!dx && !dy) continue;
      const left = Math.max(0, Math.floor(Math.min(x0, x1) - 0.5)), right = Math.min(width - 1, Math.floor(Math.max(x0, x1) + 0.5));
      const up = Math.max(0, Math.floor(Math.min(y0, y1) - 0.5)), down = Math.min(height - 1, Math.floor(Math.max(y0, y1) + 0.5));
      for (let y = up; y <= down; y++) for (let x = left; x <= right; x++) {
        // The closest the segment comes to the pixel centre in |dx| + |dy| is at an end or where it crosses the
        // centre's row or column.
        const cx = x + 0.5, cy = y + 0.5, at = t => Math.abs(x0 + t * dx - cx) + Math.abs(y0 + t * dy - cy);
        let d = Math.min(at(0), at(1));
        if (dx) { const t = (cx - x0) / dx; if (t > 0 && t < 1) d = Math.min(d, at(t)); }
        if (dy) { const t = (cy - y0) / dy; if (t > 0 && t < 1) d = Math.min(d, at(t)); }
        if (d < 0.5) mask[y * width + x] = 1;
      }
    }
  }
  const lit = (x, y) => x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1, drop = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!mask[y * width + x]) continue;
    const near = [];
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if ((i || j) && lit(x + i, y + j)) near.push([i, j]);
    // Exactly two neighbours, both square to this pixel and diagonal to each other: the inside of an L.
    if (near.length === 2 && near.every(([i, j]) => !i !== !j) && near[0][0] !== near[1][0] && near[0][1] !== near[1][1]) drop.push(y * width + x);
  }
  for (const i of drop) mask[i] = 0;
  return mask;
}
// Pixels whose centres lie within half the line width of a segment: round joins and caps.
function thickStrokeMask(subpaths, lineWidth, width, height) {
  const mask = new Uint8Array(width * height), half = lineWidth / 2;
  for (const { points, closed } of subpaths) {
    const route = closed ? [...points, points[0]] : points;
    for (let i = 0; i + 1 < route.length || (route.length === 1 && i === 0); i++) {
      const [x0, y0] = route[i], [x1, y1] = route[Math.min(i + 1, route.length - 1)], dx = x1 - x0, dy = y1 - y0, length2 = dx * dx + dy * dy;
      const left = Math.max(0, Math.floor(Math.min(x0, x1) - half)), right = Math.min(width - 1, Math.ceil(Math.max(x0, x1) + half));
      const up = Math.max(0, Math.floor(Math.min(y0, y1) - half)), down = Math.min(height - 1, Math.ceil(Math.max(y0, y1) + half));
      for (let y = up; y <= down; y++) for (let x = left; x <= right; x++) {
        const px = x + 0.5, py = y + 0.5, t = length2 ? clamp01(((px - x0) * dx + (py - y0) * dy) / length2) : 0;
        const ex = px - (x0 + t * dx), ey = py - (y0 + t * dy);
        if (ex * ex + ey * ey <= half * half) mask[y * width + x] = 1;
      }
    }
  }
  return mask;
}
// Gaussian blur of standard deviation sigma, approximated by three box blurs; outside the canvas counts as empty.
function blur(values, width, height, sigma) {
  const n = 3, ideal = Math.sqrt(12 * sigma * sigma / n + 1);
  let low = Math.floor(ideal); if (low % 2 === 0) low--;
  const m = Math.round((12 * sigma * sigma - n * low * low - 4 * n * low - 3 * n) / (-4 * low - 4));
  let source = values, target = new Float64Array(values.length);
  for (let pass = 0; pass < n; pass++) {
    const radius = ((pass < m ? low : low + 2) - 1) / 2, size = 2 * radius + 1;
    for (const horizontal of [true, false]) {
      const lines = horizontal ? height : width, span = horizontal ? width : height;
      for (let line = 0; line < lines; line++) {
        const at = k => (horizontal ? line * width + k : k * width + line);
        let sum = 0;
        for (let k = 0; k <= Math.min(radius, span - 1); k++) sum += source[at(k)];
        for (let k = 0; k < span; k++) {
          target[at(k)] = sum / size;
          if (k + radius + 1 < span) sum += source[at(k + radius + 1)];
          if (k - radius >= 0) sum -= source[at(k - radius)];
        }
      }
      [source, target] = [target, source];
    }
  }
  return source;
}

// ---- The context ------------------------------------------------------------------------------------------------------
const COMPOSITES = ['source-over', 'lighter', 'destination-out'];
const IGNORED = ['lineCap', 'lineJoin', 'miterLimit', 'lineDashOffset', 'imageSmoothingEnabled', 'imageSmoothingQuality', 'direction', 'fontKerning', 'textRendering', 'letterSpacing', 'wordSpacing', 'fontStretch', 'fontVariantCaps'];
const UNSUPPORTED = {
  arcTo: 'use arc or roundRect', createPattern: 'draw the tile with drawImage', createConicGradient: 'use a linear or radial gradient',
  getImageData: 'pixels are read from the compiled recipe', putImageData: 'use drawImage with palette rows', createImageData: 'use drawImage with palette rows',
  strokeText: 'use fillText', isPointInPath: 'keep the geometry in your own code', isPointInStroke: 'keep the geometry in your own code', drawFocusIfNeeded: 'not needed offline'
};
const fontSize = font => { const match = /(\d+(?:\.\d+)?)px/.exec(font); return match ? parseFloat(match[1]) : 10; };

// A Canvas 2D context that draws pixel art. `frame` numbers the moment being drawn (flickering ramps reseed by it);
// unmapped colours are counted into `unmapped`. readLayers() returns the finished palette rows per layer.
export function createPixelContext(options, { frame = 0, unmapped = new Map() } = {}) {
  if (isObject(options) && !options[PARSED]) fields(options, CONTEXT_FIELDS, 'context');
  const config = options?.[PARSED] ? options : readOptions(options, 'context');
  const { width, height, palette, ramps, rampOf, soft, threshold, units, snap, symbols } = config;
  const keys = ['.', ...Object.keys(palette)], code = new Map(keys.map((key, i) => [key, i]));
  const layers = [], points = {};
  const newLayer = name => ({ name, base: new Uint8Array(width * height), ramp: new Int16Array(width * height).fill(-1), heat: new Float64Array(width * height) });
  let layer = null;
  const target = () => { if (!layer) { layer = newLayer(null); layers.push(layer); } return layer; };

  const resolveCache = new Map();
  // A CSS colour, palette key or gradient → { key, alpha }, a gradient, or null (unmapped, recorded).
  const resolve = value => {
    if (typeof value !== 'string') return null;
    if (Object.hasOwn(palette, value)) return { key: value, alpha: 1 };
    if (resolveCache.has(value)) return resolveCache.get(value);
    const text = value.trim().toLowerCase(), parsed = cssColor(text);
    let result = null;
    if (parsed && parsed[3] === 0) result = { key: null, alpha: 0 };
    else {
      const key = config.byText.get(text) ?? (parsed && (config.byRGB.get(hexOf(parsed)) ?? config.exact.get(hexOf(parsed))));
      if (key !== undefined && key !== null) result = { key, alpha: parsed ? parsed[3] : 1 };
    }
    resolveCache.set(value, result);
    return result;
  };
  // A paint: { key, alpha, text } for a colour (missing set when unmapped), or a gradient object.
  const style = value => {
    if (value && value.gradient) return value;
    const resolved = resolve(value);
    return resolved ? { ...resolved, text: value } : { key: null, alpha: 0, text: value, missing: String(value) };
  };
  const record = missing => unmapped.set(missing, (unmapped.get(missing) ?? 0) + 1);
  const gradient = at => {
    const g = { gradient: true, at, stops: [], addColorStop(offset, color) {
      if (typeof offset !== 'number' || !(offset >= 0 && offset <= 1)) fail('gradient.addColorStop', 'the offset must be a number from 0 to 1');
      g.stops.push({ offset, color: style(color) });
    } };
    return g;
  };

  const initial = [units, 0, 0, units, 0, 0], black = style('#000000');
  let state = { m: initial, fill: black, stroke: black, alpha: 1, lineWidth: 1, blur: 0, shadow: style('rgba(0, 0, 0, 0)'), offsetX: 0, offsetY: 0, composite: 'source-over', font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic', clip: null, ignored: {} };
  const stack = [];
  let subpaths = [], current = null;

  const device = (x, y) => {
    const [a, b, c, d, e, f] = state.m;
    return [a * x + c * y + (snap ? Math.round(e) : e), b * x + d * y + (snap ? Math.round(f) : f)];
  };
  const toDevice = p => { if (!current) { current = { points: [p], closed: false }; subpaths.push(current); } else current.points.push(p); };
  // Like a browser canvas, calls with non-finite numbers do nothing.
  const check = (...values) => finite(...values);

  // Coverage passes for solid keys: ordered dither by default, or a plain half threshold.
  const passes = (c, x, y) => c >= 1 || (soft === 'threshold' ? c >= 0.5 : threshold(x, y) < c);
  const single = (r, heat, x, y) => {
    const ramp = ramps[r];
    return rampRows(1, 1, () => heat, { ramp: ramp.keys, ...ramp.options, seed: ramp.flicker ? ramp.seed + frame : ramp.seed, origin: [x, y] })[0];
  };
  const bake = (l, i, x, y) => {
    const key = single(l.ramp[i], l.heat[i], x, y);
    if (key !== '.') l.base[i] = code.get(key);
    l.ramp[i] = -1; l.heat[i] = 0;
  };
  // One pixel's contribution: a key at a coverage, with an optional ramp level that overrides the key's own.
  const deposit = (i, key, c, level) => {
    if (!(c > 0) || key === null) return;
    if (state.clip && !state.clip[i]) return;
    const l = target(), x = i % width, y = (i - x) / width;
    if (state.composite === 'destination-out') { if (passes(c, x, y)) { l.base[i] = 0; l.ramp[i] = -1; l.heat[i] = 0; } return; }
    let r = rampOf.get(key);
    if (r === undefined) {
      if (!passes(c, x, y)) return;
      l.base[i] = code.get(key); l.ramp[i] = -1; l.heat[i] = 0;
      return;
    }
    const lit = level ?? ramps[r].levels.get(key);
    // Light added onto a surface ramp raises that surface along its own colours instead of painting the light's.
    if (state.composite === 'lighter') {
      const under = l.ramp[i] >= 0 ? l.ramp[i] : rampOf.get(keys[l.base[i]]);
      if (under !== undefined && under !== r && ramps[under].surface) r = under;
    }
    if (l.ramp[i] !== r) {
      if (l.ramp[i] >= 0) bake(l, i, x, y);
      const below = keys[l.base[i]];
      l.heat[i] = rampOf.get(below) === r ? ramps[r].levels.get(below) : 0;
      l.ramp[i] = r;
    }
    l.heat[i] = state.composite === 'lighter' ? l.heat[i] + c * lit : l.heat[i] + c * (lit - l.heat[i]);
  };

  // A paint at a pixel: { key, alpha, level? }. Gradients are evaluated in the user space of the current transform.
  const painter = paint => {
    if (!paint.gradient) { if (paint.missing) record(paint.missing); return () => paint; }
    for (const stop of paint.stops) if (stop.color.missing) record(stop.color.missing);
    const inverse = invert(state.m), stops = paint.stops.slice().sort((p, q) => p.offset - q.offset);
    if (!inverse || !stops.length) return () => ({ key: null, alpha: 0 });
    return (x, y) => {
      const ux = inverse[0] * (x + 0.5) + inverse[2] * (y + 0.5) + inverse[4], uy = inverse[1] * (x + 0.5) + inverse[3] * (y + 0.5) + inverse[5];
      const t = paint.at(ux, uy);
      if (t === null) return { key: null, alpha: 0 };
      if (t <= stops[0].offset) return stops[0].color;
      if (t >= stops.at(-1).offset) return stops.at(-1).color;
      let k = 0;
      while (stops[k + 1].offset < t) k++;
      const from = stops[k], to = stops[k + 1], span = to.offset - from.offset, f = span ? (t - from.offset) / span : 1;
      const a0 = from.color, a1 = to.color, alpha = a0.alpha + (a1.alpha - a0.alpha) * f;
      const k0 = a0.key ?? a1.key, k1 = a1.key ?? a0.key;
      if (k0 === null) return { key: null, alpha: 0 };
      const r0 = rampOf.get(k0), r1 = rampOf.get(k1);
      // Stops on one ramp blend as light; other pairs pick a key through the ordered pattern.
      if (r0 !== undefined && r0 === r1) { const l0 = ramps[r0].levels.get(k0), l1 = ramps[r0].levels.get(k1); return { key: k0, alpha, level: l0 + (l1 - l0) * f }; }
      if (k0 === k1) return { key: k0, alpha };
      return { key: threshold(x, y) < f ? k1 : k0, alpha };
    };
  };
  // Draws a geometry mask with a paint, its shadow first.
  const draw = (mask, paint) => {
    const at = painter(paint), global = clamp01(state.alpha);
    const shadow = state.shadow;
    if (shadow.missing && (state.blur > 0 || state.offsetX || state.offsetY)) record(shadow.missing);
    if (shadow.key !== null && shadow.alpha > 0 && (state.blur > 0 || state.offsetX || state.offsetY)) {
      const dx = Math.round(state.offsetX * units), dy = Math.round(state.offsetY * units);
      let values = new Float64Array(width * height);
      for (let i = 0; i < mask.length; i++) if (mask[i]) {
        const x = i % width, y = (i - x) / width, tx = x + dx, ty = y + dy;
        if (tx >= 0 && ty >= 0 && tx < width && ty < height) values[ty * width + tx] = at(x, y).alpha * global;
      }
      if (state.blur > 0) values = blur(values, width, height, state.blur * units / 2);
      for (let i = 0; i < values.length; i++) if (values[i] > 0) deposit(i, shadow.key, values[i] * shadow.alpha, null);
    }
    for (let i = 0; i < mask.length; i++) if (mask[i]) {
      const x = i % width, y = (i - x) / width, p = at(x, y);
      deposit(i, p.key, p.alpha * global, p.level);
    }
  };
  const path = () => subpaths.filter(s => s.points.length > 1);
  const rectPath = (x, y, w, h) => [{ points: [device(x, y), device(x + w, y), device(x + w, y + h), device(x, y + h)], closed: true }];
  const strokeMask = paths => {
    const lineWidth = state.lineWidth * scaleOf(state.m);
    return lineWidth < 1.5 ? thinStrokeMask(paths, width, height) : thickStrokeMask(paths, lineWidth, width, height);
  };
  const ellipsePoints = (x, y, rx, ry, rotation, a0, a1, ccw) => {
    let sweep;
    if (!ccw) sweep = a1 - a0 >= TAU ? TAU : ((((a1 - a0) % TAU) + TAU) % TAU);
    else sweep = -(a0 - a1 >= TAU ? TAU : ((((a0 - a1) % TAU) + TAU) % TAU));
    const steps = Math.min(1024, Math.max(4, Math.ceil(Math.abs(sweep) * Math.max(rx, ry) * scaleOf(state.m) / 1.5)));
    const cr = cos(rotation), sr = sin(rotation);
    for (let k = 0; k <= steps; k++) {
      const angle = a0 + sweep * k / steps, px = rx * cos(angle), py = ry * sin(angle);
      toDevice(device(x + px * cr - py * sr, y + px * sr + py * cr));
    }
  };

  const api = {
    get canvas() { return { width: width / units, height: height / units }; },
    get fillStyle() { return state.fill.gradient ? state.fill : state.fill.text; }, set fillStyle(v) { state.fill = style(v); },
    get strokeStyle() { return state.stroke.gradient ? state.stroke : state.stroke.text; }, set strokeStyle(v) { state.stroke = style(v); },
    get shadowColor() { return state.shadow.text; }, set shadowColor(v) { if (!v?.gradient) state.shadow = style(v); },
    get globalAlpha() { return state.alpha; }, set globalAlpha(v) { if (Number.isFinite(v) && v >= 0 && v <= 1) state.alpha = v; },
    get lineWidth() { return state.lineWidth; }, set lineWidth(v) { if (Number.isFinite(v) && v > 0) state.lineWidth = v; },
    get shadowBlur() { return state.blur; }, set shadowBlur(v) { if (Number.isFinite(v) && v >= 0) state.blur = v; },
    get shadowOffsetX() { return state.offsetX; }, set shadowOffsetX(v) { if (Number.isFinite(v)) state.offsetX = v; },
    get shadowOffsetY() { return state.offsetY; }, set shadowOffsetY(v) { if (Number.isFinite(v)) state.offsetY = v; },
    get globalCompositeOperation() { return state.composite; },
    set globalCompositeOperation(v) { if (!COMPOSITES.includes(v)) fail('context.globalCompositeOperation', `${JSON.stringify(v)} is not supported; use ${COMPOSITES.join(', ')}`); state.composite = v; },
    get font() { return state.font; }, set font(v) { if (typeof v === 'string') state.font = v; },
    get textAlign() { return state.textAlign; }, set textAlign(v) { if (['start', 'end', 'left', 'right', 'center'].includes(v)) state.textAlign = v; },
    get textBaseline() { return state.textBaseline; }, set textBaseline(v) { if (['top', 'hanging', 'middle', 'alphabetic', 'ideographic', 'bottom'].includes(v)) state.textBaseline = v; },
    get filter() { return 'none'; }, set filter(v) { if (v !== 'none') fail('context.filter', 'filters are not supported; draw the effect with shapes, gradients or shadows'); },

    save() { stack.push({ ...state, ignored: { ...state.ignored } }); },
    restore() { if (stack.length) state = stack.pop(); },
    translate(x, y) { if (check(x, y)) state.m = multiply(state.m, [1, 0, 0, 1, x, y]); },
    rotate(angle) { if (check(angle)) state.m = multiply(state.m, [cos(angle), sin(angle), -sin(angle), cos(angle), 0, 0]); },
    scale(x, y) { if (check(x, y)) state.m = multiply(state.m, [x, 0, 0, y, 0, 0]); },
    transform(a, b, c, d, e, f) { if (check(a, b, c, d, e, f)) state.m = multiply(state.m, [a, b, c, d, e, f]); },
    setTransform(a, b, c, d, e, f) {
      if (a === undefined) { state.m = initial; return; }
      if (isObject(a)) ({ a, b, c, d, e, f } = a);
      if (check(a, b, c, d, e, f)) state.m = multiply(initial, [a, b, c, d, e, f]);
    },
    resetTransform() { state.m = initial; },
    getTransform() { const [a, b, c, d, e, f] = multiply([1 / units, 0, 0, 1 / units, 0, 0], state.m); return { a, b, c, d, e, f }; },

    beginPath() { subpaths = []; current = null; },
    moveTo(x, y) { if (!check(x, y)) return; current = { points: [device(x, y)], closed: false }; subpaths.push(current); },
    lineTo(x, y) { if (check(x, y)) toDevice(device(x, y)); },
    closePath() {
      if (!current || !current.points.length) return;
      current.closed = true;
      const first = current.points[0];
      current = { points: [first], closed: false }; subpaths.push(current);
    },
    rect(x, y, w, h) { if (!check(x, y, w, h)) return; api.moveTo(x, y); api.lineTo(x + w, y); api.lineTo(x + w, y + h); api.lineTo(x, y + h); api.closePath(); },
    roundRect(x, y, w, h, radii = 0) {
      if (!check(x, y, w, h)) return;
      const list = Array.isArray(radii) ? radii : [radii];
      if (!list.length || list.length > 4 || list.some(r => typeof r !== 'number' || !(r >= 0))) fail('context.roundRect', 'radii must be 1–4 non-negative numbers');
      let [tl, tr, br, bl] = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 1, 0, 1], [0, 1, 2, 1], [0, 1, 2, 3]][list.length].map(i => list[i]);
      const fit = Math.min(1, Math.abs(w) / Math.max(tl + tr, bl + br, 1e-9), Math.abs(h) / Math.max(tl + bl, tr + br, 1e-9));
      [tl, tr, br, bl] = [tl, tr, br, bl].map(r => r * fit);
      const sx = Math.sign(w) || 1, sy = Math.sign(h) || 1, q = TAU / 4;
      api.moveTo(x + tl * sx, y);
      ellipsePoints(x + w - tr * sx, y + tr * sy, tr, tr, 0, -q, 0, false);
      ellipsePoints(x + w - br * sx, y + h - br * sy, br, br, 0, 0, q, false);
      ellipsePoints(x + bl * sx, y + h - bl * sy, bl, bl, 0, q, 2 * q, false);
      ellipsePoints(x + tl * sx, y + tl * sy, tl, tl, 0, 2 * q, 3 * q, false);
      api.closePath();
    },
    arc(x, y, r, a0, a1, ccw = false) {
      if (!check(x, y, r, a0, a1)) return;
      if (r < 0) fail('context.arc', 'the radius must not be negative');
      ellipsePoints(x, y, r, r, 0, a0, a1, ccw);
    },
    ellipse(x, y, rx, ry, rotation, a0, a1, ccw = false) {
      if (!check(x, y, rx, ry, rotation, a0, a1)) return;
      if (rx < 0 || ry < 0) fail('context.ellipse', 'the radii must not be negative');
      ellipsePoints(x, y, rx, ry, rotation, a0, a1, ccw);
    },
    quadraticCurveTo(cx, cy, x, y) {
      if (!check(cx, cy, x, y)) return;
      if (!current) api.moveTo(cx, cy);
      const p0 = current.points.at(-1), p1 = device(cx, cy), p2 = device(x, y);
      const steps = Math.min(128, Math.max(2, Math.ceil((distance(p0, p1) + distance(p1, p2)) / 2)));
      for (let k = 1; k <= steps; k++) { const t = k / steps, u = 1 - t; toDevice([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]); }
    },
    bezierCurveTo(c1x, c1y, c2x, c2y, x, y) {
      if (!check(c1x, c1y, c2x, c2y, x, y)) return;
      if (!current) api.moveTo(c1x, c1y);
      const p0 = current.points.at(-1), p1 = device(c1x, c1y), p2 = device(c2x, c2y), p3 = device(x, y);
      const length = [[p0, p1], [p1, p2], [p2, p3]].reduce((sum, [p, q]) => sum + distance(p, q), 0);
      const steps = Math.min(128, Math.max(2, Math.ceil(length / 2)));
      for (let k = 1; k <= steps; k++) {
        const t = k / steps, u = 1 - t, w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
        toDevice([w[0] * p0[0] + w[1] * p1[0] + w[2] * p2[0] + w[3] * p3[0], w[0] * p0[1] + w[1] * p1[1] + w[2] * p2[1] + w[3] * p3[1]]);
      }
    },
    fill(rule = 'nonzero', second) {
      if (typeof rule === 'object' || second !== undefined) fail('context.fill', 'Path2D is not supported; build the path on the context');
      draw(fillMask(path(), rule, width, height), state.fill);
    },
    stroke(argument) {
      if (argument !== undefined) fail('context.stroke', 'Path2D is not supported; build the path on the context');
      draw(strokeMask(path()), state.stroke);
    },
    clip(rule = 'nonzero', second) {
      if (typeof rule === 'object' || second !== undefined) fail('context.clip', 'Path2D is not supported; build the path on the context');
      const mask = fillMask(path(), rule, width, height);
      if (state.clip) for (let i = 0; i < mask.length; i++) mask[i] &= state.clip[i];
      state.clip = mask;
    },
    fillRect(x, y, w, h) { if (check(x, y, w, h)) draw(fillMask(rectPath(x, y, w, h), 'nonzero', width, height), state.fill); },
    strokeRect(x, y, w, h) { if (check(x, y, w, h)) draw(strokeMask(rectPath(x, y, w, h)), state.stroke); },
    clearRect(x, y, w, h) {
      if (!check(x, y, w, h)) return;
      const mask = fillMask(rectPath(x, y, w, h), 'nonzero', width, height), l = target();
      for (let i = 0; i < mask.length; i++) if (mask[i] && (!state.clip || state.clip[i])) { l.base[i] = 0; l.ramp[i] = -1; l.heat[i] = 0; }
    },
    setLineDash(segments) { if (!Array.isArray(segments) || segments.length) fail('context.setLineDash', 'dashed lines are not supported; draw the dashes as separate segments'); },
    getLineDash() { return []; },
    createLinearGradient(x0, y0, x1, y1) {
      if (!finite(x0, y0, x1, y1)) fail('context.createLinearGradient', 'expected four finite numbers');
      const dx = x1 - x0, dy = y1 - y0, length2 = dx * dx + dy * dy;
      return gradient((x, y) => (length2 ? ((x - x0) * dx + (y - y0) * dy) / length2 : null));
    },
    createRadialGradient(x0, y0, r0, x1, y1, r1) {
      if (!finite(x0, y0, r0, x1, y1, r1) || r0 < 0 || r1 < 0) fail('context.createRadialGradient', 'expected finite centres and non-negative radii');
      // The largest t whose circle, interpolated between the two, passes through the point with a radius of at least 0.
      const cdx = x1 - x0, cdy = y1 - y0, dr = r1 - r0, a = cdx * cdx + cdy * cdy - dr * dr;
      return gradient((x, y) => {
        const px = x - x0, py = y - y0, b = px * cdx + py * cdy + r0 * dr, c = px * px + py * py - r0 * r0;
        let roots;
        if (Math.abs(a) < 1e-12) roots = b ? [c / (2 * b)] : [];
        else { const disc = b * b - a * c; if (disc < 0) return null; const s = Math.sqrt(disc); roots = [(b + s) / a, (b - s) / a]; }
        const t = roots.filter(v => r0 + v * dr >= 0).sort((p, q) => q - p)[0];
        return t === undefined ? null : t;
      });
    },
    fillText(text, x, y) {
      if (!check(x, y)) return;
      const [a, b, c, d] = state.m;
      if (Math.abs(b) > 1e-9 || Math.abs(c) > 1e-9 || a <= 0 || Math.abs(a - d) > 1e-9) fail('context.fillText', 'text is drawn upright in the built-in pixel font; rotated, skewed or mirrored text is not supported');
      const s = Math.max(1, Math.round(fontSize(state.font) * a / 8)), align = { start: 'left', left: 'left', center: 'center', end: 'right', right: 'right' }[state.textAlign];
      const block = layoutText(String(text), { spacing: 1, lineHeight: 10, align }, message => fail('context.fillText', message));
      const [px, py] = device(x, y), drawn = block.width * s;
      const left = Math.round(px) - (align === 'center' ? Math.floor(drawn / 2) : align === 'right' ? drawn : 0);
      const capTop = Math.round(py) + { alphabetic: -7 * s, top: 0, hanging: 0, middle: -Math.floor(7 * s / 2), ideographic: -8 * s, bottom: -8 * s }[state.textBaseline];
      const mask = new Uint8Array(width * height);
      block.rows.forEach((row, gy) => [...row].forEach((cell, gx) => {
        if (cell !== '#') return;
        for (let sy = 0; sy < s; sy++) for (let sx = 0; sx < s; sx++) {
          const tx = left + gx * s + sx, ty = capTop + (block.top + gy) * s + sy;
          if (tx >= 0 && ty >= 0 && tx < width && ty < height) mask[ty * width + tx] = 1;
        }
      }));
      draw(mask, state.fill);
    },
    measureText(text) {
      const s = Math.max(1, Math.round(fontSize(state.font) * scaleOf(state.m) / 8));
      return { width: layoutText(String(text), {}, message => fail('context.measureText', message)).width * s / scaleOf(state.m) };
    },
    // Images are palette rows: a symbol name from the loop's symbols, or { rows }. Pixels stay whole: the destination
    // is resized by nearest neighbour, turned by RotSprite to the nearest degree and placed on whole pixels.
    drawImage(image, ...args) {
      const rowsOf = typeof image === 'string' ? (Object.hasOwn(symbols, image) ? symbols[image] : fail('context.drawImage', `unknown symbol ${JSON.stringify(image)}; declare it in symbols`)) : isObject(image) ? readRows(image.rows, 'context.drawImage.rows', palette) : fail('context.drawImage', 'expected a symbol name or { rows } of palette keys; browser images cannot be read offline');
      if (![2, 4, 8].includes(args.length) || !finite(...args)) fail('context.drawImage', 'expected (image, dx, dy), (image, dx, dy, dw, dh) or (image, sx, sy, sw, sh, dx, dy, dw, dh)');
      let rows = rowsOf, [dx, dy, dw, dh] = args.length === 8 ? args.slice(4) : args;
      if (args.length === 8) {
        const [sx, sy, sw, sh] = args.slice(0, 4).map(Math.round);
        rows = rows.slice(Math.max(0, sy), Math.max(0, sy + sh)).map(row => row.slice(Math.max(0, sx), Math.max(0, sx + sw)));
        if (!rows.length || !rows[0].length) return;
      }
      const w = rows[0].length, h = rows.length;
      dw ??= w; dh ??= h;
      // The transform as a mirror (when its determinant is negative), a turn and two scales.
      const [a, b, c, d] = state.m, det = a * d - b * c, mirrored = det < 0, scaleX = Math.sqrt(a * a + b * b), scaleY = scaleX ? Math.abs(det) / scaleX : 0;
      const targetW = Math.max(1, Math.round(Math.abs(dw) * scaleX)), targetH = Math.max(1, Math.round(Math.abs(dh) * scaleY));
      const flipX = mirrored !== dw < 0, flipY = dh < 0;
      let grid = Array.from({ length: targetH }, (_, j) => Array.from({ length: targetW }, (_, i) => rows[Math.min(h - 1, Math.floor((flipY ? targetH - 1 - j : j) * h / targetH))][Math.min(w - 1, Math.floor((flipX ? targetW - 1 - i : i) * w / targetW))].replace(' ', '.')).join(''));
      // Whole degrees: the rounding also absorbs the last-bit differences of atan2 between engines.
      const degrees = ((Math.round(Math.atan2(mirrored ? -b : b, mirrored ? -a : a) * DEGREES) % 360) + 360) % 360;
      const [cx, cy] = device(dx + dw / 2, dy + dh / 2);
      let originX, originY;
      if (degrees % 90 === 0) {
        // Quarter turns are exact and stay centred on the destination.
        for (let k = 0; k < degrees / 90; k++) grid = Array.from({ length: grid[0].length }, (_, r) => Array.from({ length: grid.length }, (_, q) => grid[grid.length - 1 - q][r]).join(''));
        originX = Math.round(cx - grid[0].length / 2); originY = Math.round(cy - grid.length / 2);
      } else {
        // Other angles turn by RotSprite around the centre pixel, which stays where it was.
        const pivot = [Math.floor(targetW / 2), Math.floor(targetH / 2)], turned = rotateRows(grid, degrees, pivot);
        originX = Math.round(cx - targetW / 2) + pivot[0] - turned.pivot[0]; originY = Math.round(cy - targetH / 2) + pivot[1] - turned.pivot[1]; grid = turned.rows;
      }
      const global = clamp01(state.alpha), l = target();
      grid.forEach((row, j) => [...row].forEach((key, i) => {
        if (key === '.' || key === ' ') return;
        const x = originX + i, y = originY + j;
        if (x < 0 || y < 0 || x >= width || y >= height) return;
        const at = y * width + x;
        if (state.clip && !state.clip[at]) return;
        if (state.composite === 'destination-out') { if (passes(global, x, y)) { l.base[at] = 0; l.ramp[at] = -1; l.heat[at] = 0; } return; }
        if (!passes(global, x, y)) return;
        l.base[at] = code.get(key); l.ramp[at] = -1; l.heat[at] = 0;
      }));
    },

    // PixelForge additions. layer(name) sends what follows to a named recipe layer; point(name, x, y) marks a named
    // point on this frame, which the atlas exports for game code (a hand, a muzzle, the centre of an impact).
    layer(name) {
      if (typeof name !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)) fail('context.layer', 'expected a layer name of letters, digits, hyphens or underscores');
      layer = layers.find(l => l.name === name) ?? (layers.push(newLayer(name)), layers.at(-1));
    },
    point(name, x, y) {
      if (typeof name !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)) fail('context.point', 'expected a point name of letters, digits, hyphens or underscores');
      if (!check(x, y)) return;
      const [px, py] = device(x, y);
      points[name] = [Math.floor(px), Math.floor(py)];
    },
    readPoints() { return { ...points }; },
    // The finished rows of every layer in first-use order; a context with no named layers has one unnamed layer.
    readLayers() {
      return layers.map(l => {
        const rows = Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => keys[l.base[y * width + x]]));
        ramps.forEach((ramp, r) => {
          if (!l.ramp.includes(r)) return;
          const lit = rampRows(width, height, (x, y) => (l.ramp[y * width + x] === r ? l.heat[y * width + x] : 0), { ramp: ramp.keys, ...ramp.options, seed: ramp.flicker ? ramp.seed + frame : ramp.seed });
          lit.forEach((row, y) => { for (let x = 0; x < width; x++) if (row[x] !== '.') rows[y][x] = row[x]; });
        });
        return { name: l.name, rows: rows.map(row => row.join('')) };
      });
    }
  };
  for (const name of IGNORED) Object.defineProperty(api, name, { get: () => state.ignored[name], set: v => { state.ignored[name] = v; }, enumerable: true });
  // Anything a browser context has that this one does not is an error naming the call, never a silent no-op.
  return new Proxy(api, {
    get(target, key) {
      if (typeof key === 'symbol' || Object.hasOwn(target, key) || key in Object.prototype) return Reflect.get(target, key);
      if (key === 'then' || key === 'toJSON') return undefined;
      fail(`context.${key}`, Object.hasOwn(UNSUPPORTED, key) ? `not supported by the pixel context; ${UNSUPPORTED[key]}` : 'not supported by the pixel context');
    },
    set(target, key, value) {
      if (typeof key === 'symbol' || !Object.hasOwn(target, key)) fail(`context.${String(key)}`, 'not supported by the pixel context');
      return Reflect.set(target, key, value);
    }
  });
}

// ---- Compiling a loop -------------------------------------------------------------------------------------------------
const LOOP_FIELDS = ['name', 'width', 'height', 'palette', 'colors', 'ramps', 'soft', 'pattern', 'units', 'snap', 'symbols', 'timeline', 'loop', 'background', 'anchor', 'sheet', 'draw'];
const crop = rows => {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x] !== '.') { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } });
  return x1 < 0 ? null : { op: 'grid', x: x0, y: y0, rows: rows.slice(y0, y1 + 1).map(row => row.slice(x0, x1 + 1)) };
};
// Samples draw(ctx, seconds, { ms, frame, duration, length }) at every frame of the timeline and returns an ordinary
// recipe (frames <name>-0, <name>-1… in one animation) plus metadata with each cue's frame.
export function compileLoop(spec) {
  if (!isObject(spec)) fail('loop', 'expected { name, width, height, palette, timeline, draw }');
  fields(spec, LOOP_FIELDS, 'loop');
  if (typeof spec.draw !== 'function') fail('loop.draw', 'expected a function (ctx, t, frame) that draws the moment t, in seconds');
  if (typeof spec.name !== 'string') fail('loop.name', 'expected a name');
  if (spec.loop !== undefined && typeof spec.loop !== 'boolean') fail('loop.loop', 'expected a boolean');
  const config = readOptions(spec, 'loop'), timeline = readTimeline(spec.timeline, 'loop.timeline'), unmapped = new Map();
  const frames = timeline.starts.map((ms, index) => {
    const duration = (timeline.starts[index + 1] ?? timeline.length) - ms, ctx = createPixelContext(config, { frame: index, unmapped });
    try { spec.draw(ctx, ms / 1000, { ms, frame: index, duration, length: timeline.length }); }
    catch (error) {
      const where = `frame ${index} at ${ms} ms`;
      if (error instanceof PixelError) throw new PixelError(error.path, `${error.message.slice(error.path.length + 2)} (${where})`);
      const wrapped = new PixelError('loop.draw', `${where}: ${error?.message ?? error}`); wrapped.cause = error; throw wrapped;
    }
    const drawn = ctx.readLayers().map(l => ({ ...l, grid: crop(l.rows) })), named = drawn.some(l => l.name !== null);
    const cuePoints = Object.fromEntries(Object.entries(timeline.cues).filter(([, cue]) => cue.index === index && cue.at).map(([name, cue]) => [name, cue.at]));
    const framePoints = { ...ctx.readPoints(), ...cuePoints };
    return {
      name: `${spec.name}-${index}`, duration, ...(Object.keys(framePoints).length && { points: framePoints }),
      ...(named ? { layers: drawn.filter(l => l.grid).map(l => ({ name: l.name ?? 'main', ops: [l.grid] })) } : drawn[0]?.grid ? { ops: [drawn[0].grid] } : {})
    };
  });
  if (unmapped.size) {
    const list = [...unmapped].map(([color, uses]) => `${JSON.stringify(color)} (${uses} use${uses === 1 ? '' : 's'})`).join(', ');
    fail('loop.colors', `map these colours to palette keys, for example colors: { ${JSON.stringify([...unmapped.keys()][0])}: "k" }, or add them to the palette: ${list}`);
  }
  const names = frames.map(frame => frame.name);
  const recipe = {
    version: 1, name: spec.name, width: spec.width, height: spec.height, palette: spec.palette ?? {}, ...(spec.background !== undefined && { background: spec.background }),
    ...(spec.anchor !== undefined && { anchor: spec.anchor }), frames, animations: { [spec.name]: { frames: names, ...(spec.loop === false && { loop: false }) } }, ...(spec.sheet !== undefined && { sheet: spec.sheet })
  };
  renderProject(recipe);
  const metadata = { format: 'pixelforge-loop-metadata', version: 1, timeline: { length: timeline.length, cues: Object.fromEntries(Object.entries(timeline.cues).map(([name, { time, index, at }]) => [name, { time, frame: names[index], ...(at && { at }) }])) } };
  return JSON.parse(JSON.stringify({ recipe, metadata }));
}
