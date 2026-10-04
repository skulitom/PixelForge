import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderProject, buildAtlas } from '../src/core.js';
import { createPixelContext, compileLoop } from '../src/drawloop.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const palette = { k: '#000000', w: '#ffffff', r: '#ff0000', d: '#401010', o: '#ff8040', y: '#ffd080', g: '#00ff00' };
const context = (width, height, extra = {}) => createPixelContext({ width, height, palette, ...extra });
const rows = ctx => ctx.readLayers()[0]?.rows ?? [];
const count = (lines, key) => lines.join('').split(key).length - 1;
const ramp = [{ keys: ['d', 'r', 'o', 'y', 'w'] }];

test('shapes are sampled at pixel centres, without anti-aliasing', () => {
  let ctx = context(8, 6);
  ctx.fillStyle = '#ff0000'; ctx.fillRect(1, 1, 3, 2);
  ctx.fillStyle = 'w'; ctx.fillRect(4.6, 3.4, 2, 2);
  // x from 4.6 to 6.6 covers the centres 5.5 and 6.5; y from 3.4 to 5.4 covers 3.5 and 4.5.
  assert.deepEqual(rows(ctx), ['........', '.rrr....', '.rrr....', '.....ww.', '.....ww.', '........']);
  // A circle is symmetric around a pixel centre; even-odd leaves the hole of a ring.
  ctx = context(9, 9);
  ctx.fillStyle = 'w'; ctx.beginPath(); ctx.arc(4.5, 4.5, 4, 0, Math.PI * 2); ctx.arc(4.5, 4.5, 2, 0, Math.PI * 2); ctx.fill('evenodd');
  const ring = rows(ctx);
  assert.deepEqual(ring, ring.map(row => [...row].reverse().join('')));
  assert.deepEqual(ring, [...ring].reverse());
  assert.equal(ring[4][4], '.');
  assert.equal(ring[4][1], 'w');
});

test('one-pixel strokes are traced without doubled corners; wider strokes keep their width', () => {
  // An odd canvas, so that reversing a row mirrors around the circle's centre pixel.
  const ctx = context(17, 17);
  ctx.strokeStyle = 'w'; ctx.beginPath(); ctx.arc(8.5, 8.5, 6, 0, Math.PI * 2); ctx.stroke();
  const circle = rows(ctx);
  // Pixel perfect: no pixel has both a horizontal and a vertical neighbour forming an L.
  for (let y = 1; y < 16; y++) for (let x = 1; x < 16; x++) {
    if (circle[y][x] !== 'w') continue;
    const across = circle[y][x - 1] === 'w' || circle[y][x + 1] === 'w', down = circle[y - 1][x] === 'w' || circle[y + 1][x] === 'w';
    assert.ok(!(across && down), `corner at ${x},${y}`);
  }
  // The rule ignores drawing direction, so a circle around a pixel centre is symmetric both ways.
  assert.deepEqual(circle, circle.map(row => [...row].reverse().join('')));
  assert.deepEqual(circle, [...circle].reverse());
  assert.equal(circle[2], '......wwwww......');
  const thick = context(12, 7);
  thick.strokeStyle = 'r'; thick.lineWidth = 3; thick.beginPath(); thick.moveTo(2, 3.5); thick.lineTo(10, 3.5); thick.stroke();
  assert.deepEqual(rows(thick), ['............', '............', '.rrrrrrrrrr.', 'rrrrrrrrrrrr', '.rrrrrrrrrr.', '............', '............']);
});

test('transforms, save and restore follow the canvas', () => {
  const ctx = context(12, 12);
  ctx.save(); ctx.translate(6, 6); ctx.rotate(Math.PI / 2); ctx.fillStyle = 'r'; ctx.fillRect(0, 0, 4, 2); ctx.restore();
  ctx.fillStyle = 'w'; ctx.fillRect(0, 0, 1, 1);
  const drawn = rows(ctx);
  // Turned a quarter clockwise: four rows tall, two columns wide, to the left of x = 6.
  assert.deepEqual(drawn.slice(6, 10).map(row => row.slice(4, 6)), ['rr', 'rr', 'rr', 'rr']);
  assert.equal(drawn[0][0], 'w');
  assert.equal(count(drawn, 'r'), 8);
  // units maps drawing units to pixels, and getTransform reports drawing units.
  const half = createPixelContext({ width: 8, height: 8, palette, units: 0.5 });
  half.fillStyle = 'w'; half.fillRect(0, 0, 8, 8);
  assert.equal(count(rows(half), 'w'), 16);
  assert.deepEqual(half.canvas, { width: 16, height: 16 });
  half.translate(2, 0);
  assert.deepEqual(half.getTransform(), { a: 1, b: 0, c: 0, d: 1, e: 2, f: 0 });
});

