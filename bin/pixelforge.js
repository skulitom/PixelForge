#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderProject, createBundle, writeBundle, inspectProject, encodePNG } from '../src/index.js';

const HELP = `PixelForge — text to pixels, without dependencies

  pixelforge init [file.json]              Create an editable example
  pixelforge validate <file.json|->        Validate and describe a project
  pixelforge inspect <file.json|-> [--out sheet.png] [--grid]
                                           See every frame; writes only --out
  pixelforge render <file.json|-> --out dir Export a complete asset bundle
  pixelforge preview [file.json] [--port 4747]
  pixelforge mcp [--out directory]         Run the MCP server over stdio
  pixelforge schema                       Print the JSON Schema

Options: --force allows overwriting exported files. '-' reads JSON from stdin.
Inspect: --frames a,b or --animation name picks cells; --region x,y,w,h crops;
--grid adds palette-key rows; --scale 1-16 and --background color style the sheet.
All command results except the preview server are JSON. Errors exit with code 1.
No installation needed: node bin/pixelforge.js <command>
`;

function parseArgs(args) {
  const positional = [], options = {};
  for (let i = 0; i < args.length; i++) {
    if (['--force', '--grid'].includes(args[i])) options[args[i].slice(2)] = true;
    else if (['--out', '--port', '--frames', '--animation', '--region', '--scale', '--background'].includes(args[i])) {
      const key = args[i].slice(2);
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`--${key} requires a value`);
      options[key] = args[++i];
    } else if (args[i].startsWith('--')) throw new Error(`Unknown option: ${args[i]}`);
    else positional.push(args[i]);
  }
  return { positional, options };
}
async function readProject(file) {
  if (!file) throw new Error('Provide a project JSON filename or - for stdin');
  let source;
  if (file === '-') { const chunks = []; for await (const chunk of process.stdin) chunks.push(chunk); source = Buffer.concat(chunks).toString('utf8'); }
  else source = await readFile(file, 'utf8');
  return JSON.parse(source.replace(/^\uFEFF/, ''));
}
function inspectOptions({ frames, animation, region, grid, scale, background }) {
  if (region !== undefined && !/^\d+,\d+,\d+,\d+$/.test(region)) throw new Error('--region expects four whole numbers: x,y,w,h');
  const [x, y, w, h] = region?.split(',').map(Number) ?? [];
  return { ...(frames !== undefined && { frames: frames.split(',') }), ...(animation !== undefined && { animation }), ...(region !== undefined && { region: { x, y, w, h } }), ...(grid && { grid }), ...(scale !== undefined && { scale: Number(scale) }), ...(background !== undefined && { background }) };
}
const summary = project => ({ name: project.name, width: project.width, height: project.height, frames: project.frames.length, animations: Object.keys(project.animations), warnings: project.warnings });
try {
  const [command = 'help', ...rest] = process.argv.slice(2);
  if (['help', '--help', '-h'].includes(command)) process.stdout.write(HELP);
  else {
    const { positional, options } = parseArgs(rest);
    if (positional.length > 1) throw new Error('Too many positional arguments');
    const allowed = { init: ['force'], validate: [], inspect: ['frames', 'animation', 'region', 'grid', 'scale', 'background', 'out', 'force'], render: ['out', 'force'], preview: ['port'], mcp: ['out'], schema: [] };
    if (!Object.hasOwn(allowed, command)) throw new Error(`Unknown command: ${command}. Run pixelforge help.`);
    for (const key of Object.keys(options)) if (!allowed[command].includes(key)) throw new Error(`--${key} is not supported by ${command}`);
    if (['schema', 'mcp'].includes(command) && positional.length) throw new Error(`${command} does not accept a filename`);
    if (command === 'init') {
      const file = positional[0] ?? 'sprite.pixel.json';
      await writeFile(file, await readFile(new URL('../examples/forest-spirit.json', import.meta.url)), { flag: options.force ? 'w' : 'wx' });
      console.log(JSON.stringify({ ok: true, file }));
    } else if (command === 'schema') process.stdout.write(await readFile(new URL('../schema.json', import.meta.url), 'utf8'));
    else if (command === 'mcp') {
      const { startMCP } = await import('../src/mcp.js'); await startMCP({ directory: options.out });
    } else if (command === 'preview') {
      const { startStudio } = await import('../src/server.js');
      const port = options.port === undefined ? 4747 : Number(options.port);
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Port must be an integer from 0 to 65535');
      await startStudio({ port, project: positional[0] ? await readProject(positional[0]) : undefined });
    } else if (command === 'inspect') {
      const project = renderProject(await readProject(positional[0]));
      const view = inspectProject(project, inspectOptions(options)), { data, ...sheet } = view.sheet;
      const image = options.out && path.resolve(options.out);
      if (image) {
        if (!/\.png$/i.test(image)) throw new Error('inspect --out must name a .png file');
        await mkdir(path.dirname(image), { recursive: true });
        try { await writeFile(image, encodePNG(data, sheet.width, sheet.height), { flag: options.force ? 'w' : 'wx' }); }
        catch (error) { throw error.code === 'EEXIST' ? new Error(`Output already exists: ${image}. Choose a new file or pass --force.`) : error; }
      }
      // Pretty-printed so grid rows line up for reading.
      console.log(JSON.stringify({ ok: true, ...summary(project), region: view.region, sheet, cells: view.cells, ...(view.grids && { legend: view.legend, grids: view.grids }), ...(image && { image }) }, null, 2));
    } else {
      const spec = await readProject(positional[0]);
      if (command === 'validate') console.log(JSON.stringify({ ok: true, ...summary(renderProject(spec)) }));
      else {
        if (!options.out) throw new Error('render requires --out <directory>');
        const bundle = await createBundle(spec), files = await writeBundle(bundle, options.out, options);
        console.log(JSON.stringify({ ok: true, ...summary(bundle.project), files }));
      }
    }
  }
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message, ...(error.path ? { path: error.path } : {}) })); process.exitCode = 1;
}
