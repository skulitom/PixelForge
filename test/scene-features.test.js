import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareScene, renderScene } from '../src/scene.js';
import { compileAutotile } from '../src/authoring.js';
import { templatePiece } from '../src/autotile.js';

const tiles = { version: 1, name: 'tiles', width: 2, height: 2, palette: { a: '#f00', b: '#0f0', c: '#00f' }, frames: [
  { name: 'red', ops: [{ op: 'rect', w: 2, h: 2, color: 'a' }] }, { name: 'green', ops: [{ op: 'rect', w: 2, h: 2, color: 'b' }] },
  { name: 'blue', duration: 100, ops: [{ op: 'rect', w: 2, h: 2, color: 'c' }] }, { name: 'blue2', duration: 100, ops: [{ op: 'rect', w: 1, h: 2, color: 'c' }] }
], animations: { pulse: { frames: ['blue', 'blue2'] } } };
const scene = (instances, extra = {}) => ({ format: 'pixelforge-scene', version: 1, name: 'map', width: 8, height: 6, background: '#000', assets: { tiles }, instances, ...extra });
const at = (view, x, y) => [...view.data.subarray((y * view.width + x) * 4, (y * view.width + x) * 4 + 4)];

test('tilemap placements expand a character map into frames, variants and animations as one declaration', () => {
  const prepared = prepareScene(scene([{ name: 'ground', asset: 'tiles', at: [0, 0], tilemap: { rows: ['rg.p', 'vvvv'], legend: { r: 'red', g: { frame: 'green' }, p: { animation: 'pulse' }, v: { frames: ['red', 'green'] } } } }]));
  const first = renderScene(prepared, { time: 0 }), later = renderScene(prepared, { time: 150 });
  assert.deepEqual([at(first, 0, 0), at(first, 2, 0), at(first, 4, 0)], [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 0, 255]]);
  assert.deepEqual([at(first, 7, 0), at(later, 7, 0)], [[0, 0, 255, 255], [0, 0, 0, 255]]);
  const variants = new Set([0, 2, 4, 6].map(x => at(first, x, 2).join()));
  assert.equal(variants.size, 2); // Deterministic, position-based variants mix both frames.
  assert.deepEqual(renderScene(prepared, { time: 0 }).data, first.data);
  assert.deepEqual(first.placements, [{ name: 'ground', tilemap: true, x: 0, y: 0, w: 8, h: 4, tiles: 7, scale: 1 }]);
  assert.throws(() => prepareScene(scene([{ asset: 'tiles', at: [0, 0], tilemap: { rows: ['rx'], legend: { r: 'red' } } }])), /tilemap\.rows\[0\]\[1\]: character "x" is not in the legend/);
  assert.throws(() => prepareScene(scene([{ asset: 'tiles', at: [0, 0], frame: 'red', tilemap: { rows: ['r'], legend: { r: 'red' } } }])), /choose frames through their legend/);
  assert.throws(() => prepareScene(scene([{ asset: 'tiles', at: [0, 0], tilemap: { rows: ['r'], legend: { r: 'missing' } } }])), /frame "missing" does not exist/);
});

test('autotile legends pick compiled blob tiles from each cell\'s neighbours', () => {
  // A 2px template where every piece is solid, so any mask renders; the check is that names resolve per cell.
  const rows = Array.from({ length: 6 }, () => 's'.repeat(4));
  const { recipe } = compileAutotile({ format: 'pixelforge-autotile', version: 1, name: 'sand', tile: 2, palette: { s: '#ccaa66' }, template: rows, frame: 'sand-{mask}' });
  const source = { format: 'pixelforge-scene', version: 1, name: 'isle', width: 8, height: 6, assets: { sand: recipe }, instances: [{ asset: 'sand', at: [0, 0], tilemap: { rows: ['.ss.', 'ssss', '.ss.'], legend: { s: { frame: 'sand-{mask}', autotile: 'blob' } } } }] };
  const view = renderScene(prepareScene(source));
  assert.deepEqual(at(view, 2, 2), [0xcc, 0xaa, 0x66, 255]);
  assert.equal(view.placements[0].tiles, 8);
  assert.throws(() => prepareScene({ ...source, instances: [{ ...source.instances[0], tilemap: { ...source.instances[0].tilemap, legend: { s: { frame: 'sand-0', autotile: 'blob' } } } }] }), /must contain \{mask\}/);
  assert.ok(templatePiece(2, 'br', 'i').every(Number.isInteger));
});