test('colours must be palette colours or mapped; unmapped ones are reported together', () => {
  const ctx = context(4, 1, { colors: { orange: 'o', '#123456': 'g' } });
  ctx.fillStyle = 'orange'; ctx.fillRect(0, 0, 1, 1);
  ctx.fillStyle = 'rgb(18 52 86)'; ctx.fillRect(1, 0, 1, 1);
  ctx.fillStyle = 'hsl(0, 100%, 50%)'; ctx.fillRect(2, 0, 1, 1);
  ctx.fillStyle = 'transparent'; ctx.fillRect(3, 0, 1, 1);
  assert.deepEqual(rows(ctx), ['ogr.']);
  assert.throws(() => compileLoop({ name: 'bad', width: 4, height: 4, palette, timeline: { length: 100, rate: 10 }, draw(ctx) {
    ctx.fillStyle = '#abcdef'; ctx.fillRect(0, 0, 1, 1); ctx.fillRect(1, 0, 1, 1); ctx.strokeStyle = 'teal'; ctx.strokeRect(0, 0, 2, 2);
  } }), error => error.path === 'loop.colors' && /"#abcdef" \(2 uses\), "teal" \(1 use\)/.test(error.message));
  // Setting an unmapped colour without drawing with it is not an error.
  assert.doesNotThrow(() => compileLoop({ name: 'unused', width: 4, height: 4, palette, timeline: { length: 100, rate: 10 }, draw(ctx) { ctx.fillStyle = '#abcdef'; } }));
});

test('partial coverage dithers solid keys, or thresholds them', () => {
  const dithered = context(4, 4);
  dithered.fillStyle = 'rgba(255, 255, 255, 0.5)'; dithered.fillRect(0, 0, 4, 4);
  assert.equal(count(rows(dithered), 'w'), 8);
  const threshold = context(4, 4, { soft: 'threshold' });
  threshold.globalAlpha = 0.5; threshold.fillStyle = 'w'; threshold.fillRect(0, 0, 2, 4); threshold.globalAlpha = 0.4; threshold.fillRect(2, 0, 2, 4);
  assert.deepEqual(rows(threshold), Array(4).fill('ww..'));
  // A gradient between two keys off a ramp hands over through the ordered pattern.
  const across = context(8, 2);
  const gradient = across.createLinearGradient(0, 0, 8, 0); gradient.addColorStop(0, 'r'); gradient.addColorStop(1, 'g');
  across.fillStyle = gradient; across.fillRect(0, 0, 8, 2);
  const line = rows(across), left = line.map(row => row.slice(0, 4)), right = line.map(row => row.slice(4));
  assert.equal(count(line, 'r') + count(line, 'g'), 16);
  assert.ok(count(left, 'g') < count(right, 'g'));
});

test('ramp keys behave as light: gradients band, fades cool and lighter adds up', () => {
  const glow = context(13, 13, { ramps: ramp });
  const g = glow.createRadialGradient(6.5, 6.5, 0, 6.5, 6.5, 6.5); g.addColorStop(0, 'w'); g.addColorStop(1, 'rgba(255, 255, 255, 0)');
  glow.fillStyle = g; glow.fillRect(0, 0, 13, 13);
  const bands = rows(glow);
  // Hottest at the centre, coolest at the rim, transparent beyond; symmetric.
  assert.equal(bands[6], '.drooywyoord.');
  assert.equal(bands[0], '.............');
  assert.deepEqual(bands, bands.map(row => [...row].reverse().join('')));
  // Fading a bright key cools it down the ramp instead of turning it translucent. Light scales from 0 while the bands
  // split the range above the floor (0.1 by default), so half the light is two steps down.
  const fade = alpha => { const ctx = context(1, 1, { ramps: ramp }); ctx.globalAlpha = alpha; ctx.fillStyle = 'w'; ctx.fillRect(0, 0, 1, 1); return rows(ctx)[0]; };
  assert.deepEqual([1, 0.75, 0.5, 0.3, 0.05].map(fade), ['w', 'y', 'r', 'd', '.']);
  // Two dim lights add up under 'lighter'; source-over just replaces.
  const stack = op => { const ctx = context(1, 1, { ramps: ramp }); ctx.globalCompositeOperation = op; ctx.fillStyle = 'r'; ctx.fillRect(0, 0, 1, 1); ctx.fillRect(0, 0, 1, 1); return rows(ctx)[0]; };
  assert.deepEqual([stack('source-over'), stack('lighter')], ['r', 'y']);
  // A solid key drawn on top covers the light.
  const covered = context(2, 1, { ramps: ramp });
  covered.fillStyle = 'w'; covered.fillRect(0, 0, 2, 1); covered.fillStyle = 'k'; covered.fillRect(0, 0, 1, 1);
  assert.deepEqual(rows(covered), ['kw']);
});

