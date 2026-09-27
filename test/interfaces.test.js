import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import { readFile, mkdtemp, rm, access } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMCP } from '../src/mcp.js';
import { startStudio } from '../src/server.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const tiny = { version: 1, name: 'dot', width: 1, height: 1, frames: [{ name: 'idle', ops: [{ op: 'pixel', color: '#fff' }] }] };
const strip = { version: 1, name: 'strip', width: 12, height: 2, palette: { k: '#000' }, frames: [{ name: 'a', ops: [{ op: 'pixel', x: 11, y: 1, color: 'k' }] }, { name: 'b' }] };
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
  assert.equal(results[1].result.tools.length, 4); assert.equal(JSON.parse(results[2].result.content[0].text).ok, true);
  const render = results[3].result;
  assert.equal(render.content[1].mimeType, 'image/png');
  const written = JSON.parse(render.content[0].text); assert.ok(written.directory.startsWith(dir + path.sep));
  assert.ok((await readFile(written.files[0])).length > 0);
  assert.equal(results[4].result.isError, true); assert.match(results[5].result.content[0].text, /PixelForge/);
  assert.equal(results[6].error.code, -32601); assert.equal(results[7].error.code, -32700);
});
test('MCP pixel_inspect returns a contact sheet and ruled grids without writing files', async t => {
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
  await assert.rejects(access(dir), { code: 'ENOENT' });
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