test('lighting scope "all" darkens plain assets too, and clipping names the placements', () => {
  const lit = { ambient: 0.25, bands: 4, lights: [] };
  const plain = renderScene(prepareScene(scene([{ asset: 'tiles', at: [0, 0], frame: 'red' }], { lighting: lit })));
  const all = renderScene(prepareScene(scene([{ asset: 'tiles', at: [0, 0], frame: 'red' }], { lighting: { ...lit, scope: 'all' } })));
  // Ambient is not banded: 0.25 of full red, not the nearest of four bands.
  assert.deepEqual([at(plain, 0, 0)[0], at(all, 0, 0)[0]], [255, 64]);
  assert.throws(() => prepareScene(scene([], { lighting: { scope: 'some' } })), /passes or all/);
  const clipped = renderScene(prepareScene(scene([{ name: 'edge', asset: 'tiles', at: [7, 5], frame: 'red' }, { asset: 'tiles', at: [-1, 0], frame: 'green' }])));
  assert.deepEqual(clipped.clipped, { edge: 3, 'tiles#1': 2 });
  assert.match(clipped.warnings.at(-1), /5 drawn pixels clipped at scene bounds \(edge 3, tiles#1 2\)/);
});

test('banded lighting keeps a coloured light\'s hue: channels change band together', () => {
  // A warm light over a flat grey floor. Each ring must be one colour (ambient + band x light colour); banding each
  // channel separately used to produce more distinct colours than bands, visible as rainbow rings.
  const floor = { version: 1, name: 'floor', width: 64, height: 1, palette: { g: '#c0c0c0' }, frames: [{ name: 'f', ops: [{ op: 'rect', w: 64, h: 1, color: 'g' }] }] };
  const view = renderScene(prepareScene({ format: 'pixelforge-scene', version: 1, name: 'ring', width: 64, height: 1, assets: { floor }, instances: [{ asset: 'floor', at: [0, 0], frame: 'f' }],
    lighting: { ambient: 0.2, bands: 4, scope: 'all', lights: [{ at: [0, 0], height: 8, radius: 64, color: '#ffb060' }] } }));
  const colours = new Set(Array.from({ length: 64 }, (_, x) => at(view, x, 0).join()));
  assert.ok(colours.size <= 4, `${colours.size} colours for 4 bands`);
  for (const colour of colours) { const [r, g, b] = colour.split(',').map(Number); assert.ok(r >= g && g >= b, colour); }
});

test('null legend entries are context cells: matched by neighbours, never drawn', () => {
  const rows = Array.from({ length: 6 }, () => 's'.repeat(4));
  const { recipe } = compileAutotile({ format: 'pixelforge-autotile', version: 1, name: 'sand', tile: 2, palette: { s: '#ccaa66' }, template: rows, frame: 'sand-{mask}' });
  const source = legend => ({ format: 'pixelforge-scene', version: 1, name: 'window', width: 4, height: 2, assets: { sand: recipe }, instances: [{ asset: 'sand', at: [-2, 0], tilemap: { rows: ['Sss'], legend } }] });
  const withContext = prepareScene(source({ s: { frame: 'sand-{mask}', autotile: 'blob', match: 'sS' }, S: null }));
  assert.deepEqual(withContext.instances[0].tilemap.cells.map(cell => cell.frame), ['sand-68', 'sand-64']);
  assert.equal(renderScene(withContext).clipped, undefined); // The context cell sits off-canvas but is never drawn.
  assert.throws(() => prepareScene(source({ s: { frame: 'sand-{mask}', autotile: 'blob' } })), /character "S" is not in the legend/);
});

test('scene file and revision references must be resolved before rendering', () => {
  assert.throws(() => prepareScene(scene([], { assets: { tiles: 'tiles.json' } })), /resolved by the CLI and MCP/);
  assert.throws(() => prepareScene(scene([], { assets: { tiles: { revision: 'abc123abc123' } } })), /resolved by the CLI and MCP/);
});

test('anchor "frame" places each drawn frame by its own anchor, so animated placements follow per-frame anchors', () => {
  const hopper = { version: 1, name: 'hopper', width: 4, height: 4, palette: { a: '#f00' }, anchor: [1, 3], frames: [
    { name: 'stand', duration: 100, ops: [{ op: 'pixel', x: 1, y: 3, color: 'a' }] },
    { name: 'lean', duration: 100, anchor: [2, 3], ops: [{ op: 'pixel', x: 2, y: 3, color: 'a' }] }
  ], animations: { step: { frames: ['stand', 'lean'] } } };
  const placed = (anchor, time) => renderScene(prepareScene({ format: 'pixelforge-scene', version: 1, name: 'anchors', width: 8, height: 6, background: '#000', assets: { hopper },
    instances: [{ asset: 'hopper', at: [4, 4], animation: 'step', ...(anchor !== undefined && { anchor }) }] }), { time }).placements[0];
  // Each frame's anchor pixel lands on `at`, even though the anchor moves between frames.
  assert.deepEqual([placed('frame', 0).x, placed('frame', 150).x], [3, 2]);
  assert.deepEqual([placed([1, 3], 0).x, placed([1, 3], 150).x], [3, 3]);
  assert.deepEqual([placed(undefined, 0).x, placed(undefined, 0).y], [4, 4]);
  const plain = prepareScene(scene([{ name: 'loose', asset: 'tiles', at: [2, 2], frame: 'red', anchor: 'frame' }]));
  assert.match(plain.warnings.join(), /declares no anchors/);
  assert.throws(() => prepareScene(scene([{ asset: 'tiles', at: [0, 0], anchor: 'frame', tilemap: { rows: ['r'], legend: { r: 'red' } } }])), /tilemap is placed by one \[x, y\] anchor/);
});
