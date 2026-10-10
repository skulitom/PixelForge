import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assembleMcpb, buildMcpb, registryEntry, root } from '../scripts/build-mcpb.mjs';
import { readZip, writeZip, sha256 } from '../scripts/build-studio.mjs';
import { verifyMcpb } from '../scripts/verify-mcpb.mjs';

let temp, base, build, pkg, metadata, template;
const json = value => JSON.stringify(value, null, 2) + '\n';
const writeJSON = (file, value) => writeFile(file, json(value));
before(async () => {
  temp = await mkdtemp(path.join(os.tmpdir(), 'pixelforge-mcpb-test-'));
  base = path.join(temp, 'source');
  build = await buildMcpb({ out: path.join(temp, 'first'), check: true });
  // A fixture lets release validation reject version disagreements without coupling ordinary tests to the
  // metadata version on main. package.json may be bumped independently until the release is prepared.
  for (const [file, entry] of readZip(build.bytes)) {
    if (file === 'manifest.json') continue;
    await mkdir(path.dirname(path.join(base, file)), { recursive: true });
    await writeFile(path.join(base, file), entry.read());
  }
  pkg = JSON.parse(await readFile(path.join(base, 'package.json')));
  metadata = { ...JSON.parse(await readFile(path.join(root, 'server.json'))), version: pkg.version };
  template = JSON.parse(await readFile(path.join(root, 'mcpb/manifest.json')));
  await mkdir(path.join(base, 'mcpb'));
  await writeJSON(path.join(base, 'mcpb/manifest.json'), template);
  await writeJSON(path.join(base, 'server.json'), metadata);
});
after(async () => {
  if (!temp) return;
  const relative = path.relative(path.resolve(os.tmpdir()), temp);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
  await rm(temp, { recursive: true, force: true });
});

