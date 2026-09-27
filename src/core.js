// Browser-compatible, deterministic rasterizer. No I/O and no dependencies.
export class PixelError extends Error {
  constructor(path, message) { super(`${path}: ${message}`); this.name = 'PixelError'; this.path = path; }
}
const fail = (path, message) => { throw new PixelError(path, message); };
const own = (obj, key) => Object.hasOwn(obj, key);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function object(value, path, keys) {
  if (!isObject(value)) fail(path, 'expected an object');
  for (const key of Object.keys(value)) if (value[key] === null) fail(`${path}.${key}`, 'null is not supported; omit optional fields to use defaults');
  if (keys) for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${path}.${key}`, 'unknown field');
  return value;
}
function integer(value, path, min = -4096, max = 4096) {
  if (!Number.isInteger(value) || value < min || value > max) fail(path, `expected an integer from ${min} to ${max}`);
  return value;
}
function boolean(value, path) { if (typeof value !== 'boolean') fail(path, 'expected a boolean'); return value; }
function list(value, path, max = 2048) {
  if (!Array.isArray(value) || value.length > max) fail(path, `expected an array with at most ${max} items`);
  return value;
}
function name(value, path) {
  if (typeof value !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(value)) fail(path, 'use 1–64 letters, digits, underscores or hyphens, starting with a letter');
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(value)) fail(path, 'reserved filename; choose a portable name');
  return value;
}
export function parseColor(value, palette = {}, path = 'color') {
  if (typeof value !== 'string') fail(path, 'expected a palette name or hex color');
  if (own(palette, value)) value = palette[value];
  if (value === 'transparent') return [0, 0, 0, 0];
  if (typeof value !== 'string' || !/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)) fail(path, `unknown color ${JSON.stringify(value)}; use a palette name or #RGB, #RGBA, #RRGGBB, #RRGGBBAA`);
  let hex = value.slice(1);
  if (hex.length < 5) hex = [...hex].map(c => c + c).join('');
  if (hex.length === 6) hex += 'ff';
  return [0, 2, 4, 6].map(i => parseInt(hex.slice(i, i + 2), 16));
}

function blend(data, i, color, opacity = 1) {
  const a = color[3] / 255 * opacity;
  if (a === 0) return;
  if (a === 1) { data.set(color, i); return; }
  const old = data[i + 3] / 255, out = a + old * (1 - a);
  for (let c = 0; c < 3; c++) data[i + c] = Math.round((color[c] * a + data[i + c] * old * (1 - a)) / out);
  data[i + 3] = Math.round(out * 255);
}
function readRows(rows, path, palette) {
  list(rows, path, 256);
  if (!rows.length) fail(path, 'grid must contain at least one row');
  if (typeof rows[0] !== 'string' || rows[0].length < 1 || rows[0].length > 256) fail(`${path}[0]`, 'row must contain 1–256 ASCII characters');
  const width = rows[0].length;
  rows.forEach((row, y) => {
    if (typeof row !== 'string' || row.length !== width) fail(`${path}[${y}]`, `all rows must be ${width} characters wide`);
    for (const char of row) if (char !== '.' && char !== ' ') {
      if (!own(palette, char)) fail(`${path}[${y}]`, `unknown palette character ${JSON.stringify(char)}`);
    }
  });
  return { rows, width, height: rows.length };
}

