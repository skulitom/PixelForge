// Bounded scene review, not a game engine. In-memory recipes only; no filesystem or network access.
import { PixelError, renderProject, parseColor, animationPosition } from './core.js';
import { fields, point } from './authoring.js';

const fail = (path, message) => { throw new PixelError(path, message); };
const int = (v, min, max, path) => { if (!Number.isInteger(v) || v < min || v > max) fail(path, `expected an integer from ${min} to ${max}`); return v; };
const alphaOver = (target, at, color) => {
  if (color[3] === 255) { target.set(color, at); return; }
  const alpha = color[3] / 255; if (!alpha) return;
  const old = target[at + 3] / 255, out = alpha + old * (1 - alpha);
  for (let c = 0; c < 3; c++) target[at + c] = Math.round((color[c] * alpha + target[at + c] * old * (1 - alpha)) / out);
  target[at + 3] = Math.round(out * 255);
};
export function prepareScene(source) {
  fields(source, ['format', 'version', 'name', 'width', 'height', 'background', 'duration', 'assets', 'instances', 'lighting'], 'scene');
  if (source.format !== 'pixelforge-scene' || source.version !== 1) fail('scene', 'expected version-1 pixelforge-scene');
  const width = int(source.width, 1, 256, 'scene.width'), height = int(source.height, 1, 256, 'scene.height');
  const duration = int(source.duration ?? 2000, 1, 60000, 'scene.duration');
  // Reuse portable name validation.
  renderProject({ version: 1, name: source.name, width: 1, height: 1, frames: [{ name: 'check' }] });
  const background = parseColor(source.background ?? '#10121e');
  if (!source.assets || Array.isArray(source.assets) || typeof source.assets !== 'object' || Object.keys(source.assets).length > 64) fail('scene.assets', 'expected at most 64 inlined assets');
  const assets = Object.create(null), warnings = []; let sourceArea = 0;
  for (const [id, value] of Object.entries(source.assets)) {
    const entry = value?.recipe ? value : { recipe: value };
    fields(entry, ['recipe', 'normal', 'emissive'], `scene.assets.${id}`);
    const passes = {};
    for (const key of ['recipe', 'normal', 'emissive']) if (entry[key] !== undefined) {
      const spec = entry[key];
      const area = spec?.width * spec?.height * spec?.frames?.length;
      if (!Number.isFinite(area) || (sourceArea += area) > 4194304) fail(`scene.assets.${id}`, 'combined scene source passes exceed 4,194,304 pixels or have invalid dimensions');
      passes[key] = renderProject(spec);
      warnings.push(...passes[key].warnings.map(message => `${id}.${key}: ${message}`));
    }
    const base = passes.recipe;
    for (const key of ['normal', 'emissive']) if (passes[key]) {
      const p = passes[key];
      if (p.width !== base.width || p.height !== base.height || JSON.stringify(p.sheet) !== JSON.stringify(base.sheet) || JSON.stringify(p.frames.map(f => [f.name, f.duration])) !== JSON.stringify(base.frames.map(f => [f.name, f.duration])) || JSON.stringify(p.animations) !== JSON.stringify(base.animations)) fail(`scene.assets.${id}.${key}`, 'material passes must share color frame order, names, durations, animations, dimensions and atlas layout');
    }
    assets[id] = passes;
  }
  if (!Array.isArray(source.instances) || source.instances.length > 256) fail('scene.instances', 'expected at most 256 placements');
  let work = 0, count = 0;
  const instances = source.instances.map((instance, i) => {
    const path = `scene.instances[${i}]`;
    fields(instance, ['name', 'asset', 'at', 'anchor', 'scale', 'frame', 'animation', 'repeat', 'step', 'sequence', 'trajectory'], path);
    if (instance.name !== undefined && typeof instance.name !== 'string') fail(`${path}.name`, 'expected a string label');
    if (typeof instance.asset !== 'string' || !Object.hasOwn(assets, instance.asset)) fail(`${path}.asset`, 'unknown asset');
    const project = assets[instance.asset].recipe;
    const at = point(instance.at, `${path}.at`), anchor = point(instance.anchor ?? [0, 0], `${path}.anchor`);
    if (instance.scale !== undefined && !Number.isInteger(instance.scale)) fail(`${path}.scale`, 'fractional sprite scaling creates inconsistent pixel sizes; use an integer or author a smaller asset');
    const scale = int(instance.scale ?? 1, 1, 16, `${path}.scale`);
    const repeat = point(instance.repeat ?? [1, 1], `${path}.repeat`, 32);
    if (repeat.some(n => n < 1)) fail(`${path}.repeat`, 'repeat counts must be positive');
    const step = point(instance.step ?? [project.width * scale, project.height * scale], `${path}.step`);
    count += repeat[0] * repeat[1]; work += repeat[0] * repeat[1] * project.width * project.height * scale ** 2;
    if (count > 1024 || work > 4194304) fail(path, 'scene exceeds 1,024 draws or 4,194,304 drawing pixels');
    const selection = (entry, ep) => {
      if (entry.frame !== undefined && entry.animation !== undefined) fail(ep, 'choose frame or animation');
      if (entry.frame !== undefined && (typeof entry.frame !== 'string' || !project.frames.some(f => f.name === entry.frame))) fail(ep, 'unknown frame');
      if (entry.animation !== undefined && (typeof entry.animation !== 'string' || !Object.hasOwn(project.animations, entry.animation))) fail(ep, 'unknown animation');
    };
    selection(instance, path);
    if (instance.sequence !== undefined && (!Array.isArray(instance.sequence) || instance.sequence.length > 64)) fail(`${path}.sequence`, 'expected at most 64 state cues');
    let previous = -1;
    for (const [j, cue] of (instance.sequence ?? []).entries()) {
      fields(cue, ['time', 'frame', 'animation'], `${path}.sequence[${j}]`);
      int(cue.time, 0, duration - 1, `${path}.sequence[${j}].time`);
      if (cue.time <= previous) fail(`${path}.sequence`, 'cue times must increase strictly');
      if (cue.frame === undefined && cue.animation === undefined) fail(`${path}.sequence`, 'a cue needs frame or animation');
      previous = cue.time; selection(cue, `${path}.sequence[${j}]`);
    }
    if (instance.trajectory !== undefined) {
      if (!Array.isArray(instance.trajectory) || instance.trajectory.length < 2 || instance.trajectory.length > 256) fail(`${path}.trajectory`, 'expected 2–256 timed positions');
      let prior = -1;
      for (const [j, key] of instance.trajectory.entries()) {
        fields(key, ['time', 'at'], `${path}.trajectory[${j}]`); int(key.time, 0, duration, `${path}.trajectory[${j}].time`); point(key.at, `${path}.trajectory[${j}].at`);
        if (key.time <= prior || (j === 0 && key.time !== 0)) fail(`${path}.trajectory`, 'start at time 0, then strictly increase');
        prior = key.time;
      }
    }
    if (scale !== 1) warnings.push(`${instance.name ?? i}: ${scale}× pixels; compare density against neighboring 1× assets.`);
    return { ...instance, at, anchor, scale, repeat, step };
  });
  let lighting = null;
  if (source.lighting !== undefined) {
    fields(source.lighting, ['ambient', 'bands', 'lights'], 'scene.lighting');
    const { ambient = .35, bands = 5, lights = [] } = source.lighting;
    if (typeof ambient !== 'number' || !Number.isFinite(ambient) || ambient < 0 || ambient > 1) fail('scene.lighting.ambient', 'expected 0–1');
    int(bands, 2, 16, 'scene.lighting.bands');
    if (!Array.isArray(lights) || lights.length > 8) fail('scene.lighting.lights', 'expected at most 8 lights');
    lighting = { ambient, bands, lights: lights.map((light, i) => {
      fields(light, ['at', 'height', 'radius', 'color'], `scene.lighting.lights[${i}]`);
      return { at: point(light.at, 'light.at'), height: int(light.height ?? 24, 1, 256, 'light.height'), radius: int(light.radius ?? 96, 1, 512, 'light.radius'), color: parseColor(light.color ?? '#fff') };
    }) };
  }
  return { source, width, height, duration, assets, instances, background, lighting, warnings: [...new Set(warnings)] };
}
export function renderScene(scene, { time = 0, lit = true, density = false } = {}) {
  if (!Number.isFinite(time) || time < 0) fail('scene.time', 'expected a nonnegative finite time in milliseconds');
  if (typeof lit !== 'boolean' || typeof density !== 'boolean') fail('scene.preview', 'lit and density must be booleans');
  const { width, height, background, assets, lighting } = scene, data = new Uint8ClampedArray(width * height * 4), placements = [];
  for (let at = 0; at < data.length; at += 4) data.set(background, at);
  let clipped = 0;
  for (const instance of scene.instances) {
    const asset = assets[instance.asset], project = asset.recipe;
    let choice = instance, start = 0;
    for (const cue of instance.sequence ?? []) if (cue.time <= time) { choice = cue; start = cue.time; }
    const animation = choice.animation === undefined ? null : project.animations[choice.animation];
    const index = animation ? animation.frames[animationPosition(project, animation, time - start)] : choice.frame ? project.frames.findIndex(f => f.name === choice.frame) : 0;
    const frame = project.frames[index], s = instance.scale;
    const normal = asset.normal?.frames[index].data, emission = asset.emissive?.frames[index].data;
    let position = instance.at;
    if (instance.trajectory) {
      position = instance.trajectory.at(-1).at;
      for (let i = 1; i < instance.trajectory.length; i++) {
        const a = instance.trajectory[i - 1], b = instance.trajectory[i];
        if (time <= b.time) { const fraction = (time - a.time) / (b.time - a.time); position = a.at.map((v, axis) => Math.round(v + (b.at[axis] - v) * fraction)); break; }
      }
    }
    for (let ry = 0; ry < instance.repeat[1]; ry++) for (let rx = 0; rx < instance.repeat[0]; rx++) {
      const left = position[0] - instance.anchor[0] * s + rx * instance.step[0], top = position[1] - instance.anchor[1] * s + ry * instance.step[1];
      placements.push({ name: instance.name ?? instance.asset, frame: frame.name, x: left, y: top, w: project.width * s, h: project.height * s, scale: s });
      const rgba = new Uint8ClampedArray(4);
      for (let y = 0; y < project.height; y++) for (let x = 0; x < project.width; x++) {
        const at = (y * project.width + x) * 4;
        for (let c = 0; c < 4; c++) rgba[c] = frame.data[at + c];
        if (!rgba[3]) continue;
        if (lit && lighting && (normal || emission)) {
          let nx = 0, ny = 0, nz = 1;
          if (normal?.[at + 3]) { nx = normal[at] / 127.5 - 1; ny = normal[at + 1] / 127.5 - 1; nz = normal[at + 2] / 127.5 - 1; }
          const norm = Math.hypot(nx, ny, nz) || 1, intensity = [lighting.ambient, lighting.ambient, lighting.ambient];
          for (const light of lighting.lights) {
            const dx = light.at[0] - (left + x * s), dy = light.at[1] - (top + y * s), dz = light.height;
            const distance = Math.hypot(dx, dy, dz), diffuse = Math.max(0, (nx * dx + ny * dy + nz * dz) / norm / distance) * Math.max(0, 1 - Math.hypot(dx, dy) / light.radius);
            for (let c = 0; c < 3; c++) intensity[c] += diffuse * light.color[c] / 255;
          }
          for (let c = 0; c < 3; c++) {
            const amount = Math.round(Math.min(1, intensity[c]) * (lighting.bands - 1)) / (lighting.bands - 1);
            rgba[c] = Math.min(255, Math.round(rgba[c] * amount + (emission ? emission[at + c] * emission[at + 3] / 255 : 0)));
          }
        }
        for (let sy = 0; sy < s; sy++) for (let sx = 0; sx < s; sx++) {
          const tx = left + x * s + sx, ty = top + y * s + sy;
          if (tx < 0 || ty < 0 || tx >= width || ty >= height) { clipped++; continue; }
          alphaOver(data, (ty * width + tx) * 4, rgba);
        }
      }
    }
  }
  if (density) for (const box of placements) {
    const color = box.scale === 1 ? [65, 201, 240, 180] : [255, 70, 100, 255];
    for (let y = Math.max(0, box.y); y < Math.min(height, box.y + box.h); y++) for (let x = Math.max(0, box.x); x < Math.min(width, box.x + box.w); x++) {
      if (x === box.x || y === box.y || x === box.x + box.w - 1 || y === box.y + box.h - 1) alphaOver(data, (y * width + x) * 4, color);
    }
  }
  return { data, width, height, placements, warnings: [...scene.warnings, ...(clipped ? [`${clipped} drawn pixels clipped at scene bounds.`] : [])] };
}
export function inspectTile(project, frameName = project.frames[0].name) {
  const index = project.frames.findIndex(f => f.name === frameName);
  if (index < 0) fail('tile.frame', 'unknown frame');
  const frame = project.frames[index], mismatches = { horizontal: [], vertical: [] };
  const different = (a, b) => [0, 1, 2, 3].some(c => frame.data[a + c] !== frame.data[b + c]);
  for (let y = 0; y < project.height; y++) if (different(y * project.width * 4, (y * project.width + project.width - 1) * 4)) mismatches.horizontal.push(y);
  for (let x = 0; x < project.width; x++) if (different(x * 4, ((project.height - 1) * project.width + x) * 4)) mismatches.vertical.push(x);
  const data = new Uint8ClampedArray(project.width * project.height * 9 * 4), width = project.width * 3, height = project.height * 3;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(frame.data.subarray(((y % project.height) * project.width + x % project.width) * 4, ((y % project.height) * project.width + x % project.width) * 4 + 4), (y * width + x) * 4);
  return { data, width, height, mismatches, note: 'Opposite-edge differences are advisory, not proof of a visible seam. Review the 3×3 repeat.' };
}
