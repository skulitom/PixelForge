import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createZip } from '../src/export.js';
import { root, readZip, writeZip, packageFiles, sourceState, assembleStudio, manifest, sha256 } from '../scripts/build-studio.mjs';
import { verifyStudio } from '../scripts/verify-studio.mjs';

const source = { commit: 'c0ffee'.padEnd(40, '0'), date: new Date(Date.UTC(2026, 9, 2, 12, 30, 44)), dirty: [] };
const standIn = { version: process.versions.node, exe: Buffer.from('MZ stand-in for node.exe'), license: Buffer.from('Node.js license\n'), origin: 'a test stand-in' };
const launcher = (script, ...args) => [process.execPath, [path.join(root, 'packaging', 'windows', 'launcher', script), ...args]];

test('the build ZIP is deterministic, compressed where it helps and read back exactly', () => {
  const files = new Map([['top/text.txt', Buffer.from('pixel '.repeat(400))], ['top/noise.bin', Buffer.from(Array.from({ length: 64 }, (_, i) => i * 37 % 256))], ['top/empty', Buffer.alloc(0)]]);
  const zip = writeZip(files, { date: source.date }), entries = readZip(zip);
  assert.ok(zip.equals(writeZip(files, { date: source.date })));
  assert.deepEqual([...entries].map(([name, entry]) => [name, entry.read()]), [...files]);
  // Local headers: the text is deflated (8), the incompressible bytes are stored (0); the DOS stamp is the given UTC time.
  assert.deepEqual([zip.readUInt16LE(8), zip.readUInt16LE(10), zip.readUInt16LE(12)], [8, 12 << 11 | 30 << 5 | 22, 46 << 9 | 10 << 5 | 2]);
  assert.equal(zip.readUInt16LE(zip.indexOf('top/noise.bin') - 30 + 8), 0);
  assert.ok(zip.length < 1000);
  for (const name of ['top\\file', 'tòp/file', 'C:/file']) assert.throws(() => writeZip(new Map([[name, Buffer.alloc(1)]])), /plain ASCII/);
  const damaged = Buffer.from(zip); damaged[zip.indexOf('top/noise.bin') + 'top/noise.bin'.length] ^= 1;
  assert.throws(() => readZip(damaged).get('top/noise.bin').read(), /damaged/);
  assert.throws(() => readZip(Buffer.alloc(64)), /Not a ZIP/);
  // The studio's own store-mode exports read back through the same reader.
  assert.equal(readZip(createZip(new Map([['preview.html', Buffer.from('<!doctype html>')]]))).get('preview.html').read().toString(), '<!doctype html>');
});
test('the build ships exactly the files npm pack ships', async t => {
  const packed = spawnSync('npm pack --dry-run --json', { cwd: root, shell: true, encoding: 'utf8' });
  if (packed.status !== 0) { t.skip('npm is not available'); return; }
  assert.deepEqual(await packageFiles(), JSON.parse(packed.stdout)[0].files.map(file => file.path).sort());
});
test('the portable layout holds the package, runtime, launchers and build facts, and nothing from development', async () => {
  const build = await assembleStudio({ runtime: standIn, source }), { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(build.name, `PixelForgeStudio-${version}-win-x64`);
  const names = [...build.files.keys()], inside = file => build.files.get(`${build.name}/${file}`);
  assert.ok(names.every(name => name.startsWith(`${build.name}/`))); assert.deepEqual(names, [...names].sort());
  assert.deepEqual(names.filter(name => name.startsWith(`${build.name}/app/`)).map(name => name.slice(build.name.length + 5)), await packageFiles());
  assert.deepEqual(names.filter(name => /\/(demo|showcase|test|scripts|packaging|output)\//.test(name)), []);
  assert.ok(inside('app/src/server.js').equals(await readFile(path.join(root, 'src', 'server.js'))));
  assert.ok(inside('runtime/node.exe').equals(standIn.exe)); assert.ok(inside('runtime/NODE-LICENSE.txt').equals(standIn.license));
  for (const file of ['PixelForge Studio.cmd', 'pixelforge.cmd', 'Connect your agent.cmd', 'START HERE.txt', 'BUILD-INFO.txt']) assert.ok(!/[^\r]\n/.test(inside(file).toString()), `${file} needs CRLF`);
  const info = inside('BUILD-INFO.txt').toString();
  for (const line of [`PixelForge version: ${version}`, `Source commit: ${source.commit}`, 'Source commit date: 2026-10-02T12:30:44.000Z', `Node.js version: ${standIn.version}`, `node.exe SHA-256: ${sha256(standIn.exe)}`]) assert.ok(info.includes(`${line}\r\n`), line);
  assert.equal(manifest((await assembleStudio({ runtime: standIn, source })).files), manifest(build.files));
  // Uncommitted changes never produce a build that carries a release name.
  const dev = await assembleStudio({ runtime: standIn, source: { ...source, dirty: ['src/core.js'] } });
  assert.equal(dev.name, `PixelForgeStudio-${version}-dev-win-x64`);
  assert.match(dev.files.get(`${dev.name}/BUILD-INFO.txt`).toString(), /with uncommitted changes \(development build, not a release\)/);
});
test('a release build takes its files from the commit, whatever line endings the working copy holds', async t => {
  const tempRoot = path.resolve(os.tmpdir()), repo = await mkdtemp(path.join(tempRoot, 'pixelforge-source-'));
  t.after(async () => { assert.ok(repo.startsWith(tempRoot + path.sep)); await rm(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); });
  const git = (...args) => spawnSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, encoding: 'utf8' });
  if (git('init', '-q').status !== 0) { t.skip('git is not available'); return; }
  const write = async (file, text) => { await mkdir(path.dirname(path.join(repo, file)), { recursive: true }); await writeFile(path.join(repo, file), text); };
  await write('.gitattributes', '* text=auto eol=lf\n'); await write('package.json', JSON.stringify({ version: '9.9.9', files: ['notes.txt'] }) + '\n');
  // Saved with Windows line endings and then added: git stores LF and calls the CRLF working copy unmodified.
  await write('notes.txt', 'one\r\ntwo\r\n'); await write('packaging/windows/run.cmd', '@echo off\n'); await write('scripts/build-studio.mjs', '\n');
  git('add', '-A'); assert.equal(git('commit', '-q', '-m', 'fixture').status, 0);
  assert.equal(await readFile(path.join(repo, 'notes.txt'), 'utf8'), 'one\r\ntwo\r\n');
  const clean = await sourceState(repo);
  assert.deepEqual(clean.dirty, []); assert.match(clean.commit, /^[0-9a-f]{40}$/);
  const build = await assembleStudio({ runtime: standIn, source: clean, base: repo });
  assert.equal(build.name, 'PixelForgeStudio-9.9.9-win-x64');
  assert.equal(build.files.get(`${build.name}/app/notes.txt`).toString(), 'one\ntwo\n');
  assert.equal(build.files.get(`${build.name}/run.cmd`).toString(), '@echo off\r\n');
  // A real edit or an untracked shipped file makes it a development build, which is read from the working copy.
  await write('notes.txt', 'one\r\nthree\r\n'); await write('packaging/windows/extra.txt', 'new\n');
  const edited = await sourceState(repo), dev = await assembleStudio({ runtime: standIn, source: edited, base: repo });
  assert.deepEqual(edited.dirty, ['notes.txt', 'packaging/windows/extra.txt']); assert.equal(edited.read, undefined);
  assert.equal(dev.files.get('PixelForgeStudio-9.9.9-dev-win-x64/app/notes.txt').toString(), 'one\r\nthree\r\n');
});
test('the studio launcher takes a free port, serves the studio and stops cleanly', async t => {
  const start = () => new Promise((resolve, reject) => {
    const child = spawn(...launcher('studio.mjs', '--no-browser'), { stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '';
    t.after(() => child.kill());
    child.stdout.on('data', chunk => { text += chunk; const address = /http:\/\/127\.0\.0\.1:(\d+)\//.exec(text); if (address) resolve({ child, url: address[0], text }); });
    child.once('error', reject); child.once('exit', code => reject(new Error(`exited with ${code}: ${text}`)));
  });
  const first = await start(), second = await start();
  assert.notEqual(first.url, second.url);
  for (const { url } of [first, second]) assert.match(await (await fetch(url)).text(), /<title>PixelForge · Sprite studio<\/title>/);
  const exits = [first, second].map(({ child }) => new Promise(resolve => child.once('exit', resolve)));
  first.child.kill(); second.child.kill(); await Promise.all(exits);
  await assert.rejects(fetch(first.url));
  const unknown = spawnSync(...launcher('studio.mjs', 'hero.pixel.json'), { encoding: 'utf8' });
  assert.equal(unknown.status, 1); assert.match(unknown.stderr, /Unknown option: hero\.pixel\.json/);
});
test('the connect helper prints the same server for four agents and changes nothing', () => {
  const json = spawnSync(...launcher('connect.mjs', '--json'), { encoding: 'utf8' }), text = spawnSync(...launcher('connect.mjs'), { encoding: 'utf8' });
  assert.equal(json.status, 0, json.stderr); assert.equal(text.status, 0, text.stderr);
  const settings = JSON.parse(json.stdout);
  // From a checkout the helper names the Node that ran it and the repository's own files.
  assert.deepEqual(settings.server, { command: process.execPath, args: [path.join(root, 'bin', 'pixelforge.js'), 'mcp', '--out', path.join(path.resolve(root), 'output')] });
  assert.deepEqual(settings.clients.map(client => client.name), ['Claude Code', 'Claude Desktop', 'Codex', 'Cursor']);
  for (const client of settings.clients) {
    assert.ok(text.stdout.includes(client.text));
    if (client.format === 'json') assert.deepEqual(JSON.parse(client.text), { mcpServers: { pixelforge: settings.server } });
    else assert.deepEqual([JSON.parse(/^command = (.*)$/m.exec(client.text)[1]), JSON.parse(/^args = (.*)$/m.exec(client.text)[1])], [settings.server.command, settings.server.args]);
  }
});
test('an assembled build passes the release checks from a folder with a space and an accent', async t => {
  const tempRoot = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(tempRoot, 'pixelforge studio é-'));
  t.after(async () => { assert.ok(dir.startsWith(tempRoot + path.sep)); await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); });
  // On 64-bit Windows the Node running the tests stands in for the pinned runtime, so the batch files really run.
  const windows = process.platform === 'win32' && process.arch === 'x64', runtime = windows ? { ...standIn, exe: await readFile(process.execPath) } : standIn;
  const build = await assembleStudio({ runtime, source });
  for (const [file, bytes] of build.files) { await mkdir(path.dirname(path.join(dir, file)), { recursive: true }); await writeFile(path.join(dir, file), bytes); }
  const lines = [], outcome = await verifyStudio({ dir: path.join(dir, build.name), pinned: false, log: line => lines.push(line) });
  assert.ok(outcome.ok, lines.join('\n')); assert.equal(outcome.complete, windows);
  assert.ok(outcome.results.length >= (windows ? 25 : 5), lines.join('\n'));
});
