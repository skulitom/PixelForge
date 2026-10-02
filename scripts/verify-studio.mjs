// Tests a built portable Studio the way a stranger's PC would run it: extracted into a folder whose path has a
// space and a non-ASCII character, with no Node.js or git on PATH. It checks the layout and BUILD-INFO, the
// launcher, every studio route, the command line exactly as START HERE gives it, the MCP server over stdio, the
// connect helper, and that nothing is left running afterwards. The runtime checks need 64-bit Windows.
//   node scripts/verify-studio.mjs <PixelForgeStudio-...-win-x64.zip> [--allow-dev] [--keep]
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, readdir, rm, realpath, access } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { NODE, readZip, sha256 } from './build-studio.mjs';

const REQUIRED = ['START HERE.txt', 'PixelForge Studio.cmd', 'pixelforge.cmd', 'Connect your agent.cmd', 'first-edit.json', 'BUILD-INFO.txt', 'THIRD-PARTY-NOTICES.txt', 'runtime/node.exe', 'runtime/NODE-LICENSE.txt', 'launcher/studio.mjs', 'launcher/connect.mjs', 'app/package.json', 'app/LICENSE', 'app/bin/pixelforge.js'];
const FORBIDDEN = ['demo', 'showcase', 'test', 'scripts', 'packaging', 'output', 'node_modules', '.git', '.github'];
const COMMANDS = ['init', 'validate', 'inspect', 'patch', 'render'];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function tree(base, relative = '') {
  const found = [];
  for (const entry of await readdir(path.join(base, relative), { withFileTypes: true })) {
    const file = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...await tree(base, file)); else found.push(file);
  }
  return found.sort();
}

