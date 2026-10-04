import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderProject, buildAtlas } from '../src/core.js';
import { compilePoses } from '../src/authoring.js';
import { compileEffects } from '../src/fx.js';
import { prepareScene, renderScene } from '../src/scene.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const effects = (effect, extra = {}) => ({ format: 'pixelforge-fx', version: 1, name: 'fx', width: 24, height: 24, palette: { w: '#fff', y: '#fd6', o: '#e83', g: '#6b4', l: '#9d6' },
  symbols: { dot: ['w'], warm: ['y'], cool: ['o'], chip: ['yy', 'yo'], leafA: ['gl'], leafB: ['lg'] }, effects: { burst: effect }, ...extra });
const opsOf = recipe => recipe.frames.map(frame => frame.ops ?? []);

test('effects compile deterministically into ordinary frames, one animation per effect', () => {
  const source = effects({ frames: 6, duration: [40, 50, 60, 60, 70, 80], seed: 7, emitters: [{ at: [12, 12], burst: 6, angle: [0, 360], speed: [1, 2], life: [4, 6], shapes: ['dot', 'warm', 'cool'] }] });
  const first = compileEffects(source), second = compileEffects(structuredClone(source));
  assert.deepEqual(first, second);
  const project = renderProject(first.recipe);
  assert.deepEqual(project.frames.map(f => [f.name, f.duration]), [['burst-0', 40], ['burst-1', 50], ['burst-2', 60], ['burst-3', 60], ['burst-4', 70], ['burst-5', 80]]);
  assert.deepEqual(first.recipe.animations, { burst: { frames: ['burst-0', 'burst-1', 'burst-2', 'burst-3', 'burst-4', 'burst-5'], loop: false } });
  assert.deepEqual(project.warnings, []);
  // All six particles start on the emitter; symbols step through the life (dot → warm → cool).
  assert.deepEqual(opsOf(first.recipe)[0], Array(6).fill({ op: 'stamp', symbol: 'dot', x: 12, y: 12 }));
  assert.ok(opsOf(first.recipe)[3].every(op => op.symbol !== 'dot'));
  assert.equal(first.metadata.effects.burst.emitters[0].spawned, 6);
  // A different seed moves particles; the same seed with a different life keeps the launch directions.
  const reseeded = compileEffects({ ...source, effects: { burst: { ...source.effects.burst, seed: 8 } } });
  assert.notDeepEqual(opsOf(reseeded.recipe)[1], opsOf(first.recipe)[1]);
  const longer = compileEffects({ ...source, effects: { burst: { ...source.effects.burst, emitters: [{ ...source.effects.burst.emitters[0], life: [5, 6] }] } } });
  assert.deepEqual(opsOf(longer.recipe)[1].map(op => [op.x, op.y]), opsOf(first.recipe)[1].map(op => [op.x, op.y]));
});

test('gravity, floors, trails, variants, remaps and dissolve bake into stamps, grids, lines and pixels', () => {
  const fall = compileEffects(effects({ frames: 8, emitters: [{ at: [12, 4], burst: 1, gravity: [0, 1], floor: 18, shapes: ['dot'], trail: { color: 'o', length: 1 } }] }));
  const heights = opsOf(fall.recipe).map(ops => ops.find(op => op.op === 'stamp').y);
  assert.deepEqual(heights, [4, 5, 7, 10, 14, 18, 18, 18]);
  assert.deepEqual(opsOf(fall.recipe)[2][0], { op: 'line', x: 12, y: 5, x2: 12, y2: 7, color: 'o' });
  // Particles partly off the canvas are cropped into grids and trails keep only on-canvas pixels: no clipping.
  const edge = compileEffects(effects({ frames: 4, emitters: [{ at: [22, 12], burst: 1, angle: 0, speed: 1.5, shapes: ['chip'], trail: { color: 'o', length: 2 } }] }));
  assert.deepEqual(renderProject(edge.recipe).warnings, []);
  assert.ok(opsOf(edge.recipe).flat().some(op => op.op === 'grid'));
  assert.ok(opsOf(edge.recipe).flat().some(op => op.op === 'pixel'));
  const leaves = compileEffects(effects({ frames: 6, seed: 3, emitters: [{ at: [12, 12], burst: 8, speed: 1, life: 6, shapes: [['leafA', 'leafB'], ['leafB', 'leafA']], play: 'loop', remaps: [{}, { g: 'o' }], dissolve: 0.5 }] }));
  const all = opsOf(leaves.recipe).flat();
  assert.ok(all.some(op => op.remap?.g === 'o') && all.some(op => op.op === 'stamp' && !op.remap));
  // The last half of each life dissolves through an ordered pattern: those frames draw grids with fewer pixels.
  const drawn = ops => ops.reduce((sum, op) => sum + (op.op === 'stamp' ? 2 : op.rows.join('').replace(/\./g, '').length), 0);
  assert.ok(opsOf(leaves.recipe)[5].every(op => op.op === 'grid'));
  assert.ok(drawn(opsOf(leaves.recipe)[5]) < drawn(opsOf(leaves.recipe)[0]));
  assert.deepEqual(leaves.metadata.effects.burst.emitters, [{ spawned: 8, maxAlive: 8 }]);
});

