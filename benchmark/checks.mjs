// Machine checks for benchmark briefs. A criterion with a `check` passes or fails on the rendered frames alone, so runs
// made with different tools and workflows are compared on the same evidence; criteria marked `judge` are listed for
// the blind judges and never scored here. Browser-compatible apart from the callers' file reading.
import { parseColor, tileReport } from '../src/core.js';

const SAMPLES = 8;
const rgbaAt = (data, at) => [data[at], data[at + 1], data[at + 2], data[at + 3]];
const hex = rgba => '#' + rgba.slice(0, rgba[3] === 255 ? 3 : 4).map(v => v.toString(16).padStart(2, '0')).join('');
// Fully transparent pixels compare equal whatever RGB they carry.
const samePixel = (a, b, at) => (!a[at + 3] && !b[at + 3]) || (a[at] === b[at] && a[at + 1] === b[at + 1] && a[at + 2] === b[at + 2] && a[at + 3] === b[at + 3]);
const inside = (region, x, y) => region && x >= region.x && y >= region.y && x < region.x + region.w && y < region.y + region.h;

function visibleBox({ data }, width) {
  let left = Infinity, top = Infinity, right = -1, bottom = -1;
  for (let at = 3, i = 0; at < data.length; at += 4, i++) if (data[at]) {
    const x = i % width, y = Math.floor(i / width);
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  return right < 0 ? null : { left, top, right, bottom };
}

// The frames a check names (`frames`), the frames its animations play (`animations`), or every frame.
function selectFrames(check, project) {
  const byName = new Map(project.frames.map(frame => [frame.name, frame])), missing = [];
  let frames = project.frames;
  if (check.frames) frames = check.frames.map(name => byName.get(name) ?? (missing.push(`frame ${name}`), null)).filter(Boolean);
  else if (check.animations) {
    const seen = new Set();
    frames = check.animations.flatMap(name => {
      const animation = project.animations[name];
      if (!animation) { missing.push(`animation ${name}`); return []; }
      return animation.frames.map(i => project.frames[i]);
    }).filter(frame => !seen.has(frame.name) && seen.add(frame.name));
  }
  return { frames, missing };
}
const missingResult = missing => ({ pass: false, detail: `missing ${missing.join(', ')}` });

const CHECKS = {
  canvas: ({ width, height }, project) => ({ pass: project.width === width && project.height === height, detail: `${project.width}×${project.height}` }),

  frames({ names, exact = false }, project) {
    const have = project.frames.map(frame => frame.name), missing = names.filter(name => !have.includes(name));
    const extra = exact ? have.filter(name => !names.includes(name)) : [];
    return { pass: !missing.length && !extra.length, detail: { frames: have, ...(missing.length && { missing }), ...(extra.length && { extra }) } };
  },

  // Every visible pixel is opaque and one of the allowed colours.
  colors({ colors }, project, { setup }) {
    const allowed = new Set((colors === 'setup' ? setup.colors : colors).map(color => hex(parseColor(color))));
    let off = 0, translucent = 0;
    const samples = [];
    for (const frame of project.frames) for (let at = 0; at < frame.data.length; at += 4) {
      const rgba = rgbaAt(frame.data, at);
      if (!rgba[3] || (rgba[3] === 255 && allowed.has(hex(rgba)))) continue;
      if (rgba[3] < 255) translucent++; else off++;
      if (samples.length < SAMPLES) samples.push({ frame: frame.name, x: at / 4 % project.width, y: Math.floor(at / 4 / project.width), color: hex(rgba) });
    }
    return { pass: !off && !translucent, detail: { offPalette: off, translucent, ...(samples.length && { samples }) } };
  },

  'color-count'({ max, ...check }, project) {
    const { frames, missing } = selectFrames(check, project);
    if (missing.length) return missingResult(missing);
    const counts = Object.fromEntries(frames.map(frame => {
      const seen = new Set();
      for (let at = 0; at < frame.data.length; at += 4) if (frame.data[at + 3]) seen.add(hex(rgbaAt(frame.data, at)));
      return [frame.name, seen.size];
    }));
    return { pass: Object.values(counts).every(count => count <= max), detail: counts };
  },

  animation({ name, frames, counts, loop, duration }, project) {
    const animation = project.animations[name];
    if (!animation) return missingResult([`animation ${name}`]);
    const entries = animation.frames.map(i => project.frames[i]), problems = [];
    if (frames && (entries.length < frames[0] || entries.length > frames[1])) problems.push(`${entries.length} frames, expected ${frames[0]}–${frames[1]}`);
    if (counts && !counts.includes(entries.length)) problems.push(`${entries.length} frames, expected ${counts.join(' or ')}`);
    if (loop !== undefined && animation.loop !== loop) problems.push(loop ? 'does not loop' : 'loops');
    const durations = entries.map(frame => frame.duration);
    if (duration && durations.some(ms => ms < duration[0] || ms > duration[1])) problems.push(`durations outside ${duration[0]}–${duration[1]} ms`);
    return { pass: !problems.length, detail: { frames: entries.map(frame => frame.name), durations, loop: animation.loop, ...(problems.length && { problems }) } };
  },

  opaque(check, project) {
    const { frames, missing } = selectFrames(check, project);
    if (missing.length) return missingResult(missing);
    const holes = Object.fromEntries(frames.map(frame => {
      let count = 0;
      for (let at = 3; at < frame.data.length; at += 4) if (frame.data[at] < 255) count++;
      return [frame.name, count];
    }).filter(([, count]) => count));
    return { pass: !Object.keys(holes).length, detail: Object.keys(holes).length ? { notOpaque: holes } : 'every pixel opaque' };
  },

  // Nothing is drawn within `pixels` of the canvas edge.
  margin({ pixels, ...check }, project) {
    const { frames, missing } = selectFrames(check, project);
    if (missing.length) return missingResult(missing);
    const touching = frames.filter(frame => {
      const box = visibleBox(frame, project.width);
      return box && (box.left < pixels || box.top < pixels || box.right >= project.width - pixels || box.bottom >= project.height - pixels);
    }).map(frame => frame.name);
    return { pass: !touching.length, detail: touching.length ? { touching } : `${pixels}px margin kept` };
  },

  ground({ row, ...check }, project) {
    const { frames, missing } = selectFrames(check, project);
    if (missing.length) return missingResult(missing);
    const bottoms = Object.fromEntries(frames.map(frame => [frame.name, visibleBox(frame, project.width)?.bottom ?? null]));
    return { pass: Object.values(bottoms).every(bottom => bottom === row), detail: { lowestRow: bottoms } };
  },

  height({ min, max, ...check }, project) {
    const { frames, missing } = selectFrames(check, project);
    if (missing.length) return missingResult(missing);
    const heights = Object.fromEntries(frames.map(frame => { const box = visibleBox(frame, project.width); return [frame.name, box ? box.bottom - box.top + 1 : 0]; }));
    return { pass: Object.values(heights).every(h => h >= min && h <= max), detail: { heights } };
  },

  // Exact visible bounds: any of left, top, right and bottom.
  extent({ frames: names, ...edges }, project) {
    const { frames, missing } = selectFrames({ frames: names }, project);
    if (missing.length) return missingResult(missing);
    const boxes = Object.fromEntries(frames.map(frame => [frame.name, visibleBox(frame, project.width)]));
    const pass = Object.values(boxes).every(box => box && ['left', 'top', 'right', 'bottom'].every(edge => edges[edge] === undefined || box[edge] === edges[edge]));
    return { pass, detail: { bounds: boxes } };
  },

  // PixelForge's advisory seam evidence: lines doubled across the wrap or value steps that do not continue.
  seamless(check, project) {
    const { frames, missing } = selectFrames(check, project);
    if (missing.length) return missingResult(missing);
    const flagged = Object.fromEntries(frames.map(frame => [frame.name, tileReport(frame.data, project.width, project.height)])
      .filter(([, report]) => report.leftRight.suspicious || report.topBottom.suspicious));
    return { pass: !Object.keys(flagged).length, detail: Object.keys(flagged).length ? { flagged } : 'no seam evidence' };
  },

  // The outermost ring of pixels is identical in every listed frame.
  'same-edges'({ frames: names }, project) {
    const { width, height } = project;
    const ring = (x, y) => x === 0 || y === 0 || x === width - 1 || y === height - 1;
    return comparePixels(names, project, (x, y) => ring(x, y));
  },

  // The pixels inside `region` (or whole frames) are identical in every listed frame.
  'same-pixels'({ frames: names, region }, project) {
    return comparePixels(names, project, (x, y) => !region || inside(region, x, y));
  },

  // Against the brief's base: every base frame keeps its name, duration and pixels, except `except` frames, which may
  // change inside `region` only (anywhere without one); animations keep their sequences. Counts unrequested pixels.
  unchanged({ except = [], region }, project, { base }) {
    if (!base) return { pass: false, detail: 'the brief names no base to compare with' };
    if (base.width !== project.width || base.height !== project.height) return { pass: false, detail: { canvas: `${project.width}×${project.height}, base ${base.width}×${base.height}` } };
    const byName = new Map(project.frames.map(frame => [frame.name, frame])), problems = [], unrequested = {};
    for (const before of base.frames) {
      const after = byName.get(before.name);
      if (!after) { problems.push(`frame ${before.name} is missing`); continue; }
      if (after.duration !== before.duration) problems.push(`frame ${before.name} lasts ${after.duration} ms, was ${before.duration}`);
      const allowed = except.includes(before.name);
      let count = 0;
      for (let at = 0, i = 0; at < before.data.length; at += 4, i++) {
        if (samePixel(before.data, after.data, at)) continue;
        if (allowed && (!region || inside(region, i % base.width, Math.floor(i / base.width)))) continue;
        count++;
      }
      if (count) unrequested[before.name] = count;
    }
    const added = project.frames.filter(frame => !base.frames.some(old => old.name === frame.name)).map(frame => frame.name);
    if (added.length) problems.push(`added frames ${added.join(', ')}`);
    const sequence = (p, key) => JSON.stringify([p.animations[key].frames.map(i => p.frames[i].name), p.animations[key].loop]);
    for (const key of new Set([...Object.keys(base.animations), ...Object.keys(project.animations)])) {
      if (!base.animations[key] || !project.animations[key] || sequence(base, key) !== sequence(project, key)) problems.push(`animation ${key} changed`);
    }
    const total = Object.values(unrequested).reduce((sum, n) => sum + n, 0);
    return { pass: !total && !problems.length, detail: { unrequestedPixels: total, ...(total && { byFrame: unrequested }), ...(problems.length && { problems }) } };
  }
};

function comparePixels(names, project, counted) {
  const { frames, missing } = selectFrames({ frames: names }, project);
  if (missing.length) return missingResult(missing);
  const [first, ...rest] = frames, differing = {};
  for (const frame of rest) {
    let count = 0;
    for (let at = 0, i = 0; at < first.data.length; at += 4, i++) if (counted(i % project.width, Math.floor(i / project.width)) && !samePixel(first.data, frame.data, at)) count++;
    if (count) differing[frame.name] = count;
  }
  return { pass: !Object.keys(differing).length, detail: Object.keys(differing).length ? { differingFrom: first.name, pixels: differing } : 'identical' };
}

export const CHECK_TYPES = Object.keys(CHECKS);

// Structural problems in a brief, as messages; an empty list means the brief is usable.
export function briefProblems(brief) {
  const problems = [];
  if (brief?.format !== 'pixelforge-benchmark-brief' || brief.version !== 1) problems.push('expected format pixelforge-benchmark-brief, version 1');
  for (const key of ['id', 'title', 'tests']) if (typeof brief?.[key] !== 'string' || !brief[key]) problems.push(`${key} must be a non-empty string`);
  if (!Number.isInteger(brief?.revision) || brief.revision < 1) problems.push('revision must be a positive integer');
  if (!Array.isArray(brief?.brief) || !brief.brief.length || brief.brief.some(p => typeof p !== 'string' || !p)) problems.push('brief must be a list of paragraphs');
  if (!Number.isInteger(brief?.setup?.width) || !Number.isInteger(brief?.setup?.height)) problems.push('setup needs width and height');
  const ids = new Set();
  for (const [i, criterion] of (Array.isArray(brief?.criteria) ? brief.criteria : []).entries()) {
    if (typeof criterion.id !== 'string' || ids.has(criterion.id)) problems.push(`criteria[${i}] needs a unique id`);
    ids.add(criterion.id);
    if (typeof criterion.text !== 'string' || !criterion.text) problems.push(`criteria[${i}] needs text`);
    if (Boolean(criterion.judge) === Boolean(criterion.check)) problems.push(`criteria[${i}] needs either a check or judge: true`);
    if (criterion.check && !CHECKS[criterion.check.type]) problems.push(`criteria[${i}] has unknown check type ${JSON.stringify(criterion.check.type)}`);
    if (criterion.check?.colors === 'setup' && !Array.isArray(brief.setup?.colors)) problems.push(`criteria[${i}] uses setup colours, but setup lists none`);
    if (criterion.check?.type === 'unchanged' && !brief.setup?.base) problems.push(`criteria[${i}] compares with a base, but setup names none`);
  }
  if (!ids.size) problems.push('criteria must list at least one criterion');
  return problems;
}

// Runs every machine check of a brief against a rendered project (and the rendered base, when the brief has one).
export function checkRun(brief, project, { base } = {}) {
  const problems = briefProblems(brief);
  if (problems.length) throw new Error(`invalid brief: ${problems.join('; ')}`);
  const results = brief.criteria.map(({ id, text, check, judge }) => judge ? { id, judge: true, text } : { id, text, ...CHECKS[check.type](check, project, { base, setup: brief.setup }) });
  const checked = results.filter(result => !result.judge);
  return { brief: brief.id, revision: brief.revision, passed: checked.filter(r => r.pass).length, failed: checked.filter(r => !r.pass).length, judged: results.length - checked.length, results };
}

// Aseprite's JSON export names its animations in meta.frameTags, as frame-order ranges; PNG import reads `animations`.
export function animationsFromTags(atlas) {
  const tags = atlas?.meta?.frameTags;
  if (atlas?.animations || !Array.isArray(tags) || !atlas.frames || Array.isArray(atlas.frames)) return atlas;
  const names = Object.keys(atlas.frames), animations = {};
  for (const tag of tags) {
    const forward = names.slice(tag.from, tag.to + 1);
    animations[tag.name] = { frames: tag.direction === 'reverse' ? forward.reverse() : tag.direction === 'pingpong' ? [...forward, ...forward.slice(1, -1).reverse()] : forward };
  }
  return { ...atlas, animations };
}
