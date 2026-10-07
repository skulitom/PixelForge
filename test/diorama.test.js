import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveReferences } from '../src/resolve.js';
import { prepareScene, renderScene } from '../src/scene.js';
import { parseColor } from '../src/core.js';

const root = fileURLToPath(new URL('..', import.meta.url)), art = path.join(root, 'showcase/diorama/art');
const load = async name => (await resolveReferences(JSON.parse(await readFile(path.join(art, name), 'utf8')), { baseDir: art })).document;

test('diorama: the committed sources match build.mjs', () => {
  assert.match(execFileSync(process.execPath, ['showcase/diorama/build.mjs', '--check'], { cwd: root, encoding: 'utf8' }), /All diorama sources match build\.mjs/);
});

test('diorama: every scene, lit or re-themed, keeps exactly its palette', async () => {
  const { palette } = JSON.parse(await readFile(path.join(art, 'palette.json'), 'utf8'));
  const blue = { ...palette, ...JSON.parse(await readFile(path.join(art, 'palette-blue.json'), 'utf8')) };
  for (const [file, colours] of [['room.scene.json', palette], ['room-blue.scene.json', blue], ['room-night.scene.json', palette]]) {
    const allowed = new Set(Object.values(colours).map(hex => parseColor(hex).join()));
    const scene = prepareScene(await load(file));
    for (const time of [0, 600, 1300, 2300]) {
      const view = renderScene(scene, { time }), seen = new Set();
      for (let at = 0; at < view.data.length; at += 4) seen.add([...view.data.subarray(at, at + 4)].join());
      assert.deepEqual([...seen].filter(colour => !allowed.has(colour)), [], `${file} at ${time} ms`);
      assert.deepEqual(view.warnings, [], file);
    }
  }
});

test('diorama: the hero is drawn behind the barrel it walks past, and the smear only shows during the strike', async () => {
  const scene = prepareScene(await load('room.scene.json'));
  const order = time => renderScene(scene, { time }).placements.map(p => p.name);
  // The barrel in the middle of the room (column 7, its top-left at x 60) stands lower than the hero's path, so it is
  // drawn after the hero; at 600 ms the two overlap.
  const placements = renderScene(scene, { time: 600 }).placements, barrel = placements.findIndex(p => p.name === 'barrel' && p.x === 60), hero = placements.findIndex(p => p.name === 'hero');
  assert.ok(barrel > hero && hero >= 0, `barrel ${barrel}, hero ${hero}`);
  const [a, b] = [placements[barrel], placements[hero]];
  assert.ok(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h, 'they overlap');
  assert.equal(order(1200).includes('slash'), false);
  assert.equal(order(1300).includes('slash'), true);
  assert.equal(order(1500).includes('slash'), false);
});
