// Browser-compatible GIF89a export for sharing an animation where APNG or CSS scaling is not an option. Colours are
// exact: nothing is quantized or dithered, so a frame that needs more than 256 colours is refused rather than
// approximated. GIF has no partial transparency and times frames in 10 ms steps; both conversions are reported.
import { PixelError, parseColor } from './core.js';

const MAX_PIXELS = 67108864;
// Integer arithmetic only, so table sizes never depend on an engine's logarithm.
const bitsFor = count => { let bits = 1; while (1 << bits < count) bits++; return bits; };

// Variable-width LZW as GIF defines it. `slots` maps (prefix code, next index) to a code; entries carry a generation
// so that a dictionary reset costs nothing.
function compress(indices, minimum, slots, state) {
  const clear = 1 << minimum, end = clear + 1;
  let bytes = new Uint8Array(Math.max(256, indices.length >> 1)), length = 0, size = minimum + 1, next = end + 1, buffer = 0, bits = 0;
  const emit = code => {
    buffer |= code << bits; bits += size;
    while (bits >= 8) {
      if (length === bytes.length) { const grown = new Uint8Array(bytes.length * 2); grown.set(bytes); bytes = grown; }
      bytes[length++] = buffer & 255; buffer >>>= 8; bits -= 8;
    }
  };
  state.generation++; emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const index = indices[i], key = prefix << 8 | index, slot = slots[key];
    if (slot >>> 12 === state.generation) { prefix = slot & 4095; continue; }
    emit(prefix);
    if (next === 4096) { emit(clear); state.generation++; size = minimum + 1; next = end + 1; }
    else { if (next >= 1 << size) size++; slots[key] = state.generation << 12 | next++; }
    prefix = index;
  }
  emit(prefix); emit(end);
  if (bits) { size = 8 - bits; emit(0); }
  return bytes.subarray(0, length);
}

// `frames` are { data: RGBA bytes, duration: ms } at width × height. Pixels below 50% alpha become transparent and
// the rest opaque; pass `background` ([r, g, b]) to blend every pixel over one colour instead. Returns the file with
// the delays actually written (ms) and how many partly transparent pixels lost their alpha.
export function encodeGIF(frames, width, height, { loop = true, scale = 1, background = null } = {}) {
  if (!Array.isArray(frames) || !frames.length) throw new PixelError('gif', 'at least one frame is required');
  if (!Number.isInteger(scale) || scale < 1 || scale > 16) throw new PixelError('gif.scale', 'expected a whole number from 1 to 16');
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * scale > 65535 || height * scale > 65535) throw new PixelError('gif', 'invalid dimensions');
  if (frames.length * width * height * scale * scale > MAX_PIXELS) throw new PixelError('gif', `${frames.length} frames at ${width * scale}×${height * scale} exceed 67,108,864 pixels; lower the scale or shorten the animation`);
  const area = width * height, all = new Map(), indexed = [];
  let partialAlpha = 0, transparency = false;
  for (const [position, frame] of frames.entries()) {
    if (frame.data.length !== area * 4) throw new PixelError('gif', 'RGBA buffer does not match the dimensions');
    if (!Number.isInteger(frame.duration) || frame.duration < 1 || frame.duration > 60000) throw new PixelError('gif', 'frame durations must be 1–60000ms');
    const colors = new Map(), pixels = new Int32Array(area), { data } = frame;
    let transparent = false;
    for (let i = 0; i < area; i++) {
      const alpha = data[i * 4 + 3];
      let r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      if (background) {
        // Integer source-over onto an opaque colour, rounded to nearest.
        r = (r * alpha + background[0] * (255 - alpha) + 127) / 255 | 0; g = (g * alpha + background[1] * (255 - alpha) + 127) / 255 | 0; b = (b * alpha + background[2] * (255 - alpha) + 127) / 255 | 0;
      } else {
        if (alpha !== 0 && alpha !== 255) partialAlpha++;
        if (alpha < 128) { pixels[i] = -1; transparent = true; continue; }
      }
      const color = r << 16 | g << 8 | b;
      pixels[i] = color;
      if (!colors.has(color)) { colors.set(color, colors.size); if (!all.has(color)) all.set(color, all.size); }
    }
    if (colors.size + (transparent ? 1 : 0) > 256) throw new PixelError('gif', `frame ${position + 1} of the animation uses ${colors.size} colours${transparent ? ' beside transparency' : ''}; a GIF frame holds 256 and PixelForge does not quantize. Reduce the colours${background ? '' : ', or blend onto a background if partial alpha causes them'}.`);
    transparency ||= transparent;
    indexed.push({ colors, pixels, transparent });
  }
  // One shared table when the whole animation fits, otherwise a table per frame. Index 0 is the transparent one.
  const shared = all.size + (transparency ? 1 : 0) <= 256;
  const table = (colors, offset) => {
    const bits = bitsFor(colors.size + offset), bytes = new Uint8Array(3 << bits);
    for (const [color, index] of colors) bytes.set([color >> 16, color >> 8 & 255, color & 255], (index + offset) * 3);
    return { bits, bytes };
  };
  const chunks = [], push = (...values) => chunks.push(Uint8Array.from(values)), word = value => [value & 255, value >> 8];
  const globalTable = shared ? table(all, transparency ? 1 : 0) : null;
  chunks.push(Uint8Array.from('GIF89a', character => character.charCodeAt(0)));
  push(...word(width * scale), ...word(height * scale), globalTable ? 0xf0 | globalTable.bits - 1 : 0x70, 0, 0);
  if (globalTable) chunks.push(globalTable.bytes);
  if (loop) { push(0x21, 0xff, 11); chunks.push(Uint8Array.from('NETSCAPE2.0', character => character.charCodeAt(0))); push(3, 1, 0, 0, 0); }
  const slots = new Uint32Array(1 << 20), state = { generation: 0 }, delays = [];
  let carry = 0;
  for (const [position, { colors, pixels, transparent }] of indexed.entries()) {
    // Delays are centiseconds; the rounding remainder moves to the next frame so a sequence keeps its length.
    // Browsers play anything under 20 ms at 100 ms, so 20 ms is the floor.
    const exact = frames[position].duration + carry, delay = Math.max(2, Math.round(exact / 10));
    carry = exact < 20 ? 0 : exact - delay * 10; delays.push(delay * 10);
    const offset = (shared ? transparency : transparent) ? 1 : 0, local = shared ? null : table(colors, offset), lookup = shared ? all : colors, minimum = Math.max(2, (local ?? globalTable).bits);
    const indices = new Uint8Array(area * scale * scale);
    for (let y = 0; y < height; y++) {
      const row = y * scale * width * scale;
      for (let x = 0; x < width; x++) { const pixel = pixels[y * width + x]; indices.fill(pixel === -1 ? 0 : lookup.get(pixel) + offset, row + x * scale, row + (x + 1) * scale); }
      for (let copy = 1; copy < scale; copy++) indices.copyWithin(row + copy * width * scale, row, row + width * scale);
    }
    // Disposal 2 clears the frame before the next one, so transparent pixels never show an earlier frame.
    push(0x21, 0xf9, 4, (transparency ? 2 : 1) << 2 | (transparent ? 1 : 0), ...word(delay), 0, 0);
    push(0x2c, 0, 0, 0, 0, ...word(width * scale), ...word(height * scale), local ? 0x80 | local.bits - 1 : 0);
    if (local) chunks.push(local.bytes);
    const packed = compress(indices, minimum, slots, state);
    push(minimum);
    for (let at = 0; at < packed.length; at += 255) { const block = packed.subarray(at, at + 255); push(block.length); chunks.push(block); }
    push(0);
  }
  push(0x3b);
  const data = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) { data.set(chunk, at); at += chunk.length; }
  return { data, width: width * scale, height: height * scale, colors: all.size, transparent: transparency, delays, partialAlpha };
}

