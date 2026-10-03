import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createZip } from '../src/export.js';
import { browserCommand, STUDIO_PORT } from '../src/server.js';
import { root, TARGETS, hostTarget, readZip, writeZip, readTarGz, writeTarGz, forSystem, packageFiles, sourceState, assembleStudio, packStudio, manifest, sha256 } from '../scripts/build-studio.mjs';
import { verifyStudio } from '../scripts/verify-studio.mjs';

const source = { commit: 'c0ffee'.padEnd(40, '0'), date: new Date(Date.UTC(2026, 9, 2, 12, 30, 44)), dirty: [] };
const standIn = { version: process.versions.node, exe: Buffer.from('MZ stand-in for node.exe'), license: Buffer.from('Node.js license\n'), origin: 'a test stand-in' };
const launcher = (script, ...args) => [process.execPath, [path.join(root, 'packaging', 'common', 'launcher', script), ...args]];

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
test('the macOS and Linux archive keeps permissions, carries no host details and is read back exactly', async t => {
  const long = `top/${'deep/'.repeat(22)}file.txt`, files = new Map([['top/run', Buffer.from('#!/bin/sh\necho hi\n')], ['top/text.txt', Buffer.from('pixel '.repeat(400))], [long, Buffer.from('far down')], ['top/empty', Buffer.alloc(0)]]);
  const modes = new Map([['top/run', 0o755]]), archive = writeTarGz(files, { date: source.date, modes }), entries = readTarGz(archive);
  assert.ok(archive.equals(writeTarGz(files, { date: source.date, modes })));
  assert.deepEqual([...entries].map(([name, entry]) => [name, entry.mode, entry.read().toString()]), [...files].map(([name, data]) => [name, name === 'top/run' ? 0o755 : 0o644, data.toString()]));
  // gzip header: deflate, no flags, no timestamp, and always "Unix", whatever system packed it.
  assert.deepEqual([...archive.subarray(0, 10)], [0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 2, 3]);
  assert.ok(long.length > 100 && archive.length < 600);
  for (const name of ['/top/file', 'top\\file', 'tòp/file', `top/${'x'.repeat(120)}`]) assert.throws(() => writeTarGz(new Map([[name, Buffer.alloc(1)]])), /tar entry name/);
  // The system's own tar reads it the same way: names, bytes, the time and, where there are any, permission bits.
  const tempRoot = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(tempRoot, 'pixelforge-tar-'));
  t.after(async () => { assert.ok(dir.startsWith(tempRoot + path.sep)); await rm(dir, { recursive: true, force: true }); });
  await writeFile(path.join(dir, 'archive.tar.gz'), archive);
  const extracted = spawnSync('tar', ['-xzf', 'archive.tar.gz'], { cwd: dir, encoding: 'utf8' });
  if (extracted.error) { t.diagnostic('no tar program on this machine'); return; }
  assert.equal(extracted.status, 0, extracted.stderr);
  for (const [name, data] of files) assert.ok(data.equals(await readFile(path.join(dir, name))), name);
  const { mode, mtime } = await stat(path.join(dir, 'top', 'run'));
  assert.equal(mtime.getTime(), source.date.getTime());
  if (process.platform !== 'win32') assert.deepEqual([mode & 0o777, (await stat(path.join(dir, 'top', 'text.txt'))).mode & 0o777], [0o755, 0o644]);
});
test('START HERE is one text with blocks for each system', () => {
  const text = 'all\n#if windows\nwin\n#endif\n#if macos linux\nunix\n#endif\n#if macos\nmac\n#endif\nend';
  assert.deepEqual([forSystem(text, 'windows'), forSystem(text, 'macos'), forSystem(text, 'linux')], ['all\nwin\nend', 'all\nunix\nmac\nend', 'all\nunix\nend']);
  for (const [broken, message] of [['#if windows\n#if linux\n#endif\n#endif', /nested/], ['#endif', /without #if/], ['#if windows', /without #endif/], ['#if solaris\n#endif', /Unreadable/], ['#ifdef x', /Unreadable/]]) assert.throws(() => forSystem(broken, 'linux'), message);
});
test('the macOS and Linux builds hold shell launchers marked executable, their own START HERE and the right runtime', async () => {
  const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  for (const [target, system, launchers] of [['linux-x64', 'linux', []], ['linux-arm64', 'linux', []],['darwin-arm64', 'macos', ['PixelForge Studio.command', 'Connect your agent.command']], ['darwin-x64', 'macos', ['PixelForge Studio.command', 'Connect your agent.command']]]) {
    const build = await assembleStudio({ runtime: standIn, source, target }), inside = file => build.files.get(`${build.name}/${file}`), names = [...build.files.keys()].map(name => name.slice(build.name.length + 1));
    assert.deepEqual([build.name, build.format, TARGETS[target].os], [`PixelForgeStudio-${version}-${target}`, 'tar.gz', system]);
    const scripts = ['pixelforge', 'pixelforge-studio', 'connect-your-agent', ...launchers];
    assert.deepEqual(names.filter(name => !name.includes('/')).sort(), ['BUILD-INFO.txt', 'START HERE.txt', 'THIRD-PARTY-NOTICES.txt', 'first-edit.json', ...scripts].sort());
    assert.deepEqual(names.filter(name => name.startsWith('app/')).map(name => name.slice(4)), await packageFiles());
    assert.ok(inside('runtime/node').equals(standIn.exe)); assert.equal(inside('runtime/node.exe'), undefined);
    // Exactly the programs are executable; everything is LF, and the scripts start with a shell line.
    assert.deepEqual([...build.modes].map(([name, mode]) => [name.slice(build.name.length + 1), mode]).sort(), ['app/bin/pixelforge.js', 'runtime/node', ...scripts].sort().map(name => [name, 0o755]));
    for (const script of scripts) assert.match(inside(script).toString(), /^#!\/bin\/sh\n/, script);
    for (const file of [...scripts, 'START HERE.txt', 'BUILD-INFO.txt', 'launcher/studio.mjs']) assert.ok(!inside(file).includes('\r'), `${file} must use LF`);
    const start = inside('START HERE.txt').toString(), info = inside('BUILD-INFO.txt').toString();
    assert.doesNotMatch(start, /^#|\.cmd|\\pixelforge/m); assert.match(start, /^ {4}\.\/pixelforge render hero-v2\.pixel\.json --out output\/hero$/m);
    assert.equal(start.includes('PixelForge Studio.command'), system === 'macos');
    for (const line of [`Target: ${target}`, `Node.js program SHA-256: ${sha256(standIn.exe)}`, `run: node scripts/build-studio.mjs --target ${target}`]) assert.ok(info.includes(`${line}\n`), line);
    // Packed and read back, the archive carries the same files and the permission bits.
    const packed = readTarGz(packStudio(build, source.date));
    assert.deepEqual([...packed.keys()], [...build.files.keys()]);
    assert.deepEqual([packed.get(`${build.name}/pixelforge`).mode, packed.get(`${build.name}/START HERE.txt`).mode], [0o755, 0o644]);
  }
  assert.deepEqual([hostTarget('win32', 'x64'), hostTarget('linux', 'x64'), hostTarget('linux', 'arm64'), hostTarget('darwin', 'arm64'), hostTarget('darwin', 'x64'), hostTarget('win32', 'arm64'), hostTarget('freebsd', 'x64')], ['win-x64', 'linux-x64', 'linux-arm64', 'darwin-arm64', 'darwin-x64', undefined, undefined]);
});
test('the build ships exactly the files npm pack ships', async t => {
  const packed = spawnSync('npm pack --dry-run --json', { cwd: root, shell: true, encoding: 'utf8' });
  if (packed.status !== 0) { t.skip('npm is not available'); return; }
  assert.deepEqual(await packageFiles(), JSON.parse(packed.stdout)[0].files.map(file => file.path).sort());
});

test('every relative README link and image is shipped in the portable package', async () => {
  const readme = await readFile(path.join(root, 'README.md'), 'utf8'), shipped = await packageFiles();
  // Inline links/images and reference definitions; a directory is shipped when it contains a packaged file.
  const targets = [...readme.matchAll(/!?\[[^\]\n]*\]\(<?([^\s)>]+)>?(?:\s+"[^"]*")?\)/g), ...readme.matchAll(/^ {0,3}\[[^\]\n]+\]:\s*<?([^\s>]+)>?/gm)].map(match => match[1]);
  assert.ok(targets.length > 0);
  const missing = [];
  for (const target of targets) {
    if (/^(?:#|[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) continue;
    const relative = path.posix.normalize(decodeURIComponent(target.split(/[?#]/)[0])).replace(/\/$/, '');
    if (!shipped.some(file => file === relative || file.startsWith(`${relative}/`))) missing.push(target);
  }
  assert.deepEqual(missing, [], 'README links must resolve inside the shipped package or use an absolute URL');
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
  for (const line of [`PixelForge version: ${version}`, `Source commit: ${source.commit}`, 'Source commit date: 2026-10-02T12:30:44.000Z', 'Target: win-x64', `Node.js version: ${standIn.version}`, `Node.js program SHA-256: ${sha256(standIn.exe)}`]) assert.ok(info.includes(`${line}\r\n`), line);
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
test('the launcher is preview with a browser: the usual port, a free one beside it, and a dropped recipe opens', async t => {
  const start = (...dropped) => new Promise((resolve, reject) => {
    const child = spawn(...launcher('studio.mjs', '--no-browser', ...dropped), { stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '';
    t.after(() => child.kill());
    child.stdout.on('data', chunk => { text += chunk; const address = /PixelForge studio: (http:\/\/127\.0\.0\.1:(\d+))/.exec(text); if (address && /Press Ctrl\+C to stop\./.test(text)) resolve({ child, url: address[1], port: Number(address[2]), text }); });
    child.once('error', reject); child.once('exit', code => reject(new Error(`exited with ${code}: ${text}`)));
  });
  // Drafts are stored per address, so the same port every time is what lets a draft be found again.
  const usualFree = await new Promise(resolve => { const probe = http.createServer(); probe.once('error', () => resolve(false)); probe.listen(STUDIO_PORT, '127.0.0.1', () => probe.close(() => resolve(true))); });
  const first = await start(), second = await start(path.join(root, 'examples', 'coin.json'));
  assert.match(first.text, /^PixelForge Studio \d+\.\d+\.\d+\r?\n\r?\nClose this window or press Ctrl\+C to stop it\./);
  if (usualFree) { assert.equal(first.port, STUDIO_PORT); assert.doesNotMatch(first.text, /is in use/); }
  assert.notEqual(second.port, STUDIO_PORT); assert.match(second.text, /Port 4747 is in use, so this studio has another address/);
  assert.notEqual(first.url, second.url);
  for (const { url } of [first, second]) assert.match(await (await fetch(url)).text(), /<title>PixelForge · Sprite studio<\/title>/);
  // A file handed to the launcher, as Explorer does for one dragged onto it, is the studio's project.
  assert.equal(await (await fetch(`${first.url}/project.json`)).json(), null);
  assert.equal((await (await fetch(`${second.url}/project.json`)).json()).name, 'coin');
  // A port named on the command line is used or refused, never swapped for another.
  const busy = spawnSync(process.execPath, ['bin/pixelforge.js', 'preview', '--port', String(first.port)], { cwd: root, encoding: 'utf8' });
  assert.equal(busy.status, 1); assert.match(JSON.parse(busy.stderr).error, /EADDRINUSE/);
  const exits = [first, second].map(({ child }) => new Promise(resolve => child.once('exit', resolve)));
  first.child.kill(); second.child.kill(); await Promise.all(exits);
  await assert.rejects(fetch(first.url));
  const missing = spawnSync(...launcher('studio.mjs', '--no-browser', 'missing.pixel.json'), { encoding: 'utf8' });
  assert.equal(missing.status, 1); assert.match(JSON.parse(missing.stderr).error, /ENOENT/);
});
test('the browser is opened by each system\'s own handler, with no shell to quote for', () => {
  const url = 'http://127.0.0.1:4747/';
  assert.deepEqual(browserCommand(url, 'win32', { SystemRoot: 'D:\\Windows' }), ['D:\\Windows\\System32\\rundll32.exe', ['url.dll,FileProtocolHandler', url]]);
  assert.deepEqual(browserCommand(url, 'win32', {}), ['C:\\Windows\\System32\\rundll32.exe', ['url.dll,FileProtocolHandler', url]]);
  assert.deepEqual([browserCommand(url, 'darwin', {}), browserCommand(url, 'linux', {})], [['open', [url]], ['xdg-open', [url]]]);
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
  // The two agents with an "mcp add" command get one line. On Windows the separator is quoted so PowerShell cannot
  // drop it; elsewhere single quotes keep every character of a path literal.
  const quoted = value => process.platform === 'win32' ? `"${value}"` : `'${value.replaceAll("'", "'\\''")}'`;
  const target = `pixelforge ${process.platform === 'win32' ? '"--"' : '--'} ${quoted(settings.server.command)} ${quoted(settings.server.args[0])} mcp --out ${quoted(settings.server.args[3])}`;
  assert.deepEqual(settings.clients.map(client => client.command), [`claude mcp add --scope user ${target}`, null, `codex mcp add ${target}`, null]);
  for (const client of settings.clients) if (client.command) assert.ok(text.stdout.includes(`\n${client.command}\n`), client.name);
});
test('the Windows connect helper pauses after failure only when started without arguments', async t => {
  const script = await readFile(path.join(root, 'packaging', 'windows', 'Connect your agent.cmd'));
  assert.ok(script.every(byte => byte < 128), 'the batch file must be plain ASCII');
  assert.doesNotMatch(script.toString(), /(?<!\r)\n|\r(?!\n)/, 'the batch file must use CRLF');
  assert.match(script.toString(), /if errorlevel 1 \(\r\n  if "%~1"=="" pause\r\n  exit \/b 1\r\n\)/);
  if (process.platform !== 'win32') return;
  const tempRoot = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(tempRoot, 'pixelforge-connect-failed-'));
  t.after(async () => { assert.ok(dir.startsWith(tempRoot + path.sep)); await rm(dir, { recursive: true, force: true }); });
  await mkdir(path.join(dir, 'runtime'));
  await writeFile(path.join(dir, 'runtime', 'node.exe'), standIn.exe);
  await writeFile(path.join(dir, 'Connect your agent.cmd'), script);
  const child = spawn('cmd.exe', ['/d', '/c', '"Connect your agent.cmd" --json'], { cwd: dir, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { child.stdin.destroy(); child.kill(); });
  // Leave stdin open: an accidental pause cannot be satisfied by EOF.
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('the helper did not exit without waiting for input')); }, 5000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); resolve(code); });
  });
  assert.equal(result, 1);
});
test('an assembled build passes the release checks from a folder with a space and an accent', async t => {
  const tempRoot = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(tempRoot, 'pixelforge studio é-'));
  t.after(async () => { assert.ok(dir.startsWith(tempRoot + path.sep)); await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); });
  // Where a build is pinned for this machine, the Node running the tests stands in for the pinned runtime, so the
  // launcher scripts really run. Elsewhere the Windows layout is checked for its contents only.
  const target = hostTarget(), runtime = target ? { ...standIn, exe: await readFile(process.execPath) } : standIn;
  const build = await assembleStudio({ runtime, source, target: target ?? 'win-x64' });
  for (const [file, bytes] of build.files) { await mkdir(path.dirname(path.join(dir, file)), { recursive: true }); await writeFile(path.join(dir, file), bytes, { mode: build.modes.get(file) ?? 0o644 }); }
  const lines = [], outcome = await verifyStudio({ dir: path.join(dir, build.name), pinned: false, log: line => lines.push(line) });
  assert.ok(outcome.ok, lines.join('\n')); assert.equal(outcome.complete, Boolean(target), lines.join('\n'));
  assert.ok(outcome.results.length >= (target ? 25 : 5), lines.join('\n'));
});
