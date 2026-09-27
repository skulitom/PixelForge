// Browser-compatible recipe patching: targeted edits addressed by readable paths. No I/O.
import { PixelError, parseColor } from './core.js';

const fail = (path, message) => { throw new PixelError(path, message); };
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const define = (target, key, value) => Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
const summarize = value => {
  const text = JSON.stringify(value);
  return text === undefined || text.length <= 160 ? value : `${Array.isArray(value) ? 'list' : typeof value} of ${text.length} JSON characters`;
};
const segmentPattern = /\.([^.[\]"]+)|\[(\d+|-|[a-zA-Z][\w-]*)\]|\[("(?:[^"\\]|\\.)*")\]/y;

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
  const next = structuredClone(recipe), edits = [];
  changes.forEach((change, i) => {
    const where = `changes[${i}]`;
    if (!isObject(change)) fail(where, 'expected an object such as {"set": "frames[idle].duration", "value": 120}');
    for (const key of Object.keys(change)) if (!['set', 'insert', 'remove', 'paint', 'value'].includes(key)) fail(`${where}.${key}`, 'unknown field; use set, insert, remove or paint with a path');
    const verbs = ['set', 'insert', 'remove', 'paint'].filter(verb => change[verb] !== undefined);
    if (verbs.length !== 1) fail(where, 'use exactly one of set, insert, remove or paint');
    const [verb] = verbs, target = `${where}.${verb}`;
    if (verb === 'remove' && change.value !== undefined) fail(`${where}.value`, 'remove takes no value');
    if (verb !== 'remove' && change.value === undefined) fail(`${where}.value`, `${verb} needs a value`);
    if (change.value === null) fail(`${where}.value`, 'null is not supported; remove the field instead');
    const { parent, slot, path } = locate(next, parsePath(change[verb], target), target, verb);
    const edit = { [verb]: change[verb], ...(path !== change[verb].replace(/^project\.?/, '') && { at: path }) };
    if (verb === 'paint') {
      if (parent !== next.frames || !isObject(parent[slot])) fail(target, 'paint needs a frame path, such as frames[blink]');
      if (!Array.isArray(change.value) || !change.value.length || change.value.length > 65536) fail(`${where}.value`, 'paint needs 1–65,536 pixels with x, y and color');
      const frame = parent[slot];
      if (frame.pixels !== undefined && !Array.isArray(frame.pixels)) fail(target, `${path}.pixels must be a list`);
      // Keep one correction per coordinate. Later paint replaces an earlier correction, without touching layers.
      const pixels = new Map((frame.pixels ?? []).map(pixel => [`${pixel.x},${pixel.y}`, pixel]));
      change.value.forEach((pixel, j) => {
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
      edit.pixels = change.value.length;
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
