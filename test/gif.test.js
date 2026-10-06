import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, readdir, mkdtemp, rm, access, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderProject, PixelError } from '../src/core.js';
import { encodeGIF, animationGIF, framesGIF } from '../src/gif.js';
import { numberedFrames } from '../src/frame-folder.js';
import { encodePNG } from '../src/png.js';

const root = fileURLToPath(new URL('../', import.meta.url));
// A separate, plain reading of the GIF89a structure and its LZW stream: it shares no code with the encoder. Frames
// are composited the way a viewer shows them: a frame paints its rectangle over what the last one left, and
// disposal 2 clears that rectangle afterwards.
function decodeGIF(bytes) {
  assert.equal(Buffer.from(bytes.subarray(0, 6)).toString('latin1'), 'GIF89a');
  const word = at => bytes[at] | bytes[at + 1] << 8, gif = { width: word(6), height: word(8), loop: null, frames: [] };
  let at = 13, control = null, canvas = Array(gif.width * gif.height).fill('clear');
  const table = flags => { const colors = bytes.subarray(at, at + (3 << (flags & 7) + 1)); at += colors.length; return colors; };
  const blocks = () => { const parts = []; for (let size = bytes[at++]; size; size = bytes[at++]) { parts.push(bytes.subarray(at, at + size)); at += size; } return Buffer.concat(parts); };
  const shared = bytes[10] & 0x80 ? table(bytes[10]) : null;
  gif.shared = Boolean(shared);
  for (let marker = bytes[at++]; marker !== 0x3b; marker = bytes[at++]) {
    if (marker === 0x21) {
      const label = bytes[at++];
      if (label === 0xf9) { assert.equal(bytes[at], 4); control = { disposal: bytes[at + 1] >> 2 & 7, transparent: bytes[at + 1] & 1 ? bytes[at + 4] : null, delay: word(at + 2) * 10 }; at += 5; assert.equal(bytes[at++], 0); }
      else if (label === 0xff) { assert.equal(Buffer.from(bytes.subarray(at + 1, at + 12)).toString('latin1'), 'NETSCAPE2.0'); at += 12; const data = blocks(); assert.equal(data[0], 1); gif.loop = data[1] | data[2] << 8; }
      else assert.fail(`unexpected extension ${label}`);
      continue;
    }
    assert.equal(marker, 0x2c);
    const rect = [word(at), word(at + 2), word(at + 4), word(at + 6)], flags = bytes[at + 8]; at += 9;
    assert.ok(rect[2] && rect[3] && rect[0] + rect[2] <= gif.width && rect[1] + rect[3] <= gif.height, 'frame rectangle inside the canvas');
    const colors = flags & 0x80 ? table(flags) : shared, minimum = bytes[at++], data = blocks(), clear = 1 << minimum, indices = [];
    let size = minimum + 1, buffer = 0, bits = 0, read = 0, dictionary = [], previous = null;
    for (;;) {
      while (bits < size) { buffer |= data[read++] << bits; bits += 8; }
      const code = buffer & (1 << size) - 1; buffer >>>= size; bits -= size;
      if (code === clear) { dictionary = Array.from({ length: clear + 2 }, (_, index) => [index]); size = minimum + 1; previous = null; continue; }
      if (code === clear + 1) break;
      assert.ok(code <= dictionary.length && (previous || code < clear), 'code out of range');
      const entry = code < dictionary.length ? dictionary[code] : [...previous, previous[0]];
      indices.push(...entry);
      if (previous && dictionary.length < 4096) dictionary.push([...previous, entry[0]]);
      if (dictionary.length === 1 << size && size < 12) size++;
      previous = entry;
    }
    assert.equal(read, data.length, 'bytes after the end code'); assert.equal(indices.length, rect[2] * rect[3]);
    const pixels = canvas.slice(), inside = (callback) => { for (let y = 0; y < rect[3]; y++) for (let x = 0; x < rect[2]; x++) callback((rect[1] + y) * gif.width + rect[0] + x, y * rect[2] + x); };
    inside((to, from) => { if (indices[from] !== control.transparent) pixels[to] = Buffer.from(colors.subarray(indices[from] * 3, indices[from] * 3 + 3)).toString('hex'); });
    gif.frames.push({ ...control, local: Boolean(flags & 0x80), colors: colors.length / 3, rect, pixels });
    canvas = pixels.slice();
    if (control.disposal === 2) inside(to => { canvas[to] = 'clear'; });
  }
  assert.equal(at, bytes.length);
  return gif;
}
const rgba = (...pixels) => Uint8Array.from(pixels.flat());
const RED = [255, 0, 0, 255], BLUE = [0, 0, 255, 255], CLEAR = [0, 0, 0, 0];

