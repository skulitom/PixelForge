import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderProject, analyzeProject, PixelError } from '../src/core.js';
import { compileFluid, FLUID_FIELDS } from '../src/fluid.js';
import { startMCP } from '../src/mcp.js';
import { packageFiles } from '../scripts/build-studio.mjs';
import { FLUID_SHOWCASE, buildFluidGIFs } from '../showcase/fluid/build.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = async file => JSON.parse(await readFile(path.join(root, file), 'utf8'));
// The same source must give the same recipe on every machine and engine: these hashes are checked on every CI system.
const GOLDEN = {
  campfire: '1a789c44e352be9623801b345b444127ef948fccdefd8dd480aea752ff64d4c4',
  explosion: 'cc5409a9598f810114ba3f51618802e08c280e46f9a0dd0758e331e74c7b941f',
  'smoke-puff': 'ff84249a92a18f11a778c4bc391d3c2adaac7d9e2d2389de8f9e5400a7218f65',
  'steam-vent': '00ff7b5fc9cb9a5afa1ec354d4da1d6995d57ca4bdf262503f397a0ade9c3757',
  'magic-swirl': '2be991d3b94b474346ba7101d2283bdc2659394a65cb3e44dee0c9ca61766221',
  torch: '1653a23c933b250d5cc6aa8c0a5e1878e7438b11169ef85c52d733e019263828',
  splash: 'd3dd9b5c803e03aab0a23a5a0b69fa28782f873f97f4dd1356bb3d8732e2b730',
  waterfall: '26622a804b4a189e17dce2334e518af94e954f6c3e4d30b955badb3a104036c3',
  drip: '1147551d26b4945e65773fe243ebf0858779c20acf8200068866f247d63e5480',
  potion: '11636b6972e45c5c7e65fb9b473cc20981133ed724650b17c491efac78d92d74'
};
const examples = new Map();
const example = async name => {
  if (!examples.has(name)) {
    const source = await read(`examples/${name}.fluid.json`), started = performance.now(), compiled = compileFluid(source);
    examples.set(name, { source, ...compiled, ms: performance.now() - started, project: renderProject(compiled.recipe) });
  }
  return examples.get(name);
};
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const gas = (effect, extra = {}) => ({ format: 'pixelforge-fluid', version: 1, name: 'fluid', width: 16, height: 16, palette: { s: '#888', w: '#fff', r: '#c33', y: '#fd6', k: '#000' }, effects: { plume: effect }, ...extra });
const smoke = [{ field: 'density', colors: ['s', 'w'], thresholds: [0.2, 0.6] }];
const pixelsOf = frame => { let n = 0; for (let i = 3; i < frame.data.length; i += 4) if (frame.data[i]) n++; return n; };
const changed = (a, b) => { let n = 0; for (let i = 0; i < a.data.length; i += 4) if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2] || a.data[i + 3] !== b.data[i + 3]) n++; return n; };

test('every fluid example compiles to its golden recipe, using only its palette and grid operations', async () => {
  const sources = (await readFile(path.join(root, 'scripts/generate-examples.js'), 'utf8')).match(/\.fluid\b/g);
  assert.ok(sources.length >= 1);
  for (const name of FLUID_SHOWCASE) {
    const { source, recipe, project } = await example(name);
    assert.equal(sha(recipe), GOLDEN[name], `${name} compiled differently; if the change is intended, update GOLDEN and rebuild the GIFs`);
    const keys = new Set(Object.keys(source.palette)), colours = new Set(Object.values(source.palette).map(hex => hex.toLowerCase()));
    for (const frame of recipe.frames) for (const op of frame.ops ?? []) {
      assert.ok(['grid', 'stamp'].includes(op.op), `${name} ${frame.name}: ${op.op}`);
      if (op.op === 'grid') for (const row of op.rows) for (const char of row) assert.ok(char === '.' || keys.has(char), `${name} ${frame.name} draws ${char}`);
    }
    // No colour outside the palette, by construction: every opaque pixel is a palette colour.
    const hex = (data, at) => `#${[data[at], data[at + 1], data[at + 2]].map(v => v.toString(16).padStart(2, '0')).join('')}`;
    for (const frame of project.frames) for (let at = 0; at < frame.data.length; at += 4) if (frame.data[at + 3]) assert.ok(colours.has(hex(frame.data, at)), `${name} ${frame.name} has ${hex(frame.data, at)}`);
    assert.deepEqual(project.warnings, [], name);
  }
  // Compiling again gives the same recipe.
  assert.deepEqual(compileFluid(structuredClone((await example('campfire')).source)), { recipe: (await example('campfire')).recipe, metadata: (await example('campfire')).metadata });
});