test('shadow blur draws a glow under the shape, banded when its colour is on a ramp', () => {
  const ctx = context(21, 21, { ramps: ramp });
  ctx.shadowColor = '#ffd080'; ctx.shadowBlur = 6; ctx.fillStyle = 'w'; ctx.fillRect(7, 7, 7, 7);
  const lit = rows(ctx);
  assert.equal(lit[10][10], 'w');
  assert.ok(['o', 'r', 'd'].includes(lit[10][15]) && lit[10][20] === '.');
  assert.ok(count(lit, 'd') + count(lit, 'r') + count(lit, 'o') > 20);
  // An offset shadow without blur is the shape moved.
  const drop = context(6, 6);
  drop.shadowColor = 'k'; drop.shadowOffsetX = 2; drop.shadowOffsetY = 2; drop.fillStyle = 'w'; drop.fillRect(0, 0, 3, 3);
  assert.deepEqual(rows(drop), ['www...', 'www...', 'wwwkk.', '..kkk.', '..kkk.', '......']);
});

test('clip, clearRect, destination-out and layers', () => {
  const ctx = context(6, 3);
  ctx.fillStyle = 'r'; ctx.fillRect(0, 0, 6, 3);
  ctx.clearRect(1, 1, 1, 1);
  ctx.globalCompositeOperation = 'destination-out'; ctx.fillRect(5, 0, 1, 3); ctx.globalCompositeOperation = 'source-over';
  ctx.save(); ctx.beginPath(); ctx.rect(2, 0, 2, 3); ctx.clip(); ctx.fillStyle = 'w'; ctx.fillRect(0, 0, 6, 1); ctx.restore();
  ctx.fillStyle = 'g'; ctx.fillRect(0, 2, 1, 1);
  assert.deepEqual(rows(ctx), ['rrwwr.', 'r.rrr.', 'grrrr.']);
  const layered = context(3, 1);
  layered.layer('back'); layered.fillStyle = 'r'; layered.fillRect(0, 0, 3, 1);
  layered.layer('front'); layered.fillStyle = 'w'; layered.fillRect(1, 0, 1, 1);
  assert.deepEqual(layered.readLayers(), [{ name: 'back', rows: ['rrr'] }, { name: 'front', rows: ['.w.'] }]);
});

test('text uses the pixel font, and images keep their pixels through scaling, flipping and rotation', () => {
  const ctx = context(20, 10);
  ctx.fillStyle = 'w'; ctx.textBaseline = 'top'; ctx.font = '8px monospace'; ctx.fillText('Hi', 1, 1);
  const text = rows(ctx);
  assert.equal(text[1].slice(1, 6), 'w...w');
  assert.equal(count(text, 'w'), 26);
  assert.ok(ctx.measureText('Hi').width > 0);
  assert.throws(() => { ctx.rotate(0.3); ctx.fillText('x', 0, 0); }, /upright/);
  const symbols = { arrow: ['.w.', 'www', '.w.', '.w.'] };
  const img = createPixelContext({ width: 12, height: 8, palette, symbols });
  img.drawImage('arrow', 0, 0);
  img.drawImage({ rows: ['rg'] }, 4, 0, 4, 2);
  img.save(); img.translate(9, 1); img.scale(-1, 1); img.drawImage({ rows: ['rg'] }, 0, 0); img.restore();
  img.save(); img.translate(9.5, 6); img.rotate(Math.PI / 2); img.drawImage('arrow', -1.5, -2); img.restore();
  const drawn = rows(img);
  assert.deepEqual(drawn.slice(0, 4).map(row => row.slice(0, 3)), symbols.arrow);
  assert.deepEqual([drawn[0].slice(4, 8), drawn[1].slice(4, 8)], ['rrgg', 'rrgg']);
  // Mirrored by scale(-1, 1) around x = 9: the two pixels swap and stay in place.
  assert.equal(drawn[1].slice(7, 9), 'gr');
  // Turned a quarter: four columns wide, three rows tall, the head pointing right.
  assert.deepEqual(drawn.slice(5, 8).map(row => row.slice(8, 12)), ['.w..', 'wwww', '.w..'].map(row => [...row].reverse().join('')));
});

test('calls a browser canvas has but the pixel context does not are errors, not silent no-ops', () => {
  const ctx = context(4, 4);
  assert.throws(() => ctx.createPattern(), error => error.path === 'context.createPattern' && /drawImage/.test(error.message));
  assert.throws(() => ctx.getImageData(0, 0, 1, 1), /not supported/);
  assert.throws(() => { ctx.filter = 'blur(2px)'; }, /filters are not supported/);
  assert.throws(() => { ctx.globalCompositeOperation = 'multiply'; }, /source-over, lighter, destination-out/);
  assert.throws(() => ctx.setLineDash([2, 2]), /dashed/);
  assert.throws(() => { ctx.somethingNew = 1; }, /not supported/);
  assert.doesNotThrow(() => { ctx.imageSmoothingEnabled = false; ctx.lineCap = 'round'; ctx.setLineDash([]); ctx.fillRect(NaN, 0, 1, 1); });
  assert.throws(() => createPixelContext({ width: 4, height: 4, palette: { ab: '#fff' } }), /single characters/);
  assert.throws(() => createPixelContext({ width: 4, height: 4, palette, ramps: [['d', 'r'], ['r', 'o']] }), /already on ramp/);
  assert.throws(() => createPixelContext({ width: 4, height: 4, palette, ramp: [] }), /context\.ramp: unknown/);
});

