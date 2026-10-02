// Double-click launcher: starts the studio on a loopback port and opens it in the default browser. It asks for the
// same port every time, because the studio's unsaved-draft recovery lives in browser storage and browsers keep
// storage per address. If that port is taken (a second copy, another program) it takes any free one instead.
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
const USUAL_PORT = 4748;
let server;
try {
  const { startStudio } = await import(pathToFileURL(path.join(app, 'src', 'server.js')));
  // 4747 stays free for `pixelforge preview`. Port 0 asks the system for any free port.
  server = await startStudio({ port: USUAL_PORT, quiet: true }).catch(error => { if (error.code !== 'EADDRINUSE') throw error; return startStudio({ port: 0, quiet: true }); });
} catch (error) {
  console.error(`PixelForge Studio could not start: ${error.message}`);
  process.exit(1);
}
const url = `http://127.0.0.1:${server.address().port}/`, moved = server.address().port === USUAL_PORT ? '' : `
Port ${USUAL_PORT} is in use, so this copy has another address. A draft kept at the usual address is not shown here.`;
// One write, so anything reading the output sees the whole message at once.
console.log(`PixelForge Studio ${version}

  Open:  ${url}
  Stop:  close this window, or press Ctrl+C.
${moved}
The studio runs on this computer only. Use "Save JSON" in the studio to keep a recipe; unsaved edits are kept
as a draft in your browser and offered back next time.
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
