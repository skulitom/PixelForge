// Browser-compatible recipe patching: targeted edits addressed by readable paths. No I/O.
import { PixelError, parseColor, renderProject } from './core.js';

const fail = (path, message) => { throw new PixelError(path, message); };
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const define = (target, key, value) => Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
const summarize = value => {
  const text = JSON.stringify(value);
  return text === undefined || text.length <= 160 ? value : `${Array.isArray(value) ? 'list' : typeof value} of ${text.length} JSON characters`;
};
const segmentPattern = /\.([^.[\]"]+)|\[(\d+|-|[a-zA-Z][\w-]*)\]|\[("(?:[^"\\]|\\.)*")\]/y;

const hex = data => '#' + [...data].map(v => v.toString(16).padStart(2, '0')).join('');
function regionPixels(recipe, frameIndex, verb, value, where) {
  if (!isObject(value)) fail(where, 'expected a region object');
  const allowed = ['x', 'y', 'mask', ...(verb === 'grid' ? ['rows', 'erase'] : ['w', 'h', ...(verb === 'move' ? ['dx', 'dy'] : ['from', 'to'])])];
  for (const key of Object.keys(value)) if (!allowed.includes(key) || value[key] === null) fail(`${where}.${key}`, 'unknown or null region field');
  const rows = value.rows;
  if (verb === 'grid' && (!Array.isArray(rows) || !rows.length || rows.length > 256 || typeof rows[0] !== 'string' || !rows[0].length)) fail(`${where}.rows`, 'expected 1–256 equal-width rows');
  const w = verb === 'grid' ? rows[0].length : value.w, h = verb === 'grid' ? rows.length : value.h;
  for (const [key, number, max] of [['x', value.x, recipe.width - 1], ['y', value.y, recipe.height - 1], ['w', w, recipe.width], ['h', h, recipe.height]]) {
    if (!Number.isInteger(number) || number < (key === 'w' || key === 'h' ? 1 : 0) || number > max) fail(`${where}.${key}`, 'expected an integer region inside the canvas');
  }
  if (value.x + w > recipe.width || value.y + h > recipe.height) fail(where, 'region must fit inside the canvas');
  if (rows && rows.some(row => typeof row !== 'string' || row.length !== w)) fail(`${where}.rows`, 'rows must have equal width');
  if (value.mask !== undefined && (!Array.isArray(value.mask) || value.mask.length !== h || value.mask.some(row => typeof row !== 'string' || row.length !== w || /[^x.]/.test(row)))) fail(`${where}.mask`, 'mask must match the region: x selects, dot preserves');
  if (value.erase !== undefined && (typeof value.erase !== 'string' || value.erase.length !== 1 || '. '.includes(value.erase) || Object.hasOwn(recipe.palette ?? {}, value.erase))) fail(`${where}.erase`, 'choose one non-palette character other than dot/space for erasure');
  let data, from, to;
  if (verb !== 'grid') data = renderProject(recipe).frames[frameIndex].data;
  if (verb === 'move') {
    for (const key of ['dx', 'dy']) if (!Number.isInteger(value[key]) || Math.abs(value[key]) > 256) fail(`${where}.${key}`, 'expected an integer offset from -256 to 256');
  } else if (verb === 'recolor') { from = parseColor(value.from, recipe.palette, `${where}.from`); to = value.to; parseColor(to, recipe.palette, `${where}.to`); }
  const pixels = [], moved = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (value.mask && value.mask[y][x] !== 'x') continue;
    const px = value.x + x, py = value.y + y, at = (py * recipe.width + px) * 4;
    if (verb === 'grid') {
      const char = rows[y][x]; if (char === '.' || char === ' ') continue;
      if (char !== value.erase && !Object.hasOwn(recipe.palette ?? {}, char)) fail(`${where}.rows[${y}]`, `unknown palette character ${JSON.stringify(char)}`);
      pixels.push({ x: px, y: py, color: char === value.erase ? 'transparent' : char });
    } else if (verb === 'recolor') {
      if (from.every((c, i) => data[at + i] === c)) pixels.push({ x: px, y: py, color: to });
    } else {
      const tx = px + value.dx, ty = py + value.dy;
      if (tx < 0 || ty < 0 || tx >= recipe.width || ty >= recipe.height) fail(where, 'selected destination falls outside the canvas; clipping is not implicit');
      pixels.push({ x: px, y: py, color: 'transparent' });
      moved.push({ x: tx, y: ty, color: hex(data.subarray(at, at + 4)) });
    }
  }
  return [...pixels, ...moved]; // Capture before clearing so overlapping moves preserve every highlight.
}

// Paths use the same form as error messages, such as frames[3].ops[0].x; "project." is optional.
function parsePath(text, where) {
  if (typeof text !== 'string' || !text) fail(where, 'expected a path such as frames[idle].duration');
  const source = text.replace(/^project(?=[.[])/, ''), segments = [], first = /^[^.[\]"]+/.exec(source);
  let at = first ? first[0].length : 0;
  if (first) segments.push({ key: first[0] });
  while (at < source.length) {
    segmentPattern.lastIndex = at;
    const match = segmentPattern.exec(source);
    if (!match) fail(where, `cannot read ${JSON.stringify(source.slice(at))} in ${JSON.stringify(text)}; use .key, [index], [name] or [-]`);
    at = segmentPattern.lastIndex;
    if (match[1] !== undefined) segments.push({ key: match[1] });
    else if (match[3] !== undefined) segments.push({ name: JSON.parse(match[3]) });
    else if (match[2] === '-') segments.push({ end: true });
    else segments.push(/^\d+$/.test(match[2]) ? { index: Number(match[2]) } : { name: match[2] });
  }
  return segments;
}

// Walks to the final segment's container. Lists take [index], [name] (the item whose name, or string value, matches)
// or [-] for the end; an insert may create the list it inserts into.
function locate(root, segments, where, verb) {
  let node = root, path = '';
  for (const [i, segment] of segments.entries()) {
    const last = i === segments.length - 1, owner = path || 'the project';
    let slot;
    if (Array.isArray(node)) {
      if (segment.key !== undefined) fail(where, `${owner} is a list; select an item with [index] or [name]`);
      if (segment.end) {
        if (!last || verb !== 'insert') fail(where, '[-] is the end of a list and can only end an insert path');
        slot = node.length;
      } else if (segment.index !== undefined) slot = segment.index;
      else {
        const matches = node.flatMap((item, index) => ((isObject(item) ? item.name : item) === segment.name ? [index] : []));
        if (matches.length !== 1) fail(where, matches.length ? `${matches.length} items in ${owner} match ${JSON.stringify(segment.name)}; use an index` : `${owner} has no item named ${JSON.stringify(segment.name)}`);
        [slot] = matches;
      }
      if (slot > node.length - (last && verb === 'insert' ? 0 : 1)) fail(where, `${owner} has ${node.length} item${node.length === 1 ? '' : 's'}`);
      path += `[${slot}]`;
    } else if (isObject(node)) {
      if (segment.end) fail(where, `${owner} is not a list`);
      slot = segment.key ?? segment.name ?? String(segment.index);
      path += /^[^.[\]"]+$/.test(slot) ? `${path ? '.' : ''}${slot}` : `[${JSON.stringify(slot)}]`;
      if (!last && !Object.hasOwn(node, slot)) {
        const next = segments[i + 1];
        if (verb === 'insert' && i === segments.length - 2 && (next.end || next.index === 0)) define(node, slot, []);
        else fail(where, `${owner} has no field ${JSON.stringify(slot)}`);
      }
    } else fail(where, `${owner} is ${JSON.stringify(node)}, not an object or list`);
    if (last) return { parent: node, slot, path };
    node = node[slot];
  }
}

// Applies changes in order to a copy of the recipe. Each edit reports its resolved path and the value it replaced.
export function patchRecipe(recipe, changes) {
  if (!isObject(recipe)) fail('project', 'expected an object');
  if (!Array.isArray(changes) || !changes.length || changes.length > 1024) fail('changes', 'expected a list of 1–1024 changes');
  const estimate = (source, change) => {
    if (!change || !['paint', 'grid', 'move', 'recolor'].some(verb => change[verb] !== undefined)) return 0;
    const renders = (change.scope === 'frame' ? 2 : 0) + (change.move !== undefined || change.recolor !== undefined ? 1 : 0);
    return (source.width * source.height || 0) * (2 + renders * (source.frames?.length ?? 0));
  };
  const budget = 67108864;
  if (changes.reduce((sum, change) => sum + estimate(recipe, change), 0) > budget) fail('changes', 'regional edit work exceeds 67,108,864 estimated pixels; split the batch or reduce frame scope');
  const next = structuredClone(recipe), edits = [];
  let work = 0;
  changes.forEach((change, i) => {
    const where = `changes[${i}]`;
    if (!isObject(change)) fail(where, 'expected an object such as {"set": "frames[idle].duration", "value": 120}');
    for (const key of Object.keys(change)) if (!['set', 'insert', 'remove', 'paint', 'grid', 'move', 'recolor', 'scope', 'value'].includes(key)) fail(`${where}.${key}`, 'unknown field in patch');
    const verbs = ['set', 'insert', 'remove', 'paint', 'grid', 'move', 'recolor'].filter(verb => change[verb] !== undefined);
    if (verbs.length !== 1) fail(where, 'use exactly one of set, insert, remove, paint, grid, move or recolor');
    const [verb] = verbs, target = `${where}.${verb}`;
    const painting = ['paint', 'grid', 'move', 'recolor'].includes(verb);
    work += estimate(next, change);
    if (work > budget) fail(where, 'regional edit work exceeds 67,108,864 estimated pixels; split the batch');
    if (change.scope !== undefined && (!painting || !['frame', 'inherited'].includes(change.scope))) fail(`${where}.scope`, 'paint/grid/move/recolor scope must be frame or inherited (default)');
    if (verb === 'remove' && change.value !== undefined) fail(`${where}.value`, 'remove takes no value');
    if (verb !== 'remove' && change.value === undefined) fail(`${where}.value`, `${verb} needs a value`);
    if (change.value === null) fail(`${where}.value`, 'null is not supported; remove the field instead');
    const { parent, slot, path } = locate(next, parsePath(change[verb], target), target, verb);
    const edit = { [verb]: change[verb], ...(path !== change[verb].replace(/^project\.?/, '') && { at: path }) };
    if (painting) {
      if (parent !== next.frames || !isObject(parent[slot])) fail(target, `${verb} needs a frame path, such as frames[blink]`);
      const protectedFrames = change.scope === 'frame' ? renderProject(next).frames : null;
      const entries = verb === 'paint' ? change.value : regionPixels(next, slot, verb, change.value, `${where}.value`);
      if (!Array.isArray(entries) || (verb === 'paint' && !entries.length) || entries.length > 131072) fail(`${where}.value`, verb === 'paint' ? 'paint needs 1–65,536 pixels with x, y and color' : 'expected a bounded pixel list');
      if (verb === 'paint' && entries.length > 65536) fail(`${where}.value`, 'paint needs 1–65,536 pixels with x, y and color');
      const frame = parent[slot];
      if (frame.pixels !== undefined && !Array.isArray(frame.pixels)) fail(target, `${path}.pixels must be a list`);
      // Keep one correction per coordinate. Later paint replaces an earlier correction, without touching layers.
      const pixels = new Map((frame.pixels ?? []).map(pixel => [`${pixel.x},${pixel.y}`, pixel]));
      entries.forEach((pixel, j) => {
        const pp = `${where}.value[${j}]`;
        if (!isObject(pixel)) fail(pp, 'expected a pixel with x, y and color');
        for (const key of Object.keys(pixel)) if (!['x', 'y', 'color'].includes(key)) fail(`${pp}.${key}`, 'unknown field');
        for (const [axis, limit] of [['x', next.width], ['y', next.height]]) {
          if (!Number.isInteger(pixel[axis]) || pixel[axis] < 0 || pixel[axis] >= limit) fail(`${pp}.${axis}`, `expected an integer from 0 to ${limit - 1} in canvas coordinates`);
        }
        parseColor(pixel.color, next.palette ?? {}, `${pp}.color`);
        pixels.set(`${pixel.x},${pixel.y}`, structuredClone(pixel));
      });
      frame.pixels = [...pixels.values()];
      edit.pixels = entries.length;
      if (change.scope !== undefined) edit.scope = change.scope;
      if (protectedFrames) {
        const current = renderProject(next); edit.protected = [];
        for (let index = slot + 1; index < next.frames.length; index++) {
          const original = protectedFrames[index].data, changed = current.frames[index].data;
          const restore = new Map((next.frames[index].pixels ?? []).map(pixel => [`${pixel.x},${pixel.y}`, pixel]));
          let count = 0;
          for (let at = 0; at < original.length; at += 4) {
            if (original.subarray(at, at + 4).every((c, i) => c === changed[at + i])) continue;
            const x = at / 4 % next.width, y = Math.floor(at / 4 / next.width);
            restore.set(`${x},${y}`, { x, y, color: hex(original.subarray(at, at + 4)) }); count++;
          }
          if (count) { next.frames[index].pixels = [...restore.values()]; edit.protected.push({ frame: next.frames[index].name, pixels: count }); }
        }
      }
    } else if (verb === 'insert') {
      if (!Array.isArray(parent)) fail(target, `insert needs a list position, such as ${path}[-]`);
      parent.splice(slot, 0, structuredClone(change.value));
    } else if (Array.isArray(parent) || Object.hasOwn(parent, slot)) {
      edit.before = summarize(parent[slot]);
      if (verb === 'set') define(parent, slot, structuredClone(change.value));
      else if (Array.isArray(parent)) parent.splice(slot, 1);
      else delete parent[slot];
    } else if (verb === 'set') {
      edit.created = true;
      define(parent, slot, structuredClone(change.value));
    } else fail(target, `nothing to remove at ${path}`);
    edits.push(edit);
  });
  return { recipe: next, edits };
}