test('a loop samples its draw function on the timeline into an ordinary recipe with cues and points', () => {
  const times = [];
  const spec = { name: 'blink', width: 8, height: 8, palette, timeline: { length: 1000, rate: 4, cues: { hit: { time: 500, at: [4, 4] } } }, loop: false,
    draw(ctx, t, info) { times.push([t, info.ms, info.frame, info.duration]); ctx.fillStyle = t < 0.5 ? 'r' : 'w'; ctx.fillRect(0, 0, 8 * (t + 0.25), 1); ctx.point('tip', 8 * (t + 0.25) - 0.5, 0); } };
  const { recipe, metadata } = compileLoop(spec);
  assert.deepEqual(times, [[0, 0, 0, 250], [0.25, 250, 1, 250], [0.5, 500, 2, 250], [0.75, 750, 3, 250]]);
  assert.deepEqual(recipe.frames.map(frame => [frame.name, frame.duration, frame.ops[0].rows[0]]), [['blink-0', 250, 'rr'], ['blink-1', 250, 'rrrr'], ['blink-2', 250, 'wwwwww'], ['blink-3', 250, 'wwwwwwww']]);
  assert.deepEqual(recipe.animations, { blink: { frames: ['blink-0', 'blink-1', 'blink-2', 'blink-3'], loop: false } });
  assert.deepEqual(recipe.frames[2].points, { tip: [5, 0], hit: [4, 4] });
  assert.deepEqual(metadata.timeline, { length: 1000, cues: { hit: { time: 500, frame: 'blink-2', at: [4, 4] } } });
  assert.deepEqual(buildAtlas(renderProject(recipe)).metadata.frames['blink-2'].points.hit, { x: 4, y: 4 });
  assert.deepEqual(compileLoop(spec), compileLoop(spec));
  // Errors name the frame they happened in.
  assert.throws(() => compileLoop({ ...spec, draw(ctx, t) { if (t > 0.6) throw new Error('boom'); } }), error => error.path === 'loop.draw' && /frame 3 at 750 ms: boom/.test(error.message));
  assert.throws(() => compileLoop({ ...spec, draw(ctx) { ctx.createPattern(); } }), error => error.path === 'context.createPattern' && /frame 0 at 0 ms/.test(error.message));
  assert.throws(() => compileLoop({ ...spec, timeline: { length: 1000 } }), /exactly one of rate/);
  assert.throws(() => compileLoop({ ...spec, draw: undefined }), /loop\.draw/);
});

test('the examples compile, and the CLI reads draw loops wherever it reads a recipe', async t => {
  for (const file of ['lantern', 'slime']) {
    const { recipe } = compileLoop((await import(`../examples/${file}.loop.mjs`)).default);
    assert.deepEqual(renderProject(recipe).warnings, []);
    assert.deepEqual(JSON.parse(await readFile(path.join(root, `examples/${file}.json`), 'utf8')), recipe);
  }
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pixelforge-loop-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, 'dot.loop.mjs'), `export default { name: 'dot', width: 4, height: 4, palette: { w: '#ffffff' }, timeline: { length: 200, rate: 10 }, draw(ctx, t) { ctx.fillStyle = '#fff'; ctx.fillRect(t * 10, 0, 1, 1); } };\n`);
  const run = (...args) => spawnSync(process.execPath, [path.join(root, 'bin/pixelforge.js'), ...args], { encoding: 'utf8' });
  const compiled = run('compile', path.join(dir, 'dot.loop.mjs'), '--out', path.join(dir, 'dot.json'), '--metadata', path.join(dir, 'dot.meta.json'));
  assert.equal(compiled.status, 0, compiled.stderr);
  assert.equal(JSON.parse(await readFile(path.join(dir, 'dot.json'), 'utf8')).frames.length, 2);
  assert.equal(JSON.parse(await readFile(path.join(dir, 'dot.meta.json'), 'utf8')).format, 'pixelforge-loop-metadata');
  assert.equal(JSON.parse(run('validate', path.join(dir, 'dot.loop.mjs')).stdout).frames, 2);
  assert.equal(run('gif', path.join(dir, 'dot.loop.mjs'), '--out', path.join(dir, 'dot.gif')).status, 0);
});