// Verifies `zip`, or an already extracted build in `dir`. `pinned: false` accepts a stand-in runtime (tests).
export async function verifyStudio({ zip, dir, pinned = true, allowDev = false, keep = false, window = Boolean(zip), log = console.log }) {
  const results = [], notes = [];
  const check = async (name, run) => {
    try { const detail = await run(); results.push({ name, ok: true }); log(`  ok    ${name}${detail ? ` (${detail})` : ''}`); }
    catch (error) { results.push({ name, ok: false, error: error.message }); log(`  FAIL  ${name}\n        ${String(error.message).replace(/\n/g, '\n        ')}`); }
  };
  const note = text => { notes.push(text); log(`  note  ${text}`); };
  const windows = process.platform === 'win32' && process.arch === 'x64', systemRoot = process.env.SystemRoot ?? 'C:\\Windows', system = path.join(systemRoot, 'System32');
  const powershell = path.join(system, 'WindowsPowerShell', 'v1.0', 'powershell.exe'), comspec = path.join(system, 'cmd.exe');
  // What a PC without developer tools offers: Windows' own folders on PATH and no Node or npm settings. PowerShell 7's
  // module path goes too: Windows PowerShell started with it cannot load its own modules.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(path|psmodulepath|node_.*|npm_.*)$/i.test(key)));
  env.PATH = [system, systemRoot, path.join(system, 'Wbem'), path.dirname(powershell)].join(';');
  const ps = (script, extra = {}) => spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], { env: { ...env, ...extra }, encoding: 'utf8', windowsHide: true, timeout: 120000 });
  let workspace = null;

  if (zip) {
    log(`Archive ${zip}`);
    const bytes = await readFile(zip), name = path.basename(zip, '.zip');
    let entries = new Map();
    await check('the .sha256 file beside the ZIP matches it', async () => {
      const [hash, file] = (await readFile(`${zip}.sha256`, 'utf8')).trim().split(/\s+/);
      assert.equal(hash, sha256(bytes)); assert.equal(file, path.basename(zip)); return hash;
    });
    await check('the ZIP reads cleanly and holds one top-level folder named after it', () => {
      entries = new Map([...readZip(bytes)].map(([file, entry]) => [file, entry.read()]));
      assert.deepEqual([...new Set([...entries.keys()].map(file => file.split('/')[0]))], [name]); return `${entries.size} files`;
    });
    // mkdtemp keeps the prefix, so every later path carries the space and the accented letter.
    workspace = await realpath(await mkdtemp(path.join(os.tmpdir(), 'PixelForge Studio vérifié ')));
    dir = path.join(workspace, name);
    await check(`it extracts into "${workspace}"${windows ? ' with Windows\' own ZIP reader, byte for byte' : ''}`, async () => {
      if (windows) {
        const run = ps('Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory($env:PF_ZIP, $env:PF_DEST)', { PF_ZIP: path.resolve(zip), PF_DEST: workspace });
        assert.equal(run.status, 0, run.stderr);
        assert.deepEqual((await tree(workspace)), [...entries.keys()].sort());
        for (const [file, data] of entries) assert.ok(data.equals(await readFile(path.join(workspace, file))), `${file} differs after extraction`);
      } else for (const [file, data] of entries) { await mkdir(path.dirname(path.join(workspace, file)), { recursive: true }); await writeFile(path.join(workspace, file), data); }
    });
  } else dir = await realpath(dir);
  const files = await tree(dir), read = file => readFile(path.join(dir, file), 'utf8');
  const info = Object.fromEntries((await read('BUILD-INFO.txt').catch(() => '')).split(/\r?\n/).map(line => /^([^:]+): (.*)$/.exec(line)?.slice(1)).filter(Boolean));
  const start = await read('START HERE.txt').catch(() => ''), pkg = JSON.parse(await read('app/package.json').catch(() => '{}'));

  log('Contents');
  await check('the launcher, command wrapper, helper, START HERE, BUILD-INFO, notices and runtime are present', () => {
    assert.deepEqual(REQUIRED.filter(file => !files.includes(file)), []);
  });
  await check('app/ holds every entry of package.json\'s files list and no demo, test or development script', () => {
    assert.deepEqual(pkg.files.filter(entry => !files.some(file => file === `app/${entry}` || file.startsWith(`app/${entry}/`))), []);
    assert.deepEqual(files.filter(file => FORBIDDEN.some(folder => file.startsWith(`${folder}/`) || file.startsWith(`app/${folder}/`)) || /\.test\.[cm]?js$/.test(file)), []);
    return `${files.filter(file => file.startsWith('app/')).length} files`;
  });
  await check('BUILD-INFO names the PixelForge version, the source commit and the Node.js runtime with its SHA-256', async () => {
    assert.equal(info['PixelForge version'], pkg.version);
    assert.match(info['Source commit'], allowDev ? /^([0-9a-f]{40}|unknown)/ : /^[0-9a-f]{40}$/, 'a release build names a clean commit; pass --allow-dev to accept a development build');
    assert.equal(info['node.exe SHA-256'], sha256(await readFile(path.join(dir, 'runtime', 'node.exe'))));
    if (pinned) { assert.equal(info['Node.js version'], NODE.version); assert.equal(info['node.exe SHA-256'], NODE.exeSha256); assert.equal(info['Node.js archive SHA-256'], NODE.sha256); assert.equal(info['Node.js origin'], NODE.url); }
    return `PixelForge ${pkg.version} at ${info['Source commit'].slice(0, 12)}, Node.js ${info['Node.js version']}`;
  });
  await check('the batch files are plain ASCII with CRLF line endings', async () => {
    for (const file of files.filter(name => name.endsWith('.cmd'))) {
      const text = await readFile(path.join(dir, file), 'latin1');
      assert.ok(/^[\x09\x0d\x0a\x20-\x7e]*$/.test(text) && !/[^\r]\n/.test(text) && text.includes('\r\n'), file);
    }
  });
  await check('START HERE says in one line where the Emberfall and Tidewatch demos are', () => {
    assert.ok(start.split(/\r?\n/).some(line => /Emberfall/.test(line) && /Tidewatch/.test(line) && /GitHub/.test(line)));
    assert.match(start, /https:\/\/github\.com\/skulitom\/PixelForge/);
    for (const name of ['PixelForge Studio.cmd', 'Connect your agent.cmd', 'first-edit.json']) assert.ok(start.includes(name), `START HERE does not mention ${name}`);
  });

  if (!windows) note('Runtime checks skipped: they need 64-bit Windows.');
  else {
    const cmd = (line, options = {}) => spawnSync(comspec, ['/d', '/s', '/c', `"${line}"`], { cwd: dir, env, encoding: 'utf8', windowsVerbatimArguments: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000, ...options });
    const running = () => {
      const run = ps('Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($env:PF_DIR, [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { "$($_.ProcessId) $($_.Name)" }', { PF_DIR: dir + path.sep });
      assert.equal(run.status, 0, run.stderr); return run.stdout.split(/\r?\n/).filter(Boolean);
    };
    const settled = async () => { for (let i = 0; ; i++) { const left = running(); if (!left.length || i === 20) return left; await sleep(500); } };
    const launchers = [];
    const launch = () => new Promise((resolve, reject) => {
      const child = spawn(comspec, ['/d', '/s', '/c', `""${path.join(dir, 'PixelForge Studio.cmd')}" --no-browser"`], { cwd: os.tmpdir(), env, windowsVerbatimArguments: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let text = '';
      const timer = setTimeout(() => reject(new Error(`no address within 30 seconds; output so far:\n${text}`)), 30000);
      launchers.push(child);
      for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
        text += chunk;
        const address = /http:\/\/127\.0\.0\.1:(\d+)\//.exec(text);
        if (address && /Stop:/.test(text)) { clearTimeout(timer); resolve({ child, url: address[0].slice(0, -1), port: Number(address[1]), text }); }
      });
      child.once('error', reject); child.once('exit', code => { clearTimeout(timer); reject(new Error(`the launcher exited with code ${code}:\n${text}`)); });
    });
    const status = (url, options = {}) => new Promise((resolve, reject) => { const request = http.request(url, options, response => { response.resume(); resolve(response.statusCode); }); request.on('error', reject); request.end(options.body); });

    log('Environment');
    await check('no Node.js and no git on PATH for anything started below', () => {
      for (const tool of ['node', 'git', 'npm']) assert.notEqual(spawnSync(path.join(system, 'where.exe'), [tool], { env, windowsHide: true }).status, 0, `${tool} is on PATH`);
    });
    await check('the bundled runtime starts and reports the version in BUILD-INFO', () => {
      const run = spawnSync(path.join(dir, 'runtime', 'node.exe'), ['--version'], { env, encoding: 'utf8', windowsHide: true });
      assert.equal(run.stdout.trim(), `v${info['Node.js version']}`, run.stderr || String(run.error)); return run.stdout.trim();
    });
    note(`Elevated (administrator) process: ${/S-1-16-(12288|16384)/.test(spawnSync(path.join(system, 'whoami.exe'), ['/groups'], { encoding: 'utf8', windowsHide: true }).stdout) ? 'yes' : 'no'}`);
    const signature = ps('$s = Get-AuthenticodeSignature -LiteralPath $env:PF_FILE; "$($s.Status): $($s.SignerCertificate.Subject)"', { PF_FILE: path.join(dir, 'runtime', 'node.exe') });
    note(`node.exe Authenticode signature: ${signature.stdout.trim() || 'could not be read'}`);

    log('Studio');
    let first, second, paths = [];
    await check('the launcher in no-browser mode prints a loopback address and how to stop', async () => { first = await launch(); assert.match(first.text, /close this window/i); return first.url; });
    await check('a second copy starts beside the first on another port', async () => {
      second = await launch(); assert.notEqual(second.port, first.port);
      assert.equal(await status(first.url), 200); assert.equal(await status(second.url), 200); return second.url;
    });
    await check('it listens on 127.0.0.1 only', () => {
      const listening = spawnSync(path.join(system, 'netstat.exe'), ['-ano', '-p', 'TCP'], { encoding: 'utf8', windowsHide: true }).stdout.split(/\r?\n/).map(line => line.trim().split(/\s+/)).filter(([, local, , state]) => state === 'LISTENING' && local.endsWith(`:${first.port}`));
      assert.deepEqual(listening.map(([, local]) => local), [`127.0.0.1:${first.port}`]);
    });
    await check('every studio route answers 200 and anything else 404', async () => {
      ({ STUDIO_PATHS: paths } = await import(pathToFileURL(path.join(dir, 'app', 'src', 'server.js'))));
      assert.ok(paths.length >= 15);
      for (const route of paths) assert.equal(await status(first.url + route), 200, route);
      for (const route of ['/package.json', '/src/server.js', '/..%2fBUILD-INFO.txt']) assert.equal(await status(first.url + route), 404, route);
      return `${paths.length} routes`;
    });
    await check('a foreign Host header and a foreign Origin are refused with 403', async () => {
      assert.equal(await status(first.url, { headers: { Host: 'evil.example' } }), 403);
      assert.equal(await status(first.url + '/api/export', { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}' }), 403);
    });
    await check('an export returns a ZIP that contains preview.html', async () => {
      const response = await fetch(first.url + '/api/export', { method: 'POST', headers: { Origin: first.url, 'Content-Type': 'application/json' }, body: await read('app/examples/forest-spirit.json') });
      assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'application/zip');
      const bundle = readZip(Buffer.from(await response.arrayBuffer()));
      assert.match(bundle.get('preview.html').read().toString(), /^<!doctype html>/); return `${bundle.size} files`;
    });
    await check('stopping the launchers leaves no process behind', async () => {
      for (const { pid } of launchers) spawnSync(path.join(system, 'taskkill.exe'), ['/pid', String(pid), '/t', '/f'], { windowsHide: true });
      assert.deepEqual(await settled(), []);
      await assert.rejects(fetch(first.url), 'the studio still answers after its launcher was stopped');
    });

    // What a double-click does: the launcher in a console window of its own, closed the way its X button closes it.
    // Opens a minimised window, so it only runs for a ZIP (or on request) and only where there is a desktop.
    if (window) {
      const run = ps([
        "function Under { @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($env:PF_DIR, [StringComparison]::OrdinalIgnoreCase) }) }",
        "$p = Start-Process -FilePath $env:ComSpec -ArgumentList ('/d /s /c \"\"' + $env:PF_LAUNCHER + '\" --no-browser\"') -WindowStyle Minimized -PassThru",
        "for ($i = 0; $i -lt 60 -and (Under).Count -eq 0; $i++) { Start-Sleep -Milliseconds 250 }",
        "Start-Sleep -Milliseconds 500; $p.Refresh()",
        "if ((Under).Count -eq 0 -or $p.MainWindowHandle -eq 0) { & taskkill.exe /pid $p.Id /t /f 2>&1 | Out-Null; 'NOWINDOW'; exit }",
        "[void]$p.CloseMainWindow()",
        "for ($i = 0; $i -lt 60 -and (Under).Count -gt 0; $i++) { Start-Sleep -Milliseconds 250 }",
        "'CLOSED ' + (Under).Count"
      ].join('; '), { PF_DIR: dir + path.sep, PF_LAUNCHER: path.join(dir, 'PixelForge Studio.cmd') });
      if (/^CLOSED \d+/m.test(run.stdout)) await check('closing the launcher\'s console window leaves no process behind', () => assert.match(run.stdout, /^CLOSED 0\s*$/m));
      else note(`Window-close check not run: no console window could be opened here (${(run.stdout || run.stderr).trim().split(/\r?\n/).pop() || 'no output'}).`);
      for (const line of running()) spawnSync(path.join(system, 'taskkill.exe'), ['/pid', line.split(' ')[0], '/t', '/f'], { windowsHide: true });
    }

    log('Command line');
    const lines = start.split(/\r?\n/).map(line => /^ {4}(\.\\pixelforge .+)$/.exec(line)?.[1]).filter(Boolean);
    await check('START HERE gives init, validate, inspect, patch and render', () => assert.deepEqual(lines.map(line => line.split(' ')[1]), COMMANDS));
    for (const line of lines) await check(line, () => {
      const run = cmd(line); assert.equal(run.status, 0, run.stderr || run.stdout); assert.equal(JSON.parse(run.stdout).ok, true);
    });
    await check('the commands wrote what START HERE says, inside the folder', async () => {
      assert.equal((await readFile(path.join(dir, 'hero-frames.png'))).toString('latin1', 1, 4), 'PNG');
      assert.equal(JSON.parse(await read('hero-v2.pixel.json')).palette.L, JSON.parse(await read('first-edit.json'))[0].value);
      assert.match(await read('output/hero/preview.html'), /^<!doctype html>/);
    });
    await check('a second run refuses to replace an existing file', () => {
      const run = cmd(lines[0]); assert.equal(run.status, 1); assert.equal(JSON.parse(run.stderr).ok, false);
    });
    await check('two renders of one recipe are identical', async () => {
      const run = cmd('.\\pixelforge render hero-v2.pixel.json --out output\\hero-again'); assert.equal(run.status, 0, run.stderr);
      const once = await tree(path.join(dir, 'output', 'hero'));
      assert.deepEqual(await tree(path.join(dir, 'output', 'hero-again')), once);
      for (const file of once) assert.ok((await readFile(path.join(dir, 'output', 'hero', file))).equals(await readFile(path.join(dir, 'output', 'hero-again', file))), file);
      return `${once.length} files`;
    });
    await check('the same commands work from PowerShell', () => {
      const run = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', '.\\pixelforge validate hero.pixel.json; exit $LASTEXITCODE'], { cwd: dir, env, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      assert.equal(run.status, 0, run.stderr); assert.equal(JSON.parse(run.stdout).ok, true);
      assert.match(cmd('.\\pixelforge help').stdout, /pixelforge init/);
    });

    log('Agent connection');
    let settings;
    await check('the helper prints settings for Claude Code, Claude Desktop, Codex and Cursor that parse and point into this folder', async () => {
      const helper = `"${path.join(dir, 'Connect your agent.cmd')}"`, json = cmd(`${helper} --json`, { cwd: os.tmpdir() }), text = cmd(helper, { cwd: os.tmpdir() });
      assert.equal(json.status, 0, json.stderr); assert.equal(text.status, 0, text.stderr);
      settings = JSON.parse(json.stdout);
      assert.equal(settings.folder, dir); assert.equal(settings.server.command, path.join(dir, 'runtime', 'node.exe'));
      await access(settings.server.command); await access(settings.server.args[0]);
      assert.deepEqual(settings.server.args.slice(1), ['mcp', '--out', path.join(dir, 'output')]);
      assert.deepEqual(settings.clients.map(client => client.id), ['claude-code', 'claude-desktop', 'codex', 'cursor']);
      for (const client of settings.clients) {
        const parsed = client.format === 'json' ? JSON.parse(client.text).mcpServers.pixelforge
          : { command: JSON.parse(/^command = (.*)$/m.exec(client.text)[1]), args: JSON.parse(/^args = (.*)$/m.exec(client.text)[1]) };
        assert.deepEqual(parsed, settings.server, client.name);
        assert.ok(text.stdout.replace(/\r\n/g, '\n').includes(`${client.name} `) && text.stdout.replace(/\r\n/g, '\n').includes(client.text), `${client.name} is missing from the printed settings`);
      }
    });
    await check('the MCP server initialises, lists eight tools and renders over stdio on the bundled runtime', async () => {
      const child = spawn(settings.server.command, settings.server.args, { cwd: os.tmpdir(), env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      let output = '', errors = '';
      child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { errors += chunk; });
      const messages = [{ id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'verify-studio', version: '1' } } }, { method: 'notifications/initialized' }, { id: 2, method: 'tools/list' }, { id: 3, method: 'tools/call', params: { name: 'pixel_render', arguments: { project: JSON.parse(await read('app/examples/coin.json')) } } }];
      child.stdin.end(messages.map(message => JSON.stringify({ jsonrpc: '2.0', ...message })).join('\n') + '\n');
      const code = await new Promise(resolve => { const timer = setTimeout(() => { child.kill(); resolve('a timeout'); }, 60000); child.once('exit', status => { clearTimeout(timer); resolve(status); }); });
      assert.equal(code, 0, `the server ended with ${code}: ${errors}`);
      const [initialized, listed, rendered] = output.trim().split('\n').map(line => JSON.parse(line).result);
      assert.equal(initialized.serverInfo.version, pkg.version); assert.equal(listed.tools.length, 8);
      assert.ok(!rendered.isError, JSON.stringify(rendered)); assert.equal(rendered.content[1].mimeType, 'image/png');
      const written = JSON.parse(rendered.content[0].text);
      assert.ok(written.directory.startsWith(path.join(dir, 'output') + path.sep), `rendered outside the folder: ${written.directory}`);
      await access(written.playback); return `${listed.tools.map(tool => tool.name).join(', ')}`;
    });

    log('Afterwards');
    await check('nothing from the folder is still running', async () => assert.deepEqual(await settled(), []));
    if (workspace && !keep) await check('deleting the folder removes everything', async () => { await rm(workspace, { recursive: true }); await assert.rejects(access(workspace)); workspace = null; });
  }
  if (workspace && !keep) await rm(workspace, { recursive: true, force: true }).catch(() => {});
  if (workspace && keep) note(`Kept ${workspace}`);
  const failed = results.filter(result => !result.ok);
  log(`${results.length - failed.length} of ${results.length} checks passed${failed.length ? `; failed: ${failed.map(result => result.name).join('; ')}` : ''}${windows ? '' : ' (static checks only)'}`);
  return { ok: failed.length === 0, complete: windows, results, notes };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), zip = args.find(argument => !argument.startsWith('--'));
  if (!zip || args.some(argument => argument.startsWith('--') && !['--allow-dev', '--keep'].includes(argument))) { console.error('Usage: node scripts/verify-studio.mjs <PixelForgeStudio-...-win-x64.zip> [--allow-dev] [--keep]'); process.exit(2); }
  const outcome = await verifyStudio({ zip, allowDev: args.includes('--allow-dev'), keep: args.includes('--keep') }).catch(error => { console.error(error.stack); return { ok: false, complete: true }; });
  // A run that could not exercise the build is not a pass.
  process.exitCode = !outcome.ok ? 1 : outcome.complete ? 0 : 3;
}