// One animation of a rendered project as a GIF. The default scale is the largest whole number that keeps the longer
// side within 256 pixels. `notes` says, in words, what GIF could not keep.
export function animationGIF(project, animation, options = {}) {
  const names = Object.keys(project.animations), name = animation ?? names[0];
  for (const key of Object.keys(options)) if (!['scale', 'background'].includes(key)) throw new PixelError(`gif.${key}`, 'unknown option; use scale or background');
  if (!Object.hasOwn(project.animations, name)) throw new PixelError('gif.animation', `no animation named "${name}"; choose one of: ${names.join(', ')}`);
  const sequence = project.animations[name], scale = options.scale ?? Math.max(1, Math.min(16, Math.floor(256 / Math.max(project.width, project.height))));
  let background = null;
  if (options.background !== undefined && options.background !== 'transparent') {
    background = parseColor(options.background, project.palette, 'gif.background');
    if (background[3] !== 255) throw new PixelError('gif.background', 'must be an opaque colour; omit it to keep 1-bit transparency');
  }
  const frames = sequence.frames.map(index => ({ data: project.frames[index].data, duration: project.frames[index].duration }));
  const gif = encodeGIF(frames, project.width, project.height, { loop: sequence.loop, scale, background }), notes = [];
  if (gif.partialAlpha) notes.push(`${gif.partialAlpha} partly transparent pixel${gif.partialAlpha === 1 ? '' : 's'} across the frames became fully transparent (below 50% alpha) or fully opaque; GIF has no partial transparency. Pass a background colour to blend them instead.`);
  const retimed = frames.map((frame, position) => [frame.duration, gif.delays[position]]).filter(([from, to]) => from !== to);
  if (retimed.length) notes.push(`${retimed.length} of ${frames.length} frame durations were rounded to GIF's 10 ms steps (20 ms minimum): ${[...new Set(retimed.map(([from, to]) => `${from}→${to}`))].slice(0, 8).join(', ')}${new Set(retimed.map(([from, to]) => `${from}→${to}`)).size > 8 ? ', …' : ''}.`);
  return { data: gif.data, animation: name, width: gif.width, height: gif.height, scale, frames: frames.length, duration: gif.delays.reduce((sum, delay) => sum + delay, 0), loop: sequence.loop, colors: gif.colors, transparent: gif.transparent, partialAlpha: gif.partialAlpha, notes };
}
