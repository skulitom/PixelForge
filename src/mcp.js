import { readFile, mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { PixelError, renderProject, inspectProject, compareProjects } from './core.js';
import { patchRecipe } from './patch.js';
import { createRevisionStore } from './revisions.js';
import { encodePNG } from './png.js';
import { createBundle, writeBundle } from './export.js';

const versions = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const textContent = value => ({ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) });
const imageContent = ({ data, width, height }) => ({ type: 'image', mimeType: 'image/png', data: encodePNG(data, width, height).toString('base64') });
function viewSummary({ sheet: { data, ...sheet }, nativeSheet, grids, legend, ...view }) {
  return { ...view, sheet, ...(nativeSheet && { nativeSheet: { ...nativeSheet, data: undefined } }) };
}
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
  const source = { project: projectSchema, revision: { type: 'string', pattern: '^[a-f0-9]{12}$', description: 'Revision id from an earlier PixelForge response. Send it instead of project to reuse that recipe, including after restarting with the same MCP --out directory.' } };
  const projectInput = { type: 'object', properties: source, additionalProperties: false, $defs };
  const renderInput = { ...projectInput, properties: { ...source, animation: { type: 'string', description: 'Preview this animation in playback order. Default: preview every frame in project order. All animations are always exported.' } } };
  const coordinate = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
  const inspectInput = { ...projectInput, properties: {
    ...source,
    layers: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 64, description: 'Isolate named layers, preserving inheritance/transforms/visibility. Omits frame ops, background and final canvas corrections, which do not belong to a named layer.' },
    reference: { type: 'string', description: 'Saved revision to compare against at the same origin. Adds a before/after image and changed-pixel report.' },
    frames: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 1024, description: 'Frame names to show, in this order. Default: every frame.' },
    animation: { type: 'string', description: 'Show one animation in playback order instead of frames.' },
    region: { type: 'object', properties: { x: coordinate(0, 255), y: coordinate(0, 255), w: coordinate(1, 256), h: coordinate(1, 256) }, required: ['x', 'y', 'w', 'h'], additionalProperties: false, description: 'Crop every frame to this canvas rectangle. Smaller regions are shown larger.' },
    grid: { type: 'boolean', description: 'Also return each frame as palette-key text rows with x/y rulers. At most 16,384 pixels in total.' },
    scale: { type: 'integer', minimum: 1, maximum: 16, description: 'Contact sheet scale. Default: the largest that fits about 1024px.' },
    background: { type: 'string', description: 'Cell background: checker (default), transparent, a palette name or a hex color.' },
    view: { enum: ['color', 'silhouette', 'grayscale', 'onion'], description: 'Onion uses pink previous/cyan next poses in animation playback order; requires animation.' },
    native: { type: 'boolean', description: 'Also return a native-size contact sheet beside the enlarged view.' },
    diagnostics: { type: 'boolean', description: 'Advisory duplicate, empty, isolated-pixel, palette and loop-boundary evidence, plus original animation timing.' },
    maxCells: { type: 'integer', minimum: 1, maximum: 256, description: 'Bound the preview with evenly spaced samples; returns omitted count and original positions. Does not alter exported animation.' }
  } };
  const patchInput = { ...projectInput, required: ['changes'], properties: {
    ...source,
    changes: { type: 'array', minItems: 1, maxItems: 1024, description: 'Edits applied in order. Paths match error paths, such as frames[3].duration; lists also accept [name] and [-] to append.', items: { type: 'object', properties: {
      set: { type: 'string', description: 'Path to replace, or an object field to add.' },
      insert: { type: 'string', description: 'List position to insert before; [-] appends.' },
      remove: { type: 'string', description: 'Object field or list item to delete.' },
      paint: { type: 'string', description: 'Frame path, such as frames[blink]. Replaces pixels in final canvas coordinates, after all layers, preserving source operations. Use transparent to erase.' },
      grid: { type: 'string', description: 'Frame path. Value: {x,y,rows,erase?,mask?}. Dots/spaces preserve; explicit erase character clears; mask x selects and dot preserves.' },
      move: { type: 'string', description: 'Frame path. Value: {x,y,w,h,dx,dy,mask?}. Moves exact pixels including corrections; erases selected source. Destination must fit.' },
      recolor: { type: 'string', description: 'Frame path. Value: {x,y,w,h,from,to,mask?}. Replaces only matching selected colors.' },
      scope: { enum: ['frame', 'inherited'], description: 'Canvas edits: inherited is default. frame preserves other poses by recording compensating canvas corrections, reported in edits.protected.' },
      value: { description: 'JSON value for set or insert; for paint, a list of {x, y, color} pixels inside the canvas (palette names or hex colors, exact RGBA replacement).' }
    }, additionalProperties: false } }
  } };
  const tools = [
    { name: 'pixel_help', description: 'Get the PixelForge authoring guide, JSON Schema, and a complete editable example. Start here.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
    { name: 'pixel_validate', description: 'Validate a pixel project and return its revision id, dimensions, frame timing, animations, and clipping warnings. Saves an immutable recipe revision; no asset export.', inputSchema: projectInput, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    { name: 'pixel_inspect', description: 'See a project without exporting assets. Returns one PNG contact sheet of every frame (or the chosen frames, or one animation in playback order), read left to right and top to bottom, with each cell\'s frame name and duration. With grid: true it also returns palette-key text grids with x/y rulers for exact pixel checks. Use region to zoom in. Saves an immutable recipe revision. Use this while iterating; call pixel_render to export.', inputSchema: inspectInput, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    { name: 'pixel_patch', description: 'Change a recipe with targeted edits instead of resending it. Pass revision or project, plus changes applied in order: {"set": path, "value": v}, {"insert": path, "value": v}, {"remove": path}, or {"paint": "frames[blink]", "value": [{"x": 9, "y": 7, "color": "k"}]}. Paint replaces exact RGBA in canvas coordinates after all layers; transparent erases. Other paths look like frames[blink].layers[body].ops[2].x2, palette.k or animations.idle.frames[-]. The patch is atomic and the result must validate. Returns the new revision, edit details, every frame whose pixels changed (exact pixels for small changes), timing and animation changes, and a before/after PNG with one row per frame. Saves immutable base and result revisions; render the revision to export assets.', inputSchema: patchInput, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    { name: 'pixel_render', description: 'Render a project into PNG sprite sheet, atlas JSON, individual PNGs, APNG animations, CSS, and Canvas player. Writes a new unique folder inside the configured export directory and saves an immutable recipe revision. Returns file paths, actual playback and a bounded contact sheet. Large previews report sample positions and omissions; all frames still export. Optionally select an animation.', inputSchema: renderInput, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } }
  ];
  const { remember, read } = createRevisionStore(directory);
  const recipeFrom = async (project, revision) => {
    if ((project === undefined) === (revision === undefined)) throw new PixelError('arguments', 'send either project or revision');
    if (project !== undefined) return project;
    return read(revision);
  };
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
      result({ protocolVersion: versions.includes(params.protocolVersion) ? params.protocolVersion : versions[0], capabilities: { tools: {} }, serverInfo: { name: 'pixelforge', version: '0.1.0' }, instructions: 'Call pixel_help for the JSON format. Use small grids and reusable symbols. Send a full recipe once; every response returns a revision id to use instead of project afterwards. Call pixel_inspect to see every frame (grid: true reads exact pixels), pixel_patch to make targeted edits and check what changed, and pixel_render to export game-ready files.' }); return;
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
      const { project: spec, revision, changes, ...options } = args;
      if (params.name === 'pixel_help') {
        const guide = await readFile(new URL('../docs/agent-guide.md', import.meta.url), 'utf8');
        const workflow = await readFile(new URL('../docs/art-workflow.md', import.meta.url), 'utf8');
        const example = JSON.parse(await readFile(new URL('../examples/forest-spirit.json', import.meta.url), 'utf8'));
        result({ content: [textContent(guide), textContent(workflow), textContent({ schema, example })] });
      } else if (params.name === 'pixel_validate') {
        const recipe = await recipeFrom(spec, revision), project = renderProject(recipe);
        result({ content: [textContent({ ok: true, revision: await remember(recipe), width: project.width, height: project.height, frames: project.frames.map(({ name, duration }) => ({ name, duration })), animations: project.animations, warnings: project.warnings })] });
      } else if (params.name === 'pixel_inspect') {
        const { layers, reference, ...inspection } = options;
        const recipe = await recipeFrom(spec, revision), project = renderProject(recipe, layers === undefined ? {} : { layers }), view = inspectProject(project, inspection);
        const comparison = reference === undefined ? null : compareProjects(renderProject(await read(reference), layers === undefined ? {} : { layers }), project);
        const content = [textContent({ ok: true, revision: await remember(recipe), name: project.name, width: project.width, height: project.height, ...viewSummary(view), warnings: project.warnings }), imageContent(view.sheet)];
        if (view.nativeSheet) content.push(imageContent(view.nativeSheet));
        if (view.grids) content.push(textContent(gridText(view)));
        if (reference !== undefined) {
          const { image, ...report } = comparison;
          content.push(textContent({ reference, comparison: report, ...(image && { comparisonImage: { region: image.region, frames: image.frames, omitted: image.omitted ?? 0 } }) }));
          if (image) content.push(imageContent(image.sheet));
        }
        result({ content });
      } else if (params.name === 'pixel_patch') {
        const base = await recipeFrom(spec, revision), before = renderProject(base), { recipe, edits } = patchRecipe(base, changes), after = renderProject(recipe);
        const { image, ...report } = compareProjects(before, after), baseId = await remember(base);
        const summary = { ok: true, revision: await remember(recipe), base: baseId, edits, ...report, ...(image && { image: { region: image.region, frames: image.frames, ...(image.omitted && { omitted: image.omitted }), scale: image.sheet.scale } }), warnings: after.warnings };
        result({ content: [textContent(summary), ...(image ? [imageContent(image.sheet)] : [])] });
      } else {
        const recipe = await recipeFrom(spec, revision), bundle = await createBundle(recipe), view = inspectProject(bundle.project, { ...options, maxCells: 256 });
        const savedRevision = await remember(recipe);
        await mkdir(path.resolve(directory), { recursive: true });
        const out = await mkdtemp(path.join(path.resolve(directory), `${bundle.project.name}-`));
        const files = await writeBundle(bundle, out);
        result({ content: [textContent({ ok: true, revision: savedRevision, directory: out, files, playback: path.join(out, 'preview.html'), preview: viewSummary(view), warnings: bundle.project.warnings }), imageContent(view.sheet)] });
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