test('looping examples close their loop and one-shot examples end empty or at rest', async () => {
  for (const name of FLUID_SHOWCASE) {
    const { project, metadata } = await example(name), [effect] = Object.values(metadata.effects), [animation] = Object.values(project.animations);
    if (effect.loop) {
      assert.deepEqual(analyzeProject(project).findings.filter(finding => finding.code === 'loop-jump'), [], `${name}: the inspector's loop-boundary check`);
      assert.equal(animation.loop, true);
    } else if (effect.kind === 'gas') {
      assert.equal(effect.residue, 0, `${name} should end fully dissipated`);
      assert.equal(pixelsOf(project.frames[animation.frames.at(-1)]), 0);
    } else {
      // A liquid one-shot settles: its last frames barely change.
      const [a, b] = animation.frames.slice(-2).map(index => project.frames[index]);
      assert.ok(changed(a, b) <= 12, `${name} still moves ${changed(a, b)} pixels a frame at the end`);
    }
  }
});

test('the committed fluid GIFs match the examples', async () => {
  const recipes = {};
  for (const name of FLUID_SHOWCASE) recipes[name] = (await example(name)).recipe;
  const { files } = await buildFluidGIFs(recipes);
  for (const [file, bytes] of files) assert.ok(bytes.equals(await readFile(path.join(root, file))), `${file} is stale; run node showcase/fluid/build.mjs --force`);
});

test('heat rises and curls, smoke thins, obstacles stay clear and a still pool stays still', () => {
  // A hot puff near the bottom rises: its centre of mass moves up frame by frame.
  const { recipe, metadata } = compileFluid(gas({ frames: 10, emitters: [{ at: [8, 12], radius: 2, burst: 1, density: 2, temperature: 2 }], buoyancy: 0.3, look: smoke }));
  const project = renderProject(recipe), height = frame => { let sum = 0, n = 0; for (let i = 3; i < frame.data.length; i += 4) if (frame.data[i]) { sum += Math.floor((i - 3) / 4 / 16); n++; } return n ? sum / n : NaN; };
  const heights = project.frames.map(height);
  assert.ok(heights[6] < heights[0] - 2, `rose from ${heights[0]} to ${heights[6]}`);
  assert.deepEqual(Object.keys(metadata.effects.plume), ['kind', 'frames', 'loop', 'seed', 'steps', 'peak', 'sparks', 'pixels', 'residue']);
  // Without buoyancy and with dissipation the smoke thins until nothing is drawn.
  const fading = compileFluid(gas({ frames: 30, emitters: [{ at: [8, 8], radius: 2, burst: 1, density: 1 }], buoyancy: 0, dissipation: 0.3, look: smoke }));
  assert.equal(fading.metadata.effects.plume.residue, 0);
  assert.ok(fading.metadata.effects.plume.pixels[0] > 0);
  // Obstacle cells never hold fluid; the obstacle is stamped over the fluid by default.
  const wall = compileFluid(gas({ frames: 6, emitters: [{ at: [8, 12], radius: 2, rate: 1, density: 1, temperature: 1 }], obstacles: [{ symbol: 'lid', x: 4, y: 4 }], look: smoke }, { symbols: { lid: ['kkkkkkkk'] } }));
  for (const frame of wall.recipe.frames) {
    const grid = frame.ops.find(op => op.op === 'grid');
    if (grid) grid.rows.forEach((row, j) => [...row].forEach((char, i) => { if (grid.y + j === 4 && grid.x + i >= 4 && grid.x + i < 12) assert.equal(char, '.'); }));
    assert.deepEqual(frame.ops.at(-1), { op: 'stamp', symbol: 'lid', x: 4, y: 4 });
  }
  // A pool at rest in a closed box keeps every pixel, frame after frame.
  const pool = compileFluid({ ...gas(null), effects: { pool: { kind: 'liquid', frames: 12, walls: ['left', 'right', 'bottom'], fill: [{ x: 0, y: 10, w: 16, h: 6 }], emitters: [], look: [{ field: 'density', colors: ['s'], thresholds: [0.5] }, { field: 'depth', colors: ['w', 's'], thresholds: [1, 2], dither: 0 }] } } });
  assert.deepEqual(new Set(pool.metadata.effects.pool.pixels), new Set([96]));
  assert.deepEqual(pool.recipe.frames[11].ops, pool.recipe.frames[0].ops);
  assert.deepEqual(pool.recipe.frames[0].ops[0].rows.slice(0, 2), ['w'.repeat(16), 's'.repeat(16)]);
  // Cohesion keeps the surface particles trembling a little, never enough to move a pixel.
  assert.ok(pool.metadata.effects.pool.peak.speed < 0.25);
});

