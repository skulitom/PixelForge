// Double-click launcher: `pixelforge preview --open` with a few words for someone who has never seen a console.
// A recipe, scene or source file dropped on "PixelForge Studio.cmd" arrives as an argument and opens in the studio.
//   --no-browser   start without opening a browser (used by automated checks)
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, version } from './layout.mjs';

const given = process.argv.slice(2), files = given.filter(argument => argument !== '--no-browser');
console.log(`PixelForge Studio ${version}

Close this window to stop it. The studio runs on this computer only. Use "Save JSON" in the studio to keep a
recipe; unsaved edits are kept as a draft in your browser and offered back next time.
`);
// Ctrl+C is an ordinary way to stop, not an error for the window to report.
process.on('SIGINT', () => process.exit(0));
process.argv = [process.argv[0], path.join(app, 'bin', 'pixelforge.js'), 'preview', ...files, ...(given.includes('--no-browser') ? [] : ['--open'])];
await import(pathToFileURL(process.argv[1]));
