import { readFile, mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { renderProject, scalePixels, inspectProject } from './core.js';
import { encodePNG } from './png.js';
import { createBundle, writeBundle } from './export.js';

const versions = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const textContent = value => ({ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) });
// Rulers let an agent read grid coordinates without counting characters.
function gridText({ region, legend, grids }) {
  const label = String(region.y + region.h - 1).length, xs = Array.from({ length: region.w }, (_, i) => region.x + i);
  const rulers = [100, 10, 1].filter(p => p === 1 || xs.at(-1) >= p).map(p => ' '.repeat(label + 2) + xs.map(x => (x >= p || p === 1 ? Math.floor(x / p) % 10 : ' ')).join(''));
  const lines = [`Palette-key grids for x ${region.x}–${region.x + region.w - 1}, y ${region.y}–${region.y + region.h - 1}. "." is transparent.`];
  for (const [symbol, entry] of Object.entries(legend)) lines.push(symbol === '?' ? `? = ${entry.colors} more colors without a symbol` : `${symbol} = ${entry.palette ? `palette "${entry.palette}" ${entry.color}` : `${entry.color}, not in the palette`}`);
  for (const { frame, rows } of grids) lines.push('', frame, ...rulers, ...rows.map((row, y) => `${String(region.y + y).padStart(label)}  ${row}`));
  return lines.join('\n');
}
export async function startMCP({ directory = 'output', input = process.stdin, output = process.stdout } = {}) {
  const schema = JSON.parse(await readFile(new URL('../schema.json', import.meta.url), 'utf8'));
  const { $schema, $defs, ...projectSchema } = schema;
  const projectInput = { type: 'object', properties: { project: projectSchema }, required: ['project'], additionalProperties: false, $defs };
  const coordinate = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
  const inspectInput = { ...projectInput, properties: {
    project: projectSchema,
    frames: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 1024, description: 'Frame names to show, in this order. Default: every frame.' },
    animation: { type: 'string', description: 'Show one animation in playback order instead of frames.' },
    region: { type: 'object', properties: { x: coordinate(0, 255), y: coordinate(0, 255), w: coordinate(1, 256), h: coordinate(1, 256) }, required: ['x', 'y', 'w', 'h'], additionalProperties: false, description: 'Crop every frame to this canvas rectangle. Smaller regions are shown larger.' },
    grid: { type: 'boolean', description: 'Also return each frame as palette-key text rows with x/y rulers. At most 16,384 pixels in total.' },
    scale: { type: 'integer', minimum: 1, maximum: 16, description: 'Contact sheet scale. Default: the largest that fits about 1024px.' },
    background: { type: 'string', description: 'Cell background: checker (default), transparent, a palette name or a hex color.' }
  } };
  const tools = [
    { name: 'pixel_help', description: 'Get the PixelForge authoring guide, JSON Schema, and a complete editable example. Start here.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
    { name: 'pixel_validate', description: 'Validate a pixel project and return dimensions, frame timing, animations, and clipping warnings without writing files.', inputSchema: projectInput, annotations: { readOnlyHint: true } },
    { name: 'pixel_inspect', description: 'See a project without writing files. Returns one PNG contact sheet of every frame (or the chosen frames, or one animation in playback order), read left to right and top to bottom, with each cell\'s frame name and duration. With grid: true it also returns palette-key text grids with x/y rulers for exact pixel checks. Use region to zoom in. Use this while iterating; call pixel_render to export.', inputSchema: inspectInput, annotations: { readOnlyHint: true } },
    { name: 'pixel_render', description: 'Render a project into PNG sprite sheet, atlas JSON, individual PNGs, APNG animations, CSS, and Canvas player. Writes a new unique folder inside the configured export directory and returns paths plus a PNG preview.', inputSchema: projectInput, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } }
  ];
  const send = value => output.write(JSON.stringify(value) + '\n');
  let initialized = false;
  async function handle(line) {
    let request;
    try { request = JSON.parse(line); } catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return; }
    if (!request || Array.isArray(request) || request.jsonrpc !== '2.0' || typeof request.method !== 'string' || ('id' in request && typeof request.id !== 'string' && !(typeof request.id === 'number' && Number.isFinite(request.id)))) {
      send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } }); return;
    }
    if (!Object.hasOwn(request, 'id')) return;
    const { id, method, params } = request;
    const error = (code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });
    const result = value => send({ jsonrpc: '2.0', id, result: value });
    if (method === 'initialize') {
      if (!params || typeof params.protocolVersion !== 'string') { error(-32602, 'protocolVersion is required'); return; }
      initialized = true;
      result({ protocolVersion: versions.includes(params.protocolVersion) ? params.protocolVersion : versions[0], capabilities: { tools: {} }, serverInfo: { name: 'pixelforge', version: '0.1.0' }, instructions: 'Call pixel_help for the JSON format. Use small grids and reusable symbols. Call pixel_inspect to see every frame, and grid: true to read exact pixels, without writing files; call pixel_render to export game-ready files.' }); return;
    }
    if (method === 'ping') { result({}); return; }
    if (!initialized) { error(-32000, 'Initialize the server first'); return; }
    if (method === 'tools/list') { result({ tools }); return; }
    if (method !== 'tools/call') { error(-32601, `Unknown method: ${method}`); return; }
    const tool = tools.find(t => t.name === params?.name);
    if (!tool) { error(-32602, 'Unknown tool'); return; }
    const args = params.arguments ?? {};
    if (args === null || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(k => !Object.hasOwn(tool.inputSchema.properties, k))) { error(-32602, 'Invalid tool arguments'); return; }
    try {
      if (params.name === 'pixel_help') {
        const guide = await readFile(new URL('../docs/agent-guide.md', import.meta.url), 'utf8');
        const example = JSON.parse(await readFile(new URL('../examples/forest-spirit.json', import.meta.url), 'utf8'));
        result({ content: [textContent(guide), textContent({ schema, example })] });
      } else if (params.name === 'pixel_validate') {
        const project = renderProject(args.project);
        result({ content: [textContent({ ok: true, width: project.width, height: project.height, frames: project.frames.map(({ name, duration }) => ({ name, duration })), animations: project.animations, warnings: project.warnings })] });
      } else if (params.name === 'pixel_inspect') {
        const { project: spec, ...options } = args;
        const project = renderProject(spec), view = inspectProject(project, options), { data, ...sheet } = view.sheet;
        const content = [
          textContent({ ok: true, name: project.name, width: project.width, height: project.height, region: view.region, sheet, cells: view.cells, warnings: project.warnings }),
          { type: 'image', mimeType: 'image/png', data: encodePNG(data, sheet.width, sheet.height).toString('base64') }
        ];
        if (view.grids) content.push(textContent(gridText(view)));
        result({ content });
      } else {
        const bundle = await createBundle(args.project);
        await mkdir(path.resolve(directory), { recursive: true });
        const out = await mkdtemp(path.join(path.resolve(directory), `${bundle.project.name}-`));
        const files = await writeBundle(bundle, out);
        const { width, height, frames } = bundle.project;
        const scale = Math.max(1, Math.min(8, Math.floor(256 / Math.max(width, height))));
        const image = encodePNG(scalePixels(frames[0].data, width, height, scale), width * scale, height * scale);
        result({ content: [textContent({ ok: true, directory: out, files, warnings: bundle.project.warnings }), { type: 'image', mimeType: 'image/png', data: image.toString('base64') }] });
      }
    } catch (cause) { result({ isError: true, content: [textContent({ error: cause.message, ...(cause.path ? { path: cause.path } : {}) })] }); }
  }
  input.setEncoding('utf8');
  let pending = '';
  // Sequential dispatch preserves initialization order and bounds parallel render memory.
  for await (const chunk of input) {
    pending += chunk;
    let newline;
    while ((newline = pending.indexOf('\n')) !== -1) {
      const line = pending.slice(0, newline).replace(/\r$/, ''); pending = pending.slice(newline + 1);
      if (Buffer.byteLength(line) > 2097152) throw new Error('MCP message exceeds 2 MiB');
      if (line.trim()) await handle(line);
    }
    if (Buffer.byteLength(pending) > 2097152) throw new Error('MCP message exceeds 2 MiB');
  }
  if (pending.trim()) await handle(pending);
}