export function renderProject(spec, options = {}) {
  object(options, 'render', ['layers']);
  if (options.layers !== undefined) {
    renderProject(spec); // Validate the complete recipe before hiding any drawing.
    list(options.layers, 'render.layers', 64);
    if (!options.layers.length) fail('render.layers', 'select at least one named layer');
    const known = new Set(spec.frames.flatMap(f => (f.layers ?? []).map(l => l.name).filter(Boolean)));
    for (const ref of options.layers) if (typeof ref !== 'string' || !known.has(ref)) fail('render.layers', `unknown layer ${JSON.stringify(ref)}`);
    const isolated = structuredClone(spec); isolated.background = 'transparent';
    for (const frame of isolated.frames) { delete frame.ops; delete frame.pixels; frame.layers = (frame.layers ?? []).filter(layer => options.layers.includes(layer.name)); }
    return renderProject(isolated);
  }
  object(spec, 'project', ['$schema', 'version', 'name', 'width', 'height', 'palette', 'background', 'symbols', 'frames', 'animations', 'sheet']);
  if (spec.version !== 1) fail('project.version', 'expected 1');
  const projectName = name(spec.name, 'project.name');
  const width = integer(spec.width, 'project.width', 1, 256), height = integer(spec.height, 'project.height', 1, 256);
  const palette = spec.palette ?? {};
  object(palette, 'project.palette');
  if (Object.keys(palette).length > 256) fail('project.palette', 'at most 256 colors are allowed');
  for (const [key, value] of Object.entries(palette)) {
    if (!key || key.length > 64 || key === '.' || key === ' ' || key === 'transparent') fail(`project.palette.${key}`, 'invalid or reserved palette name');
    parseColor(value, {}, `project.palette.${key}`);
  }
  const color = (value, path) => parseColor(value, palette, path);
  const background = color(spec.background ?? 'transparent', 'project.background');
  const symbols = Object.create(null);
  object(spec.symbols ?? {}, 'project.symbols');
  for (const [key, rows] of Object.entries(spec.symbols ?? {})) {
    name(key, `project.symbols.${key}`);
    symbols[key] = readRows(rows, `project.symbols.${key}`, palette);
  }
  list(spec.frames, 'project.frames', 256);
  if (!spec.frames.length) fail('project.frames', 'at least one frame is required');
  if (width * height * spec.frames.length > 4194304) fail('project.frames', 'total frame area exceeds 4,194,304 pixels');
  object(spec.animations ?? {}, 'project.animations');
  const animationCount = spec.animations === undefined ? 1 : Object.keys(spec.animations).length;
  if (7 + spec.frames.length + animationCount > 65535) fail('project.animations', `bundle exceeds the ZIP32 limit of 65,535 files; at most ${65535 - 7 - spec.frames.length} animations fit alongside these frames and 7 support files`);
  let work = 0, operationCount = 0;
  const spend = amount => { work += amount; if (work > 67108864) fail('project', 'drawing work exceeds the 67-million-pixel budget; simplify repeated operations'); };
  const warnings = new Set();
  const rendered = new Map(), frameNames = new Set();
  function drawOps(data, ops, path) {
    list(ops, path);
    for (let index = 0; index < ops.length; index++) {
      if (++operationCount > 20000) fail(path, 'project exceeds 20,000 drawing operations');
      const op = ops[index], p = `${path}[${index}]`;
      object(op, p);
      const fields = {
        pixel: ['x', 'y', 'color'], rect: ['x', 'y', 'w', 'h', 'color', 'filled'],
        ellipse: ['x', 'y', 'w', 'h', 'color', 'filled'], line: ['x', 'y', 'x2', 'y2', 'color'],
        clear: ['x', 'y', 'w', 'h'], fill: ['x', 'y', 'color'],
        grid: ['x', 'y', 'rows', 'scale', 'flipX', 'flipY', 'rotate'],
        stamp: ['x', 'y', 'symbol', 'scale', 'flipX', 'flipY', 'rotate'], replace: ['from', 'to']
      };
      if (typeof op.op !== 'string' || !own(fields, op.op)) fail(`${p}.op`, `unknown operation ${JSON.stringify(op.op)}`);
      object(op, p, ['op', ...fields[op.op]]);
      const x = integer(op.x ?? 0, `${p}.x`), y = integer(op.y ?? 0, `${p}.y`);
      const put = (px, py, c, erase = false) => {
        if (px < 0 || py < 0 || px >= width || py >= height) { warnings.add('Some drawing falls outside the canvas and is clipped.'); return; }
        const at = (py * width + px) * 4;
        if (erase) data.fill(0, at, at + 4); else blend(data, at, c);
      };
      if (op.op === 'pixel') { spend(1); put(x, y, color(op.color, `${p}.color`)); }
      else if (['rect', 'ellipse', 'clear'].includes(op.op)) {
        const w = integer(op.w, `${p}.w`, 1, 512), h = integer(op.h, `${p}.h`, 1, 512);
        const c = op.op === 'clear' ? [0, 0, 0, 0] : color(op.color, `${p}.color`);
        const filled = op.filled === undefined ? true : boolean(op.filled, `${p}.filled`);
        spend(w * h);
        const inside = (i, j) => ((i + .5 - w / 2) / (w / 2)) ** 2 + ((j + .5 - h / 2) / (h / 2)) ** 2 <= 1;
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
          const draw = op.op === 'ellipse'
            ? inside(i, j) && (filled || !inside(i - 1, j) || !inside(i + 1, j) || !inside(i, j - 1) || !inside(i, j + 1))
            : filled || i === 0 || j === 0 || i === w - 1 || j === h - 1;
          if (draw) put(x + i, y + j, c, op.op === 'clear');
        }
      } else if (op.op === 'line') {
        let px = x, py = y;
        const x2 = integer(op.x2, `${p}.x2`), y2 = integer(op.y2, `${p}.y2`), c = color(op.color, `${p}.color`);
        const dx = Math.abs(x2 - px), sx = px < x2 ? 1 : -1, dy = -Math.abs(y2 - py), sy = py < y2 ? 1 : -1;
        let error = dx + dy;
        spend(Math.max(dx, -dy) + 1);
        while (true) { put(px, py, c); if (px === x2 && py === y2) break; const e = 2 * error; if (e >= dy) { error += dy; px += sx; } if (e <= dx) { error += dx; py += sy; } }
      } else if (op.op === 'grid' || op.op === 'stamp') {
        if (op.op === 'stamp' && typeof op.symbol !== 'string') fail(`${p}.symbol`, 'expected a string naming a symbol');
        const grid = op.op === 'grid' ? readRows(op.rows, `${p}.rows`, palette) : symbols[op.symbol];
        if (!grid) fail(`${p}.symbol`, `unknown symbol ${JSON.stringify(op.symbol)}`);
        const scale = integer(op.scale ?? 1, `${p}.scale`, 1, 16);
        const flipX = boolean(op.flipX ?? false, `${p}.flipX`), flipY = boolean(op.flipY ?? false, `${p}.flipY`);
        const rotate = integer(op.rotate ?? 0, `${p}.rotate`, 0, 270);
        if (rotate % 90) fail(`${p}.rotate`, 'expected 0, 90, 180 or 270 degrees clockwise');
        spend(grid.width * grid.height * scale * scale);
        for (let gy = 0; gy < grid.height; gy++) for (let gx = 0; gx < grid.width; gx++) {
          const char = grid.rows[gy][gx];
          if (char === '.' || char === ' ') continue;
          let px = flipX ? grid.width - 1 - gx : gx, py = flipY ? grid.height - 1 - gy : gy;
          if (rotate === 90) [px, py] = [grid.height - 1 - py, px];
          else if (rotate === 180) [px, py] = [grid.width - 1 - px, grid.height - 1 - py];
          else if (rotate === 270) [px, py] = [py, grid.width - 1 - px];
          const c = color(char, `${p}.rows`);
          for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) put(x + px * scale + sx, y + py * scale + sy, c);
        }
      } else if (op.op === 'replace') {
        const from = color(op.from, `${p}.from`), to = color(op.to, `${p}.to`);
        spend(width * height);
        for (let i = 0; i < data.length; i += 4) if (from.every((c, j) => data[i + j] === c)) data.set(to, i);
      } else if (op.op === 'fill') {
        if (x < 0 || y < 0 || x >= width || y >= height) fail(p, 'fill seed must be inside the canvas');
        const c = color(op.color, `${p}.color`), target = data.slice((y * width + x) * 4, (y * width + x) * 4 + 4);
        const visited = new Uint8Array(width * height), stack = [y * width + x];
        spend(width * height);
        while (stack.length) {
          const at = stack.pop();
          if (visited[at]) continue;
          visited[at] = 1;
          if (!target.every((v, j) => data[at * 4 + j] === v)) continue;
          data.set(c, at * 4);
          const px = at % width, py = Math.floor(at / width);
          if (px > 0) stack.push(at - 1); if (px + 1 < width) stack.push(at + 1);
          if (py > 0) stack.push(at - width); if (py + 1 < height) stack.push(at + width);
        }
      }
    }
  }
  const frames = spec.frames.map((frame, index) => {
    const p = `project.frames[${index}]`;
    object(frame, p, ['name', 'duration', 'from', 'translate', 'flipX', 'flipY', 'ops', 'layers', 'pixels']);
    const frameName = name(frame.name, `${p}.name`);
    if (frameNames.has(frameName.toLowerCase())) fail(`${p}.name`, `duplicate frame ${frameName}; names must also be unique ignoring case`);
    frameNames.add(frameName.toLowerCase());
    const duration = integer(frame.duration ?? 100, `${p}.duration`, 1, 60000);
    let data = new Uint8ClampedArray(width * height * 4);
    if (frame.from !== undefined) {
      if (typeof frame.from !== 'string' || !rendered.has(frame.from)) fail(`${p}.from`, 'must name an earlier frame');
      data.set(rendered.get(frame.from).data);
    } else for (let i = 0; i < data.length; i += 4) data.set(background, i);
    const translate = frame.translate ?? [0, 0];
    list(translate, `${p}.translate`, 2);
    if (translate.length !== 2) fail(`${p}.translate`, 'expected [x, y]');
    const dx = integer(translate[0], `${p}.translate[0]`), dy = integer(translate[1], `${p}.translate[1]`);
    const flipX = boolean(frame.flipX ?? false, `${p}.flipX`), flipY = boolean(frame.flipY ?? false, `${p}.flipY`);
    if (dx || dy || flipX || flipY) {
      const transformed = new Uint8ClampedArray(data.length);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const px = (flipX ? width - 1 - x : x) + dx, py = (flipY ? height - 1 - y : y) + dy;
        if (px >= 0 && py >= 0 && px < width && py < height) transformed.set(data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4), (py * width + px) * 4);
        else if (data[(y * width + x) * 4 + 3]) warnings.add('Some drawing falls outside the canvas and is clipped.');
      }
      data = transformed;
    }
    drawOps(data, frame.ops ?? [], `${p}.ops`);
    list(frame.layers ?? [], `${p}.layers`, 64);
    for (const [li, layer] of (frame.layers ?? []).entries()) {
      const lp = `${p}.layers[${li}]`;
      object(layer, lp, ['name', 'visible', 'opacity', 'x', 'y', 'ops']);
      if (layer.name !== undefined) name(layer.name, `${lp}.name`);
      const visible = boolean(layer.visible ?? true, `${lp}.visible`), opacity = layer.opacity ?? 1;
      if (typeof opacity !== 'number' || !Number.isFinite(opacity) || opacity < 0 || opacity > 1) fail(`${lp}.opacity`, 'expected a number from 0 to 1');
      const lx = integer(layer.x ?? 0, `${lp}.x`), ly = integer(layer.y ?? 0, `${lp}.y`);
      const pixels = new Uint8ClampedArray(data.length);
      drawOps(pixels, layer.ops ?? [], `${lp}.ops`);
      if (visible && opacity > 0) {
        spend(width * height);
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
          const tx = x + lx, ty = y + ly, i = (y * width + x) * 4;
          if (tx >= 0 && tx < width && ty >= 0 && ty < height) blend(data, (ty * width + tx) * 4, pixels.subarray(i, i + 4), opacity);
          else if (pixels[i + 3]) warnings.add('Some drawing falls outside the canvas and is clipped.');
        }
      }
    }
    // Final canvas-space corrections replace RGBA, including transparency, after all layers.
    list(frame.pixels ?? [], `${p}.pixels`, 65536);
    spend((frame.pixels ?? []).length);
    for (const [i, pixel] of (frame.pixels ?? []).entries()) {
      const pp = `${p}.pixels[${i}]`;
      object(pixel, pp, ['x', 'y', 'color']);
      const x = integer(pixel.x, `${pp}.x`, 0, width - 1), y = integer(pixel.y, `${pp}.y`, 0, height - 1);
      data.set(color(pixel.color, `${pp}.color`), (y * width + x) * 4);
    }
    const result = { name: frameName, duration, data };
    rendered.set(frameName, result);
    return result;
  });
  const animations = Object.create(null), animationNames = new Set();
  object(spec.animations ?? {}, 'project.animations');
  for (const [key, animation] of Object.entries(spec.animations ?? { default: { frames: frames.map(f => f.name) } })) {
    const p = `project.animations.${key}`;
    name(key, p);
    if (animationNames.has(key.toLowerCase())) fail(p, 'animation names must also be unique ignoring case');
    animationNames.add(key.toLowerCase());
    object(animation, p, ['frames', 'direction', 'loop']);
    list(animation.frames, `${p}.frames`, 1024);
    if (!animation.frames.length) fail(`${p}.frames`, 'at least one frame is required');
    const indices = animation.frames.map((ref, i) => { if (!rendered.has(ref)) fail(`${p}.frames[${i}]`, `unknown frame ${JSON.stringify(ref)}`); return frames.findIndex(f => f.name === ref); });
    const direction = animation.direction ?? 'forward';
    if (!['forward', 'reverse', 'pingpong'].includes(direction)) fail(`${p}.direction`, 'expected forward, reverse or pingpong');
    if (direction === 'reverse') indices.reverse();
    if (direction === 'pingpong' && indices.length > 2) indices.push(...indices.slice(1, -1).reverse());
    const loop = boolean(animation.loop ?? true, `${p}.loop`);
    animations[key] = { frames: indices, loop, duration: indices.reduce((sum, i) => sum + frames[i].duration, 0) };
  }
  if (!Object.keys(animations).length) fail('project.animations', 'at least one animation is required; omit this field for a default animation');
  const sheet = object(spec.sheet ?? {}, 'project.sheet', ['columns', 'padding', 'scale']);
  const columns = integer(sheet.columns ?? Math.min(frames.length, 8), 'project.sheet.columns', 1, 256);
  const padding = integer(sheet.padding ?? 0, 'project.sheet.padding', 0, 16);
  const scale = integer(sheet.scale ?? 1, 'project.sheet.scale', 1, 16);
  const sheetWidth = columns * (width + padding * 2) * scale, sheetHeight = Math.ceil(frames.length / columns) * (height + padding * 2) * scale;
  if (sheetWidth * sheetHeight > 16777216) fail('project.sheet', 'atlas exceeds 16,777,216 pixels; reduce scale or columns');
  return { name: projectName, width, height, frames, animations, palette, sheet: { columns, padding, scale, width: sheetWidth, height: sheetHeight }, warnings: [...warnings] };
}