test('sparks draw as blocks of their size, with a streak back along their path', () => {
  const thrown = extra => compileFluid(gas({ frames: 4, buoyancy: 0, emitters: [{ at: [8, 8], radius: 0.5, burst: 1, sparks: { count: 1, life: 8, colors: ['w', 'y'], angle: 0, speed: 3, drag: 0, follow: 0, ...extra } }], look: smoke }));
  const pixels = recipe => recipe.frames.map(frame => { const grid = frame.ops?.find(op => op.op === 'grid'); return grid ? grid.rows.flatMap((row, j) => [...row].flatMap((char, i) => (char === '.' ? [] : [[grid.x + i, grid.y + j, char]]))) : []; });
  // One spark thrown right at 3 pixels a frame: a single pixel, a 2 × 2 block, or a pixel with a streak behind it.
  assert.deepEqual(pixels(thrown({}).recipe)[1], [[11, 8, 'w']]);
  assert.equal(pixels(thrown({ size: 2 }).recipe)[1].length, 4);
  assert.deepEqual(pixels(thrown({ trail: true }).recipe)[1], [[8, 8, 'y'], [9, 8, 'y'], [10, 8, 'y'], [11, 8, 'w']]);
});

test('in a liquid, spray ends where it falls back into the water and a bubble bursts in a ring, then two droplets', () => {
  // A still pool fills rows 10–15. One spark is thrown up from just above the surface; one bubble rises from inside it.
  const pool = sparks => compileFluid({ ...gas(null), effects: { pool: { kind: 'liquid', frames: 16, walls: ['left', 'right', 'bottom'], fill: [{ x: 0, y: 10, w: 16, h: 6 }],
    emitters: [{ at: sparks.at, radius: 0.5, burst: 1, density: 0, sparks: { count: 1, life: 40, colors: ['w'], drag: 0, follow: 0, angle: 270, ...sparks.extra } }], look: [{ field: 'density', colors: ['s'], thresholds: [0.5], dither: 0 }] } } });
  const whites = recipe => recipe.frames.map(frame => frame.ops[0].rows.flatMap((row, j) => [...row].flatMap((char, i) => (char === 'w' ? [[frame.ops[0].x + i, frame.ops[0].y + j]] : []))));
  // Spray rises, falls back and ends at the surface instead of being drawn on inside the water for the rest of its life.
  const spray = whites(pool({ at: [8, 9.5], extra: { speed: 1.5, gravity: [0, 0.3] } }).recipe);
  assert.ok(spray.slice(0, 4).every(list => list.length === 1 && list[0][1] < 10));
  assert.ok(spray.every(list => list.every(([, y]) => y < 10)), JSON.stringify(spray));
  assert.deepEqual(spray.slice(-4), [[], [], [], []]);
  // The bubble is drawn while it rises; where it leaves the water it is a ring for one frame, then two droplets, then gone.
  const bubble = whites(pool({ at: [8, 13], extra: { speed: 0.6, gravity: [0, -0.05], pop: true } }).recipe), burst = bubble.findIndex(list => list.length === 4);
  assert.ok(burst > 0 && bubble.slice(0, burst).every(list => list.length === 1), JSON.stringify(bubble));
  const [x, y] = bubble[burst].reduce(([a, b], [i, j]) => [a + i / 4, b + j / 4], [0, 0]);
  assert.deepEqual(bubble[burst].map(([i, j]) => [i - x, j - y]).sort(), [[-1, 0], [0, -1], [0, 1], [1, 0]]);
  assert.deepEqual(bubble[burst + 1].map(([i, j]) => [i - x, j - y]).sort(), [[-1, -1], [1, -1]]);
  assert.ok(bubble.slice(burst + 2).every(list => !list.length));
});

