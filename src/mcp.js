import { readFile, mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { PixelError, MAX_REQUEST_BYTES, renderProject, inspectProject, compareProjects, scalePixels, reviewPixels } from './core.js';
import { patchRecipe } from './patch.js';
import { createRevisionStore } from './revisions.js';
import { encodePNG } from './png.js';
import { createBundle, writeBundle } from './export.js';
import { compilePoses, compileAutotile } from './authoring.js';
import { compileEffects } from './fx.js';
import { prepareScene, renderScene } from './scene.js';
import { createSceneBundle } from './scene-export.js';
import { importPNG } from './import.js';
import { applyOverlay } from './overlays.js';
import { resolveReferences } from './resolve.js';

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
// Bundles can hold thousands of files; list the ones an agent opens and count the rest.
function outputSummary(out, files, listFiles) {
  const relative = files.map(file => path.relative(out, file).split(path.sep).join('/'));
  const count = prefix => relative.filter(file => file.startsWith(`${prefix}/`)).length;
  const animations = count('animations');
  return {
    files: listFiles ? relative : relative.filter(file => !file.startsWith('frames/') && !(file.startsWith('animations/') && animations > 16)),
    frames: { directory: 'frames', count: count('frames') }, animations: { directory: 'animations', count: animations }
  };
}
// JSON-RPC clients normally send "id" before "params", so an oversized request's id is usually in its first bytes.
function leadingId(prefix) {
  const head = prefix.split('"params"')[0], match = /"id"\s*:\s*("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?)/.exec(head);
  try { return match ? JSON.parse(match[1]) : null; } catch { return null; }
}
const HELP_TOPICS = { poses: '../poses.schema.json', scenes: '../scene.schema.json', autotile: '../autotile.schema.json', fx: '../fx.schema.json' };
const COMPILERS = { 'pixelforge-poses': compilePoses, 'pixelforge-autotile': compileAutotile, 'pixelforge-fx': compileEffects };

export async function startMCP({ directory = 'output', root = process.cwd(), input = process.stdin, output = process.stdout } = {}) {
  const schema = JSON.parse(await readFile(new URL('../schema.json', import.meta.url), 'utf8'));
  const { $schema, $defs, ...projectSchema } = schema;
  const source = { project: projectSchema, revision: { type: 'string', pattern: '^[a-f0-9]{12}$', description: 'Revision id from an earlier PixelForge response. Send it instead of project to reuse that recipe, including after restarting with the same MCP --out directory.' } };
  const projectInput = { type: 'object', properties: source, additionalProperties: false, $defs };
  const renderInput = { ...projectInput, properties: { ...source, animation: { type: 'string', description: 'Preview this animation in playback order. Default: preview every frame in project order. All animations are always exported.' }, listFiles: { type: 'boolean', description: 'List every exported file. Default: key files plus frame/animation counts.' } } };
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
    view: { enum: ['color', 'silhouette', 'grayscale', 'onion', 'tile'], description: 'Onion uses pink previous/cyan next poses in animation playback order (requires animation). Tile repeats each frame 3x3 and reports doubled edges and wrap steps.' },
    native: { type: 'boolean', description: 'Also return a native-size contact sheet beside the enlarged view.' },
    diagnostics: { type: 'boolean', description: 'Advisory duplicate, empty, isolated-pixel, palette and loop-boundary evidence, plus original animation timing.' },
    maxCells: { type: 'integer', minimum: 1, maximum: 256, description: 'Bound the preview with evenly spaced samples; returns omitted count and original positions. Does not alter exported animation.' }
  } };
  const patchInput = { ...projectInput, properties: {
    ...source,
    changes: { type: 'array', minItems: 1, maxItems: 1024, description: 'Edits applied in order. Paths match error paths, such as frames[3].duration; lists also accept [name] and [-] to append.', items: { type: 'object', properties: {
      set: { type: 'string', description: 'Path to replace, or an object field to add.' },
      insert: { type: 'string', description: 'List position to insert before; [-] appends.' },
      remove: { type: 'string', description: 'Object field or list item to delete.' },
      paint: { type: 'string', description: 'Frame path, such as frames[blink]. Replaces pixels in final canvas coordinates, after all layers, preserving source operations. Use transparent to erase.' },
      grid: { type: 'string', description: 'Frame path. Value: {x,y,rows,erase?,mask?}. Dots/spaces preserve; explicit erase character clears; mask x selects and dot preserves.' },
      move: { type: 'string', description: 'Frame path. Value: {x,y,w,h,dx,dy,mask?}. Moves exact pixels including corrections; erases selected source. Destination must fit.' },
      recolor: { type: 'string', description: 'Frame path. Value: {x,y,w,h,from,to,mask?}. Replaces only matching selected colors.' },
      cleanup: { type: 'string', description: 'Frame path. Value: {corners?, strays?, x?, y?, w?, h?, mask?, colors?}. Proposes fixes as canvas corrections: corners removes doubled L-shaped steps in one-pixel lines; strays gives a pixel the colour all eight neighbours share (noise, pinholes, isolated specks). Check the report and keep deliberate corners, eyes and sparks. Diagnostics list these with a ready change.' },
      scope: { enum: ['frame', 'inherited'], description: 'Canvas edits: inherited is default. frame preserves other poses by recording compensating canvas corrections, reported in edits.protected.' },
      value: { description: 'JSON value for set or insert; for paint, a list of {x, y, color} pixels inside the canvas (palette names or hex colors, exact RGBA replacement).' }
    }, additionalProperties: false } },
    overlay: { type: 'object', description: 'Apply a saved pixelforge-overlay instead of changes. Canvas-only overlays reapply when the frames they touch are unchanged (reported as rebased).' }
  } };
  const tools = [
    { name: 'pixel_help', description: 'Get the PixelForge authoring guide, JSON Schema, and a complete editable example. Start here. Pass topic poses, scenes, autotile or fx for those sidecar schemas.', inputSchema: { type: 'object', properties: { topic: { enum: Object.keys(HELP_TOPICS) } }, additionalProperties: false }, annotations: { readOnlyHint: true } },
    { name: 'pixel_validate', description: 'Validate a pixel project and return its revision id, dimensions, frame timing, animations, and clipping locations. Saves an immutable recipe revision; no asset export.', inputSchema: projectInput, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    { name: 'pixel_inspect', description: 'See a project without exporting assets. Returns one PNG contact sheet of every frame (or the chosen frames, or one animation in playback order), read left to right and top to bottom, with each cell\'s frame name and duration. With grid: true it also returns palette-key text grids with x/y rulers for exact pixel checks. view: tile repeats frames 3x3 for seam review. Use region to zoom in. Saves an immutable recipe revision. Use this while iterating; call pixel_render to export.', inputSchema: inspectInput, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    { name: 'pixel_patch', description: 'Change a recipe with targeted edits instead of resending it. Pass revision or project, plus changes applied in order: {"set": path, "value": v}, {"insert": path, "value": v}, {"remove": path}, or {"paint": "frames[blink]", "value": [{"x": 9, "y": 7, "color": "k"}]}. Paint replaces exact RGBA in canvas coordinates after all layers; transparent erases. {"cleanup": "frames[run-2]", "value": {"corners": true}} proposes fixes for doubled corners and stray pixels. Other paths look like frames[blink].layers[body].ops[2].x2, palette.k or animations.idle.frames[-]. Or pass overlay to apply a saved correction overlay. The patch is atomic and the result must validate. Returns the new revision, edit details, every frame whose pixels changed (exact pixels for small changes), timing and animation changes, and a before/after PNG with one row per frame. Saves immutable base and result revisions; render the revision to export assets.', inputSchema: patchInput, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    { name: 'pixel_render', description: 'Render a project into PNG sprite sheet, atlas JSON, individual PNGs, APNG animations, CSS, and Canvas player. Writes a new unique folder inside the configured export directory and saves an immutable recipe revision. Returns the folder, key files (relative), frame/animation counts, actual playback and a bounded contact sheet. Large previews report sample positions and omissions; all frames still export. Optionally select an animation.', inputSchema: renderInput, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
    { name: 'pixel_compile', description: 'Compile a pixelforge-poses source (named parts, attachments, rotated parts, tweened in-betweens, mirrored poses, markers), a pixelforge-autotile template (47-tile blob or 16-tile cardinal sets) or a pixelforge-fx source (seeded particle emitters baked into frames) into an ordinary recipe. Saves the recipe as a revision and returns a contact sheet; pass metadata: true for pose attachment/marker metadata, the autotile mask table or particle counts.', inputSchema: { type: 'object', properties: { source: { type: 'object', description: 'A pixelforge-poses, pixelforge-autotile or pixelforge-fx document (see pixel_help topics).' }, metadata: { type: 'boolean' } }, required: ['source'], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    { name: 'pixel_scene', description: 'Render a pixelforge-scene manifest (placements, tilemaps with autotile legends, sequences, trajectories and optional lighting) at a time in milliseconds and return the image plus placements and warnings. Assets may be inline recipes, files under the server root, or {"revision": id}. Pass export: true to write a replayable scene bundle to a new folder.', inputSchema: { type: 'object', properties: { scene: { type: 'object' }, time: { type: 'integer', minimum: 0, maximum: 60000 }, lit: { type: 'boolean' }, density: { type: 'boolean' }, view: { enum: ['color', 'grayscale'] }, scale: { type: 'integer', minimum: 1, maximum: 8 }, export: { type: 'boolean' } }, required: ['scene'], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
    { name: 'pixel_import', description: 'Import a native-resolution 8-bit RGB/RGBA PNG (optionally sliced by an unscaled atlas) as an editable recipe without changing any pixel. Pass data (base64 PNG) or path (inside the server root). Saves the recipe as a revision.', inputSchema: { type: 'object', properties: { data: { type: 'string', description: 'Base64 PNG bytes.' }, path: { type: 'string', description: 'PNG file path relative to the server root.' }, name: { type: 'string' }, atlas: { type: 'object' } }, additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }
  ];
  const { remember, read } = createRevisionStore(directory);
  // Inline file references are resolved inside the root; revisions store the resolved recipe, so they stay immutable.
  const recipeFrom = async (project, revision) => {
    if ((project === undefined) === (revision === undefined)) throw new PixelError('arguments', 'send either project or revision');
    if (project === undefined) return { recipe: await read(revision), resolved: [] };
    const { document, files } = await resolveReferences(project, { baseDir: root, root });
    return { recipe: document, resolved: files.map(file => path.relative(root, file).split(path.sep).join('/')) };
  };
  const withResolved = (summary, resolved) => resolved.length ? { ...summary, resolved } : summary;
  const newFolder = async name => { await mkdir(path.resolve(directory), { recursive: true }); return mkdtemp(path.join(path.resolve(directory), `${name}-`)); };
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
      result({ protocolVersion: versions.includes(params.protocolVersion) ? params.protocolVersion : versions[0], capabilities: { tools: {} }, serverInfo: { name: 'pixelforge', version: '0.1.0' }, instructions: 'Call pixel_help for the JSON format. Use small grids and reusable symbols. Send a full recipe once; every response returns a revision id to use instead of project afterwards. Call pixel_inspect to see every frame (grid: true reads exact pixels), pixel_patch to make targeted edits and check what changed, and pixel_render to export game-ready files. pixel_compile builds recipes from pose sources, autotile templates and particle effect sources; pixel_scene reviews assets together.' }); return;
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
        if (args.topic !== undefined) { result({ content: [textContent(JSON.parse(await readFile(new URL(HELP_TOPICS[args.topic], import.meta.url), 'utf8')))] }); return; }
        const guide = await readFile(new URL('../docs/agent-guide.md', import.meta.url), 'utf8');
        const workflow = await readFile(new URL('../docs/art-workflow.md', import.meta.url), 'utf8');
        const example = JSON.parse(await readFile(new URL('../examples/forest-spirit.json', import.meta.url), 'utf8'));
        result({ content: [textContent(guide), textContent(workflow), textContent({ schema, example, topics: Object.keys(HELP_TOPICS) })] });
      } else if (params.name === 'pixel_validate') {
        const { recipe, resolved } = await recipeFrom(spec, revision), project = renderProject(recipe);
        result({ content: [textContent(withResolved({ ok: true, revision: await remember(recipe), width: project.width, height: project.height, frames: project.frames.map(({ name, duration }) => ({ name, duration })), animations: project.animations, warnings: project.warnings, ...(project.clipping && { clipping: project.clipping }) }, resolved))] });
      } else if (params.name === 'pixel_inspect') {
        const { layers, reference, ...inspection } = options;
        const { recipe, resolved } = await recipeFrom(spec, revision), project = renderProject(recipe, layers === undefined ? {} : { layers }), view = inspectProject(project, inspection);
        const comparison = reference === undefined ? null : compareProjects(renderProject(await read(reference), layers === undefined ? {} : { layers }), project);
        const content = [textContent(withResolved({ ok: true, revision: await remember(recipe), name: project.name, width: project.width, height: project.height, ...viewSummary(view), warnings: project.warnings }, resolved)), imageContent(view.sheet)];
        if (view.nativeSheet) content.push(imageContent(view.nativeSheet));
        if (view.grids) content.push(textContent(gridText(view)));
        if (reference !== undefined) {
          const { image, ...report } = comparison;
          content.push(textContent({ reference, comparison: report, ...(image && { comparisonImage: { region: image.region, frames: image.frames, omitted: image.omitted ?? 0 } }) }));
          if (image) content.push(imageContent(image.sheet));
        }
        result({ content });
      } else if (params.name === 'pixel_patch') {
        if ((changes === undefined) === (options.overlay === undefined)) throw new PixelError('arguments', 'send either changes or overlay');
        const { recipe: base, resolved } = await recipeFrom(spec, revision), before = renderProject(base);
        const applied = options.overlay === undefined ? patchRecipe(base, changes) : applyOverlay(base, options.overlay);
        const { recipe, edits } = applied, after = renderProject(recipe);
        const { image, ...report } = compareProjects(before, after), baseId = await remember(base);
        const summary = { ok: true, revision: await remember(recipe), base: baseId, edits, ...(applied.rebased && { rebased: true }), ...report, ...(image && { image: { region: image.region, frames: image.frames, ...(image.omitted && { omitted: image.omitted }), scale: image.sheet.scale } }), warnings: after.warnings };
        result({ content: [textContent(withResolved(summary, resolved)), ...(image ? [imageContent(image.sheet)] : [])] });
      } else if (params.name === 'pixel_render') {
        const { animation, listFiles } = options;
        const { recipe, resolved } = await recipeFrom(spec, revision), bundle = await createBundle(recipe), view = inspectProject(bundle.project, { ...(animation !== undefined && { animation }), maxCells: 256 });
        const savedRevision = await remember(recipe), out = await newFolder(bundle.project.name);
        const files = await writeBundle(bundle, out);
        result({ content: [textContent(withResolved({ ok: true, revision: savedRevision, directory: out, ...outputSummary(out, files, listFiles === true), playback: path.join(out, 'preview.html'), preview: viewSummary(view), warnings: bundle.project.warnings }, resolved)), imageContent(view.sheet)] });
      } else if (params.name === 'pixel_compile') {
        const { document } = await resolveReferences(args.source, { baseDir: root, root });
        const format = document?.format;
        if (!Object.hasOwn(COMPILERS, format ?? '')) throw new PixelError('source.format', 'expected pixelforge-poses, pixelforge-autotile or pixelforge-fx');
        const { recipe, metadata } = COMPILERS[format](document);
        const project = renderProject(recipe), view = inspectProject(project, { maxCells: 256 });
        result({ content: [textContent({ ok: true, revision: await remember(recipe), name: project.name, width: project.width, height: project.height, frames: project.frames.length, animations: Object.keys(project.animations), preview: viewSummary(view), warnings: project.warnings, ...(args.metadata === true && { metadata }) }), imageContent(view.sheet)] });
      } else if (params.name === 'pixel_scene') {
        const { document, files: sources } = await resolveReferences(args.scene, { baseDir: root, root, revisions: read });
        const scene = prepareScene(document), frame = renderScene(scene, { time: args.time ?? 0, lit: args.lit ?? true, density: args.density ?? false });
        const scale = args.scale ?? Math.max(1, Math.min(8, Math.floor(768 / Math.max(frame.width, frame.height))));
        const pixels = args.view === 'grayscale' ? reviewPixels(frame.data, 'grayscale') : frame.data;
        const summary = { ok: true, name: document.name, width: frame.width, height: frame.height, duration: scene.duration, time: args.time ?? 0, scale, placements: frame.placements.length, tilemaps: frame.placements.filter(p => p.tilemap).map(p => ({ name: p.name, tiles: p.tiles })), warnings: frame.warnings, ...(sources.length && { resolved: sources.map(file => path.relative(root, file).split(path.sep).join('/')) }) };
        if (args.export === true) {
          const bundle = await createSceneBundle(document), out = await newFolder(document.name);
          Object.assign(summary, { directory: out, ...outputSummary(out, await writeBundle(bundle, out), false), playback: path.join(out, 'preview.html') });
        }
        result({ content: [textContent(summary), imageContent({ data: scalePixels(pixels, frame.width, frame.height, scale), width: frame.width * scale, height: frame.height * scale })] });
      } else if (params.name === 'pixel_import') {
        if ((args.data === undefined) === (args.path === undefined)) throw new PixelError('arguments', 'send either data (base64 PNG) or path');
        let bytes;
        if (args.data !== undefined) bytes = Buffer.from(args.data, 'base64');
        else {
          const file = path.resolve(root, args.path), relative = path.relative(path.resolve(root), file);
          if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new PixelError('path', `must stay inside ${path.resolve(root)}`);
          bytes = await readFile(file);
        }
        const imported = importPNG(bytes, { ...(args.name !== undefined && { name: args.name }), ...(args.atlas !== undefined && { atlas: args.atlas }) });
        const project = renderProject(imported.recipe), view = inspectProject(project, { maxCells: 256 });
        result({ content: [textContent({ ok: true, revision: await remember(imported.recipe), name: project.name, width: project.width, height: project.height, frames: project.frames.length, provenance: imported.provenance, preview: viewSummary(view) }), imageContent(view.sheet)] });
      }
    } catch (cause) { result({ isError: true, content: [textContent({ error: cause.message, ...(cause.path ? { path: cause.path } : {}) })] }); }
  }
  const tooLarge = prefix => send({ jsonrpc: '2.0', id: leadingId(prefix), error: { code: -32600, message: `Request exceeds ${MAX_REQUEST_BYTES} bytes. Send a recipe once and reuse its revision id, or split the work.` } });
  input.setEncoding('utf8');
  let pending = '', discarding = null;
  // Sequential dispatch preserves initialization order and bounds parallel render memory. An oversized line is
  // answered with an error and skipped up to its newline; the server keeps serving.
  for await (const chunk of input) {
    pending += chunk;
    let newline;
    while ((newline = pending.indexOf('\n')) !== -1) {
      const line = pending.slice(0, newline).replace(/\r$/, ''); pending = pending.slice(newline + 1);
      if (discarding !== null) { tooLarge(discarding); discarding = null; continue; }
      if (Buffer.byteLength(line) > MAX_REQUEST_BYTES) { tooLarge(line.slice(0, 4096)); continue; }
      if (line.trim()) await handle(line);
    }
    if (Buffer.byteLength(pending) > MAX_REQUEST_BYTES) { if (discarding === null) discarding = pending.slice(0, 4096); pending = ''; }
  }
  if (discarding !== null) tooLarge(discarding);
  else if (pending.trim()) await handle(pending);
}