export function scalePixels(data, width, height, scale = 1) {
  integer(scale, 'scale', 1, 16);
  const result = new Uint8ClampedArray(width * height * scale * scale * 4);
  for (let y = 0; y < height * scale; y++) for (let x = 0; x < width * scale; x++) {
    const from = (Math.floor(y / scale) * width + Math.floor(x / scale)) * 4;
    result.set(data.subarray(from, from + 4), (y * width * scale + x) * 4);
  }
  return result;
}

export function buildAtlas(project) {
  const { width, height, frames, sheet } = project;
  const data = new Uint8ClampedArray(sheet.width * sheet.height * 4);
  const entries = Object.create(null);
  frames.forEach((frame, i) => {
    const x = ((i % sheet.columns) * (width + sheet.padding * 2) + sheet.padding) * sheet.scale;
    const y = (Math.floor(i / sheet.columns) * (height + sheet.padding * 2) + sheet.padding) * sheet.scale;
    const w = width * sheet.scale, h = height * sheet.scale;
    const pixels = scalePixels(frame.data, width, height, sheet.scale);
    for (let row = 0; row < h; row++) data.set(pixels.subarray(row * w * 4, (row + 1) * w * 4), ((y + row) * sheet.width + x) * 4);
    entries[frame.name] = { frame: { x, y, w, h }, rotated: false, trimmed: false, spriteSourceSize: { x: 0, y: 0, w, h }, sourceSize: { w, h }, duration: frame.duration };
  });
  const animations = Object.fromEntries(Object.entries(project.animations).map(([key, a]) => [key, { ...a, frames: a.frames.map(i => frames[i].name) }]));
  const meta = { app: 'PixelForge', version: '1', image: `${project.name}.png`, format: 'RGBA8888', size: { w: sheet.width, h: sheet.height }, scale: String(sheet.scale) };
  return { data, width: sheet.width, height: sheet.height, metadata: { frames: entries, animations, meta } };
}