test('depth bands stay level under water standing on the surface', () => {
  // A pool fills rows 10–15 and a 3 × 4 block of water stands on it, a mound by the first frame. Under the mound the
  // bands below the highlight keep the pool's rows instead of starting again from the mound's top.
  const { recipe } = compileFluid({ ...gas(null), effects: { pool: { kind: 'liquid', frames: 1, walls: ['left', 'right', 'bottom'], fill: [{ x: 0, y: 10, w: 16, h: 6 }, { x: 6, y: 6, w: 3, h: 4 }],
    emitters: [], look: [{ field: 'density', colors: ['s'], thresholds: [0.5], dither: 0 }, { field: 'depth', colors: ['w', 's', 'r'], thresholds: [1, 2, 4], dither: 0 }] } } });
  const grid = recipe.frames[0].ops[0], row = y => grid.rows[y - grid.y];
  assert.equal(row(8).slice(6 - grid.x, 9 - grid.x), 'sss');
  assert.deepEqual([row(11), row(12), row(13), row(15)], ['s'.repeat(16), 's'.repeat(16), 'r'.repeat(16), 'r'.repeat(16)]);
});

test('loops repeat their forcing, blend their seam and wrap sparks round', () => {
  const effect = { frames: 12, loop: true, seed: 4, emitters: [{ at: [8, 13], area: [6, 2], rate: 1, density: 0.6, temperature: 1, velocity: [0, -1], noise: 0.5, flicker: 0.4, pulse: { amplitude: 0.5, period: 6 },
    sparks: { count: 0.5, life: [6, 10], colors: ['y', 'r'], angle: [260, 280], speed: 0.3 } }], look: [...smoke, { field: 'temperature', colors: ['r', 'y'], thresholds: [0.3, 0.7] }] };
  const { recipe, metadata } = compileFluid(gas(effect)), project = renderProject(recipe);
  assert.equal(recipe.animations.plume.loop, undefined);
  assert.deepEqual([metadata.effects.plume.warmup, metadata.effects.plume.blend, metadata.effects.plume.steps], [2, 4, 2 * (36 + 10)]);
  assert.ok(metadata.effects.plume.sparks.spawned > 0);
  assert.deepEqual(analyzeProject(project).findings.filter(finding => finding.code === 'loop-jump'), []);
  // The seam is no larger a step than an ordinary one.
  const steps = project.frames.map((frame, i) => changed(project.frames[(i + project.frames.length - 1) % project.frames.length], frame));
  assert.ok(steps[0] <= Math.max(...steps.slice(1)), `seam ${steps[0]}, steps ${steps.slice(1)}`);
  // Another seed changes the noise, flicker and sparks; the same seed is the same recipe.
  assert.notDeepEqual(compileFluid(gas({ ...effect, seed: 5 })).recipe, recipe);
  assert.deepEqual(compileFluid(gas(effect)).recipe, recipe);
});

