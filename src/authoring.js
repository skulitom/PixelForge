// Optional authoring compilers. All output is ordinary, editable version-1 recipe data.
import { PixelError, renderProject } from './core.js';
import { BLOB_MASKS, CARDINAL_MASKS, quadrantPieces, templatePiece } from './autotile.js';

const fail = (path, message) => { throw new PixelError(path, message); };
export function fields(value, keys, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'expected an object');
  for (const key of Object.keys(value)) if (!keys.includes(key) || value[key] === null) fail(`${path}.${key}`, 'unknown or null field');
}
export function point(value, path, bound = 4096) {
  if (!Array.isArray(value) || value.length !== 2 || value.some(v => !Number.isInteger(v) || Math.abs(v) > bound)) fail(path, `expected two integer coordinates within ±${bound}`);
  return value;
}
const identifier = (value, path) => {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value)) fail(path, 'expected a named part, pose or marker');
  return value;
};
// Compiled output is plain JSON data (null-prototype maps are only used while compiling).
const plain = value => JSON.parse(JSON.stringify(value));

export function compilePoses(source) {
  fields(source, ['format', 'version', 'name', 'width', 'height', 'palette', 'parts', 'poses', 'animations', 'sheet'], 'poses');
  if (source.format !== 'pixelforge-poses' || source.version !== 1) fail('poses', 'expected version-1 pixelforge-poses');
  if (!source.parts || Array.isArray(source.parts) || typeof source.parts !== 'object' || Object.keys(source.parts).length > 256) fail('poses.parts', 'expected at most 256 part definitions');
  const symbols = Object.create(null);
  for (const [name, part] of Object.entries(source.parts)) {
    identifier(name, `poses.parts.${name}`);
    fields(part, ['rows', 'anchor', 'points'], `poses.parts.${name}`);
    point(part.anchor ?? [0, 0], `poses.parts.${name}.anchor`);
    if (part.points !== undefined && (!part.points || typeof part.points !== 'object' || Array.isArray(part.points))) fail(`poses.parts.${name}.points`, 'expected named attachment points');
    for (const [key, value] of Object.entries(part.points ?? {})) { identifier(key, `poses.parts.${name}.points`); point(value, `poses.parts.${name}.points.${key}`); }
    if (!Array.isArray(part.rows) || !part.rows.length || typeof part.rows[0] !== 'string') fail(`poses.parts.${name}.rows`, 'expected equal-width text rows');
    symbols[name] = part.rows;
  }
  if (!Array.isArray(source.poses) || !source.poses.length || source.poses.length > 256) fail('poses.poses', 'expected 1–256 authored key poses');
  const metadata = { format: 'pixelforge-pose-metadata', version: 1, coordinates: 'unscaled source pixels; top-left origin; positive y down; marker times are milliseconds before playback-rate adjustment', poses: Object.create(null), animations: Object.create(null) };
  const compiled = Object.create(null);
  const frames = source.poses.map((pose, index) => {
    const path = `poses.poses[${index}]`;
    fields(pose, ['name', 'duration', 'origin', 'parts', 'markers', 'mirror'], path);
    identifier(pose.name, `${path}.name`);
    if (Object.hasOwn(compiled, pose.name)) fail(`${path}.name`, 'duplicate pose');
    let origin, placed, layers, markers;
    if (pose.mirror !== undefined) {
      // A horizontal mirror of an earlier pose around its origin column: pixel column c maps to 2 * originX - c.
      for (const key of ['parts', 'markers', 'origin']) if (pose[key] !== undefined) fail(`${path}.${key}`, 'mirrored poses reuse the source pose, its markers and its origin');
      identifier(pose.mirror, `${path}.mirror`);
      const from = compiled[pose.mirror];
      if (!from) fail(`${path}.mirror`, 'must name an earlier pose');
      origin = from.origin;
      const reflect = x => 2 * origin[0] - x;
      placed = Object.create(null); layers = [];
      for (const layer of from.layers) {
        const instance = from.placed[layer.name], definition = source.parts[instance.definition], width = definition.rows[0].length;
        const x = reflect(instance.topLeft[0] + width - 1), y = instance.topLeft[1], flipX = !instance.flipX;
        placed[layer.name] = { definition: instance.definition, ...(flipX && { flipX }), topLeft: [x, y], anchor: [reflect(instance.anchor[0]), instance.anchor[1]], points: Object.fromEntries(Object.entries(instance.points).map(([key, p]) => [key, [reflect(p[0]), p[1]]])) };
        layers.push({ name: layer.name, ops: [{ op: 'stamp', symbol: instance.definition, x, y, ...(flipX && { flipX }) }] });
      }
      markers = from.markers.map(marker => ({ ...marker, at: [reflect(marker.at[0]), marker.at[1]] }));
    } else {
      origin = point(pose.origin ?? [0, 0], `${path}.origin`); placed = Object.create(null);
      if (!Array.isArray(pose.parts) || pose.parts.length > 64) fail(`${path}.parts`, 'expected at most 64 parts in back-to-front order');
      layers = pose.parts.map((instance, i) => {
        const ip = `${path}.parts[${i}]`;
        fields(instance, ['name', 'part', 'at', 'attach', 'flipX'], ip);
        identifier(instance.name, `${ip}.name`);
        if (Object.hasOwn(placed, instance.name)) fail(`${ip}.name`, 'duplicate part instance');
        if (typeof instance.part !== 'string' || !Object.hasOwn(source.parts, instance.part)) fail(`${ip}.part`, 'unknown part definition');
        if (instance.flipX !== undefined && typeof instance.flipX !== 'boolean') fail(`${ip}.flipX`, 'expected a boolean');
        const definition = source.parts[instance.part], width = definition.rows[0].length, flipX = instance.flipX === true;
        // A flipped part mirrors its own grid, anchor and points inside the part's width.
        const local = ([x, y]) => [flipX ? width - 1 - x : x, y], anchor = local(definition.anchor ?? [0, 0]);
        let parent = origin;
        if (instance.attach !== undefined) {
          fields(instance.attach, ['part', 'point'], `${ip}.attach`);
          identifier(instance.attach.part, `${ip}.attach.part`); identifier(instance.attach.point, `${ip}.attach.point`);
          const part = placed[instance.attach.part];
          if (!part || !Object.hasOwn(part.points, instance.attach.point)) fail(`${ip}.attach`, 'attachment must name a point on an earlier part in this pose');
          parent = part.points[instance.attach.point];
        }
        const at = point(instance.at ?? [0, 0], `${ip}.at`), x = parent[0] + at[0] - anchor[0], y = parent[1] + at[1] - anchor[1];
        placed[instance.name] = { definition: instance.part, ...(flipX && { flipX }), topLeft: [x, y], anchor: [x + anchor[0], y + anchor[1]], points: Object.fromEntries(Object.entries(definition.points ?? {}).map(([key, p]) => { const [px, py] = local(p); return [key, [x + px, y + py]]; })) };
        return { name: instance.name, ops: [{ op: 'stamp', symbol: instance.part, x, y, ...(flipX && { flipX }) }] };
      });
      if (pose.markers !== undefined && (!Array.isArray(pose.markers) || pose.markers.length > 64)) fail(`${path}.markers`, 'expected at most 64 markers');
      const seen = new Set();
      markers = (pose.markers ?? []).map((marker, i) => {
        fields(marker, ['name', 'part', 'point'], `${path}.markers[${i}]`);
        identifier(marker.name, `${path}.markers[${i}].name`);
        if (seen.has(marker.name)) fail(`${path}.markers[${i}].name`, 'marker names are unique within a pose');
        seen.add(marker.name);
        identifier(marker.part, `${path}.markers[${i}].part`); identifier(marker.point, `${path}.markers[${i}].point`);
        const part = placed[marker.part];
        if (!part || !Object.hasOwn(part.points, marker.point)) fail(`${path}.markers[${i}]`, 'marker must name a placed attachment point');
        return { name: marker.name, part: marker.part, point: marker.point, at: part.points[marker.point] };
      });
    }
    const duration = pose.duration ?? (pose.mirror !== undefined ? compiled[pose.mirror].duration : undefined);
    compiled[pose.name] = { origin, placed, layers, markers, duration };
    metadata.poses[pose.name] = { origin, ...(pose.mirror !== undefined && { mirror: pose.mirror }), parts: placed, markers };
    // The pose origin becomes the frame anchor; marker positions become named frame points in the atlas.
    return { name: pose.name, ...(duration !== undefined && { duration }), anchor: origin, ...(markers.length && { points: Object.fromEntries(markers.map(m => [m.name, m.at])) }), layers };
  });
  // When every pose shares one origin, it is declared once as the recipe anchor.
  const shared = frames.every(frame => frame.anchor[0] === frames[0].anchor[0] && frame.anchor[1] === frames[0].anchor[1]);
  if (shared) for (const frame of frames) delete frame.anchor;
  const recipe = { version: 1, name: source.name, width: source.width, height: source.height, palette: source.palette ?? {}, ...(shared && { anchor: compiled[source.poses[0].name].origin }), symbols, frames, ...(source.animations !== undefined && { animations: source.animations }), ...(source.sheet !== undefined && { sheet: source.sheet }) };
  const project = renderProject(recipe);
  for (const [name, animation] of Object.entries(project.animations)) {
    let start = 0;
    metadata.animations[name] = { duration: animation.duration, loop: animation.loop, entries: animation.frames.map((index, position) => {
      const frame = project.frames[index], entry = { position, frame: frame.name, start, duration: frame.duration, markers: metadata.poses[frame.name].markers };
      start += frame.duration; return entry;
    }) };
  }
  return plain({ recipe, metadata });
}