// Inspection and comparison build in-memory contact sheets and palette-key text. Nothing is written.
const gutterColor = [23, 25, 29, 255], checkerColors = [[143, 145, 151, 255], [131, 133, 139, 255]];
const legendSymbols = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&*+-/:;<=>@^_~';
const toHex = color => '#' + [...color].slice(0, color[3] === 255 ? 3 : 4).map(v => v.toString(16).padStart(2, '0')).join('');
const colorId = (data, at) => ((data[at] << 24) | (data[at + 1] << 16) | (data[at + 2] << 8) | data[at + 3]) >>> 0;

// Names exact RGBA colors with single-character palette keys where possible. Other colors get legend symbols in a
// stable order (multi-character palette names, then first use by frame), so every readback of a revision agrees.
function colorNamer(project, others = []) {
  const keys = new Map(), names = new Map(), entries = new Map(), used = new Set(), unnamed = new Set();
  const symbols = [...legendSymbols].filter(symbol => !own(project.palette, symbol));
  for (const [key, value] of Object.entries(project.palette)) {
    const id = colorId(parseColor(value), 0);
    if (key.length === 1 && !keys.has(id)) keys.set(id, key);
    if (!names.has(id)) names.set(id, key);
  }
  const assign = (data, at) => {
    const id = colorId(data, at);
    if (!data[at + 3] || keys.has(id) || !symbols.length) return;
    const symbol = symbols.shift();
    keys.set(id, symbol);
    entries.set(symbol, { color: toHex(data.slice(at, at + 4)), ...(names.has(id) ? { palette: names.get(id) } : {}) });
  };
  for (const value of Object.values(project.palette)) assign(parseColor(value), 0);
  for (const source of [project, ...others]) for (const frame of source.frames) for (let at = 0; at < frame.data.length; at += 4) assign(frame.data, at);
  return {
    char(data, at) {
      if (!data[at + 3]) return '.';
      const id = colorId(data, at), char = keys.get(id);
      if (char === undefined) { unnamed.add(id); return '?'; }
      if (entries.has(char)) used.add(char);
      return char;
    },
    legend() {
      const legend = Object.fromEntries([...entries].filter(([symbol]) => used.has(symbol)));
      if (unnamed.size) legend['?'] = { colors: unnamed.size };
      return legend;
    }
  };
}
const readRegion = (data, width, region, namer) => Array.from({ length: region.h }, (_, y) =>
  Array.from({ length: region.w }, (_, x) => namer.char(data, ((region.y + y) * width + region.x + x) * 4)).join(''));

