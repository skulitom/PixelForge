import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import { readFile, writeFile, readdir, mkdtemp, rm, access } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMCP } from '../src/mcp.js';
import { startStudio } from '../src/server.js';
import { renderProject, inspectProject } from '../src/core.js';
import { encodePNG } from '../src/png.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const tiny = { version: 1, name: 'dot', width: 1, height: 1, frames: [{ name: 'idle', ops: [{ op: 'pixel', color: '#fff' }] }] };
const strip = { version: 1, name: 'strip', width: 12, height: 2, palette: { k: '#000' }, frames: [{ name: 'a', ops: [{ op: 'pixel', x: 11, y: 1, color: 'k' }] }, { name: 'b' }] };
function runMCP(directory, calls) {
  const messages = [{ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-11-25' } }, ...calls.map(([name, args], i) => ({ jsonrpc: '2.0', id: i + 1, method: 'tools/call', params: { name, arguments: args } }))];
  const result = spawnSync(process.execPath, ['bin/pixelforge.js', 'mcp', '--out', directory], { cwd: root, input: messages.map(m => JSON.stringify(m)).join('\n') + '\n', encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim().split('\n').slice(1).map(line => JSON.parse(line).result);
}
test('CLI consumes stdin, emits machine-readable diagnostics and handles unknown flags', () => {
  const result = spawnSync(process.execPath, ['bin/pixelforge.js','validate','-'], { cwd: root, input: JSON.stringify(tiny), encoding: 'utf8' });
  assert.equal(result.status, 0); assert.equal(JSON.parse(result.stdout).frames, 1);
  const bad = spawnSync(process.execPath, ['bin/pixelforge.js','validate','-'], { cwd: root, input: '{', encoding: 'utf8' });
  assert.equal(bad.status, 1); assert.equal(JSON.parse(bad.stderr).ok, false);
  const flags = spawnSync(process.execPath, ['bin/pixelforge.js','validate','-','--typo'], { cwd: root, encoding: 'utf8' });
  assert.equal(flags.status, 1); assert.match(JSON.parse(flags.stderr).error, /Unknown option/);
});
test('MCP handshake, discovery, help, errors and render work over stdio', async t => {
  const tempRoot = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(tempRoot, 'pixelforge-mcp-'));
  t.after(async () => { assert.ok(dir.startsWith(tempRoot + path.sep)); await rm(dir, { recursive: true, force: true }); });
  const input = new PassThrough(), output = new PassThrough(); let text = '';
  output.on('data', chunk => { text += chunk; });
  const running = startMCP({ input, output, directory: dir });
  const messages = [
    { id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
    { method: 'notifications/initialized' },
    { id: 2, method: 'tools/list' },
    { id: 3, method: 'tools/call', params: { name: 'pixel_validate', arguments: { project: tiny } } },
    { id: 4, method: 'tools/call', params: { name: 'pixel_render', arguments: { project: tiny } } },
    { id: 5, method: 'tools/call', params: { name: 'pixel_validate', arguments: { project: {} } } },
    { id: 6, method: 'tools/call', params: { name: 'pixel_help' } },
    { id: 7, method: 'bogus' }
  ];
  for (const message of messages) input.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  input.end('not json\n'); await running;
  const results = text.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(results.length, 8); assert.equal(results[0].result.protocolVersion, '2025-11-25');
  assert.equal(results[1].result.tools.length, 5); assert.equal(JSON.parse(results[2].result.content[0].text).ok, true);
  const render = results[3].result;
  assert.equal(render.content[1].mimeType, 'image/png');
  const written = JSON.parse(render.content[0].text); assert.ok(written.directory.startsWith(dir + path.sep));
  assert.ok((await readFile(written.files[0])).length > 0);
  assert.equal(results[4].result.isError, true); assert.match(results[5].result.content[0].text, /PixelForge/);
  assert.equal(results[6].error.code, -32601); assert.equal(results[7].error.code, -32700);
});
test('MCP pixel_inspect returns a contact sheet and ruled grids, saving only its revision', async t => {
  const tempRoot = path.resolve(os.tmpdir()), parent = await mkdtemp(path.join(tempRoot, 'pixelforge-inspect-')), dir = path.join(parent, 'renders');
  t.after(async () => { assert.ok(parent.startsWith(tempRoot + path.sep)); await rm(parent, { recursive: true, force: true }); });
  const input = new PassThrough(), output = new PassThrough(); let text = '';
  output.on('data', chunk => { text += chunk; });
  const running = startMCP({ input, output, directory: dir });
  const call = (id, args) => ({ id, method: 'tools/call', params: { name: 'pixel_inspect', arguments: args } });
  for (const message of [
    { id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
    call(2, { project: strip, grid: true }), call(3, { project: strip, zoom: 2 }), call(4, { project: strip, frames: ['missing'] })
  ]) input.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  input.end(); await running;
  const [, inspect, extra, missing] = text.trim().split('\n').map(line => JSON.parse(line));
  const [summary, image, grids] = inspect.result.content, info = JSON.parse(summary.text);
  assert.deepEqual(info.cells, [{ frame: 'a', duration: 100 }, { frame: 'b', duration: 100 }]);
  assert.equal(image.mimeType, 'image/png');
  assert.equal(Buffer.from(image.data, 'base64').readUInt32BE(16), info.sheet.width);
  assert.match(grids.text, /^ {13}11$/m); assert.match(grids.text, /^ {3}012345678901$/m); assert.match(grids.text, /^1 {2}\.{11}k$/m);
  assert.equal(extra.error.code, -32602);
  assert.equal(missing.result.isError, true); assert.equal(JSON.parse(missing.result.content[0].text).path, 'inspect.frames[0]');
  assert.deepEqual(await readdir(dir), ['.revisions']);
  assert.deepEqual(await readdir(path.join(dir, '.revisions')), [`${info.revision}.json`]);
});
test('MCP revisions let pixel_patch edit, compare and export without resending the recipe', async t => {
  const tempRoot = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(tempRoot, 'pixelforge-patch-'));
  t.after(async () => { assert.ok(dir.startsWith(tempRoot + path.sep)); await rm(dir, { recursive: true, force: true }); });
  const input = new PassThrough(), output = new PassThrough(), waiting = new Map();
  let buffer = '', next = 0;
  output.on('data', chunk => {
    buffer += chunk;
    for (let end; (end = buffer.indexOf('\n')) !== -1; buffer = buffer.slice(end + 1)) { const message = JSON.parse(buffer.slice(0, end)); waiting.get(message.id)(message); }
  });
  const running = startMCP({ input, output, directory: dir });
  const request = (method, params) => new Promise(resolve => { waiting.set(++next, resolve); input.write(JSON.stringify({ jsonrpc: '2.0', id: next, method, params }) + '\n'); });
  const call = async (name, args) => (await request('tools/call', { name, arguments: args })).result;
  const failure = async (name, args) => { const result = await call(name, args); assert.equal(result.isError, true); return JSON.parse(result.content[0].text); };
  await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  const { revision: base } = JSON.parse((await call('pixel_validate', { project: strip })).content[0].text);
  const patched = await call('pixel_patch', { revision: base, changes: [{ set: 'frames[a].ops[0].x', value: 10 }, { set: 'frames[b].duration', value: 150 }] });
  const report = JSON.parse(patched.content[0].text);
  assert.equal(report.base, base); assert.notEqual(report.revision, base);
  assert.deepEqual(report.edits, [{ set: 'frames[a].ops[0].x', at: 'frames[0].ops[0].x', before: 11 }, { set: 'frames[b].duration', at: 'frames[1].duration', created: true }]);
  assert.deepEqual(report.frames, { changed: [{ frame: 'a', pixels: 2, box: { x: 10, y: 1, w: 2, h: 1 }, changes: [{ x: 10, y: 1, from: '.', to: 'k' }, { x: 11, y: 1, from: 'k', to: '.' }] }], unchanged: ['b'], durations: [{ frame: 'b', from: 100, to: 150 }] });
  assert.equal(patched.content[1].mimeType, 'image/png');
  const rendered = JSON.parse((await call('pixel_render', { revision: report.revision })).content[0].text);
  const saved = JSON.parse(await readFile(rendered.files.find(file => file.endsWith('.pixel.json')), 'utf8'));
  assert.deepEqual([rendered.revision, saved.frames[0].ops[0].x], [report.revision, 10]);
  assert.equal(JSON.parse((await call('pixel_inspect', { revision: base })).content[0].text).revision, base);
  assert.equal((await failure('pixel_patch', { revision: 'missing', changes: [{ remove: 'frames[b]' }] })).path, 'revision');
  assert.equal((await failure('pixel_validate', { project: strip, revision: base })).path, 'arguments');
  assert.equal((await failure('pixel_patch', { revision: base, changes: [{ set: 'frames[a].duration', value: 0 }] })).path, 'project.frames[0].duration');
  assert.equal((await failure('pixel_patch', { revision: base, changes: [{ set: 'frames[zzz].duration', value: 1 }] })).path, 'changes[0].set');
  input.end(); await running;
});

test('MCP revisions from validate, inspect and paint survive process restarts before export', async t => {
  const tempRoot = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(tempRoot, 'pixelforge-restart-'));
  t.after(async () => { assert.ok(dir.startsWith(tempRoot + path.sep)); await rm(dir, { recursive: true, force: true }); });
  const changes = [{ paint: 'frames[a]', value: [{ x: 11, y: 1, color: 'transparent' }, { x: 10, y: 1, color: 'k' }] }];
  const initial = runMCP(dir, [['pixel_validate', { project: tiny }], ['pixel_inspect', { project: strip }], ['pixel_patch', { project: strip, changes }]]);
  const summaries = initial.map(response => { assert.ok(!response.isError); return JSON.parse(response.content[0].text); });
  const ids = summaries.map(summary => summary.revision);
  assert.deepEqual(await readdir(dir), ['.revisions']);
  const restarted = runMCP(dir, [...ids.map(revision => ['pixel_inspect', { revision, grid: true }]), ['pixel_render', { revision: ids[2] }]]);
  restarted.forEach((result, i) => { assert.ok(!result.isError, JSON.stringify(result)); assert.equal(JSON.parse(result.content[0].text).revision, ids[Math.min(i, 2)]); });
  const rendered = JSON.parse(restarted[3].content[0].text), saved = JSON.parse(await readFile(rendered.files.find(file => file.endsWith('.pixel.json')), 'utf8'));
  assert.deepEqual(saved.frames[0].pixels, changes[0].value);
  assert.deepEqual(rendered.preview.cells, [{ frame: 'a', duration: 100 }, { frame: 'b', duration: 100 }]);
  assert.match(restarted[2].content[2].text, /k\.$/m);
  const third = runMCP(dir, [['pixel_validate', { revision: rendered.revision }], ['pixel_validate', { revision: ids[1] }]]);
  assert.ok(third.every(result => !result.isError));
});

test('MCP render previews every frame or an animation in playback order, with exact timing and cells', async t => {
  const tempRoot = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(tempRoot, 'pixelforge-preview-'));
  t.after(async () => { assert.ok(dir.startsWith(tempRoot + path.sep)); await rm(dir, { recursive: true, force: true }); });
  const project = { ...tiny, name: 'sequence', frames: ['#f00', '#0f0', '#00f'].map((color, i) => ({ name: `pose${i}`, duration: 70 + i * 30, ops: [{ op: 'pixel', color }] })), animations: { idle: { frames: ['pose0', 'pose1', 'pose2'], direction: 'pingpong', loop: false } } };
  const results = runMCP(dir, [['pixel_render', { project }], ['pixel_render', { project, animation: 'idle' }]]);
  for (const [i, result] of results.entries()) {
    assert.ok(!result.isError, JSON.stringify(result));
    const info = JSON.parse(result.content[0].text), view = inspectProject(renderProject(project), i ? { animation: 'idle' } : {});
    assert.deepEqual(info.preview.cells.map(c => c.frame), i ? ['pose0', 'pose1', 'pose2', 'pose1'] : ['pose0', 'pose1', 'pose2']);
    assert.deepEqual(info.preview.cells.map(c => c.duration), i ? [70, 100, 130, 100] : [70, 100, 130]);
    assert.deepEqual(Buffer.from(result.content[1].data, 'base64'), encodePNG(view.sheet.data, view.sheet.width, view.sheet.height));
    assert.equal(info.preview.sheet.width, view.sheet.width);
    assert.ok(info.files.some(file => file.endsWith(path.join('animations', 'idle.png'))));
  }
  assert.notEqual(JSON.parse(results[0].content[0].text).directory, JSON.parse(results[1].content[0].text).directory);
  const invalidDir = path.join(dir, 'invalid');
  assert.equal(runMCP(invalidDir, [['pixel_render', { project, animation: 'missing' }]])[0].isError, true);
  await assert.rejects(access(invalidDir), { code: 'ENOENT' });
});
test('CLI patch previews by default and writes only the requested recipe and image', async t => {
  const tempRoot = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(tempRoot, 'pixelforge-patch-'));
  t.after(async () => { assert.ok(dir.startsWith(tempRoot + path.sep)); await rm(dir, { recursive: true, force: true }); });
  const source = path.join(dir, 'strip.json'), out = path.join(dir, 'strip-v2.json'), image = path.join(dir, 'diff.png');
  await writeFile(source, JSON.stringify(strip));
  const run = (...args) => spawnSync(process.execPath, ['bin/pixelforge.js', 'patch', source, '--changes', '-', ...args], { cwd: root, input: JSON.stringify([{ set: 'frames[a].ops[0].x', value: 10 }]), encoding: 'utf8' });
  const preview = run();
  assert.equal(preview.status, 0); assert.equal(JSON.parse(preview.stdout).frames.changed[0].pixels, 2);
  assert.deepEqual(await readdir(dir), ['strip.json']);
  const written = JSON.parse(run('--out', out, '--image', image).stdout);
  assert.deepEqual([written.recipe, written.image.file], [out, image]);
  assert.equal(JSON.parse(await readFile(out, 'utf8')).frames[0].ops[0].x, 10);
  assert.equal((await readFile(image)).toString('latin1', 1, 4), 'PNG');
  assert.match(JSON.parse(run('--out', out).stderr).error, /already exists/);
  assert.match(JSON.parse(run('--out', path.join(dir, 'next.txt')).stderr).error, /\.json/);
  const both = spawnSync(process.execPath, ['bin/pixelforge.js', 'patch', '-', '--changes', '-'], { cwd: root, input: '[]', encoding: 'utf8' });
  assert.match(JSON.parse(both.stderr).error, /stdin/);
});
test('CLI inspect prints cells and grids, and writes a PNG only when asked', async t => {
  const tempRoot = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(tempRoot, 'pixelforge-inspect-'));
  t.after(async () => { assert.ok(dir.startsWith(tempRoot + path.sep)); await rm(dir, { recursive: true, force: true }); });
  const run = (...args) => spawnSync(process.execPath, ['bin/pixelforge.js', 'inspect', '-', ...args], { cwd: root, input: JSON.stringify(strip), encoding: 'utf8' });
  const read = run('--grid', '--region', '10,0,2,2', '--frames', 'a');
  assert.equal(read.status, 0);
  const result = JSON.parse(read.stdout);
  assert.deepEqual(result.grids, [{ frame: 'a', rows: ['..', '.k'] }]); assert.equal(result.image, undefined);
  const file = path.join(dir, 'nested', 'sheet.png'), written = run('--out', file);
  assert.equal(written.status, 0); assert.equal(JSON.parse(written.stdout).image, file);
  assert.equal((await readFile(file)).readUInt32BE(16), JSON.parse(written.stdout).sheet.width);
  assert.match(JSON.parse(run('--out', file).stderr).error, /already exists/);
  assert.equal(run('--out', file, '--force').status, 0);
  assert.match(JSON.parse(run('--out', path.join(dir, 'sheet.txt')).stderr).error, /\.png/);
  assert.match(JSON.parse(run('--region', '1,2').stderr).error, /x,y,w,h/);
  assert.equal(JSON.parse(run('--frames', 'missing').stderr).path, 'inspect.frames[0]');
});
test('studio serves only its assets and exports ZIP over same-origin requests', async t => {
  const server = await startStudio({ port: 0, quiet: true });
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base)).status, 200);
  assert.equal((await fetch(base + '/package.json')).status, 404);
  const foreignHost = await new Promise((resolve, reject) => {
    const req = http.get(base, { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject);
  });
  assert.equal(foreignHost, 403);
  assert.equal((await fetch(base + '/api/export', { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: JSON.stringify(tiny) })).status, 403);
  const res = await fetch(base + '/api/export', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(tiny) });
  assert.equal(res.status, 200); assert.equal(res.headers.get('content-type'), 'application/zip');
  assert.equal(Buffer.from(await res.arrayBuffer()).readUInt32LE(0), 0x04034b50);
  const bad = await fetch(base + '/api/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(bad.status, 400); assert.match((await bad.json()).error, /version/);
});