test('looping effects warm up so the first frame continues the last', () => {
  const source = effects({ frames: 8, loop: true, seed: 2, emitters: [{ name: 'rise', at: [12, 20], area: [8, 1], rate: 1, angle: 270, speed: 1, life: 6, shapes: ['dot'] }] });
  const { recipe, metadata } = compileEffects(source);
  assert.equal(recipe.animations.burst.loop, undefined);
  // A steady rate of one particle per frame with six-frame lives keeps six particles in every frame, including frame 0.
  assert.deepEqual(opsOf(recipe).map(ops => ops.length), Array(8).fill(6));
  // Rising particles are one pixel higher each frame; at frame 0 the oldest has risen five pixels.
  assert.deepEqual(opsOf(recipe)[0].map(op => op.y).sort((a, b) => a - b), [15, 16, 17, 18, 19, 20]);
  assert.deepEqual(metadata.effects.burst.emitters, [{ name: 'rise', spawned: 8, maxAlive: 6 }]);
});

test('effect sources fail early with paths an agent can act on', () => {
  const bad = (emitter, path) => assert.throws(() => compileEffects(effects({ frames: 4, emitters: [{ at: [1, 1], shapes: ['dot'], ...emitter }] })), error => error.path === path);
  bad({ burst: 1, rate: 1 }, 'fx.effects.burst.emitters[0]');
  bad({ burst: 1, shapes: ['nope'] }, 'fx.effects.burst.emitters[0].shapes[0]');
  bad({ burst: 1, dissolve: 0.5 }, 'fx.effects.burst.emitters[0].dissolve');
  bad({ burst: 1, bounce: 0.5 }, 'fx.effects.burst.emitters[0].bounce');
  bad({ burst: 1, remaps: [{ g: 'nope' }] }, 'fx.effects.burst.emitters[0].remaps[0].g');
  bad({ burst: 1, speed: [3, 1] }, 'fx.effects.burst.emitters[0].speed');
  bad({ burst: 1, life: 4, dissolve: 0.5, pattern: [[0, 9]] }, 'fx.effects.burst.emitters[0].pattern[0][1]');
  bad({ burst: 1, life: 4, pattern: 'bayer4' }, 'fx.effects.burst.emitters[0].pattern');
  // A custom rank matrix shapes the dissolve like the dither operation: diagonal stripes drop one diagonal in three.
  const striped = compileEffects(effects({ frames: 2, emitters: [{ at: [12, 12], burst: 1, life: 2, dissolve: 0.5, pattern: [[0, 1, 2], [1, 2, 0], [2, 0, 1]], shapes: [['chip'], ['chip']] }], }, { symbols: { chip: ['yyy', 'yyy', 'yyy'] } }));
  assert.deepEqual(opsOf(striped.recipe)[1], [{ op: 'grid', x: 11, y: 11, rows: ['yy.', 'y.y', '.yy'] }]);
  assert.throws(() => compileEffects(effects({ frames: 4, loop: true, emitters: [{ at: [1, 1], burst: 1, shapes: ['dot'] }] })), /finite life/);
  const one = { frames: 1, emitters: [{ at: [1, 1], burst: 1, shapes: ['dot'] }] };
  assert.throws(() => compileEffects({ ...effects(one), effects: { spark: one, Spark: one } }), error => error.path === 'fx.effects.Spark' && /ignoring case/.test(error.message));
  assert.throws(() => compileEffects(effects({ frames: 4, duration: [1, 2], emitters: [{ at: [1, 1], burst: 1, shapes: ['dot'] }] })), /one duration or 4/);
  assert.throws(() => compileEffects({ ...effects({ frames: 200, emitters: [{ at: [1, 1], burst: 1, shapes: ['dot'] }] }), effects: { a: { frames: 200, emitters: [{ at: [1, 1], burst: 1, shapes: ['dot'] }] }, b: { frames: 100, emitters: [{ at: [1, 1], burst: 1, shapes: ['dot'] }] } } }), /at most 256/);
});