// Cells run left to right, top to bottom. The largest scale that keeps cells within 256px and the sheet within 1024px
// wins, then fewer rows, then less area. Checker squares span whole source pixels so transparency never reads as dithering.
function drawSheet(sources, width, region, { scale, background = null, columns, where = 'inspect' } = {}) {
  const measure = (c, s) => {
    const rows = Math.ceil(sources.length / c), gap = Math.max(2, s);
    return { columns: c, rows, scale: s, gap, width: c * region.w * s + (c + 1) * gap, height: rows * region.h * s + (rows + 1) * gap };
  };
  const choices = columns ? [columns] : Array.from(sources, (_, i) => i + 1);
  let layout = null;
  for (let s = scale ?? Math.min(16, Math.max(1, Math.floor(256 / Math.max(region.w, region.h)))); s >= (scale ?? 1) && !layout; s--) {
    for (const c of choices) {
      const m = measure(c, s);
      if (m.width <= 1024 && m.height <= 1024 && (!layout || m.rows < layout.rows || (m.rows === layout.rows && m.width * m.height < layout.width * layout.height))) layout = m;
    }
  }
  if (!layout) for (const c of choices) {
    const m = measure(c, scale ?? 1);
    if (!layout || Math.max(m.width, m.height) < Math.max(layout.width, layout.height)) layout = m;
  }
  if (layout.width > 4096 || layout.height > 4096) fail(where, `the contact sheet would be ${layout.width}×${layout.height} pixels, above the 4096-pixel limit; select fewer frames, a smaller region or a lower scale`);
  const data = new Uint8ClampedArray(layout.width * layout.height * 4), square = Math.max(2, Math.ceil(8 / layout.scale)), composed = new Map();
  for (let i = 0; i < data.length; i += 4) data.set(gutterColor, i);
  sources.forEach((source, n) => {
    if (!composed.has(source)) {
      const pixels = new Uint8ClampedArray(region.w * region.h * 4);
      for (let y = 0; y < region.h; y++) for (let x = 0; x < region.w; x++) {
        const at = (y * region.w + x) * 4, from = ((region.y + y) * width + region.x + x) * 4;
        pixels.set(background ?? checkerColors[(Math.floor(x / square) + Math.floor(y / square)) % 2], at);
        if (source) blend(pixels, at, source.subarray(from, from + 4));
      }
      composed.set(source, scalePixels(pixels, region.w, region.h, layout.scale));
    }
    const pixels = composed.get(source), w = region.w * layout.scale, h = region.h * layout.scale;
    const left = layout.gap + (n % layout.columns) * (w + layout.gap), top = layout.gap + Math.floor(n / layout.columns) * (h + layout.gap);
    for (let row = 0; row < h; row++) data.set(pixels.subarray(row * w * 4, (row + 1) * w * 4), ((top + row) * layout.width + left) * 4);
  });
  return { ...layout, data };
}