test('fluid sources fail early with paths an agent can act on', async () => {
  const emitter = { at: [8, 8], rate: 1, density: 1 }, ok = { frames: 6, emitters: [emitter], look: smoke };
  const bad = (change, where, message) => {
    const source = gas({ ...ok }), effect = source.effects.plume;
    change(effect, source);
    assert.throws(() => compileFluid(source), error => error instanceof PixelError && error.path === where && (!message || message.test(error.message)), `${where}`);
  };
  bad(e => { e.emitters = [{ ...emitter, rate: 0 }]; }, 'fluid.effects.plume.emitters[0].rate', /0\.01 to 64/);
  bad(e => { e.emitters = [{ ...emitter, burst: 1 }]; }, 'fluid.effects.plume.emitters[0]', /exactly one of burst/);
  bad(e => { e.emitters = [{ ...emitter, radius: 2, area: [2, 2] }]; }, 'fluid.effects.plume.emitters[0]', /radius .* or area/);
  bad(e => { e.emitters = [{ ...emitter, wobble: 1 }]; }, 'fluid.effects.plume.emitters[0].wobble', /unknown/);
  bad(e => { e.look = [{ field: 'density', colors: ['sw'], thresholds: [0.2] }]; }, 'fluid.effects.plume.look[0].colors[0]', /one-character palette key/);
  bad(e => { e.look = [{ field: 'density', colors: ['q'], thresholds: [0.2] }]; }, 'fluid.effects.plume.look[0].colors[0]', /palette key/);
  bad(e => { e.look = [{ field: 'density', colors: ['s', 'w'], thresholds: [0.5, 0.2] }]; }, 'fluid.effects.plume.look[0].thresholds[1]', /rise/);
  bad(e => { e.look = [{ field: 'smoke', colors: ['s'], thresholds: [0.5] }]; }, 'fluid.effects.plume.look[0].field', /density, temperature, speed, depth, light, shadow/);
  bad(e => { e.look = []; }, 'fluid.effects.plume.look', /1–8 layers/);
  bad(e => { e.gravity = [0, 1]; }, 'fluid.effects.plume.gravity', /applies to liquids/);
  bad(e => { e.kind = 'liquid'; e.buoyancy = 1; }, 'fluid.effects.plume.buoyancy', /applies to gases/);
  bad(e => { e.kind = 'liquid'; e.emitters = [{ ...emitter, temperature: 1 }]; }, 'fluid.effects.plume.emitters[0].temperature', /gases/);
  bad(e => { e.kind = 'liquid'; e.look = [{ field: 'temperature', colors: ['s'], thresholds: [1] }]; }, 'fluid.effects.plume.look[0].field', /no temperature/);
  bad(e => { e.loop = true; e.emitters = [{ ...emitter, pulse: { period: 4 } }]; }, 'fluid.effects.plume.emitters[0].pulse.period', /must divide 6/);
  bad(e => { e.emitters = [{ ...emitter, orbit: { radius: 2, period: 0 } }]; }, 'fluid.effects.plume.emitters[0].orbit.period', /anticlockwise/);
  bad(e => { e.blend = 2; }, 'fluid.effects.plume.blend', /loop: true/);
  bad(e => { e.emitters = [{ ...emitter, sparks: { count: 1, colors: ['s'], pop: true } }]; }, 'fluid.effects.plume.emitters[0].sparks.pop', /liquids/);
  bad(e => { e.walls = ['top', 'top']; }, 'fluid.effects.plume.walls', /once/);
  bad(e => { e.walls = ['up']; }, 'fluid.effects.plume.walls[0]', /left, right, top, bottom/);
  bad(e => { e.obstacles = [{ symbol: 'nope' }]; }, 'fluid.effects.plume.obstacles[0].symbol', /unknown symbol/);
  bad((e, s) => { s.symbols = { slab: ['kkkk'] }; e.obstacles = [{ symbol: 'slab', x: 14 }]; }, 'fluid.effects.plume.obstacles[0]', /must fit inside the 16 × 16 canvas/);
  bad(e => { e.light = [0, 0]; }, 'fluid.effects.plume.light', /toward the light/);
  bad(e => { e.outline = 'z'; }, 'fluid.effects.plume.outline', /palette key/);
  bad(e => { e.kind = 'liquid'; e.emitters = []; e.fill = [{ x: 0, y: 0 }]; }, 'fluid.effects.plume.fill[0].w', /integer from 1 to 16/);
  bad(e => { e.emitters = []; }, 'fluid.effects.plume.emitters', /1–16 emitters/);
  bad((e, s) => { s.width = 129; }, 'fluid.width', /4 to 128/);
  bad((e, s) => { s.effects.Plume = e; }, 'fluid.effects.Plume', /ignoring case/);
  bad((e, s) => { s.effects = { a: { ...ok, frames: 200 }, b: { ...ok, frames: 100 } }; }, 'fluid.effects', /at most 256/);
  assert.throws(() => compileFluid({ ...gas(ok), format: 'pixelforge-fx' }), error => error.path === 'fluid');
  // The same paths on a real preset: the agent can patch exactly the field that is wrong.
  const campfire = await read('examples/campfire.fluid.json');
  campfire.effects.campfire.emitters[0].rate = 99;
  assert.throws(() => compileFluid(campfire), error => error.path === 'fluid.effects.campfire.emitters[0].rate' && /0\.01 to 64/.test(error.message));
  // A liquid that grows without bound is stopped with the effect's path.
  assert.throws(() => compileFluid({ ...gas(null), width: 128, height: 128, effects: { flood: { kind: 'liquid', frames: 60, substeps: 1, iterations: 1, fill: [{ x: 0, y: 0, w: 128, h: 64 }], emitters: [{ at: [64, 96], area: [128, 64], rate: 1 }], look: smoke } } }), error => error.path === 'fluid.effects.flood' && /32768 liquid particles/.test(error.message));
});