test('timelines put frames on a game\'s milliseconds, start emitters at cues and carry cue points to the atlas', () => {
  const { recipe, metadata } = compileEffects(effects({ timeline: { length: 1300, rate: 12, cues: { impact: { time: 500, at: [12, 20] }, settle: 900 } }, seed: 2, emitters: [
    { name: 'hit', at: [12, 20], burst: 3, start: 'impact', speed: 1, life: 3, shapes: ['dot'] },
    { name: 'smoke', at: [12, 20], rate: 1, start: 'impact', end: 'settle', life: 2, shapes: ['warm'] }] }));
  const durations = recipe.frames.map(frame => frame.duration);
  assert.deepEqual(durations, [83, 84, 83, 83, 84, 83, ...Array(10).fill(80)]);
  assert.equal(durations.reduce((a, b) => a + b), 1300);
  assert.deepEqual(metadata.effects.burst.timeline, { length: 1300, cues: { impact: { time: 500, frame: 'burst-6', at: [12, 20] }, settle: { time: 900, frame: 'burst-11' } } });
  // Nothing spawns before the impact frame; the rate emitter runs from impact up to, not including, settle.
  assert.ok(opsOf(recipe).slice(0, 6).every(ops => !ops.length));
  assert.equal(opsOf(recipe)[6].length, 4);
  assert.deepEqual(metadata.effects.burst.emitters, [{ name: 'hit', spawned: 3, maxAlive: 3 }, { name: 'smoke', spawned: 5, maxAlive: 2 }]);
  assert.deepEqual(recipe.frames[6].points, { impact: [12, 20] });
  assert.deepEqual(buildAtlas(renderProject(recipe)).metadata.frames['burst-6'].points, { impact: { x: 12, y: 20 } });
  // Explicit start times work too; a cue must be one of them.
  const timed = compileEffects(effects({ timeline: { length: 300, times: [0, 50, 100, 200], cues: { hit: 100 } }, emitters: [{ at: [4, 4], burst: 1, start: 'hit', shapes: ['dot'] }] }));
  assert.deepEqual(timed.recipe.frames.map(frame => frame.duration), [50, 50, 100, 100]);
  assert.deepEqual(opsOf(timed.recipe).map(ops => ops.length), [0, 0, 1, 1]);
  // A timeline loops like any other effect.
  const looped = compileEffects(effects({ timeline: { length: 800, rate: 10 }, loop: true, emitters: [{ at: [12, 20], rate: 1, angle: 270, speed: 1, life: 4, shapes: ['dot'] }] }));
  assert.deepEqual(opsOf(looped.recipe).map(ops => ops.length), Array(8).fill(4));
});

test('timeline mistakes fail with paths an agent can act on', () => {
  const bad = (effect, path, pattern) => assert.throws(() => compileEffects(effects(effect)), error => error.path === path && pattern.test(error.message));
  const emitters = [{ at: [1, 1], burst: 1, shapes: ['dot'] }];
  bad({ frames: 4, timeline: { length: 100, rate: 10 }, emitters }, 'fx.effects.burst.timeline', /not both/);
  bad({ emitters }, 'fx.effects.burst', /frames .*or a timeline/);
  bad({ timeline: { length: 100, rate: 10, times: [0] }, emitters }, 'fx.effects.burst.timeline', /exactly one of rate/);
  bad({ timeline: { length: 300, times: [0, 100, 200], cues: { hit: 150 } }, emitters }, 'fx.effects.burst.timeline.cues.hit', /150 ms does not start a frame.*100 and 200/);
  bad({ timeline: { length: 300, times: [10, 100] }, emitters }, 'fx.effects.burst.timeline.times[0]', /starts at 0/);
  bad({ timeline: { length: 300, times: [0, 100, 100] }, emitters }, 'fx.effects.burst.timeline.times[2]', /increase/);
  bad({ timeline: { length: 300, rate: 10, cues: { hit: 300 } }, emitters }, 'fx.effects.burst.timeline.cues.hit', /0 to 299/);
  bad({ timeline: { length: 300, rate: 10, cues: { hit: { time: 100, at: [1.5, 0] } } }, emitters }, 'fx.effects.burst.timeline.cues.hit.at', /integer/);
  bad({ timeline: { length: 60000, rate: 120 }, emitters }, 'fx.effects.burst.timeline', /at most 256/);
  bad({ timeline: { length: 300, rate: 10, cues: { Aux: 100 } }, emitters }, 'fx.effects.burst.timeline.cues.Aux', /reserved/);
  bad({ timeline: { length: 300, rate: 10, cues: { hit: 100 } }, emitters: [{ ...emitters[0], start: 'boom' }] }, 'fx.effects.burst.emitters[0].start', /unknown cue "boom".*hit/);
  bad({ frames: 4, emitters: [{ ...emitters[0], start: 'hit' }] }, 'fx.effects.burst.emitters[0].start', /no timeline cues/);
  bad({ timeline: { length: 300, rate: 10, cues: { early: 100, late: 200 } }, emitters: [{ at: [1, 1], rate: 1, start: 'late', end: 'early', shapes: ['dot'] }] }, 'fx.effects.burst.emitters[0].end', /cue early starts frame 1, which is not after/);
});