export function inspectProject(project, options = {}) {
  object(options, 'inspect', ['frames', 'animation', 'region', 'grid', 'scale', 'background', 'view', 'native', 'diagnostics', 'maxCells']);
  const { width, height, frames } = project;
  if (options.frames !== undefined && options.animation !== undefined) fail('inspect', 'choose frames or animation, not both');
  let cells = frames.map((_, i) => i);
  if (options.animation !== undefined) {
    if (typeof options.animation !== 'string' || !own(project.animations, options.animation)) fail('inspect.animation', `unknown animation ${JSON.stringify(options.animation)}`);
    cells = project.animations[options.animation].frames;
  } else if (options.frames !== undefined) {
    list(options.frames, 'inspect.frames', 1024);
    if (!options.frames.length) fail('inspect.frames', 'select at least one frame');
    cells = options.frames.map((ref, i) => {
      const index = frames.findIndex(f => f.name === ref);
      if (index < 0) fail(`inspect.frames[${i}]`, `unknown frame ${JSON.stringify(ref)}`);
      return index;
    });
  }
  let region = { x: 0, y: 0, w: width, h: height };
  if (options.region !== undefined) {
    const r = object(options.region, 'inspect.region', ['x', 'y', 'w', 'h']);
    const x = integer(r.x, 'inspect.region.x', 0, width - 1), y = integer(r.y, 'inspect.region.y', 0, height - 1);
    region = { x, y, w: integer(r.w, 'inspect.region.w', 1, width - x), h: integer(r.h, 'inspect.region.h', 1, height - y) };
  }
  const grid = boolean(options.grid ?? false, 'inspect.grid');
  const scale = options.scale === undefined ? undefined : integer(options.scale, 'inspect.scale', 1, 16);
  const background = (options.background ?? 'checker') === 'checker' ? null : parseColor(options.background, project.palette, 'inspect.background');
  const mode = options.view ?? 'color';
  if (!['color', 'silhouette', 'grayscale', 'onion'].includes(mode)) fail('inspect.view', 'expected color, silhouette, grayscale or onion');
  if (mode === 'onion' && options.animation === undefined) fail('inspect.view', 'onion requires an animation so neighbors have an unambiguous playback position');
  const native = boolean(options.native ?? false, 'inspect.native'), diagnostics = boolean(options.diagnostics ?? false, 'inspect.diagnostics');
  const total = cells.length;
  let positions = cells.map((_, i) => i);
  if (options.maxCells !== undefined) {
    const requested = integer(options.maxCells, 'inspect.maxCells', 1, 256);
    const count = Math.min(total, requested, Math.max(1, Math.floor(4094 / (Math.max(region.w, region.h) + 2)) ** 2));
    if (count < total) positions = Array.from({ length: count }, (_, i) => count === 1 ? 0 : Math.floor(i * (total - 1) / (count - 1)));
    cells = positions.map(i => cells[i]);
  }
  const unique = [...new Set(cells)];
  if (grid && unique.length * region.w * region.h > 16384) fail('inspect.grid', `grids are limited to 16,384 pixels, not ${unique.length} × ${region.w}×${region.h}; select fewer frames or a smaller region`);
  const sources = cells.map((i, n) => mode === 'onion' ? onionPixels(project, project.animations[options.animation], positions[n]) : reviewPixels(frames[i].data, mode));
  const view = { cells: cells.map(i => ({ frame: frames[i].name, duration: frames[i].duration })), region, sheet: drawSheet(sources, width, region, { scale, background }) };
  if (mode !== 'color') view.mode = mode;
  if (total !== cells.length) view.sampling = { total, shown: cells.length, omitted: total - cells.length, positions, method: 'evenly spaced, including endpoints; durations are original, not playback timing' };
  if (native) view.nativeSheet = drawSheet(sources, width, region, { scale: 1, background });
  if (diagnostics) view.diagnostics = analyzeProject(project);
  if (options.animation !== undefined && (diagnostics || mode === 'onion')) {
    const a = project.animations[options.animation]; let start = 0;
    view.timing = { animation: options.animation, duration: a.duration, loop: a.loop, entries: a.frames.map((index, position) => {
      const entry = { position, frame: frames[index].name, start, duration: frames[index].duration, ...animationNeighbors(a, position) };
      start += entry.duration; return entry;
    }) };
  }
  if (!grid) return view;
  const namer = colorNamer(project);
  view.grids = unique.map(index => ({ frame: frames[index].name, rows: readRegion(frames[index].data, width, region, namer) }));
  view.legend = namer.legend();
  return view;
}

