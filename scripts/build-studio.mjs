// Builds the portable PixelForge Studio for Windows: the files `npm pack` ships, the pinned official Node.js
// runtime and the launcher scripts from packaging/windows, packed into one reproducible ZIP.
//   node scripts/build-studio.mjs [--out dist] [--node-zip file] [--check] [--force] [--allow-dirty]
// --check rebuilds and compares with the ZIP already in --out instead of writing. --node-zip uses an archive
// downloaded beforehand; it must still match the pinned SHA-256. Nothing is added to package.json's dependencies.
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import zlib from 'node:zlib';
import { crc32 } from '../src/png.js';

export const root = fileURLToPath(new URL('../', import.meta.url));
// The newest 24.x LTS release. Both hashes are from https://nodejs.org/dist/v24.21.0/SHASUMS256.txt.
export const NODE = {
  version: '24.21.0',
  archive: 'node-v24.21.0-win-x64.zip',
  url: 'https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip',
  sha256: '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541',
  exeSha256: 'ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32'
};
const PACKAGING = 'packaging/windows';
export const sha256 = data => createHash('sha256').update(data).digest('hex');
const checksum = zlib.crc32 ?? crc32;

// Reads a ZIP32 archive with stored or deflated entries; each entry is checked against its CRC when read.
export function readZip(buffer) {
  let end = buffer.length - 22;
  const floor = Math.max(0, end - 65535);
  while (end >= floor && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < floor) throw new Error('Not a ZIP archive: no end-of-central-directory record');
  const count = buffer.readUInt16LE(end + 10), entries = new Map();
  let at = buffer.readUInt32LE(end + 16);
  if (count === 0xffff || at === 0xffffffff) throw new Error('ZIP64 archives are not supported');
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(at) !== 0x02014b50) throw new Error('Damaged ZIP central directory');
    const method = buffer.readUInt16LE(at + 10), crc = buffer.readUInt32LE(at + 16), packed = buffer.readUInt32LE(at + 20), size = buffer.readUInt32LE(at + 24);
    const nameLength = buffer.readUInt16LE(at + 28), local = buffer.readUInt32LE(at + 42), name = buffer.toString('utf8', at + 46, at + 46 + nameLength);
    at += 46 + nameLength + buffer.readUInt16LE(at + 30) + buffer.readUInt16LE(at + 32);
    if (name.endsWith('/')) continue;
    entries.set(name, { size, read() {
      if (method !== 0 && method !== 8) throw new Error(`ZIP entry ${name} uses unsupported compression method ${method}`);
      const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28), raw = buffer.subarray(start, start + packed);
      const data = method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw);
      if (data.length !== size || checksum(data) !== crc) throw new Error(`ZIP entry ${name} is damaged`);
      return data;
    } });
  }
  return entries;
}
// Deflated ZIP32 with a fixed timestamp and no host metadata, so the same files always give the same bytes
// (for one zlib; the build repacks under the pinned runtime where it can).
export function writeZip(files, { date = new Date(Date.UTC(1980, 0, 1)) } = {}) {
  if (files.size > 65535) throw new Error('ZIP32 supports at most 65,535 entries');
  const time = date.getUTCHours() << 11 | date.getUTCMinutes() << 5 | date.getUTCSeconds() >> 1;
  const day = Math.max(0, date.getUTCFullYear() - 1980) << 9 | (date.getUTCMonth() + 1) << 5 | date.getUTCDate();
  const local = [], central = [];
  let offset = 0;
  for (const [filename, data] of files) {
    if (!/^[\x20-\x7e]+$/.test(filename) || /[\\:*?"<>|]/.test(filename)) throw new Error(`ZIP entry names must be plain ASCII with forward slashes: ${filename}`);
    const deflated = zlib.deflateRawSync(data, { level: 9 }), method = deflated.length < data.length ? 8 : 0, body = method ? deflated : data;
    const name = Buffer.from(filename), crc = checksum(data), header = Buffer.alloc(30), entry = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(method, 8); header.writeUInt16LE(time, 10); header.writeUInt16LE(day, 12);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(body.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(method, 10); entry.writeUInt16LE(time, 12); entry.writeUInt16LE(day, 14);
    entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(body.length, 20); entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(name.length, 28); entry.writeUInt32LE(offset, 42);
    local.push(header, name, body); central.push(entry, name); offset += 30 + name.length + body.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  if (offset + directory.length + 22 > 0xffffffff) throw new Error('Archive exceeds the ZIP32 byte budget');
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.size, 8); end.writeUInt16LE(files.size, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

async function walk(base, relative) {
  const found = [];
  for (const entry of (await readdir(path.join(base, relative), { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const file = `${relative}/${entry.name}`;
    if (['.DS_Store', 'Thumbs.db', 'node_modules', '.git'].includes(entry.name)) continue;
    if (entry.isDirectory()) found.push(...await walk(base, file)); else if (entry.isFile()) found.push(file);
  }
  return found;
}
// Everything `npm pack` ships: package.json and the entries of its `files` list. A test compares this with npm's own list.
export async function packageFiles(base = root) {
  const found = [];
  for (const entry of ['package.json', ...JSON.parse(await readFile(path.join(base, 'package.json'), 'utf8')).files]) {
    if ((await stat(path.join(base, entry))).isDirectory()) found.push(...await walk(base, entry)); else found.push(entry);
  }
  return found.sort();
}
// The commit a build is made from. A build is only named after a commit when every shipped file is tracked and
// unmodified at it; otherwise the build is marked as a development build.
export async function sourceState(base = root) {
  const git = (...args) => execFileSync('git', ['-c', 'core.quotepath=off', ...args], { cwd: base, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 });
  const shipped = [...await packageFiles(base), ...await walk(base, PACKAGING)], inputs = [...shipped, 'scripts/build-studio.mjs'];
  try {
    const commit = git('rev-parse', 'HEAD').trim(), date = new Date(Number(git('log', '-1', '--format=%ct').trim()) * 1000);
    const tracked = new Set(git('ls-files', '-z', '--', ...inputs).split('\0'));
    const changed = git('status', '--porcelain', '-z', '--untracked-files=all', '--', ...inputs).split('\0').filter(Boolean).map(line => line.slice(3));
    return { commit, date, dirty: [...new Set([...changed, ...inputs.filter(file => !tracked.has(file))])].sort() };
  } catch { return { commit: null, date: new Date(Date.UTC(1980, 0, 1)), dirty: ['(not a git checkout)'] }; }
}

async function nodeRuntime({ nodeZip, cache, log }) {
  const file = nodeZip ?? path.join(cache, NODE.archive);
  let archive;
  try { archive = await readFile(file); } catch (error) {
    if (error.code !== 'ENOENT' || nodeZip) throw error;
    log(`Downloading ${NODE.url}`);
    const response = await fetch(NODE.url);
    if (!response.ok) throw new Error(`Download failed with status ${response.status}: ${NODE.url}`);
    archive = Buffer.from(await response.arrayBuffer());
    if (sha256(archive) === NODE.sha256) { await mkdir(cache, { recursive: true }); await writeFile(file, archive); }
  }
  if (sha256(archive) !== NODE.sha256) throw new Error(`${nodeZip ? file : NODE.url} has SHA-256 ${sha256(archive)}, not the pinned ${NODE.sha256}. Nothing was built.${nodeZip ? '' : ` If ${file} exists, delete it and try again.`}`);
  const entries = readZip(archive), folder = NODE.archive.replace(/\.zip$/, ''), exe = entries.get(`${folder}/node.exe`).read(), license = entries.get(`${folder}/LICENSE`).read();
  if (sha256(exe) !== NODE.exeSha256) throw new Error(`node.exe in ${NODE.archive} has SHA-256 ${sha256(exe)}, not the pinned ${NODE.exeSha256}. Nothing was built.`);
  return { version: NODE.version, exe, license, origin: NODE.url, archiveSha256: NODE.sha256 };
}
// Lays out the build as a map of archive paths to bytes. `runtime` is { version, exe, license, origin } and
// `source` is { commit, date, dirty }; tests pass stand-ins for both.
export async function assembleStudio({ runtime, source, base = root }) {
  const { version } = JSON.parse(await readFile(path.join(base, 'package.json'), 'utf8')), release = Boolean(source.commit) && source.dirty.length === 0;
  const name = `PixelForgeStudio-${version}${release ? '' : '-dev'}-win-x64`, files = new Map();
  // Batch files need CRLF to parse reliably, and Notepad users expect it in the text files; the checkout may hold either.
  const crlf = bytes => Buffer.from(bytes.toString('utf8').replace(/\r?\n/g, '\r\n'));
  for (const file of await packageFiles(base)) files.set(`app/${file}`, await readFile(path.join(base, file)));
  for (const file of await walk(base, PACKAGING)) {
    const bytes = await readFile(path.join(base, file));
    files.set(file.slice(PACKAGING.length + 1), /\.(cmd|txt)$/.test(file) ? crlf(bytes) : bytes);
  }
  files.set('runtime/node.exe', runtime.exe); files.set('runtime/NODE-LICENSE.txt', runtime.license);
  files.set('BUILD-INFO.txt', crlf(Buffer.from([
    'PixelForge Studio, portable build for 64-bit Windows', '',
    `PixelForge version: ${version}`,
    'Source: https://github.com/skulitom/PixelForge',
    `Source commit: ${source.commit ?? 'unknown'}${release ? '' : ' with uncommitted changes (development build, not a release)'}`,
    `Source commit date: ${source.date.toISOString()}`,
    'Target: win-x64',
    `Node.js version: ${runtime.version}`,
    `Node.js origin: ${runtime.origin}`,
    ...(runtime.archiveSha256 ? [`Node.js archive SHA-256: ${runtime.archiveSha256}`] : []),
    `node.exe SHA-256: ${sha256(runtime.exe)}`, '',
    'runtime\\node.exe is the official Node.js binary, unmodified. To rebuild this ZIP, check out the source commit',
    'and run: node scripts/build-studio.mjs', ''
  ].join('\n'))));
  return { name, version, release, files: new Map([...files].sort(([a], [b]) => (a < b ? -1 : 1)).map(([file, bytes]) => [`${name}/${file}`, bytes])) };
}
export const manifest = files => [...files].map(([file, bytes]) => `${sha256(bytes)}  ${String(bytes.length).padStart(9)}  ${file}\n`).join('');

async function main(argv) {
  const options = { out: 'dist' };
  for (let i = 0; i < argv.length; i++) {
    if (['--check', '--force', '--allow-dirty'].includes(argv[i])) options[argv[i].slice(2)] = true;
    else if (['--out', '--node-zip'].includes(argv[i]) && argv[i + 1]) options[argv[i].slice(2)] = argv[++i];
    else throw new Error(`Unknown or incomplete option: ${argv[i]}`);
  }
  const out = path.resolve(options.out), cache = path.join(root, 'dist', '.cache');
  const source = await sourceState();
  if (source.dirty.length && !options['allow-dirty']) throw new Error(`These shipped files differ from the commit:\n  ${source.dirty.slice(0, 12).join('\n  ')}${source.dirty.length > 12 ? `\n  and ${source.dirty.length - 12} more` : ''}\nCommit them first, or pass --allow-dirty for a development build that is marked as one.`);
  const runtime = await nodeRuntime({ nodeZip: options['node-zip'] && path.resolve(options['node-zip']), cache, log: console.log });
  // Deflate output can differ between zlib versions, so on Windows the packing runs under the pinned runtime itself.
  if (process.platform === 'win32' && process.arch === 'x64' && process.versions.node !== NODE.version && !process.env.PIXELFORGE_STUDIO_PACKER) {
    const packer = path.join(cache, `node-v${NODE.version}-win-x64.exe`);
    if (await readFile(packer).then(bytes => sha256(bytes) !== NODE.exeSha256, () => true)) { await mkdir(cache, { recursive: true }); await writeFile(packer, runtime.exe); }
    const child = spawnSync(packer, [fileURLToPath(import.meta.url), ...argv], { stdio: 'inherit', env: { ...process.env, PIXELFORGE_STUDIO_PACKER: '1' } });
    if (child.error) throw child.error;
    process.exitCode = child.status ?? 1; return;
  }
  const build = await assembleStudio({ runtime, source }), zip = writeZip(build.files, { date: source.date });
  const target = path.join(out, `${build.name}.zip`), existing = await readFile(target).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  const summary = `${build.name}.zip\n  ${build.files.size} files, ${zip.length} bytes\n  SHA-256 ${sha256(zip)}\n  PixelForge ${build.version} at ${source.commit ?? 'an unknown commit'}${build.release ? '' : ' with uncommitted changes (development build)'}, Node.js ${runtime.version}`;
  if (process.versions.node !== NODE.version) console.log(`Packed with Node.js ${process.versions.node}; byte-identical ZIPs are only promised when packing runs under ${NODE.version} on Windows x64.`);
  if (existing?.equals(zip)) { console.log(`${options.check ? 'Reproduced' : 'Unchanged'}: ${summary}`); return; }
  if (options.check) {
    if (!existing) throw new Error(`Nothing to check: ${target} does not exist.`);
    const before = new Map([...readZip(existing)].map(([file, entry]) => [file, sha256(entry.read())])), after = new Map([...build.files].map(([file, bytes]) => [file, sha256(bytes)]));
    const differing = [...new Set([...before.keys(), ...after.keys()])].filter(file => before.get(file) !== after.get(file)).sort();
    if (differing.length) throw new Error(`${target} was not reproduced. Files that differ:\n  ${differing.slice(0, 20).join('\n  ')}`);
    console.log(`Reproduced file for file (same list and per-file SHA-256); the ZIP bytes differ, so it was packed by another zlib: ${summary}`); return;
  }
  if (existing && !options.force) throw new Error(`${target} already exists with different contents. One version names one build: bump the version, choose another --out, or pass --force.`);
  await mkdir(out, { recursive: true });
  await writeFile(target, zip);
  await writeFile(`${target}.sha256`, `${sha256(zip)}  ${build.name}.zip\n`);
  await writeFile(path.join(out, `${build.name}.manifest.txt`), manifest(build.files));
  console.log(`Wrote ${target}\n${summary}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
