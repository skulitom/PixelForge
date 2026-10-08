import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, readdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderProject } from '../src/core.js';
import { patchRecipe } from '../src/patch.js';
import { encodePNG } from '../src/png.js';
import { checkRun, briefProblems, CHECK_TYPES, animationsFromTags } from '../benchmark/checks.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const briefsDir = path.join(root, 'benchmark/briefs');
const readJSON = async file => JSON.parse(await readFile(file, 'utf8'));
const brief = (criteria, setup = { width: 4, height: 4 }) => ({ format: 'pixelforge-benchmark-brief', version: 1, id: 't', revision: 1, title: 't', tests: 't', setup, brief: ['Draw.'], criteria });
const run = (check, project, options) => checkRun(brief([{ id: 'c', text: 'c', check }], { width: project.width, height: project.height, colors: ['#000', '#fff'] }), project, options).results[0];
const draw = (frames, extra = {}) => renderProject({ version: 1, name: 't', width: 4, height: 4, palette: { k: '#000', w: '#fff', r: '#f00', s: '#00000080' }, frames, ...extra });

test('every benchmark brief is complete, and every check type is used', async () => {
  const files = (await readdir(briefsDir)).filter(file => file.endsWith('.json')).sort();
  assert.deepEqual(files, ['icon.json', 'revision.json', 'tile.json', 'walker.json']);
  const used = new Set();
  for (const file of files) {
    const document = await readJSON(path.join(briefsDir, file));
    assert.deepEqual(briefProblems(document), [], file);
    assert.equal(`${document.id}.json`, file);
    for (const criterion of document.criteria) if (criterion.check) used.add(criterion.check.type);
    assert.ok(document.criteria.some(criterion => criterion.judge), `${file} leaves taste to judges`);
  }
  assert.deepEqual([...used].sort(), [...CHECK_TYPES].sort());
  assert.match(briefProblems({ ...brief([{ id: 'a', text: 'a', check: { type: 'nope' } }]) }).join(), /unknown check type/);
  assert.match(briefProblems(brief([{ id: 'a', text: 'a', check: { type: 'canvas' }, judge: true }])).join(), /either a check or judge/);
});

test('checks pass and fail on the rendered pixels alone', () => {
  const dot = draw([{ name: 'a', duration: 100, ops: [{ op: 'pixel', x: 1, y: 2, color: 'k' }] }, { name: 'b', duration: 300, ops: [{ op: 'rect', x: 1, y: 1, w: 2, h: 2, color: 'w' }] }], { animations: { idle: { frames: ['a', 'b'] }, once: { frames: ['a'], loop: false } } });
  assert.equal(run({ type: 'canvas', width: 4, height: 4 }, dot).pass, true);
  assert.equal(run({ type: 'canvas', width: 4, height: 5 }, dot).pass, false);
  assert.equal(run({ type: 'frames', names: ['a'] }, dot).pass, true);
  assert.deepEqual(run({ type: 'frames', names: ['a'], exact: true }, dot).detail.extra, ['b']);
  assert.equal(run({ type: 'colors', colors: 'setup' }, dot).pass, true);
  const stray = draw([{ name: 'a', ops: [{ op: 'pixel', color: 'r' }, { op: 'pixel', x: 1, color: 's' }] }]);
  assert.deepEqual([run({ type: 'colors', colors: 'setup' }, stray).detail.offPalette, run({ type: 'colors', colors: 'setup' }, stray).detail.translucent], [1, 1]);
  assert.deepEqual(run({ type: 'color-count', max: 1 }, stray).detail, { a: 2 });
  assert.equal(run({ type: 'color-count', max: 2 }, stray).pass, true);
  assert.equal(run({ type: 'animation', name: 'idle', frames: [2, 4], loop: true, duration: [100, 300] }, dot).pass, true);
  assert.deepEqual(run({ type: 'animation', name: 'idle', counts: [3], duration: [100, 200] }, dot).detail.problems, ['2 frames, expected 3', 'durations outside 100–200 ms']);
  assert.deepEqual(run({ type: 'animation', name: 'once', loop: true }, dot).detail.problems, ['does not loop']);
  assert.equal(run({ type: 'animation', name: 'walk' }, dot).detail, 'missing animation walk');
  assert.equal(run({ type: 'opaque' }, dot).pass, false);
  assert.equal(run({ type: 'opaque' }, draw([{ name: 'a', ops: [{ op: 'rect', w: 4, h: 4, color: 'k' }] }])).pass, true);
  assert.equal(run({ type: 'margin', pixels: 1 }, dot).pass, true);
  assert.deepEqual(run({ type: 'margin', pixels: 1 }, stray).detail.touching, ['a']);
  assert.deepEqual(run({ type: 'ground', row: 2, animations: ['idle'] }, dot).detail.lowestRow, { a: 2, b: 2 });
  assert.equal(run({ type: 'ground', row: 2, animations: ['idle'] }, dot).pass, true);
  assert.deepEqual(run({ type: 'height', min: 2, max: 2, frames: ['a', 'b'] }, dot).detail.heights, { a: 1, b: 2 });
  assert.equal(run({ type: 'height', min: 2, max: 2, frames: ['b'] }, dot).pass, true);
  assert.equal(run({ type: 'extent', frames: ['b'], left: 1, right: 2 }, dot).pass, true);
  assert.equal(run({ type: 'extent', frames: ['a', 'b'], left: 1, top: 1 }, dot).pass, false);
  assert.equal(run({ type: 'height', min: 1, max: 2, frames: ['c'] }, dot).detail, 'missing frame c');
});