// Positions refer to the expanded sequence, never the recipe's frame order.
export function animationPosition(project, animation, time) {
  let cursor = animation.loop ? ((time % animation.duration) + animation.duration) % animation.duration : Math.max(0, Math.min(time, animation.duration));
  for (let position = 0; position < animation.frames.length; position++) {
    const duration = project.frames[animation.frames[position]].duration;
    if (cursor < duration) return position;
    cursor -= duration;
  }
  return animation.frames.length - 1;
}
export function animationNeighbors(animation, position) {
  integer(position, 'animation.position', 0, animation.frames.length - 1);
  const count = animation.frames.length;
  return { previous: position > 0 ? position - 1 : animation.loop ? count - 1 : null, next: position + 1 < count ? position + 1 : animation.loop ? 0 : null };
}
export function reviewPixels(data, mode = 'color') {
  if (mode === 'color') return data;
  if (!['silhouette', 'grayscale'].includes(mode)) fail('view', 'expected color, silhouette or grayscale');
  const result = new Uint8ClampedArray(data.length);
  for (let at = 0; at < data.length; at += 4) {
    if (!data[at + 3]) continue;
    const value = mode === 'silhouette' ? 240 : Math.round(.2126 * data[at] + .7152 * data[at + 1] + .0722 * data[at + 2]);
    result.set([value, value, value, mode === 'silhouette' ? 255 : data[at + 3]], at);
  }
  return result;
}
export function onionPixels(project, animation, position) {
  const result = new Uint8ClampedArray(project.width * project.height * 4);
  const neighbors = animationNeighbors(animation, position);
  for (const [neighbor, color] of [[neighbors.previous, [240, 83, 120, 100]], [neighbors.next, [65, 201, 240, 100]]]) {
    if (neighbor === null) continue;
    const data = project.frames[animation.frames[neighbor]].data;
    for (let at = 0; at < data.length; at += 4) if (data[at + 3]) blend(result, at, color, data[at + 3] / 255);
  }
  const current = project.frames[animation.frames[position]].data;
  for (let at = 0; at < current.length; at += 4) blend(result, at, current.subarray(at, at + 4));
  return result;
}

// Advisory evidence, not an aesthetic score. Never changes artwork or invalidates holds/sparks.
export function analyzeProject(project) {
  const { width, height, frames } = project, findings = [], hashes = new Map();
  const known = new Set(Object.values(project.palette).map(color => colorId(parseColor(color), 0)));
  const stats = frames.map(frame => {
    const colors = new Set(), outside = new Set(), isolated = [], unlisted = [];
    let visible = 0, isolatedCount = 0, hash = 2166136261;
    for (let at = 0; at < frame.data.length; at += 4) {
      const id = frame.data[at + 3] ? colorId(frame.data, at) : 0;
      hash = Math.imul(hash ^ id, 16777619) >>> 0;
      if (!id) continue;
      visible++; colors.add(id);
      const x = at / 4 % width, y = Math.floor(at / 4 / width);
      if (!known.has(id) && !outside.has(id)) { outside.add(id); if (unlisted.length < 32) unlisted.push({ x, y, color: toHex(frame.data.subarray(at, at + 4)) }); }
      let neighbor = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if ((dx || dy) && x + dx >= 0 && x + dx < width && y + dy >= 0 && y + dy < height && frame.data[((y + dy) * width + x + dx) * 4 + 3]) neighbor = true;
      }
      if (!neighbor) { isolatedCount++; if (isolated.length < 32) isolated.push({ x, y }); }
    }
    const peers = hashes.get(hash) ?? [];
    const same = peers.find(other => frame.data.every((value, i) => value === other.data[i] || (!frame.data[i - i % 4 + 3] && !other.data[i - i % 4 + 3])));
    if (same) findings.push({ code: 'duplicate', frame: frame.name, sameAs: same.name, note: 'Repeated poses and holds are valid; compare action intent.' });
    peers.push(frame); hashes.set(hash, peers);
    if (!visible) findings.push({ code: 'empty', frame: frame.name, note: 'An empty effect/transition frame may be intentional.' });
    if (isolatedCount) findings.push({ code: 'isolated', frame: frame.name, count: isolatedCount, coordinates: isolated, omitted: isolatedCount - isolated.length, note: 'No visible 8-connected neighbor. Exempt intentional sparks, stars and detached accents.' });
    if (outside.size) findings.push({ code: 'palette', frame: frame.name, count: outside.size, coordinates: unlisted, omitted: outside.size - unlisted.length, note: 'Colors outside the declared palette; literal colors and alpha blends may be intentional.' });
    return { frame: frame.name, visible, colors: colors.size };
  });
  const difference = (a, b) => {
    let pixels = 0, left = width, top = height, right = -1, bottom = -1;
    for (let at = 0; at < a.length; at += 4) if (colorId(a, at) !== colorId(b, at) && (a[at + 3] || b[at + 3])) {
      pixels++; const x = at / 4 % width, y = Math.floor(at / 4 / width);
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
    return { pixels, ...(pixels && { box: { x: left, y: top, w: right - left + 1, h: bottom - top + 1 } }) };
  };
  const animations = Object.entries(project.animations).map(([name, a]) => {
    const deltas = a.frames.slice(1).map((index, i) => difference(frames[a.frames[i]].data, frames[index].data).pixels);
    const nonzero = deltas.filter(n => n).sort((a, b) => a - b), median = nonzero[Math.floor(nonzero.length / 2)] ?? 0;
    const boundary = difference(frames[a.frames.at(-1)].data, frames[a.frames[0]].data);
    if (a.loop && boundary.pixels > Math.max(4, median * 3)) findings.push({ code: 'loop-jump', animation: name, from: frames[a.frames.at(-1)].name, to: frames[a.frames[0]].name, ...boundary, note: 'Loop boundary changes over three times the median nonzero adjacent change. Intentional cuts are exempt.' });
    return { animation: name, duration: a.duration, entries: a.frames.length, repeatedAdjacent: deltas.filter(n => !n).length, boundary };
  });
  return { advisory: true, frames: stats, animations, findings };
}