test('registry source is metadata-only with a short description', async () => {
  const server = JSON.parse(await readFile(path.join(root, 'server.json')));
  assert.equal(server.name, 'io.github.skulitom/pixelforge');
  assert.equal(server.$schema, 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json');
  assert.equal(Object.hasOwn(server, 'packages'), false);
  assert.ok(server.description.length <= 100);
  assert.equal(Object.hasOwn(template, 'version'), false);
});

test('MCPB builds are byte-identical, including across CRLF and LF checkouts', async () => {
  const second = await buildMcpb({ base, out: path.join(temp, 'second') });
  assert.deepEqual(second.bytes, build.bytes);
  assert.equal(await readFile(`${build.bundle}.sha256`, 'utf8'), `${sha256(build.bytes)}  pixelforge.mcpb\n`);
  assert.deepEqual(JSON.parse(await readFile(path.join(temp, 'first/manifest.json'))), build.manifest);
  const file = path.join(base, 'src/mcp.js'), original = await readFile(file, 'utf8');
  try {
    await writeFile(file, original.replace(/\n/g, '\r\n'));
    assert.deepEqual((await assembleMcpb({ base })).bytes, build.bytes);
  } finally { await writeFile(file, original); }
  const files = readZip(build.bytes);
  assert.ok(files.has('studio/scene-player.js'));
  for (const excluded of ['src/server.js', 'studio/index.html', 'server.json', 'scripts/build-mcpb.mjs', 'docs/PUBLISHING.md']) assert.equal(files.has(excluded), false, excluded);
});

test('the standalone verifier runs bundled MCP help, render, import and scene export', () => {
  const output = execFileSync(process.execPath, [path.join(root, 'scripts/verify-mcpb.mjs'), build.bundle], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  assert.match(output, /MCPB verified:.*8 tools/);
});

test('the verifier reports missing help and scene export assets and cleans up', async () => {
  for (const missing of ['docs/art-workflow.md', 'studio/scene-player.js']) {
    const files = new Map([...readZip(build.bytes)].map(([name, entry]) => [name, entry.read()]));
    files.delete(missing);
    const broken = path.join(temp, `${path.basename(missing)}.mcpb`);
    await writeFile(broken, writeZip(files));
    await assert.rejects(verifyMcpb(broken), /pixel_(help|scene) failed/);
  }
});

test('the verifier refuses traversal paths and a manifest/package version mismatch', async () => {
  const files = new Map([...readZip(build.bytes)].map(([name, entry]) => [name, entry.read()]));
  files.set('../escape.txt', Buffer.from('escape'));
  const bad = path.join(temp, 'bad.mcpb');
  await writeFile(bad, writeZip(files));
  await assert.rejects(verifyMcpb(bad), /Unsafe bundle path/);
  files.delete('../escape.txt');
  files.set('manifest.json', Buffer.from(json({ ...build.manifest, version: '999.0.0' })));
  await writeFile(bad, writeZip(files));
  await assert.rejects(verifyMcpb(bad), /manifest version must equal bundled package.json/);
});

test('the builder refuses template versions, non-stable versions and different existing artifacts', async () => {
  try {
    await writeJSON(path.join(base, 'mcpb/manifest.json'), { ...template, version: pkg.version });
    await assert.rejects(assembleMcpb({ base }), /must not contain version/);
  } finally { await writeJSON(path.join(base, 'mcpb/manifest.json'), template); }
  try {
    for (const version of ['1.0', 'v1.0.0', '01.0.0', '1.0.0-beta', 1]) {
      await writeJSON(path.join(base, 'package.json'), { ...pkg, version });
      await assert.rejects(assembleMcpb({ base }), /version must have the form X.Y.Z/);
    }
  } finally { await writeJSON(path.join(base, 'package.json'), pkg); }
  const out = path.join(temp, 'occupied');
  await mkdir(out); await writeFile(path.join(out, 'pixelforge.mcpb'), 'keep');
  await assert.rejects(buildMcpb({ base, out }), /already exists with different contents/);
  assert.equal(await readFile(path.join(out, 'pixelforge.mcpb'), 'utf8'), 'keep');
});

test('registry entry identifies the exact release bundle and preserves source metadata', async () => {
  const out = path.join(temp, 'server.registry.json'), before = await readFile(path.join(base, 'server.json'));
  const entry = await registryEntry({ base, tag: `v${pkg.version}`, bundle: build.bundle, out });
  assert.deepEqual(entry.packages, [{ registryType: 'mcpb', identifier: `https://github.com/skulitom/PixelForge/releases/download/v${pkg.version}/pixelforge.mcpb`, version: pkg.version, fileSha256: sha256(build.bytes), transport: { type: 'stdio' } }]);
  assert.deepEqual(JSON.parse(await readFile(out)), entry);
  assert.deepEqual(await readFile(path.join(base, 'server.json')), before);
  await registryEntry({ base, tag: `v${pkg.version}`, bundle: build.bundle, out }); // Identical rerun is safe.
});

test('registry entry refuses bad tags, mismatched versions and packages in metadata', async () => {
  const options = { base, tag: `v${pkg.version}`, bundle: build.bundle, out: path.join(temp, 'refused.json') };
  for (const tag of ['0.7.1', 'v1.2', 'v1.2.3-beta', 'v01.2.3', '../v1.2.3']) await assert.rejects(registryEntry({ ...options, tag }), /Tag must have the form/);
  await assert.rejects(registryEntry({ ...options, tag: `v${pkg.version === '999.0.0' ? '998.0.0' : '999.0.0'}` }), /versions must match/);
  try {
    await writeJSON(path.join(base, 'server.json'), { ...metadata, packages: [] });
    await assert.rejects(registryEntry(options), /metadata-only/);
    await writeJSON(path.join(base, 'server.json'), { ...metadata, version: 'different' });
    await assert.rejects(registryEntry(options), /versions must match/);
  } finally { await writeJSON(path.join(base, 'server.json'), metadata); }
  const files = new Map([...readZip(build.bytes)].map(([name, entry]) => [name, entry.read()]));
  files.set('manifest.json', Buffer.from(json({ ...build.manifest, version: 'different' })));
  const oldBundle = path.join(temp, 'old.mcpb'); await writeFile(oldBundle, writeZip(files));
  await assert.rejects(registryEntry({ ...options, bundle: oldBundle }), /Bundle manifest version must match/);
});

test('registry entry cannot replace server.json or the bundle', async () => {
  for (const out of [path.join(base, 'server.json'), build.bundle]) {
    const before = await readFile(out);
    await assert.rejects(registryEntry({ base, tag: `v${pkg.version}`, bundle: build.bundle, out }), /must not overwrite/);
    assert.deepEqual(await readFile(out), before);
  }
});