// Compiles a small template into an autotile set. The template is two tiles wide and three tall:
//   [ unused preview ][ inner corners ]
//   [ 2x2 island whose quadrants give outer corners, edges and fill ]
// Every output frame is four `copy` operations from the template symbol, so editing the template updates the set.
export function compileAutotile(source) {
  fields(source, ['format', 'version', 'name', 'tile', 'mode', 'palette', 'template', 'frame', 'variants', 'animation', 'sheet'], 'autotile');
  if (source.format !== 'pixelforge-autotile' || source.version !== 1) fail('autotile', 'expected version-1 pixelforge-autotile');
  const tile = source.tile;
  if (!Number.isInteger(tile) || tile < 2 || tile > 128 || tile % 2) fail('autotile.tile', 'expected an even tile size from 2 to 128');
  const mode = source.mode ?? 'blob';
  if (!['blob', 'cardinal'].includes(mode)) fail('autotile.mode', 'expected blob or cardinal');
  const template = source.template;
  if (!Array.isArray(template) || template.length !== tile * 3 || template.some(row => typeof row !== 'string' || row.length !== tile * 2)) fail('autotile.template', `expected ${tile * 3} rows of ${tile * 2} characters (two tiles wide, three tall)`);
  if (typeof source.frame !== 'string' || !source.frame.includes('{mask}')) fail('autotile.frame', 'expected a frame name template containing {mask}');
  const variants = source.variants ?? [{ name: '' }];
  if (!Array.isArray(variants) || !variants.length || variants.length > 16) fail('autotile.variants', 'expected 1–16 variants');
  if (source.variants !== undefined && !source.frame.includes('{variant}')) fail('autotile.frame', 'with variants, the frame template must contain {variant}');
  variants.forEach((variant, i) => {
    fields(variant, ['name', 'duration', 'palette'], `autotile.variants[${i}]`);
    if (typeof variant.name !== 'string' || (source.variants !== undefined && !/^[A-Za-z0-9_-]{1,16}$/.test(variant.name))) fail(`autotile.variants[${i}].name`, 'expected 1–16 letters, digits, hyphens or underscores');
  });
  if (source.animation !== undefined && (typeof source.animation !== 'string' || !source.animation.includes('{mask}'))) fail('autotile.animation', 'expected an animation name template containing {mask}');
  const q = tile / 2, frames = [], animations = {};
  for (const mask of mode === 'cardinal' ? CARDINAL_MASKS : BLOB_MASKS) {
    const pieces = quadrantPieces(mode, mask), names = [];
    for (const variant of variants) {
      const name = source.frame.replaceAll('{mask}', String(mask)).replaceAll('{variant}', variant.name);
      names.push(name);
      frames.push({ name, ...(variant.duration !== undefined && { duration: variant.duration }), ...(variant.palette !== undefined && { palette: variant.palette }), ops: Object.entries({ tl: [0, 0], tr: [q, 0], bl: [0, q], br: [q, q] }).map(([position, [x, y]]) => {
        const [sx, sy] = templatePiece(tile, position, pieces[position]);
        return { op: 'copy', symbol: 'template', sx, sy, w: q, h: q, x, y };
      }) });
    }
    if (source.animation !== undefined) animations[source.animation.replaceAll('{mask}', String(mask))] = { frames: names };
  }
  const recipe = { version: 1, name: source.name, width: tile, height: tile, palette: source.palette ?? {}, symbols: { template }, frames, ...(source.animation !== undefined && { animations }), ...(source.sheet !== undefined && { sheet: source.sheet }) };
  renderProject(recipe);
  return plain({ recipe, metadata: { format: 'pixelforge-autotile-metadata', version: 1, mode, masks: mode === 'cardinal' ? [...CARDINAL_MASKS] : [...BLOB_MASKS], bits: mode === 'cardinal' ? { n: 1, e: 2, s: 4, w: 8 } : { n: 1, ne: 2, e: 4, se: 8, s: 16, sw: 32, w: 64, nw: 128 } } });
}
