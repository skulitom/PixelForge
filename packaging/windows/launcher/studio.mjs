// Double-click launcher: starts the studio on a free loopback port and opens it in the default browser.
//   --no-browser   print the address without opening a browser (used by automated checks)
import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, version } from './layout.mjs';

const unknown = process.argv.slice(2).filter(argument => argument !== '--no-browser');
if (unknown.length) {
  console.error(`Unknown option: ${unknown[0]}\nUsage: "PixelForge Studio.cmd" [--no-browser]\nTo open a recipe from the command line: pixelforge preview <file.json>`);
  process.exit(1);
}
let server;
try {
  const { startStudio } = await import(pathToFileURL(path.join(app, 'src', 'server.js')));
  // Port 0 asks the system for a free port, so a second copy or another program on 4747 never blocks the start.
  server = await startStudio({ port: 0, quiet: true });
} catch (error) {
  console.error(`PixelForge Studio could not start: ${error.message}`);
  process.exit(1);
}
const url = `http://127.0.0.1:${server.address().port}/`;
console.log(`PixelForge Studio ${version}

  Open:  ${url}
  Stop:  close this window, or press Ctrl+C.

The studio runs on this computer only. There is no autosave: use "Save JSON" in the studio to keep a recipe.
`);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.closeAllConnections(); server.close(); console.log('PixelForge Studio stopped.'); process.exit(0); });

if (!process.argv.includes('--no-browser')) {
  // rundll32 hands the address to whatever handles http links, without a shell that would need quoting.
  const opened = process.platform === 'win32' && await new Promise(resolve => {
    const child = spawn(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'rundll32.exe'), ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore', windowsHide: true });
    child.once('error', () => resolve(false)); child.once('spawn', () => { child.unref(); resolve(true); });
  });
  if (!opened) console.log('No browser was opened. Copy the address above into your browser.');
}