test('GIF frames, colours, timing and loop flag are read back exactly by a separate decoder', () => {
  const frames = [{ data: rgba(RED, BLUE, CLEAR, [0, 255, 0, 200]), duration: 100 }, { data: rgba(BLUE, BLUE, [9, 9, 9, 100], RED), duration: 250 }];
  const gif = encodeGIF(frames, 2, 2, { scale: 2 }), decoded = decodeGIF(gif.data);
  assert.deepEqual([gif.width, gif.height, gif.colors, gif.transparent, gif.partialAlpha, gif.delays], [4, 4, 3, true, 2, [100, 250]]);
  assert.deepEqual([decoded.width, decoded.height, decoded.loop, decoded.shared], [4, 4, 0, true]);
  // Each source pixel becomes a 2×2 block; alpha 200 turns opaque and alpha 100 transparent.
  const block = (a, b, c, d) => [a, a, b, b, a, a, b, b, c, c, d, d, c, c, d, d];
  assert.deepEqual(decoded.frames.map(frame => frame.pixels), [block('ff0000', '0000ff', 'clear', '00ff00'), block('0000ff', '0000ff', 'clear', 'ff0000')]);
  // Disposal 2 restores the background, so a transparent pixel never shows the frame before it.
  assert.deepEqual(decoded.frames.map(({ disposal, delay, transparent, local }) => [disposal, delay, transparent, local]), [[2, 100, 0, false], [2, 250, 0, false]]);
  assert.deepEqual(encodeGIF(frames, 2, 2, { scale: 2 }).data, gif.data);
  const once = decodeGIF(encodeGIF([{ data: rgba(RED, BLUE), duration: 40 }], 2, 1, { loop: false }).data);
  assert.deepEqual([once.loop, once.frames[0].disposal, once.frames[0].transparent, once.frames[0].pixels], [null, 1, null, ['ff0000', '0000ff']]);
});
test('GIF blends onto a background instead of thresholding, and keeps a sequence\'s length when rounding delays', () => {
  const blended = encodeGIF([{ data: rgba([255, 0, 0, 128], CLEAR), duration: 100 }], 2, 1, { background: [0, 0, 255] });
  assert.deepEqual([blended.transparent, blended.partialAlpha], [false, 0]);
  assert.deepEqual(decodeGIF(blended.data).frames[0].pixels, ['80007f', '0000ff']);
  const timed = encodeGIF([75, 75, 15, 5, 60000].map(duration => ({ data: rgba(RED), duration })), 1, 1);
  // 75 + 75 becomes 80 + 70; anything under 20 ms is raised to it, because browsers play shorter delays at 100 ms.
  assert.deepEqual(timed.delays, [80, 70, 20, 20, 60000]);
  assert.deepEqual(decodeGIF(timed.data).frames.map(frame => frame.delay), timed.delays);
});
test('GIF uses a table per frame when the animation needs more than 256 colours, and never quantizes', () => {
  const shades = (count, blue) => Array.from({ length: 256 }, (_, i) => i < count ? [i, 255 - i, blue, 255] : CLEAR);
  const frames = [{ data: rgba(...shades(256, 1)), duration: 100 }, { data: rgba(...shades(255, 2)), duration: 100 }];
  const gif = encodeGIF(frames, 16, 16), decoded = decodeGIF(gif.data);
  assert.deepEqual([gif.colors, decoded.shared, decoded.frames.map(frame => frame.local)], [511, false, [true, true]]);
  for (const [position, frame] of frames.entries()) assert.deepEqual(decoded.frames[position].pixels, Array.from({ length: 256 }, (_, i) => frame.data[i * 4 + 3] ? Buffer.from(frame.data.subarray(i * 4, i * 4 + 3)).toString('hex') : 'clear'));
  assert.deepEqual(decoded.frames.map(frame => frame.transparent), [null, 0]);
  const tooMany = rgba(...Array.from({ length: 257 }, (_, i) => [i & 255, i >> 8, 7, 255]));
  assert.throws(() => encodeGIF([{ data: tooMany, duration: 100 }], 257, 1), error => error instanceof PixelError && /frame 1 of the animation uses 257 colours; a GIF frame holds 256 and PixelForge does not quantize/.test(error.message));
  assert.throws(() => encodeGIF([{ data: rgba(...shades(256, 1), CLEAR), duration: 100 }], 257, 1), /256 colours beside transparency/);
  assert.throws(() => encodeGIF([{ data: rgba(RED), duration: 100 }], 1, 1, { scale: 17 }), /gif\.scale/);
  assert.throws(() => encodeGIF([], 1, 1), /at least one frame/);
  assert.throws(() => encodeGIF(Array.from({ length: 257 }, () => ({ data: new Uint8Array(256 * 256 * 4), duration: 100 })), 256, 256, { scale: 2 }), /exceed 67,108,864 pixels/);
});
test('GIF compression survives dictionary resets and 12-bit codes on noisy frames', () => {
  // Seeded noise over 200 colours fills the 4,096-entry dictionary several times in one frame.
  let seed = 12345;
  const next = () => (seed = seed * 1103515245 + 12345 & 0x7fffffff) >> 16;
  const data = new Uint8Array(160 * 120 * 4);
  for (let i = 0; i < data.length; i += 4) { const color = next() % 200; data.set([color, color * 7 & 255, 255 - color, 255], i); }
  const frames = [{ data, duration: 100 }, { data: data.slice().reverse().map((value, i) => i % 4 === 0 ? 255 : value), duration: 100 }];
  const decoded = decodeGIF(encodeGIF(frames, 160, 120).data);
  assert.deepEqual(decoded.frames[0].pixels, Array.from({ length: 160 * 120 }, (_, i) => Buffer.from(data.subarray(i * 4, i * 4 + 3)).toString('hex')));
  assert.equal(decoded.frames[1].pixels.length, 160 * 120);
});
test('an animation exports as a GIF with a default scale, notes about what GIF cannot keep, and named errors', async () => {
  const project = renderProject(JSON.parse(await readFile(path.join(root, 'examples', 'forest-spirit.json'), 'utf8')));
  const gif = animationGIF(project), decoded = decodeGIF(gif.data);
  // 24 pixels scale to 240, the largest whole multiple within 256. The soft shadow is below 50% alpha.
  assert.deepEqual([gif.animation, gif.scale, gif.width, gif.height, gif.frames, gif.duration, gif.loop, gif.transparent], ['idle', 10, 240, 240, 7, 1220, true, true]);
  assert.equal(decoded.frames.length, 7); assert.ok(gif.partialAlpha > 0); assert.match(gif.notes[0], /partly transparent pixels across the frames became fully transparent/);
  const matte = animationGIF(project, 'blink', { scale: 3, background: 'k' });
  assert.deepEqual([matte.width, matte.loop, matte.transparent, matte.partialAlpha, matte.notes], [72, false, false, 0, []]);
  assert.equal(decodeGIF(matte.data).loop, null);
  const uneven = renderProject({ version: 1, name: 'tick', width: 1, height: 1, frames: [{ name: 'a', duration: 55, ops: [{ op: 'pixel', color: '#fff' }] }, { name: 'b', from: 'a', duration: 55 }] });
  assert.deepEqual(animationGIF(uneven).notes, ["2 of 2 frame durations were rounded to GIF's 10 ms steps (20 ms minimum): 55→60, 55→50."]);
  for (const [animation, options, where] of [['nope', {}, 'gif.animation'], ['idle', { background: 's' }, 'gif.background'], ['idle', { background: '#zzz' }, 'gif.background'], ['idle', { scale: 0 }, 'gif.scale'], ['idle', { dither: true }, 'gif.dither']]) assert.throws(() => animationGIF(project, animation, options), error => error instanceof PixelError && error.path === where, where);
});
test('CLI gif writes only the requested file and refuses to replace it', async t => {
  const tempRoot = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(tempRoot, 'pixelforge-gif-'));
  t.after(async () => { assert.ok(dir.startsWith(tempRoot + path.sep)); await rm(dir, { recursive: true, force: true }); });
  const out = path.join(dir, 'spirit.gif'), run = (...args) => spawnSync(process.execPath, ['bin/pixelforge.js', 'gif', 'examples/forest-spirit.json', ...args], { cwd: root, encoding: 'utf8' });
  const written = run('--out', out, '--animation', 'bob', '--scale', '4', '--background', '#17191d');
  assert.equal(written.status, 0, written.stderr);
  const report = JSON.parse(written.stdout);
  assert.deepEqual([report.ok, report.name, report.animation, report.width, report.frames, report.file, report.notes, report.data], [true, 'forest-spirit', 'bob', 96, 4, out, [], undefined]);
  assert.deepEqual(await readdir(dir), ['spirit.gif']);
  assert.equal(decodeGIF(await readFile(out)).frames.length, 4);
  assert.match(JSON.parse(run('--out', out).stderr).error, /already exists/);
  assert.equal(run('--out', out, '--force').status, 0);
  assert.match(JSON.parse(run('--out', path.join(dir, 'spirit.png')).stderr).error, /\.gif/);
  assert.equal(JSON.parse(run('--out', path.join(dir, 'x.gif'), '--animation', 'nope').stderr).path, 'gif.animation');
  assert.match(JSON.parse(run('--out', path.join(dir, 'x.gif'), '--grid').stderr).error, /--grid is not supported by gif/);
});
test('MCP pixel_render writes GIFs on request and leaves nothing behind when one is refused', async t => {
  const tempRoot = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(tempRoot, 'pixelforge-gif-mcp-'));
  t.after(async () => { assert.ok(dir.startsWith(tempRoot + path.sep)); await rm(dir, { recursive: true, force: true }); });
  const project = JSON.parse(await readFile(path.join(root, 'examples', 'forest-spirit.json'), 'utf8'));
  const call = (directory, args) => {
    const messages = [{ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-11-25' } }, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'pixel_render', arguments: args } }];
    const result = spawnSync(process.execPath, ['bin/pixelforge.js', 'mcp', '--out', directory], { cwd: root, input: messages.map(message => JSON.stringify(message)).join('\n') + '\n', encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout.trim().split('\n')[1]).result;
  };
  const rendered = call(path.join(dir, 'with'), { project, gif: { scale: 2 } });
  assert.ok(!rendered.isError, JSON.stringify(rendered));
  const info = JSON.parse(rendered.content[0].text);
  assert.deepEqual([info.gifs.directory, info.gifs.count, info.gifs.scale, info.gifs.width, info.gifs.files], ['gifs', 3, 2, 48, ['gifs/idle.gif', 'gifs/bob.gif', 'gifs/blink.gif']]);
  assert.ok(info.gifs.notes.some(note => note.startsWith('idle: ')));
  for (const file of info.gifs.files) assert.equal(decodeGIF(await readFile(path.join(info.directory, file))).width, 48);
  // The bundle itself is unchanged: GIFs sit beside it and are not counted as animations.
  assert.deepEqual([info.animations.count, info.files.filter(file => file.endsWith('.gif'))], [3, []]);
  assert.equal(JSON.parse(call(path.join(dir, 'without'), { project }).content[0].text).gifs, undefined);
  for (const gif of [{ scale: 99 }, { background: 's' }, 'yes']) {
    const refused = call(path.join(dir, 'refused'), { project, gif });
    assert.equal(refused.isError, true); assert.match(JSON.parse(refused.content[0].text).path, /^gif/);
  }
  // A refused GIF writes nothing at all: no revision and no half-made export folder.
  assert.deepEqual(await readdir(path.join(dir, 'refused')).catch(() => []), []);
  await assert.rejects(access(path.join(dir, 'refused', 'gifs')));
});
test('framesGIF times frames on the frame-rate grid, counts plays and keeps every colour of every frame', () => {
  // Three frames per colour set, 40 colours each and 120 in all; nothing is transparent.
  const frame = (shift, size = 8) => ({ width: size, height: 5, data: rgba(...Array.from({ length: size * 5 }, (_, i) => [i % 40 + shift, 200 - i % 40, shift, 255])) });
  const tick = framesGIF([frame(0), frame(0), frame(100)], { fps: { numerator: 30, denominator: 1 } });
  // 33.333 ms frames start at 0, 33.3 and 66.7 ms: 0, 30 and 70 ms after rounding, so the loop stays 100 ms long.
  assert.deepEqual([tick.delays, tick.duration, tick.frameMs, tick.fps.label, tick.loops], [{ 30: 2, 40: 1 }, 100, 33.333, '30', 0]);
  assert.match(tick.notes[0], /^At 30 fps a frame lasts 33\.333 ms, which GIF's 10 ms steps cannot hold: the delays are 30 ms × 2, 40 ms × 1, keeping every frame within 5 ms of its time and the loop at exactly 100 ms\.$/);
  const decoded = decodeGIF(tick.data);
  assert.deepEqual(decoded.frames.map(entry => entry.delay), [30, 40, 30]);
  const hex = ({ data }) => Array.from({ length: data.length / 4 }, (_, i) => Buffer.from(data.subarray(i * 4, i * 4 + 3)).toString('hex'));
  assert.deepEqual(decoded.frames.map(entry => entry.pixels), [hex(frame(0)), hex(frame(0)), hex(frame(100))]);
  // An unchanged frame stores one pixel; later frames store only what changed.
  assert.deepEqual(decoded.frames.map(entry => entry.rect), [[0, 0, 8, 5], [0, 0, 1, 1], [0, 0, 8, 5]]);
  // Plays: 0 loops for ever, 1 plays once (no loop extension), 3 is written as two repeats.
  for (const [loops, written] of [[0, 0], [1, null], [3, 2]]) assert.equal(decodeGIF(framesGIF([frame(0)], { fps: { numerator: 25, denominator: 1 }, loops }).data).loop, written);
  const many = framesGIF(Array.from({ length: 8 }, (_, i) => frame(i * 30)), { fps: { numerator: 25, denominator: 1 } }), table = decodeGIF(many.data);
  assert.deepEqual([many.colors, many.tables, many.colorsPerFrame, many.delays, table.shared, table.frames.every(entry => entry.local)], [320, 'per frame', { fewest: 40, most: 40 }, { 40: 8 }, false, true]);
  assert.deepEqual(table.frames.map(entry => entry.pixels), Array.from({ length: 8 }, (_, i) => hex(frame(i * 30))));
  assert.match(many.notes[0], /320 colours in all \(40 per frame\), more than one 256-colour table holds, so each frame carries its own table/);
  // 60 fps is faster than GIF plays; 29.97 cannot keep the loop's exact length.
  const fast = framesGIF([frame(0), frame(1), frame(2)], { fps: { numerator: 60, denominator: 1 } });
  assert.deepEqual([fast.delays, fast.duration], [{ 20: 3 }, 60]);
  assert.match(fast.notes[0], /1 of 3 delays were raised to 20 ms and the loop lasts 60 ms instead of 50 ms\. Use 50 fps or less\./);
  assert.match(framesGIF([frame(0), frame(1)], { fps: { numerator: 30000, denominator: 1001 } }).notes[0], /delays are 30 ms × 1, 40 ms × 1, .*the loop lasts 70 ms instead of 66\.733 ms/);
  for (const [options, where] of [[{}, 'gif.fps'], [{ fps: { numerator: 1, denominator: 61 } }, 'gif.fps'], [{ fps: { numerator: 25, denominator: 1 }, loops: -1 }, 'gif.loops'], [{ fps: { numerator: 25, denominator: 1 }, background: '#fff' }, 'gif.background']]) assert.throws(() => framesGIF([frame(0)], options), error => error instanceof PixelError && error.path === where, where);
  assert.throws(() => framesGIF([frame(0), { ...frame(0, 9), name: 'b.png' }], { fps: { numerator: 25, denominator: 1 } }), /b\.png is 9×5, but the first frame is 8×5/);
  assert.throws(() => framesGIF([], { fps: { numerator: 25, denominator: 1 } }), /at least one frame/);
});
test('numbered frames are read in number order, with gaps and other files reported and mixed sequences refused', () => {
  const found = numberedFrames(['shot_10.png', 'shot_9.png', 'shot_0001.png', 'sequence.json', 'poster.png', 'shot_2.PNG']);
  assert.deepEqual([found.prefix, found.frames.map(entry => entry.file), found.gaps, found.others], ['shot_', ['shot_0001.png', 'shot_2.PNG', 'shot_9.png', 'shot_10.png'], [[3, 8]], ['poster.png']]);
  assert.throws(() => numberedFrames(['a_1.png', 'b_1.png', 'b_2.png']), error => error.path === 'frames.prefix' && /2 numbered sequences: "a_" \(1\), "b_" \(2\); choose one with --prefix/.test(error.message));
  assert.deepEqual(numberedFrames(['a_1.png', 'b_1.png', 'b_2.png'], { prefix: 'b_' }).others, ['a_1.png']);
  assert.throws(() => numberedFrames(['a_1.png', 'a_01.png']), /a_01\.png and a_1\.png have the same number|a_1\.png and a_01\.png have the same number/);
  assert.throws(() => numberedFrames(['notes.txt', 'cover.png']), /no numbered PNG frames .*found cover\.png/);
  assert.throws(() => numberedFrames(['a_1.png'], { prefix: 'z' }), /no frames are named z<number>\.png/);
});
test('CLI gif-frames turns a folder of PNG frames into an exact GIF and writes only --out', async t => {
  const tempRoot = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(tempRoot, 'pixelforge-gif-frames-'));
  t.after(async () => { assert.ok(dir.startsWith(tempRoot + path.sep)); await rm(dir, { recursive: true, force: true }); });
  const frames = path.join(dir, 'frames'), out = path.join(dir, 'loop.gif');
  await mkdir(frames);
  // Four frames numbered 1, 2, 3 and 5, one pixel half transparent, a sidecar and a stray PNG.
  const pixels = [[RED, BLUE, CLEAR, [0, 255, 0, 200]], [BLUE, BLUE, RED, RED], [RED, [9, 9, 9, 100], BLUE, BLUE], [CLEAR, CLEAR, RED, BLUE]];
  for (const [i, number] of [1, 2, 3, 5].entries()) await writeFile(path.join(frames, `glow_${String(number).padStart(4, '0')}.png`), encodePNG(rgba(...pixels[i]), 2, 2));
  await writeFile(path.join(frames, 'sequence.json'), '{}');
  await writeFile(path.join(frames, 'cover.png'), encodePNG(rgba(RED), 1, 1));
  const run = (...args) => spawnSync(process.execPath, ['bin/pixelforge.js', 'gif-frames', ...args], { cwd: root, encoding: 'utf8' });
  const written = run(frames, '--fps', '12.5', '--out', out, '--loops', '2');
  assert.equal(written.status, 0, written.stderr);
  const report = JSON.parse(written.stdout);
  assert.deepEqual([report.frames, report.width, report.delays, report.duration, report.loops, report.colors, report.tables, report.transparent, report.partialAlpha, report.file, report.data], [4, 2, { 80: 4 }, 320, 2, 3, 'shared', true, 2, out, undefined]);
  assert.deepEqual([report.source.prefix, report.source.first, report.source.last, report.source.gaps], ['glow_', 'glow_0001.png', 'glow_0005.png', [[4, 4]]]);
  assert.match(report.notes[0], /^The numbering skips 4\. The GIF holds only the frames that exist/);
  assert.ok(report.notes.some(note => /2 partly transparent pixels/.test(note)) && report.notes.some(note => /1 other PNG file was left out: cover\.png/.test(note)));
  assert.deepEqual((await readdir(dir)).sort(), ['frames', 'loop.gif']);
  const decoded = decodeGIF(await readFile(out));
  assert.deepEqual([decoded.loop, decoded.frames.map(frame => frame.pixels)], [1, [['ff0000', '0000ff', 'clear', '00ff00'], ['0000ff', '0000ff', 'ff0000', 'ff0000'], ['ff0000', 'clear', '0000ff', '0000ff'], ['clear', 'clear', 'ff0000', '0000ff']]]);
  // A background blends partial alpha instead; existing files are kept unless --force.
  assert.match(JSON.parse(run(frames, '--fps', '25', '--out', out).stderr).error, /already exists/);
  const matte = JSON.parse(run(frames, '--fps', '25', '--out', out, '--background', '#000000', '--force').stdout);
  assert.deepEqual([matte.transparent, matte.partialAlpha, decodeGIF(await readFile(out)).frames[2].pixels[1]], [false, 0, '040404']);
  const refused = (args, pattern) => { const result = run(...args); assert.equal(result.status, 1); assert.match(JSON.parse(result.stderr).error, pattern); };
  refused([frames, '--out', path.join(dir, 'x.gif')], /requires --fps/);
  refused([frames, '--fps', '25', '--out', path.join(dir, 'x.png')], /--out <new\.gif>/);
  refused([path.join(dir, 'missing'), '--fps', '25', '--out', path.join(dir, 'x.gif')], /no folder at/);
  refused([frames, '--fps', '25', '--out', path.join(dir, 'x.gif'), '--loops', '1.5'], /gif\.loops/);
  refused([frames, '--fps', '25', '--out', path.join(dir, 'x.gif'), '--scale', '2'], /--scale is not supported by gif-frames/);
  await writeFile(path.join(frames, 'glow_0006.png'), encodePNG(rgba(...Array.from({ length: 300 }, (_, i) => [i & 255, i >> 8, 1, 255])), 300, 1));
  refused([frames, '--fps', '25', '--out', path.join(dir, 'x.gif')], /glow_0006\.png is 300×1, but the first frame is 2×2/);
  await writeFile(path.join(frames, 'glow_0006.png'), encodePNG(rgba(...Array.from({ length: 4 }, () => RED)), 2, 2));
  await writeFile(path.join(frames, 'other_0001.png'), encodePNG(rgba(...Array.from({ length: 300 }, () => RED)), 300, 1));
  refused([frames, '--fps', '25', '--out', path.join(dir, 'x.gif')], /2 numbered sequences: "glow_" \(5\), "other_" \(1\)/);
  await writeFile(path.join(frames, 'other_0002.png'), encodePNG(rgba(...Array.from({ length: 300 }, (_, i) => [i & 255, i >> 8, 1, 255])), 300, 1));
  refused([frames, '--fps', '25', '--out', path.join(dir, 'x.gif'), '--prefix', 'other_'], /other_0002\.png uses 300 colours; a GIF frame holds 256 and PixelForge does not quantize/);
  assert.equal(run(frames, '--fps', '25', '--out', path.join(dir, 'x.gif'), '--prefix', 'glow_').status, 0);
});
