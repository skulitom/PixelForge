// Optional authoring compiler. All output is ordinary, editable version-1 recipe data.
import { PixelError, renderProject } from './core.js';

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
    symbols[name] = part.rows;
  }
  if (!Array.isArray(source.poses) || !source.poses.length || source.poses.length > 256) fail('poses.poses', 'expected 1–256 authored key poses');
  const metadata = { format: 'pixelforge-pose-metadata', version: 1, coordinates: 'unscaled source pixels; top-left origin; positive y down; marker times are milliseconds before playback-rate adjustment', poses: Object.create(null), animations: Object.create(null) };
  const frames = source.poses.map((pose, index) => {
    const path = `poses.poses[${index}]`;
    fields(pose, ['name', 'duration', 'origin', 'parts', 'markers'], path);
    const origin = point(pose.origin ?? [0, 0], `${path}.origin`), placed = Object.create(null);
    if (!Array.isArray(pose.parts) || pose.parts.length > 64) fail(`${path}.parts`, 'expected at most 64 parts in back-to-front order');
    const layers = pose.parts.map((instance, i) => {
      const ip = `${path}.parts[${i}]`;
      fields(instance, ['name', 'part', 'at', 'attach'], ip);
      identifier(instance.name, `${ip}.name`);
      if (Object.hasOwn(placed, instance.name)) fail(`${ip}.name`, 'duplicate part instance');
      if (typeof instance.part !== 'string' || !Object.hasOwn(source.parts, instance.part)) fail(`${ip}.part`, 'unknown part definition');
      const definition = source.parts[instance.part], anchor = definition.anchor ?? [0, 0];
      let parent = origin;
      if (instance.attach !== undefined) {
        fields(instance.attach, ['part', 'point'], `${ip}.attach`);
        identifier(instance.attach.part, `${ip}.attach.part`); identifier(instance.attach.point, `${ip}.attach.point`);
        const part = placed[instance.attach.part];
        if (!part || !Object.hasOwn(part.points, instance.attach.point)) fail(`${ip}.attach`, 'attachment must name a point on an earlier part in this pose');
        parent = part.points[instance.attach.point];
      }
      const at = point(instance.at ?? [0, 0], `${ip}.at`), x = parent[0] + at[0] - anchor[0], y = parent[1] + at[1] - anchor[1];
      placed[instance.name] = { definition: instance.part, topLeft: [x, y], anchor: [x + anchor[0], y + anchor[1]], points: Object.fromEntries(Object.entries(definition.points ?? {}).map(([key, p]) => [key, [x + p[0], y + p[1]]])) };
      return { name: instance.name, ops: [{ op: 'stamp', symbol: instance.part, x, y }] };
    });
    if (pose.markers !== undefined && (!Array.isArray(pose.markers) || pose.markers.length > 64)) fail(`${path}.markers`, 'expected at most 64 markers');
    const markers = (pose.markers ?? []).map((marker, i) => {
      fields(marker, ['name', 'part', 'point'], `${path}.markers[${i}]`);
      identifier(marker.name, `${path}.markers[${i}].name`);
      identifier(marker.part, `${path}.markers[${i}].part`); identifier(marker.point, `${path}.markers[${i}].point`);
      const part = placed[marker.part];
      if (!part || !Object.hasOwn(part.points, marker.point)) fail(`${path}.markers[${i}]`, 'marker must name a placed attachment point');
      return { name: marker.name, part: marker.part, point: marker.point, at: part.points[marker.point] };
    });
    metadata.poses[pose.name] = { origin, parts: placed, markers };
    return { name: pose.name, ...(pose.duration !== undefined && { duration: pose.duration }), layers };
  });
  const recipe = { version: 1, name: source.name, width: source.width, height: source.height, palette: source.palette ?? {}, symbols, frames, ...(source.animations !== undefined && { animations: source.animations }), ...(source.sheet !== undefined && { sheet: source.sheet }) };
  const project = renderProject(recipe);
  for (const [name, animation] of Object.entries(project.animations)) {
    let start = 0;
    metadata.animations[name] = { duration: animation.duration, loop: animation.loop, entries: animation.frames.map((index, position) => {
      const frame = project.frames[index], entry = { position, frame: frame.name, start, duration: frame.duration, markers: metadata.poses[frame.name].markers };
      start += frame.duration; return entry;
    }) };
  }
  return { recipe, metadata };
}
