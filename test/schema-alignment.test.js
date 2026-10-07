import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderProject, PixelError } from '../src/core.js';
import { prepareScene } from '../src/scene.js';

const read = async file => JSON.parse(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'));
// Runs `attempt` with one field present and reports whether the renderer rejected that field as unknown.
const unknown = (attempt, where) => { try { attempt(); return false; } catch (error) { assert.ok(error instanceof PixelError, String(error)); return [`${where}: unknown field`, `${where}: unknown or null field`].includes(error.message); } };

test('every operation field the schema lists is one the renderer accepts, and no others', async () => {
  const schema = await read('schema.json');
  for (const op of schema.$defs.op.oneOf) {
    const name = op.properties.op.const, keys = Object.keys(op.properties).filter(key => key !== 'op');
    const draw = (key, value = 0) => renderProject({ version: 1, name: 'a', width: 2, height: 2, palette: { k: '#000' }, frames: [{ name: 'f', ops: [{ op: name, [key]: value }] }] });
    for (const key of keys) assert.equal(unknown(() => draw(key), `project.frames[0].ops[0].${key}`), false, `${name}.${key} is in the schema but the renderer rejects it`);
    assert.equal(unknown(() => draw('notAField'), 'project.frames[0].ops[0].notAField'), true, name);
  }
  assert.deepEqual(Object.keys(schema.properties).sort(), ['$schema', 'anchor', 'animations', 'background', 'frames', 'height', 'name', 'palette', 'ramps', 'sheet', 'symbols', 'version', 'width']);
});

test('scene fields in the schema match what prepareScene accepts', async () => {
  const schema = await read('scene.schema.json');
  const tiny = { version: 1, name: 't', width: 1, height: 1, palette: { k: '#000' }, frames: [{ name: 'f', ops: [{ op: 'pixel', color: 'k' }] }] };
  const scene = extra => ({ format: 'pixelforge-scene', version: 1, name: 's', width: 2, height: 2, assets: { t: tiny }, instances: [], ...extra });
  const instance = schema.properties.instances.items, lighting = schema.properties.lighting, tilemap = instance.properties.tilemap, cue = instance.properties.sequence.items;
  for (const key of Object.keys(schema.properties)) assert.equal(unknown(() => prepareScene({ ...scene(), [key]: scene()[key] ?? 0 }), `scene.${key}`), false, `scene.${key}`);
  for (const key of Object.keys(instance.properties)) assert.equal(unknown(() => prepareScene(scene({ instances: [{ asset: 't', at: [0, 0], [key]: 0 }] })), `scene.instances[0].${key}`), false, `instance.${key}`);
  for (const key of Object.keys(lighting.properties)) assert.equal(unknown(() => prepareScene(scene({ lighting: { [key]: 0 } })), `scene.lighting.${key}`), false, `lighting.${key}`);
  for (const key of Object.keys(tilemap.properties)) assert.equal(unknown(() => prepareScene(scene({ instances: [{ asset: 't', at: [0, 0], tilemap: { rows: ['k'], legend: { k: 'f' }, [key]: 0 } }] })), `scene.instances[0].tilemap.${key}`), false, `tilemap.${key}`);
  for (const key of Object.keys(cue.properties)) assert.equal(unknown(() => prepareScene(scene({ instances: [{ asset: 't', at: [0, 0], sequence: [{ time: 0, [key]: 0 }] }] })), `scene.instances[0].sequence[0].${key}`), false, `cue.${key}`);
  assert.equal(unknown(() => prepareScene(scene({ instances: [{ asset: 't', at: [0, 0], notAField: 0 }] })), 'scene.instances[0].notAField'), true);
});
