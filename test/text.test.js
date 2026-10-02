import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderProject, PixelError } from '../src/core.js';
import { layoutText, measureText, FONT_CHARACTERS, FONT_HEIGHT, FONT_CAP_HEIGHT } from '../src/font.js';
import { STUDIO_PATHS } from '../src/server.js';
import { createSceneBundle } from '../src/scene-export.js';

const root = fileURLToPath(new URL('../', import.meta.url));
// Renders one frame of ops on a w × h canvas and returns it as rows of "#" (drawn) and "." (empty).
const draw = (w, h, ops, extra = {}) => {
  const project = renderProject({ version: 1, name: 'probe', width: w, height: h, palette: { k: '#000000', w: '#ffffff' }, frames: [{ name: 'a', ops }], ...extra }), { data } = project.frames[0];
  return { project, rows: Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => data[(y * w + x) * 4 + 3] ? '#' : '.').join('')) };
};

test('the built-in font covers printable ASCII with tabular digits', () => {
  assert.equal(FONT_CHARACTERS, Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join(''));
  assert.deepEqual([FONT_HEIGHT, FONT_CAP_HEIGHT], [8, 7]);
  for (const character of FONT_CHARACTERS) {
    const { width, height, rows } = layoutText(character);
    assert.ok(height === 8 && rows.length === 8 && width >= 1 && width <= 5 && rows.every(row => row.length === width), JSON.stringify(character));
    // Every glyph but the space has ink, and is trimmed to it on both sides.
    if (character === ' ') { assert.equal(width, 3); continue; }
    assert.ok(rows.some(row => row.includes('#')), `${character} is blank`);
    if (!/\d/.test(character)) assert.ok(rows.some(row => row[0] === '#') && rows.some(row => row.at(-1) === '#'), `${character} has an empty edge column`);
  }
  assert.deepEqual([...'0123456789'].map(digit => measureText(digit).width), Array(10).fill(5));
  // Capitals stand on the baseline (row 6); only descenders and the underscore use the row below it.
  for (const character of 'ABCXYZ0189') assert.equal(layoutText(character).rows[7].includes('#'), false, character);
  assert.deepEqual([...FONT_CHARACTERS].filter(character => layoutText(character).rows[7].includes('#')).join(''), ',;_gjpqy');
});
test('text is laid out with glyph spacing, line height and alignment', () => {
  assert.deepEqual(layoutText('i.').rows, ['.#...', '.....', '##...', '.#...', '.#...', '.#...', '###.#', '.....']);
  assert.deepEqual(measureText('Hi'), { width: 9, height: 8, lines: [{ text: 'Hi', width: 9 }] });
  assert.deepEqual(measureText('A\nBB'), { width: 11, height: 18, lines: [{ text: 'A', width: 5 }, { text: 'BB', width: 11 }] });
  assert.deepEqual([measureText('AB', { spacing: 0 }).width, measureText('AB', { spacing: 4 }).width, measureText('A\nB', { lineHeight: 20 }).height, measureText('a b').width], [10, 14, 28, 15]);
  // A shorter line sits left, in the middle or right of the block.
  const first = align => layoutText('.\nAAA', { align }).rows[6];
  assert.deepEqual([first('left'), first('center'), first('right')], ['#................', '........#........', '................#']);
  assert.deepEqual(measureText('\n'), { width: 1, height: 18, lines: [{ text: '', width: 0 }, { text: '', width: 0 }] });
  assert.throws(() => layoutText('né'), /no glyph for "é"/);
});
test('the text operation draws exact glyph pixels, placed by align and changed by the usual transforms', () => {
  // "i." at 1,1: a three-wide i, one pixel of spacing, and a full stop on the baseline.
  assert.deepEqual(draw(7, 10, [{ op: 'text', x: 1, y: 1, text: 'i.', color: 'w' }]).rows, ['.......', '..#....', '.......', '.##....', '..#....', '..#....', '..#....', '.###.#.', '.......', '.......']);
  // x is the left edge, the centre or the right edge of the block. "II" is 7 wide: 3 + 1 + 3.
  const top = align => draw(20, 8, [{ op: 'text', x: 10, y: 0, text: 'II', color: 'w', ...(align && { align }) }]).rows[0];
  assert.deepEqual([top(), top('center'), top('right')], ['..........###.###...', '.......###.###......', '...###.###..........']);
  // Scale enlarges every glyph pixel; rotation and flips work as for grids.
  assert.deepEqual(draw(4, 16, [{ op: 'text', x: 0, y: 0, text: '!', color: 'w', scale: 2 }]).rows.map(row => row.slice(0, 2)), ['##', '##', '##', '##', '##', '##', '##', '##', '##', '##', '..', '..', '##', '##', '..', '..']);
  assert.deepEqual(draw(8, 2, [{ op: 'text', x: 0, y: 0, text: '!', color: 'w', rotate: 90 }]).rows, ['.#.#####', '........']);
  assert.deepEqual(draw(5, 8, [{ op: 'text', x: 0, y: 0, text: 'L', color: 'w', flipX: true }]).rows.slice(5, 7), ['....#', '#####']);
  // Colours come from the palette or a hex value; layers and several lines work like any other drawing.
  const { project, rows } = draw(11, 18, [], { frames: [{ name: 'a', layers: [{ name: 'label', ops: [{ op: 'text', x: 0, y: 0, text: 'A\nBB', color: '#ff000080' }] }] }] });
  assert.deepEqual([rows[0], rows[10], [...project.frames[0].data.subarray(4, 8)]], ['.###.......', '####..####.', [255, 0, 0, 128]]);
  // Text that runs off the canvas is clipped and reported at its operation, like every other overhang.
  assert.deepEqual(draw(6, 8, [{ op: 'text', x: 0, y: 0, text: 'WW', color: 'w' }]).project.clipping.map(entry => entry.path), ['project.frames[0].ops[0]']);
});
test('text errors name the field and the character', () => {
  for (const [op, where, message] of [
    [{ text: 'café', color: 'w' }, 'text', /no glyph for "é"; the built-in font draws printable ASCII/], [{ text: '', color: 'w' }, 'text', /1–512 characters/], [{ text: 'x'.repeat(513), color: 'w' }, 'text', /1–512 characters/],
    [{ text: 7, color: 'w' }, 'text', /1–512 characters/], [{ text: 'a\n'.repeat(64), color: 'w' }, 'text', /at most 64 lines/], [{ text: 'a', color: 'w', align: 'middle' }, 'align', /left, center or right/],
    [{ text: 'a', color: 'w', spacing: 17 }, 'spacing', /0 to 16/], [{ text: 'a', color: 'w', lineHeight: 0 }, 'lineHeight', /1 to 64/], [{ text: 'a', color: 'nope' }, 'color', /unknown color/],
    [{ text: 'a' }, 'color', /palette name or hex/], [{ text: 'a', color: 'w', font: 'tiny' }, 'font', /unknown field/], [{ text: 'a', color: 'w', scale: 17 }, 'scale', /1 to 16/]
  ]) assert.throws(() => draw(8, 8, [{ op: 'text', x: 0, y: 0, ...op }]), error => error instanceof PixelError && error.path === `project.frames[0].ops[0].${where}` && message.test(error.message), `${where}: ${JSON.stringify(op).slice(0, 60)}`);
});
test('the schema describes the text operation the renderer accepts', async () => {
  for (const file of ['schema.json', 'poses.schema.json', 'scene.schema.json', 'autotile.schema.json', 'fx.schema.json']) {
    const text = JSON.parse(await readFile(path.join(root, file), 'utf8')).$defs.op.oneOf.find(op => op.properties.op.const === 'text');
    assert.deepEqual([Object.keys(text.properties).sort(), text.required, text.additionalProperties], [['align', 'color', 'flipX', 'flipY', 'lineHeight', 'op', 'rotate', 'scale', 'spacing', 'text', 'x', 'y'], ['op', 'text', 'color'], false], file);
    assert.deepEqual([text.properties.text.maxLength, text.properties.align.enum, text.properties.spacing.maximum, text.properties.lineHeight.maximum], [512, ['left', 'center', 'right'], 16, 64], file);
  }
});
test('every module the browser imports is served by the studio and packed with scene exports', async () => {
  // The renderer gained a module for the font; a page that imports the renderer needs that module too.
  const imports = async file => [...(await readFile(path.join(root, file), 'utf8')).matchAll(/^import [^;]*? from '([^']+)';/gm)].map(match => match[1]);
  const served = { '/core.js': 'src/core.js', '/craft.js': 'src/craft.js', '/font.js': 'src/font.js', '/gif.js': 'src/gif.js', '/authoring.js': 'src/authoring.js', '/autotile.js': 'src/autotile.js', '/scene.js': 'src/scene.js', '/studio.js': 'studio/studio.js', '/scene-player.js': 'studio/scene-player.js', '/draft.js': 'studio/draft.js' };
  for (const [route, file] of Object.entries(served)) {
    assert.ok(STUDIO_PATHS.includes(route), `${route} is not served`);
    for (const specifier of await imports(file)) assert.ok(STUDIO_PATHS.includes(`/${specifier.replace(/^\.?\//, '')}`), `${file} imports ${specifier}, which the studio does not serve`);
  }
  const scene = JSON.parse(await readFile(path.join(root, 'examples', 'quality', 'stride.scene.json'), 'utf8')), { files } = await createSceneBundle(scene);
  for (const file of [...files.keys()].filter(name => name.endsWith('.js'))) for (const [, specifier] of files.get(file).toString().matchAll(/^import [^;]*? from '([^']+)';/gm)) assert.ok(files.has(specifier.replace(/^\.\//, '')), `the scene bundle's ${file} imports ${specifier}, which is not in the bundle`);
});