test('limits are reported with the effect path, extreme settings stay finite, and any palette key draws its own colour', () => {
  const liquidBox = (emitters, fill) => ({ ...gas(null), width: 128, height: 128, effects: { flood: { kind: 'liquid', frames: 2, substeps: 1, iterations: 1, walls: ['left', 'right', 'bottom'], fill, emitters, look: smoke } } });
  // A drain in the same frame must not hide water the particle limit refused.
  assert.throws(() => compileFluid(liquidBox([{ at: [64, 64], area: [128, 128], rate: 1, density: -0.5 }], [{ x: 0, y: 0, w: 128, h: 128 }])), error => error.path === 'fluid.effects.flood' && /32768 liquid particles/.test(error.message));
  const sparks = gas({ frames: 40, emitters: [{ at: [8, 8], rate: 1, sparks: { count: 16, life: 256, colors: ['w'] } }, { at: [8, 8], rate: 1, sparks: { count: 16, life: 256, colors: ['w'] } }], look: smoke });
  assert.throws(() => compileFluid({ ...sparks, effects: { plume: { ...sparks.effects.plume, frames: 200 } } }), error => error.path === 'fluid.effects.plume' && /4096 sparks/.test(error.message));
  // The work budget refuses the most expensive source the schema allows before simulating anything.
  const started = performance.now();
  assert.throws(() => compileFluid({ ...gas({ frames: 256, loop: true, warmup: 8, substeps: 4, iterations: 200, emitters: [{ at: [8, 8], rate: 1, density: 1 }], look: smoke }), width: 128, height: 128 }), error => error.path === 'fluid.effects.plume' && /million cell updates/.test(error.message));
  assert.ok(performance.now() - started < 1000);
  // The strongest in-range forcing stays finite: flows are capped at 32 pixels per frame.
  const wild = compileFluid({ ...gas({ frames: 48, walls: ['left', 'right', 'top', 'bottom'], substeps: 1, vorticity: 2, buoyancy: 2, dissipation: 0, cooling: 0, drag: 0,
    emitters: [{ at: [8, 8], radius: 6, rate: 64, density: 16, temperature: 16, vortex: 16, noise: 8, flicker: 1, sparks: { count: 4, life: 20, colors: ['w'], trail: true } }], look: smoke }), width: 32, height: 32 });
  assert.ok(Number.isFinite(wild.metadata.effects.plume.peak.speed) && wild.metadata.effects.plume.peak.speed <= 46);
  // Palette keys beyond Latin-1 keep their own colour in the grid rows.
  const accented = compileFluid({ ...gas({ frames: 2, emitters: [{ at: [8, 8], radius: 3, burst: 1, density: 2 }], look: [{ field: 'density', colors: ['ŧ'], thresholds: [0.5] }] }), palette: { 'ŧ': '#f00', g: '#0f0' } });
  assert.ok(accented.recipe.frames[0].ops[0].rows.join('').includes('ŧ'));
  assert.ok(renderProject(accented.recipe).frames[0].data.some((value, i) => i % 4 === 0 && value === 255));
  // An outline may cover an obstacle drawn under the fluid but never one drawn over it.
  const outlined = draw => { const source = gas({ frames: 3, outline: 'o', emitters: [{ at: [8, 11], radius: 2.5, burst: 1, density: 3 }], obstacles: [{ symbol: 'lid', x: 4, y: 8, draw }], look: smoke }, { symbols: { lid: ['kkkkkkkk'] }, palette: { s: '#888', w: '#fff', r: '#c33', y: '#fd6', k: '#000', o: '#00f' } }); return compileFluid(source).recipe.frames[0].ops.find(op => op.op === 'grid'); };
  const rowAt = (grid, y) => (grid.y <= y && y < grid.y + grid.rows.length ? grid.rows[y - grid.y] : '');
  assert.match(rowAt(outlined('under'), 8), /o/);
  assert.doesNotMatch(rowAt(outlined('over'), 8), /o/);
});