const armSource = poses => ({ format: 'pixelforge-poses', version: 1, name: 'arm', width: 16, height: 16, palette: { a: '#f00', b: '#00f', c: '#0f0' },
  parts: { upper: { rows: ['aaaa'], points: { elbow: [3, 0] } }, blade: { rows: ['bbbbc'], points: { tip: [4, 0] } } }, poses });
const swing = (name, rotate, extra = {}) => ({ name, origin: [4, 8], parts: [{ name: 'arm', part: 'upper', rotate }, { name: 'sword', part: 'blade', attach: { part: 'arm', point: 'elbow' }, rotate }], markers: [{ name: 'tip', part: 'sword', point: 'tip' }], ...extra });

test('rotated pose parts bake into editable symbols and carry their points', () => {
  const { recipe, metadata } = compilePoses(armSource([swing('rest', 0), swing('down', 90), swing('slant', 45), { name: 'back', mirror: 'down' }]));
  assert.deepEqual([recipe.symbols['upper-r90'], recipe.symbols['blade-r45']], [['a', 'a', 'a', 'a'], ['b...', '.b..', '..b.', '...c']]);
  assert.deepEqual(metadata.poses.down.parts.sword.points.tip, [4, 15]);
  assert.deepEqual(recipe.frames.find(f => f.name === 'slant').points, { tip: [9, 13] });
  assert.deepEqual(metadata.poses.back.parts.arm, { definition: 'upper', symbol: 'upper-r90', flipX: true, rotate: -90, topLeft: [3, 8], anchor: [3, 8], points: { elbow: [3, 11] } });
  assert.deepEqual(recipe.frames.find(f => f.name === 'down').layers[1].ops, [{ op: 'stamp', symbol: 'blade-r90', x: 4, y: 11 }]);
  // Unrotated parts compile exactly as before: plain stamps of the definition.
  assert.deepEqual(recipe.frames[0].layers[0].ops, [{ op: 'stamp', symbol: 'upper', x: 4, y: 8 }]);
  const raw = compilePoses(armSource([{ name: 'p', parts: [{ name: 'arm', part: 'upper', rotate: 30, cleanup: false }] }]));
  assert.ok(raw.recipe.symbols['upper-r30-raw']);
  assert.throws(() => compilePoses(armSource([{ name: 'p', parts: [{ name: 'arm', part: 'upper', rotate: 30.5 }] }])), /whole degrees/);
  assert.throws(() => compilePoses({ ...armSource([{ name: 'p', parts: [{ name: 'arm', part: 'upper', rotate: 90 }] }]), parts: { upper: { rows: ['a'] }, 'upper-r90': { rows: ['a'] } } }), /rename that part/);
});

test('tweened poses interpolate offsets and angles, switch shapes at the eased midpoint and keep attachments', () => {
  const { recipe, metadata } = compilePoses(armSource([
    { ...swing('wind', 0), origin: [2, 8] }, { ...swing('strike', 90), origin: [6, 10] },
    { name: 'half', duration: 60, tween: { from: 'wind', to: 'strike', t: 0.5 } },
    { name: 'early', tween: { from: 'wind', to: 'strike', t: 0.5, ease: 'in' } },
    { name: 'again', tween: { from: 'half', to: 'strike', t: 0.5 } },
    { name: 'mirrored', mirror: 'half' }
  ]));
  assert.deepEqual([metadata.poses.half.origin, metadata.poses.half.parts.arm.rotate, metadata.poses.early.parts.arm.rotate, metadata.poses.again.parts.arm.rotate], [[4, 9], 45, 11, 68]);
  assert.deepEqual(metadata.poses.half.tween, { from: 'wind', to: 'strike', t: 0.5 });
  // The sword stays on the rotated elbow; in-betweens fire no markers unless they declare them.
  assert.deepEqual(metadata.poses.half.parts.sword.anchor, metadata.poses.half.parts.arm.points.elbow);
  assert.deepEqual(metadata.poses.half.markers, []);
  assert.equal(recipe.frames.find(f => f.name === 'half').duration, 60);
  assert.ok(renderProject(recipe).frames.find(f => f.name === 'mirrored'));
  assert.throws(() => compilePoses(armSource([swing('a', 0), { name: 'b', mirror: 'a' }, { name: 'c', tween: { from: 'a', to: 'b', t: 0.5 } }])), /mirror the finished tween/);
  assert.throws(() => compilePoses(armSource([swing('a', 0), { name: 'b', parts: [{ name: 'arm', part: 'upper' }] }, { name: 'c', tween: { from: 'a', to: 'b', t: 0.5 } }])), /same part instances/);
  assert.throws(() => compilePoses(armSource([swing('a', 0), swing('b', 90), { name: 'c', tween: { from: 'a', to: 'b', t: 2 } }])), /from 0 to 1/);
  assert.throws(() => compilePoses(armSource([swing('a', 0), swing('b', 90), { name: 'c', origin: [0, 0], tween: { from: 'a', to: 'b', t: 0.5 } }])), /interpolate the parts and origin/);
});