test('tile checks find doubled seams and edges that differ between variants', () => {
  const blank = 'wwwwwwww', plain = [blank, blank, blank, 'wwwkkwww', 'wwwkkwww', blank, blank, blank];
  const variant = [blank, blank, blank, 'wwkkkkww', 'wwwkkwww', blank, blank, blank], edged = plain.map(row => 'k' + row.slice(1));
  const project = renderProject({ version: 1, name: 't', width: 8, height: 8, palette: { k: '#000', w: '#fff' }, frames: [['plain', plain], ['variant', variant], ['edged', edged]].map(([name, rows]) => ({ name, ops: [{ op: 'grid', rows }] })) });
  assert.equal(run({ type: 'seamless', frames: ['plain', 'variant'] }, project).pass, true);
  assert.equal(run({ type: 'same-edges', frames: ['plain', 'variant'] }, project).pass, true);
  assert.deepEqual(run({ type: 'same-edges', frames: ['plain', 'edged'] }, project).detail.pixels, { edged: 8 });
  assert.equal(run({ type: 'same-pixels', frames: ['plain', 'variant'], region: { x: 0, y: 4, w: 8, h: 4 } }, project).pass, true);
  assert.deepEqual(run({ type: 'same-pixels', frames: ['plain', 'variant'] }, project).detail.pixels, { variant: 2 });
  // A line on both opposite edges doubles when the tile repeats.
  const lines = renderProject({ version: 1, name: 't', width: 8, height: 8, palette: { k: '#000', w: '#fff' }, frames: [{ name: 'a', ops: [{ op: 'rect', w: 8, h: 8, color: 'w' }, { op: 'rect', w: 1, h: 8, color: 'k' }, { op: 'rect', x: 7, w: 1, h: 8, color: 'k' }] }] });
  assert.equal(run({ type: 'seamless' }, lines).pass, false);
});