// Compares two rendered revisions, matching frames by name, so a patch can report every visible effect.
export function compareProjects(before, after) {
  const { width, height } = after, resized = before.width !== width || before.height !== height;
  const namer = colorNamer(after, [before]), previous = new Map(before.frames.map(frame => [frame.name, frame]));
  const kept = new Set(after.frames.map(frame => frame.name)), changed = [], unchanged = [], added = [], durations = [], shown = [];
  for (const frame of after.frames) {
    const old = previous.get(frame.name);
    if (!old) { added.push(frame.name); shown.push({ frame: frame.name, status: 'added', before: null, after: frame.data }); continue; }
    if (old.duration !== frame.duration) durations.push({ frame: frame.name, from: old.duration, to: frame.duration });
    if (resized) { changed.push({ frame: frame.name }); continue; }
    let pixels = 0, left = width, top = height, right = -1, bottom = -1;
    const changes = [], transitions = new Map();
    for (let at = 0; at < frame.data.length; at += 4) {
      if (colorId(frame.data, at) === colorId(old.data, at) || (!frame.data[at + 3] && !old.data[at + 3])) continue;
      const x = at / 4 % width, y = Math.floor(at / 4 / width), from = namer.char(old.data, at), to = namer.char(frame.data, at);
      pixels++; left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
      if (changes.length < 16) changes.push({ x, y, from, to });
      transitions.set(from + to, (transitions.get(from + to) ?? 0) + 1);
    }
    if (!pixels) { unchanged.push(frame.name); continue; }
    const box = { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
    const detail = pixels <= 16 ? { changes } : { transitions: [...transitions].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([pair, count]) => ({ from: pair[0], to: pair[1], pixels: count })) };
    changed.push({ frame: frame.name, pixels, box, ...detail });
    shown.push({ frame: frame.name, status: 'changed', before: old.data, after: frame.data, box });
  }
  const removed = before.frames.filter(frame => !kept.has(frame.name)).map(frame => frame.name);
  for (const name of removed) shown.push({ frame: name, status: 'removed', before: previous.get(name).data, after: null });
  const sequence = (project, key) => project.animations[key].frames.map(i => project.frames[i].name);
  const animations = { changed: [], added: [], removed: Object.keys(before.animations).filter(key => !own(after.animations, key)) };
  for (const key of Object.keys(after.animations)) {
    if (!own(before.animations, key)) { animations.added.push(key); continue; }
    const from = sequence(before, key), to = sequence(after, key), loop = [before.animations[key].loop, after.animations[key].loop];
    if (from.join() !== to.join() || loop[0] !== loop[1]) animations.changed.push({ animation: key, ...(from.join() !== to.join() && { frames: { from, to } }), ...(loop[0] !== loop[1] && { loop: { from: loop[0], to: loop[1] } }) });
  }
  const filled = value => Object.fromEntries(Object.entries(value).filter(([, list]) => list.length));
  const report = {
    ...(resized && { canvas: { from: { w: before.width, h: before.height }, to: { w: width, h: height } } }),
    frames: { changed, unchanged, ...filled({ added, removed, durations }) },
    ...(Object.keys(filled(animations)).length && { animations: filled(animations) })
  };
  // Before and after share one row per frame, cropped to the changed area plus 2 pixels unless frames were added or removed.
  if (shown.length && !resized) {
    let region = { x: 0, y: 0, w: width, h: height };
    if (shown.every(row => row.box)) {
      const x = Math.max(0, Math.min(...shown.map(row => row.box.x)) - 2), y = Math.max(0, Math.min(...shown.map(row => row.box.y)) - 2);
      region = { x, y, w: Math.min(width, Math.max(...shown.map(row => row.box.x + row.box.w)) + 2) - x, h: Math.min(height, Math.max(...shown.map(row => row.box.y + row.box.h)) + 2) - y };
    }
    const rows = shown.slice(0, Math.max(1, Math.min(16, Math.floor(4094 / (region.h + 2)))));
    report.image = { region, frames: rows.map(({ frame, status }) => ({ frame, status })), ...(rows.length < shown.length && { omitted: shown.length - rows.length }), sheet: drawSheet(rows.flatMap(row => [row.before, row.after]), width, region, { columns: 2, where: 'image' }) };
  }
  const legend = namer.legend();
  if (Object.keys(legend).length) report.legend = legend;
  return report;
}