test('scene trajectories ease each segment and still land on whole pixels', () => {
  const dot = { version: 1, name: 'dot', width: 1, height: 1, palette: { w: '#fff' }, frames: [{ name: 'a', ops: [{ op: 'pixel', x: 0, y: 0, color: 'w' }] }] };
  const x = (ease, time) => renderScene(prepareScene({ format: 'pixelforge-scene', version: 1, name: 'path', width: 16, height: 4, duration: 200, assets: { dot },
    instances: [{ asset: 'dot', at: [0, 0], trajectory: [{ time: 0, at: [0, 1], ...(ease && { ease }) }, { time: 100, at: [10, 1] }] }] }), { time }).placements[0].x;
  assert.deepEqual([x(undefined, 25), x('inOut', 25), x('hold', 99), x('hold', 100), x('out', 50), x('overshoot', 57), x('overshoot', 100)], [3, 1, 0, 10, 9, 11, 10]);
  assert.throws(() => prepareScene({ format: 'pixelforge-scene', version: 1, name: 'path', width: 4, height: 4, assets: { dot }, instances: [{ asset: 'dot', at: [0, 0], trajectory: [{ time: 0, at: [0, 0], ease: 'wobble' }, { time: 10, at: [1, 0] }] }] }), /expected one of linear/);
});

test('the CLI compiles effect sources and keeps their shared palette link', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pixelforge-fx-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, 'palette.json'), JSON.stringify({ w: '#fff', y: '#fd6', o: '#e83', g: '#6b4', l: '#9d6' }));
  const source = { ...effects({ frames: 3, emitters: [{ at: [4, 4], burst: 2, speed: 1, shapes: ['dot'] }] }), palette: { $ref: 'palette.json' } };
  await writeFile(path.join(dir, 'burst.fx.json'), JSON.stringify(source));
  const run = spawnSync(process.execPath, [path.join(root, 'bin/pixelforge.js'), 'compile', path.join(dir, 'burst.fx.json'), '--out', path.join(dir, 'out/burst.json'), '--metadata', path.join(dir, 'out/burst.meta.json')], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const recipe = JSON.parse(await readFile(path.join(dir, 'out/burst.json'), 'utf8'));
  assert.deepEqual(recipe.palette, { $ref: '../palette.json' });
  assert.equal(JSON.parse(await readFile(path.join(dir, 'out/burst.meta.json'), 'utf8')).format, 'pixelforge-fx-metadata');
  const validate = spawnSync(process.execPath, [path.join(root, 'bin/pixelforge.js'), 'validate', path.join(dir, 'out/burst.json')], { encoding: 'utf8' });
  assert.equal(JSON.parse(validate.stdout).frames, 3);
  // compile dispatches on the source format, so it also builds autotile templates.
  await writeFile(path.join(dir, 'turf.autotile.json'), JSON.stringify({ format: 'pixelforge-autotile', version: 1, name: 'turf', tile: 2, mode: 'cardinal', palette: { g: '#0a0' }, template: Array(6).fill('gggg'), frame: 'turf-{mask}' }));
  const tiles = spawnSync(process.execPath, [path.join(root, 'bin/pixelforge.js'), 'compile', path.join(dir, 'turf.autotile.json'), '--out', path.join(dir, 'out/turf.json')], { encoding: 'utf8' });
  assert.equal(tiles.status, 0, tiles.stderr);
  assert.equal(JSON.parse(await readFile(path.join(dir, 'out/turf.json'), 'utf8')).frames.length, 16);
});
