// Composes a tile map through PixelForge's scene renderer: water everywhere, then autotiled layers.
// Usage: node tools/preview-map.mjs <map.txt> <out.png> [--phase 0] [--scale 3] [--scene out.scene.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { prepareScene, renderScene, scalePixels, encodePNG } from '../../../src/index.js';
import { maskAt } from './autotile.mjs';
const [mapFile, out, ...rest] = process.argv.slice(2);
const opt = {}; for (let i = 0; i < rest.length; i += 2) opt[rest[i].slice(2)] = rest[i + 1];
const phase = Number(opt.phase ?? 0), scale = Number(opt.scale ?? 3);
const rows = readFileSync(mapFile, 'utf8').trim().split(/\r?\n/);
const load = name => JSON.parse(readFileSync(`art/recipes/${name}.json`, 'utf8'));
const assets = { water: load('water'), shore: load('shore'), grass: load('grass') };
const instances = [];
const cell = (g, x, y) => g[y]?.[x];
const sandLike = (g, x, y) => { const c = cell(g, x, y); return c !== undefined && c !== '.'; };
// Scenes allow only 256 placements, so the water layer uses one repeated instance (a single variant).
instances.push({ asset: 'water', frame: `water-a${phase}`, at: [0, 0], repeat: [rows[0].length, rows.length] });
for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[0].length; x++) {
  if (!sandLike(rows, x, y)) continue;
  instances.push({ asset: 'shore', frame: `shore-${maskAt(rows, x, y, sandLike)}-${phase}`, at: [x * 16, y * 16] });
}
const grassLike = (g, x, y) => cell(g, x, y) === 'g';
for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[0].length; x++) {
  if (grassLike(rows, x, y)) instances.push({ asset: 'grass', frame: `grass-${maskAt(rows, x, y, grassLike)}`, at: [x * 16, y * 16] });
}
const source = { format: 'pixelforge-scene', version: 1, name: 'map-preview', width: rows[0].length * 16, height: rows.length * 16, background: '#000000', assets, instances };
const view = renderScene(prepareScene(source));
writeFileSync(out, encodePNG(scalePixels(view.data, view.width, view.height, scale), view.width * scale, view.height * scale));
if (opt.scene) writeFileSync(opt.scene, JSON.stringify(source));
console.log(JSON.stringify({ instances: instances.length, warnings: view.warnings }));