test('the fluid schema lists exactly the fields the compiler reads', async () => {
  const schema = await read('fluid.schema.json'), effect = schema.properties.effects.additionalProperties, emitter = effect.properties.emitters.items;
  const unknown = (source, where) => { try { compileFluid(source); return false; } catch (error) { assert.ok(error instanceof PixelError, String(error)); return error.path === where && /unknown or null field/.test(error.message); } };
  const base = () => gas({ frames: 4, emitters: [{ at: [8, 8], rate: 1, density: 1 }], look: smoke }, { symbols: { lid: ['k'] } });
  const levels = [
    [schema.properties, (s, key) => { s[key] = s[key] ?? 0; }, 'fluid'],
    [effect.properties, (s, key) => { s.effects.plume[key] = 0; }, 'fluid.effects.plume'],
    [emitter.properties, (s, key) => { s.effects.plume.emitters[0][key] = 0; }, 'fluid.effects.plume.emitters[0]'],
    [emitter.properties.sparks.properties, (s, key) => { s.effects.plume.emitters[0].sparks = { count: 1, colors: ['s'], [key]: 0 }; }, 'fluid.effects.plume.emitters[0].sparks'],
    [emitter.properties.pulse.properties, (s, key) => { s.effects.plume.emitters[0].pulse = { [key]: 0 }; }, 'fluid.effects.plume.emitters[0].pulse'],
    [emitter.properties.orbit.properties, (s, key) => { s.effects.plume.emitters[0].orbit = { radius: 1, [key]: 0 }; }, 'fluid.effects.plume.emitters[0].orbit'],
    [effect.properties.look.items.properties, (s, key) => { s.effects.plume.look = [{ field: 'density', colors: ['s'], thresholds: [0.5], [key]: 0 }]; }, 'fluid.effects.plume.look[0]'],
    [effect.properties.fill.items.properties, (s, key) => { Object.assign(s.effects.plume, { kind: 'liquid', fill: [{ x: 0, y: 0, w: 2, h: 2, [key]: 0 }] }); }, 'fluid.effects.plume.fill[0]'],
    [effect.properties.obstacles.items.properties, (s, key) => { s.effects.plume.obstacles = [{ symbol: 'lid', [key]: 0 }]; }, 'fluid.effects.plume.obstacles[0]'],
    [effect.properties.cleanup.properties, (s, key) => { s.effects.plume.cleanup = { [key]: 0 }; }, 'fluid.effects.plume.cleanup']
  ];
  for (const [properties, put, where] of levels) {
    for (const key of Object.keys(properties)) { const source = base(); put(source, key); assert.equal(unknown(source, `${where}.${key}`), false, `${where}.${key} is in the schema but the compiler rejects it`); }
    const source = base(); put(source, 'notAField');
    assert.equal(unknown(source, `${where}.notAField`), true, `${where} accepts a field the schema does not list`);
  }
  assert.deepEqual(effect.properties.look.items.properties.field.enum, FLUID_FIELDS);
});

