// Builds a pixelforge-scene manifest of one 240x160 screen of the island, straight from the game's map, so the
// PixelForge scene viewer can review it (native size, grayscale, density, lighting). Recipes must be inlined.
// Usage: node tools/make-scene.mjs <name> <tileX> <tileY> [--night]
import { readFileSync } from 'node:fs';
import { writeJSON } from './common.mjs';
import { TERRAIN, OBJECTS, isSand, isGrass } from '../game/src/map.js';
import { maskAt } from '../game/src/autotile.js';
import { ANCHORS } from '../game/src/world.js';
const [name = 'headland', tx = '12', ty = '0'] = process.argv.slice(2), night = process.argv.includes('--night');
const X0 = Number(tx), Y0 = Number(ty), COLS = 15, ROWS = 10;
const load = recipe => JSON.parse(readFileSync(new URL(`../art/recipes/${recipe}.json`, import.meta.url), 'utf8'));
const lit = recipe => ({ recipe: load(recipe), normal: load(`${recipe}-normal`), emissive: load(`${recipe}-emissive`) });
const assets = { water: load('water'), shore: load('shore'), grass: load('grass'), props: load('props'), flora: load('flora'), rocks: load('rocks'), keeper: load('keeper'), lighthouse: lit('lighthouse'), lamp: lit('lamp') };
const instances = [{ name: 'sea', asset: 'water', animation: 'shimmer-a', at: [0, 0], repeat: [COLS, ROWS] }];
for (let y = Y0; y < Y0 + ROWS; y++) for (let x = X0; x < X0 + COLS; x++) {
  const at = [(x - X0) * 16, (y - Y0) * 16];
  if (isSand(x, y)) instances.push({ asset: 'shore', frame: `shore-${maskAt(null, x, y, (_, i, j) => isSand(i, j))}-0`, at });
  if (isGrass(x, y)) instances.push({ asset: 'grass', frame: `grass-${maskAt(null, x, y, (_, i, j) => isGrass(i, j))}`, at });
}
const ASSET = { palm: 'flora', oak: 'flora', 'boulder-a': 'rocks', 'boulder-b': 'rocks', lighthouse: 'lighthouse', lamp: 'lamp' };
const FRAME = { lighthouse: night ? undefined : 'unlit', lamp: night ? undefined : 'off', palm: 'palm-0', oak: 'oak-0' };
const ANIM = { lighthouse: 'night', lamp: 'on', grass: 'grass-sway' };
const visible = OBJECTS.map(([kind, x, y, extra = {}]) => ({ kind, x: x * 16 + 8 + (extra.dx ?? 0) - X0 * 16, y: y * 16 + 16 + (extra.dy ?? 0) - Y0 * 16 }))
  .filter(o => o.x > -40 && o.x < COLS * 16 + 40 && o.y > -8 && o.y < ROWS * 16 + 140 && ['lighthouse', 'lamp', 'palm', 'oak', 'bush', 'grass', 'rock', 'boulder-a', 'boulder-b', 'flower-red', 'flower-violet', 'flower-white', 'pot'].includes(o.kind))
  .sort((a, b) => a.y - b.y);
for (const o of visible) {
  const asset = ASSET[o.kind] ?? 'props', anim = night || o.kind === 'grass' ? ANIM[o.kind] : undefined;
  instances.push({ name: o.kind, asset, at: [o.x, o.y], anchor: ANCHORS[o.kind], ...(anim ? { animation: anim } : { frame: FRAME[o.kind] ?? o.kind }) });
}
instances.push({ name: 'keeper', asset: 'keeper', animation: 'idle-u', at: [8 * 16 + 8, 9 * 16 + 4], anchor: ANCHORS.keeper });
const lighthouse = visible.find(o => o.kind === 'lighthouse'), lamps = visible.filter(o => o.kind === 'lamp');
const scene = { format: 'pixelforge-scene', version: 1, name: `tidewatch-${name}${night ? '-night' : ''}`, width: COLS * 16, height: ROWS * 16, duration: 2400, background: '#213f7a', assets, instances,
  ...(night && { lighting: { ambient: 0.28, bands: 4, lights: [{ at: [lighthouse.x, lighthouse.y - 98], height: 40, radius: 130, color: '#ffe8a0' }, ...lamps.map(l => ({ at: [l.x, l.y - 24], height: 14, radius: 64, color: '#ffb866' }))].slice(0, 8) } }) };
console.log('placements', instances.length);
writeJSON(`art/scenes/${scene.name}.scene.json`, scene, { force: true });