test('the revision brief rewards the requested edit and counts every unrequested pixel', async () => {
  const revision = await readJSON(path.join(briefsDir, 'revision.json'));
  const source = await readJSON(path.join(briefsDir, revision.setup.base));
  const base = renderProject(source);
  const score = project => Object.fromEntries(checkRun(revision, project, { base }).results.filter(r => !r.judge).map(r => [r.id, r.pass]));
  // Untouched: everything holds except the tip.
  assert.deepEqual(score(base), { canvas: true, palette: true, tip: false, unrequested: true, match: true });
  // The requested edit, made only in idle and blink: erase the tail left of x 3.
  const edited = structuredClone(base);
  for (const frame of edited.frames.filter(f => f.name === 'idle' || f.name === 'blink')) {
    for (let y = 14; y <= 20; y++) for (let x = 0; x < 3; x++) frame.data.fill(0, (y * base.width + x) * 4, (y * base.width + x) * 4 + 4);
  }
  assert.deepEqual(score(edited), { canvas: true, palette: true, tip: true, unrequested: true, match: true });
  // Editing the shared tail symbol shortens the tail in every frame that stamps it: unrequested pixels.
  const tail = source.symbols.tail.map(row => '...' + row.slice(3));
  const shared = renderProject(patchRecipe(source, [{ set: 'symbols.tail', value: tail }]).recipe);
  const result = checkRun(revision, shared, { base }).results.find(r => r.id === 'unrequested');
  assert.equal(result.pass, false);
  assert.ok(result.detail.unrequestedPixels > 0 && !('idle' in result.detail.byFrame) && 'contact-a' in result.detail.byFrame);
  // Retiming or dropping frames is reported too.
  const retimed = structuredClone(edited); retimed.frames[2].duration = 999;
  assert.deepEqual(checkRun(revision, retimed, { base }).results.find(r => r.id === 'unrequested').detail.problems, [`frame ${base.frames[2].name} lasts 999 ms, was ${base.frames[2].duration}`]);
});

test('the checker CLI reads recipes, and PNG sheets with an Aseprite-style atlas', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pixelforge-benchmark-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const icon = path.join(briefsDir, 'icon.json');
  const recipe = { version: 1, name: 'flask', width: 16, height: 16, palette: { k: '#000000', g: '#00e436' }, frames: [{ name: 'icon', ops: [{ op: 'rect', x: 4, y: 4, w: 8, h: 8, color: 'k' }, { op: 'rect', x: 5, y: 5, w: 6, h: 6, color: 'g' }] }] };
  await writeFile(path.join(dir, 'icon.json'), JSON.stringify(recipe));
  const cli = (...args) => spawnSync(process.execPath, [path.join(root, 'benchmark/check.mjs'), ...args], { encoding: 'utf8' });
  const passing = cli(icon, path.join(dir, 'icon.json'));
  assert.equal(passing.status, 0, passing.stderr);
  assert.deepEqual(JSON.parse(passing.stdout).results.filter(r => !r.judge).map(r => r.pass), [true, true, true, true]);
  // Two 16×16 frames side by side, named the way an editor names files, with one tag over both.
  const project = renderProject({ ...recipe, frames: [recipe.frames[0], { name: 'second', ops: [{ op: 'pixel', color: 'g' }] }] });
  const sheet = new Uint8ClampedArray(32 * 16 * 4);
  for (let y = 0; y < 16; y++) project.frames.forEach((frame, i) => sheet.set(frame.data.subarray(y * 64, y * 64 + 64), (y * 32 + i * 16) * 4));
  await writeFile(path.join(dir, 'sheet.png'), encodePNG(sheet, 32, 16));
  const atlas = { frames: { 'flask 0.aseprite': { frame: { x: 0, y: 0, w: 16, h: 16 }, duration: 100 }, 'flask 1.aseprite': { frame: { x: 16, y: 0, w: 16, h: 16 }, duration: 100 } }, meta: { scale: '1', frameTags: [{ name: 'shine', from: 0, to: 1, direction: 'pingpong' }] } };
  await writeFile(path.join(dir, 'sheet.json'), JSON.stringify(atlas));
  const failing = cli(icon, path.join(dir, 'sheet.png'), '--atlas', path.join(dir, 'sheet.json'));
  assert.equal(failing.status, 1, failing.stderr);
  const results = Object.fromEntries(JSON.parse(failing.stdout).results.map(r => [r.id, r]));
  assert.deepEqual(results.frames.detail, { frames: ['flask-0', 'flask-1'], missing: ['icon'], extra: ['flask-0', 'flask-1'] });
  assert.deepEqual(results.margin.detail, { touching: ['flask-1'] });
  assert.deepEqual(animationsFromTags(atlas).animations, { shine: { frames: ['flask 0.aseprite', 'flask 1.aseprite'] } });
  const usage = cli(icon);
  assert.equal(usage.status, 1); assert.match(usage.stderr, /^usage:/);
});