test('fluid sources compile from the CLI with a shared palette, and preview and sequence accept them', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pixelbolt-fluid-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, 'palette.json'), JSON.stringify({ s: '#888', w: '#fff', r: '#c33', y: '#fd6', k: '#000' }));
  const source = { ...gas({ frames: 4, emitters: [{ at: [8, 12], radius: 2, rate: 1, density: 1, temperature: 1 }], look: smoke }), palette: { $ref: 'palette.json' } };
  await writeFile(path.join(dir, 'puff.fluid.json'), JSON.stringify(source));
  const cli = (...args) => spawnSync(process.execPath, [path.join(root, 'bin/pixelbolt.js'), ...args], { encoding: 'utf8' });
  const run = cli('compile', path.join(dir, 'puff.fluid.json'), '--out', path.join(dir, 'out/puff.json'), '--metadata', path.join(dir, 'out/puff.meta.json'));
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'out/puff.json'), 'utf8')).palette, { $ref: '../palette.json' });
  assert.equal(JSON.parse(await readFile(path.join(dir, 'out/puff.meta.json'), 'utf8')).format, 'pixelforge-fluid-metadata');
  assert.equal(JSON.parse(cli('validate', path.join(dir, 'out/puff.json')).stdout).frames, 4);
  // Refuses to overwrite, and reports the source error path.
  assert.match(cli('compile', path.join(dir, 'puff.fluid.json'), '--out', path.join(dir, 'out/puff.json')).stderr, /already exists/);
  await writeFile(path.join(dir, 'bad.fluid.json'), JSON.stringify({ ...source, effects: { plume: { ...source.effects.plume, emitters: [{ at: [8, 8], rate: 99 }] } } }));
  assert.match(cli('compile', path.join(dir, 'bad.fluid.json'), '--out', path.join(dir, 'bad.json')).stderr, /fluid\.effects\.plume\.emitters\[0\]\.rate/);
  const frames = cli('sequence', path.join(dir, 'puff.fluid.json'), '--out', path.join(dir, 'frames'), '--fps', '25');
  assert.equal(frames.status, 0, frames.stderr);
  assert.equal(JSON.parse(frames.stdout).frames, 8);
  assert.match(cli('help').stdout, /fluid source/);
});

test('MCP pixel_compile builds fluid sources and pixel_help serves their schema', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pixelbolt-fluid-mcp-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const input = new PassThrough(), output = new PassThrough(), waiting = new Map(); let buffer = '', next = 0;
  output.on('data', chunk => { buffer += chunk; for (let end; (end = buffer.indexOf('\n')) !== -1; buffer = buffer.slice(end + 1)) { const message = JSON.parse(buffer.slice(0, end)); waiting.get(message.id)?.(message); } });
  startMCP({ input, output, directory: dir, root: dir });
  const request = (method, params) => new Promise(resolve => { waiting.set(++next, resolve); input.write(JSON.stringify({ jsonrpc: '2.0', id: next, method, params }) + '\n'); });
  await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  const tools = (await request('tools/list')).result.tools, compile = tools.find(tool => tool.name === 'pixel_compile');
  assert.match(compile.description, /smoke, fire, explosions/);
  assert.ok(tools.find(tool => tool.name === 'pixel_help').inputSchema.properties.topic.enum.includes('fluid'));
  const help = await request('tools/call', { name: 'pixel_help', arguments: { topic: 'fluid' } });
  assert.equal(JSON.parse(help.result.content[0].text).title, 'Pixelbolt fluid effects');
  const source = (await example('torch')).source, compiled = await request('tools/call', { name: 'pixel_compile', arguments: { source, metadata: true } });
  const info = JSON.parse(compiled.result.content[0].text);
  assert.deepEqual([info.ok, info.frames, info.animations, info.metadata.format], [true, 16, ['torch'], 'pixelforge-fluid-metadata']);
  assert.match(info.revision, /^[a-f0-9]{12}$/);
  assert.equal(compiled.result.content[1].type, 'image');
  const broken = await request('tools/call', { name: 'pixel_compile', arguments: { source: { ...source, effects: { torch: { ...source.effects.torch, emitters: [{ ...source.effects.torch.emitters[0], rate: 0 }] } } } } });
  assert.equal(broken.result.isError, true);
  assert.equal(JSON.parse(broken.result.content[0].text).path, 'fluid.effects.torch.emitters[0].rate');
  input.end();
});

test('the documented fluid example compiles as written', async () => {
  const guide = await readFile(path.join(root, 'docs/art-workflow.md'), 'utf8'), block = guide.split('## Fluid effects')[1].split('```json')[1].split('```')[0];
  const { recipe, metadata } = compileFluid(JSON.parse(block));
  assert.deepEqual([recipe.frames.length, metadata.effects.torch.loop, renderProject(recipe).warnings], [16, true, []]);
  assert.ok(metadata.effects.torch.pixels.every(count => count > 20));
});

test('the package ships the fluid schema and example sources', async () => {
  const files = await packageFiles();
  assert.ok(files.includes('fluid.schema.json'));
  assert.ok(files.includes('src/fluid.js'));
  for (const name of FLUID_SHOWCASE) assert.ok(files.includes(`examples/${name}.fluid.json`), name);
  assert.ok(!files.some(file => file.startsWith('showcase/')));
});
