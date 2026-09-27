import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderProject, inspectProject } from '../src/core.js';

const pixel = (sheet, x, y) => [...sheet.data.slice((y * sheet.width + x) * 4, (y * sheet.width + x) * 4 + 4)];
test('grids read pixels back as palette keys, transparency and one shared legend', () => {
  const project = renderProject({ version: 1, name: 'probe', width: 3, height: 2, palette: { r: '#f00', 0: '#0f0', gold: '#fc0' }, frames: [
    { name: 'a', ops: [{ op: 'pixel', color: 'r' }, { op: 'pixel', x: 1, color: '0' }, { op: 'pixel', x: 2, color: 'gold' }, { op: 'pixel', y: 1, color: '#00f' }, { op: 'pixel', x: 1, y: 1, color: '#f008' }] },
    { name: 'b', from: 'a', ops: [{ op: 'pixel', x: 2, y: 1, color: '#00f' }] }
  ], animations: { loop: { frames: ['a', 'b', 'a'] } } });
  const view = inspectProject(project, { animation: 'loop', grid: true });
  assert.deepEqual(view.cells.map(c => c.frame), ['a', 'b', 'a']);
  // Legend symbols skip the palette's own "0" key; repeated frames get one grid.
  assert.deepEqual(view.grids, [{ frame: 'a', rows: ['r01', '23.'] }, { frame: 'b', rows: ['r01', '232'] }]);
  assert.deepEqual(view.legend, { 1: { color: '#ffcc00', palette: 'gold' }, 2: { color: '#0000ff' }, 3: { color: '#ff000088' } });
  // Symbols belong to the revision, not the selection: frame b alone still reads #00f as 2.
  const alone = inspectProject(project, { frames: ['b'], region: { x: 0, y: 1, w: 3, h: 1 }, grid: true });
  assert.deepEqual([alone.grids[0].rows, alone.legend], [['232'], { 2: { color: '#0000ff' }, 3: { color: '#ff000088' } }]);
});
test('inspection keeps frame order, crops regions and rejects bad options with paths', () => {
  const project = renderProject({ version: 1, name: 'probe', width: 4, height: 3, palette: { k: '#000' }, frames: [{ name: 'a', duration: 80, ops: [{ op: 'pixel', x: 3, y: 2, color: 'k' }] }, { name: 'b' }] });
  const view = inspectProject(project, { frames: ['b', 'a'], region: { x: 2, y: 1, w: 2, h: 2 }, grid: true });
  assert.deepEqual(view.cells, [{ frame: 'b', duration: 100 }, { frame: 'a', duration: 80 }]);
  assert.deepEqual(view.grids.map(g => g.rows), [['..', '..'], ['..', '.k']]);
  for (const [options, message] of [
    [{ frames: ['a'], animation: 'default' }, /not both/], [{ frames: ['missing'] }, /inspect\.frames\[0\]: unknown frame/],
    [{ animation: 'missing' }, /inspect\.animation/], [{ region: { x: 3, y: 0, w: 2, h: 1 } }, /inspect\.region\.w/],
    [{ region: { x: 0, y: 0, w: 1 } }, /inspect\.region\.h/], [{ scale: 17 }, /inspect\.scale/],
    [{ zoom: 2 }, /inspect\.zoom: unknown field/], [{ grid: null }, /null is not supported/], [{ background: 'nope' }, /inspect\.background/]
  ]) assert.throws(() => inspectProject(project, options), message);
});
test('contact sheet scales cells exactly over a checkerboard inside dark gutters', () => {
  const project = renderProject({ version: 1, name: 'probe', width: 2, height: 1, palette: { r: '#f00' }, frames: [{ name: 'a', ops: [{ op: 'pixel', color: 'r' }] }, { name: 'b', ops: [{ op: 'pixel', x: 1, color: '#f008' }] }] });
  const { data, ...layout } = inspectProject(project, { scale: 3 }).sheet, sheet = { data, ...layout };
  assert.deepEqual(layout, { columns: 2, rows: 1, scale: 3, gap: 3, width: 21, height: 9 });
  assert.deepEqual(pixel(sheet, 0, 0), [23, 25, 29, 255]);
  assert.deepEqual(pixel(sheet, 3, 3), [255, 0, 0, 255]); assert.deepEqual(pixel(sheet, 5, 5), [255, 0, 0, 255]);
  assert.deepEqual(pixel(sheet, 6, 3), [143, 145, 151, 255]);
  assert.deepEqual(pixel(sheet, 15, 3), [203, 68, 70, 255]);
  const plain = inspectProject(project, { scale: 3, background: 'transparent' }).sheet;
  assert.deepEqual(pixel(plain, 15, 3), [255, 0, 0, 136]); assert.deepEqual(pixel(plain, 12, 3), [0, 0, 0, 0]);
  assert.deepEqual(pixel(inspectProject(project, { scale: 3, background: 'r' }).sheet, 12, 3), [255, 0, 0, 255]);
});
test('automatic layout picks the largest readable scale and enforces size limits', () => {
  const spirit = renderProject(JSON.parse(readFileSync(new URL('../examples/forest-spirit.json', import.meta.url), 'utf8')));
  const { columns, rows, scale, width, height } = inspectProject(spirit).sheet;
  assert.deepEqual({ columns, rows, scale, width, height }, { columns: 3, rows: 2, scale: 10, width: 760, height: 510 });
  assert.equal(inspectProject(spirit, { animation: 'idle', region: { x: 7, y: 8, w: 10, h: 6 } }).sheet.scale, 16);
  const big = renderProject({ version: 1, name: 'big', width: 256, height: 256, frames: [{ name: 'a' }] });
  assert.throws(() => inspectProject(big, { scale: 16 }), /4096-pixel limit/);
  assert.throws(() => inspectProject(big, { grid: true }), /inspect\.grid: grids are limited/);
  assert.equal(inspectProject(big, { grid: true, region: { x: 0, y: 0, w: 128, h: 128 } }).grids[0].rows.length, 128);
});
