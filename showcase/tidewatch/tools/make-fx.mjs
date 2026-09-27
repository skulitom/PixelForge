// One-time scaffold for effects, pickups and UI. Effects use small, explicit particle layouts (hand-placed
// starting points and velocities) so each material moves differently; the resulting grids are ordinary frames.
import { paletteFor, writeJSON, palette as GLOBAL } from './common.mjs';
const force = { force: process.argv.includes('--force') };
const canvas = (w, h) => Array.from({ length: h }, () => Array(w).fill('.'));
const rows = g => g.map(r => r.join(''));
const put = (g, x, y, c) => { x = Math.round(x); y = Math.round(y); if (y >= 0 && y < g.length && x >= 0 && x < g[0].length) g[y][x] = c; };
const stamp = (g, x, y, shape) => shape.forEach((row, dy) => [...row].forEach((c, dx) => { if (c !== '.') put(g, x + dx, y + dy, c); }));
// ---------------- sword slash arcs (48x48, centred on the keeper's body) ----------------
const SWEEPS = { d: [-20, 200], u: [160, 380], r: [-110, 110], l: [70, 290] };
function slash(dir, frame) {
  const g = canvas(48, 48), [a0, a1] = SWEEPS[dir], cx = 24, cy = dir === 'u' ? 25 : dir === 'd' ? 23 : 24;
  const from = frame === 2 ? 0.45 : 0, to = frame === 0 ? 0.45 : 1;
  for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) {
    const dx = x + 0.5 - cx, dy = (y + 0.5 - cy) * 1.15, r = Math.hypot(dx, dy);
    let ang = Math.atan2(dy, dx) * 180 / Math.PI; while (ang < a0) ang += 360; while (ang > a0 + 360) ang -= 360;
    const t = (ang - a0) / (a1 - a0); if (t < from || t > to) continue;
    const lead = frame === 2 ? 1 - (t - from) / (to - from) : (t - from) / (to - from); // thickest near the blade
    const outer = 19, thick = 1 + lead * 5.5;
    if (r > outer || r < outer - thick) continue;
    const edge = r > outer - 1.2 ? 'x' : r > outer - 2.4 ? (frame === 2 ? 'M' : '7') : frame === 2 ? '8' : 'W';
    put(g, x, y, lead < 0.25 && (x + y) % 2 ? '.' : edge);
  }
  return rows(g);
}
// ---------------- particle effects (32x32) ----------------
function particles(steps, list, shapeAt) {
  return Array.from({ length: steps }, (_, f) => {
    const g = canvas(32, 32);
    for (const p of list) {
      const t = f, x = p.x + p.vx * t + (p.sway ?? 0) * Math.sin(t * 1.3 + p.x), y = p.y + p.vy * t + 0.5 * (p.g ?? 0.6) * t * t;
      if (p.life !== undefined && f > p.life) continue;
      stamp(g, x, Math.min(y, p.floor ?? 99), shapeAt(p, f));
    }
    return rows(g);
  });
}
const leafShapes = { l: [['jl', 'hj'], ['.l', 'jh', 'g.']], j: [['jj', 'hg'], ['hj', '.g']], h: [['hj', 'g.'], ['.h', 'hg']] };
const leaves = particles(7, [
  { x: 14, y: 18, vx: -1.8, vy: -3.4, g: 1.1, sway: 1.2, c: 'l' }, { x: 17, y: 17, vx: 2.1, vy: -3.8, g: 1.1, sway: 1.2, c: 'j' },
  { x: 12, y: 20, vx: -3, vy: -1.8, g: 0.9, sway: 1, c: 'h' }, { x: 19, y: 20, vx: 3.1, vy: -2.2, g: 0.9, sway: 1, c: 'j' },
  { x: 15, y: 16, vx: 0.4, vy: -4.4, g: 1.2, sway: 1.6, c: 'l' }, { x: 11, y: 19, vx: -1.4, vy: -2.6, g: 1, sway: 0.8, c: 'h' },
  { x: 20, y: 19, vx: 1.5, vy: -3, g: 1, sway: 0.8, c: 'j' }, { x: 16, y: 21, vx: -0.6, vy: -2, g: 0.8, sway: 1.4, c: 'l' },
  { x: 13, y: 22, vx: -2.2, vy: -1, g: 0.7, sway: 0.6, c: 'j', life: 5 }, { x: 18, y: 22, vx: 2.4, vy: -1.2, g: 0.7, sway: 0.6, c: 'h', life: 5 }
], (p, f) => leafShapes[p.c][(f + Math.round(p.x)) % 2]);
const shards = particles(6, [
  { x: 13, y: 17, vx: -2.6, vy: -2.6, g: 1.3, floor: 24, s: ['kOk', 'kuk'] }, { x: 17, y: 16, vx: 2.4, vy: -3.2, g: 1.3, floor: 25, s: ['kkk', 'Ouk'] },
  { x: 14, y: 20, vx: -1.2, vy: -1.6, g: 1.1, floor: 26, s: ['kOuk', '.kk.'] }, { x: 18, y: 20, vx: 3.2, vy: -1.4, g: 1, floor: 26, s: ['kO', 'uk'] },
  { x: 15, y: 18, vx: 0.6, vy: -3.8, g: 1.4, floor: 24, s: ['kOk'] }, { x: 12, y: 21, vx: -3.3, vy: -0.8, g: 0.8, floor: 27, s: ['ku', 'kk'] },
  { x: 19, y: 21, vx: 1.2, vy: -2.2, g: 1.2, floor: 26, s: ['Uk'] }, { x: 16, y: 22, vx: -0.3, vy: -1, g: 0.9, floor: 27, s: ['kuUk'] }
], p => p.s);
const splash = Array.from({ length: 5 }, (_, f) => {
  const g = canvas(32, 32), rise = [3, 7, 8, 5, 0][f];
  const ring = f >= 2 ? 3 + f * 2 : 0;
  for (let i = -ring; i <= ring; i++) { if (ring && Math.abs(i) >= ring - 1) { put(g, 16 + i, 24, 'w'); } }
  if (ring) { put(g, 16 - ring, 23, 'W'); put(g, 16 + ring, 23, 'W'); put(g, 16 - ring + 1, 25, 'W'); put(g, 16 + ring - 1, 25, 'W'); }
  if (rise) for (const [dx, h, c] of [[-3, 0.6, 'W'], [-1, 1, 'w'], [1, 0.9, 'w'], [3, 0.55, 'W']]) {
    const top = 24 - Math.round(rise * h); for (let y = top; y < 24; y++) put(g, 16 + dx + (y < top + 2 ? Math.sign(dx) : 0), y, y === top ? 'w' : c);
  }
  if (f === 1 || f === 2) [[-5, 16], [5, 15], [-2, 13], [3, 12]].forEach(([dx, y]) => put(g, 16 + dx * (f === 2 ? 1.3 : 1), y - (f === 2 ? 2 : 0), 'w'));
  return rows(g);
});
const poof = Array.from({ length: 6 }, (_, f) => {
  const g = canvas(32, 32);
  const puffs = [[16, 18, 4], [11, 17, 3], [21, 17, 3], [14, 13, 3], [19, 13, 3], [16, 21, 3]];
  for (const [px, py, r0] of puffs) {
    const r = r0 * [0.6, 1, 1.25, 1.35, 1.2, 0.8][f], y0 = py - f * 1.2 - (px === 16 ? 0.5 * f : 0);
    for (let y = Math.floor(y0 - r); y <= y0 + r; y++) for (let x = Math.floor(px - r); x <= px + r; x++) {
      const d = Math.hypot(x - px, (y - y0) * 1.1); if (d > r) continue;
      if (f >= 4 && (x + y + f) % 3 === 0) continue;
      const light = (x - px) + (y - y0) < -r * 0.3;
      put(g, x, y, d > r - 1 ? (f >= 4 ? '9' : 't') : light ? (f >= 3 ? '8' : 'r') : f >= 3 ? '9' : 'R');
    }
  }
  return rows(g);
});
const hit = [
  ['................', '.......x........', '.......x........', '...x...x...x....', '....x..W..x.....', '.....xWWWx......', '..xxxWW7WWxxx...', '.....xWWWx......', '....x..W..x.....', '...x...x...x....', '.......x........', '.......x........'],
  ['................', '................', '.......W........', '....W..x..W.....', '.....x.x.x......', '......x7x.......', '...WxxxWxxxW....', '......x7x.......', '.....x.x.x......', '....W..x..W.....', '.......W........', '................'],
  ['................', '................', '................', '................', '.......M........', '.....M.W.M......', '....M.W.W.M.....', '.....M.W.M......', '.......M........', '................', '................', '................']
].map(r => { const g = canvas(32, 32); stamp(g, 8, 10, r); return rows(g); });
const sparkle = [
  ['.......', '...x...', '..xWx..', '.xW7Wx.', '..xWx..', '...x...', '.......'],
  ['...x...', '...x...', '..xWx..', 'xxW7Wxx', '..xWx..', '...x...', '...x...'],
  ['.......', '...W...', '...x...', '.Wx7xW.', '...x...', '...W...', '.......'],
  ['.......', '.......', '...W...', '..W7W..', '...W...', '.......', '.......']
].map(r => { const g = canvas(32, 32); stamp(g, 12, 12, r); return rows(g); });
const dust = [
  ['.......', '.......', '..RR...', '.RrRt..', '..tt...'],
  ['.......', '.R..R..', 'RrR.RR.', '.tt..tt', '.......'],
  ['R.....R', '.......', 'R.....t', '.......', '.......']
].map(r => { const g = canvas(32, 32); stamp(g, 13, 24, r); return rows(g); });
const fxGroups = { leaves: [leaves, 70], shards: [shards, 70], splash: [splash, 80], poof: [poof, 70], hit: [hit, 50], sparkle: [sparkle, 90], dust: [dust, 70] };
const fxFrames = [], fxAnimations = {};
for (const [key, [list, duration]] of Object.entries(fxGroups)) {
  const names = list.map((g, i) => { const name = `${key}-${i}`; fxFrames.push({ name, duration, ops: [{ op: 'grid', x: 0, y: 0, rows: g }] }); return name; });
  fxAnimations[key] = { frames: names, loop: false };
}
fxAnimations.sparkle.loop = true;
writeJSON('art/recipes/fx.json', { version: 1, name: 'fx', width: 32, height: 32, palette: paletteFor(fxFrames.map(f => f.ops[0].rows)), frames: fxFrames, animations: fxAnimations, sheet: { columns: 8 } }, force);
const slashFrames = [], slashAnimations = {};
for (const dir of 'durl') {
  slashAnimations[`slash-${dir}`] = { frames: [0, 1, 2].map(f => { const name = `slash-${dir}-${f}`; slashFrames.push({ name, duration: [50, 70, 70][f], ops: [{ op: 'grid', x: 0, y: 0, rows: slash(dir, f) }] }); return name; }), loop: false };
}
writeJSON('art/recipes/slash.json', { version: 1, name: 'slash', width: 48, height: 48, palette: paletteFor(slashFrames.map(f => f.ops[0].rows)), frames: slashFrames, animations: slashAnimations, sheet: { columns: 6 } }, force);
// ---------------- pickups (16x16) with an emissive pass for the sunflint ----------------
const P = {
  'heart-0': ['................', '................', '................', '....kkk.kkk.....', '...k1x1k122k....', '...k1x11222k....', '...k1112223k....', '....k12223k.....', '.....k223k......', '......k3k.......', '.......k........', '................', '.....______.....', '................', '................'],
  'heart-1': ['................', '................', '................', '................', '....kkk.kkk.....', '...k1x1k122k....', '...k1x11222k....', '...k1112223k....', '....k12223k.....', '.....k223k......', '......k3k.......', '.......k........', '.....______.....', '................', '................'],
  'glass-0': ['................', '................', '................', '.......kk.......', '......kwWk......', '.....kwWWck.....', '....kwWWcccK....', '....kWWccCCk....', '....kWccCCnk....', '.....kcCCnk.....', '......kCnk......', '.......kk.......', '.....______.....', '................', '................', '................'],
  'glass-1': ['................', '................', '................', '.......kk.......', '......kWWk......', '.....kWxWck.....', '....kWxxWccK....', '....kWWWccCk....', '....kWccCCnk....', '.....kcCCnk.....', '......kCnk......', '.......kk.......', '.....______.....', '................', '................', '................'],
  'glass-2': ['................', '................', '................', '.......kk.......', '......kWWk......', '.....kWWWck.....', '....kWWWcxcK....', '....kWWccxCk....', '....kWccCCnk....', '.....kcCCnk.....', '......kCnk......', '.......kk.......', '.....______.....', '................', '................', '................'],
  'key': ['................', '................', '....kkkk........', '...kXeeXk.......', '..kXk..kXk......', '..kXk..kik......', '...kXiiik.......', '....kkXik.......', '......kXk.......', '......kXkk......', '......kXXik.....', '......kXkk......', '......kXXik.....', '.......kkk......', '.....______.....', '................'],
  'flint-0': ['................', '................', '.......kk.......', '......kxek......', '.....kxXXik.....', '.....keXXiik....', '....kxXXXiiIk...', '....keXXiiiIk...', '....kXXiiiIIk...', '.....kiiiIIk....', '.....kiIIIk.....', '......kIIk......', '.......kk.......', '.....______.....', '................', '................'],
  'flint-1': ['................', '................', '.......kk.......', '......kxxk......', '.....kxxXek.....', '.....kxXXiik....', '....kxXXXXiIk...', '....keXXXiiIk...', '....kXXXiiiIk...', '.....kXiiIIk....', '.....kiiIIk.....', '......kIIk......', '.......kk.......', '.....______.....', '................', '................']
};
const pickFrames = Object.entries(P).map(([name, g]) => ({ name, duration: name.startsWith('glass') ? 160 : name.startsWith('heart') ? 400 : 300, ops: [{ op: 'grid', x: 0, y: 0, rows: g }] }));
const pickAnimations = { heart: { frames: ['heart-0', 'heart-1'] }, glass: { frames: ['glass-0', 'glass-0', 'glass-1', 'glass-2'] }, key: { frames: ['key'] }, flint: { frames: ['flint-0', 'flint-1'] } };
writeJSON('art/recipes/pickups.json', { version: 1, name: 'pickups', width: 16, height: 16, palette: paletteFor(Object.values(P)), frames: pickFrames, animations: pickAnimations }, force);
const glow = name => P[name].map(r => r.replace(/[^xXeiI]/g, '.'));
writeJSON('art/recipes/pickups-emissive.json', { version: 1, name: 'pickups-emissive', width: 16, height: 16, palette: paletteFor(Object.values(P)), frames: pickFrames.map(f => ({ ...f, ops: [{ op: 'grid', x: 0, y: 0, rows: f.name.startsWith('flint') ? glow(f.name) : ['................'] }] })), animations: pickAnimations }, force);
// ---------------- UI icons (16x16) and a 9-slice dialog frame (8x8) ----------------
const U = {
  'heart-full': ['.kkk.kkk.', 'k1x1k122k', 'k1112222k', 'k1122223k', '.k12223k.', '..k223k..', '...k3k...', '....k....'],
  'heart-half': ['.kkk.kkk.', 'k1x1kKKLk', 'k112kKKLk', 'k122kKLLk', '.k12kLLk.', '..k2kLk..', '...kkk...', '....k....'],
  'heart-empty': ['.kkk.kkk.', 'kKKLkKKLk', 'kKKKKKLLk', 'kKKKKLLLk', '.kKKLLLk.', '..kKLLk..', '...kLk...', '....k....'],
  'glass': ['...kk...', '..kwWk..', '.kwWcck.', 'kWWccCnk', '.kcCCnk.', '..kCnk..', '...kk...'],
  'key': ['.kkk.....', 'kXeXk....', 'kX.Xkkkkk', 'kXiXXXiik', '.kkk.kXk.', '.....kkk.'],
  'flint': ['..kk..', '.kxek.', 'kxXXik', 'keXiIk', '.kiIk.', '..kk..']
};
const uiFrames = Object.entries(U).map(([name, g]) => ({ name, ops: [{ op: 'grid', x: 1, y: 1, rows: g.map(r => r.padEnd(10, '.').slice(0, 10)) }] }));
writeJSON('art/recipes/ui.json', { version: 1, name: 'ui', width: 12, height: 10, palette: paletteFor(Object.values(U)), frames: uiFrames }, force);
const box = {
  tl: ['..kkkkkk', '.kMMMMMM', 'kMvvvvvv', 'kMvVVVVV', 'kMvVVVVV', 'kMvVVVVV', 'kMvVVVVV', 'kMvVVVVV'],
  t: ['kkkkkkkk', 'MMMMMMMM', 'vvvvvvvv', 'VVVVVVVV', 'VVVVVVVV', 'VVVVVVVV', 'VVVVVVVV', 'VVVVVVVV'],
  c: Array(8).fill('VVVVVVVV')
};
const rot = g => g[0].split('').map((_, x) => g.map(r => r[x]).reverse().join(''));
const boxFrames = { tl: box.tl, t: box.t, tr: rot(box.tl), r: rot(box.t), br: rot(rot(box.tl)), b: rot(rot(box.t)), bl: rot(rot(rot(box.tl))), l: rot(rot(rot(box.t))), c: box.c };
writeJSON('art/recipes/dialog.json', { version: 1, name: 'dialog', width: 8, height: 8, palette: paletteFor(Object.values(boxFrames)), frames: Object.entries(boxFrames).map(([name, g]) => ({ name: `box-${name}`, ops: [{ op: 'grid', x: 0, y: 0, rows: g }] })), sheet: { columns: 9 } }, force);
console.log('fx, slash, pickups, ui and dialog written');
