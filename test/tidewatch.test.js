import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { renderProject, compilePoses } from '../src/index.js';
import { World } from '../showcase/tidewatch/game/src/world.js';
import { blobMasks, maskAt } from '../showcase/tidewatch/game/src/autotile.js';
import { TERRAIN, isSand } from '../showcase/tidewatch/game/src/map.js';

const art = new URL('../showcase/tidewatch/art/', import.meta.url);
const json = path => JSON.parse(readFileSync(new URL(path, art), 'utf8'));
const recipes = readdirSync(new URL('recipes/', art)).filter(f => f.endsWith('.json') && !f.includes('.meta.') && !f.includes('.map.'));

test('Tidewatch: every recipe validates without clipping warnings', () => {
  assert.ok(recipes.length >= 30);
  for (const file of recipes) {
    const project = renderProject(json(`recipes/${file}`));
    assert.deepEqual(project.warnings, [], file);
  }
});

test('Tidewatch: compiled pose recipes and metadata match their authoritative pose sources', () => {
  for (const name of ['keeper', 'crab']) {
    // compilePoses uses null-prototype maps; compare the JSON a file would contain.
    const { recipe, metadata } = JSON.parse(JSON.stringify(compilePoses(json(`poses/${name}.poses.json`))));
    assert.deepEqual(recipe, json(`recipes/${name}.json`), `${name} recipe is stale; recompile it`);
    assert.deepEqual(metadata, json(`recipes/${name}.meta.json`), `${name} metadata is stale; recompile it`);
  }
});

test('Tidewatch: exported game atlases match the recipes byte for byte', () => {
  const output = execFileSync(process.execPath, ['showcase/tidewatch/tools/build-assets.mjs', '--check'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.match(output, /All exported assets match their recipes/);
});

test('Tidewatch: material passes stay aligned with their colour recipes', () => {
  for (const name of ['lighthouse', 'cottage', 'lamp']) {
    const color = renderProject(json(`recipes/${name}.json`));
    for (const pass of ['normal', 'emissive']) {
      const other = renderProject(json(`recipes/${name}-${pass}.json`));
      assert.deepEqual(other.frames.map(f => [f.name, f.duration]), color.frames.map(f => [f.name, f.duration]), `${name}-${pass}`);
      assert.deepEqual([other.width, other.height], [color.width, color.height]);
    }
  }
});

test('Tidewatch: blob autotiling covers every sand tile with one of 47 authored tiles', () => {
  const masks = new Set(blobMasks()), shore = renderProject(json('recipes/shore.json'));
  assert.equal(masks.size, 47);
  const names = new Set(shore.frames.map(f => f.name));
  TERRAIN.forEach((row, y) => [...row].forEach((_, x) => {
    if (!isSand(x, y)) return;
    const mask = maskAt(null, x, y, (_, i, j) => isSand(i, j));
    assert.ok(masks.has(mask) && names.has(`shore-${mask}-0`), `tile ${x},${y}`);
  }));
});

test('Tidewatch: the island can be completed in a deterministic headless run', () => {
  const meta = json('recipes/keeper.meta.json'), world = new World(meta, 3);
  const input = { pressed: new Set(), held: new Set(), take(k) { const had = this.pressed.has(k); this.pressed.delete(k); return had; }, axis() { return { x: 0, y: 0 }; } };
  const run = (ms, key) => { if (key) input.pressed.add(key); for (let t = 0; t < ms; t += 1000 / 60) world.update(1000 / 60, input); };
  const skip = () => { while (world.messages.length) world.messages.shift(); run(20); };
  const p = world.player;
  // The sea blocks movement.
  p.x = 5 * 16; p.y = 13 * 16; const x0 = p.x; world.move(p, -40, 0, [-5, -4, 10, 5]); assert.ok(p.x > x0 - 40);
  // Cutting tall grass reveals the sunflint; walking onto it grants the item and starts dusk.
  p.x = 152; p.y = 352; p.dir = 'u'; run(100, 'attack'); run(400);
  const flint = world.pickups.find(k => k.kind === 'flint'); assert.ok(flint, 'flint revealed');
  p.x = flint.x; p.y = flint.y; run(300);
  assert.equal(world.flags.flint, true); assert.equal(world.phase, 'dusk'); skip();
  // The east-cove chest holds the tower key.
  p.x = 584; p.y = 304; p.dir = 'u'; run(50, 'act'); assert.equal(world.flags.key, true); skip();
  // A crab takes two cutlass hits.
  const crab = world.enemies.find(e => e.kind === 'crab'); p.inv = 99999;
  for (let i = 0; i < 2; i++) { p.x = crab.x - 16; p.y = crab.y; p.dir = 'r'; run(400, 'attack'); }
  assert.equal(crab.alive, false); assert.ok(world.stats.defeated >= 1);
  // With both items the lighthouse door starts the ending.
  p.x = 320; p.y = 162; p.dir = 'u'; run(50, 'act');
  assert.ok(world.flags.ending > 0);
  assert.ok(world.events.some(e => e.type === 'ignite'));
});
