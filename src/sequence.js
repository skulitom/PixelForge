// Image sequences for video editors: one numbered PNG per video frame at a constant frame rate, on a canvas of the
// video's size. Editors read these directly and keep the alpha; nothing here encodes video. Timing is exact integer
// arithmetic on the frame rate as a fraction, so 29.97 means 30000/1001 and a sequence is the same on every machine.
import { PixelError, parseColor } from './core.js';
import { renderScene } from './scene.js';
import { encodePNG } from './png.js';

const fail = (path, message) => { throw new PixelError(path, message); };
export const MAX_SEQUENCE_FRAMES = 18000;
const MAX_UNIQUE_PIXELS = 4294967296;
export const VIDEO_SIZES = { '720p': [1280, 720], '1080p': [1920, 1080], '1440p': [2560, 1440], '4k': [3840, 2160], vertical: [1080, 1920], square: [1080, 1080] };
const ALIGN = { 'top-left': [0, 0], top: [1, 0], 'top-right': [2, 0], left: [0, 1], center: [1, 1], right: [2, 1], 'bottom-left': [0, 2], bottom: [1, 2], 'bottom-right': [2, 2] };
const NTSC = { '23.976': [24000, 1001], '23.98': [24000, 1001], '29.97': [30000, 1001], '59.94': [60000, 1001], '119.88': [120000, 1001] };
const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };

// A frame rate as { numerator, denominator, label }. Accepts 30, "25", "29.97" (the NTSC rates mean n000/1001),
// decimals such as 12.5, and fractions such as "30000/1001".
export function parseFrameRate(value, path = 'sequence.fps') {
  const text = String(value).trim(), fraction = /^(\d{1,7})\/(\d{1,7})$/.exec(text), decimal = /^\d{1,3}(\.\d{1,3})?$/.exec(text);
  let numerator, denominator;
  if (NTSC[text]) [numerator, denominator] = NTSC[text];
  else if (fraction) [numerator, denominator] = [Number(fraction[1]), Number(fraction[2])];
  else if (decimal) { denominator = 10 ** (decimal[1]?.length - 1 || 0); numerator = Math.round(Number(text) * denominator); }
  else fail(path, 'expected a frame rate such as 24, 25, 29.97, 30, 60 or 30000/1001');
  if (!numerator || !denominator || numerator > 240 * denominator) fail(path, 'expected a frame rate above 0 and up to 240 frames per second');
  const shared = gcd(numerator, denominator);
  numerator /= shared; denominator /= shared;
  return { numerator, denominator, label: denominator === 1 ? String(numerator) : NTSC[text] ? text : `${numerator}/${denominator}` };
}
const integerOption = (value, path, min, max) => { if (!Number.isInteger(value) || value < min || value > max) fail(path, `expected a whole number from ${min} to ${max}`); return value; };

// Which pose each video frame shows. `durations` are the poses of one pass in milliseconds. A video frame shows the
// pose that is active at the moment the frame starts; `step` holds every sampled frame for that many video frames
// ("on twos" is step 2). Returns the pose index per frame and what the frame grid did to each pose's length.
export function planSequence(durations, { fps, loop = true, loops = 1, seconds, step = 1 } = {}, path = 'sequence') {
  const { numerator, denominator } = fps, pass = durations.reduce((sum, ms) => sum + ms, 0);
  integerOption(loops, `${path}.loops`, 1, 1000); integerOption(step, `${path}.step`, 1, 60);
  if (seconds !== undefined && (typeof seconds !== 'number' || !(seconds > 0) || seconds > 3600)) fail(`${path}.seconds`, 'expected a length in seconds above 0 and up to 3600');
  // Lengths are compared as integers scaled by the frame rate: frame k starts at k * 1000 * denominator / numerator ms.
  const unit = 1000 * denominator, passUnits = pass * numerator, wanted = loops * passUnits;
  const count = seconds === undefined ? Math.ceil(wanted / unit) : Math.max(1, Math.round(seconds * numerator / denominator));
  if (count > MAX_SEQUENCE_FRAMES) fail(path, `${count} frames exceed the limit of ${MAX_SEQUENCE_FRAMES}; lower the frame rate, the loops or the seconds`);
  const starts = []; let elapsed = 0;
  for (const ms of durations) { starts.push(elapsed * numerator); elapsed += ms; }
  const poses = [], shown = durations.map(() => 0);
  for (let frame = 0; frame < count; frame++) {
    const at = Math.floor(frame / step) * step * unit;
    // A looping animation keeps cycling for as long as frames are asked for; one that plays once holds its last pose.
    let pose = durations.length - 1;
    if (loop || at < wanted) { const within = at % passUnits; pose = 0; while (pose + 1 < starts.length && starts[pose + 1] <= within) pose++; }
    poses.push(pose);
    if (at < passUnits) shown[pose]++;
  }
  const frameMs = unit / numerator, exact = wanted / unit;
  let fits = null;
  if (!Number.isInteger(exact)) for (let n = 1; n <= 240 && fits === null; n++) if (Number.isInteger(n * passUnits / unit)) fits = n;
  return {
    poses, count, pass, frameMs,
    // How one pass maps onto the frame grid: frames per pose, and the time that is and was asked for.
    timing: durations.map((ms, pose) => ({ pose, frames: shown[pose], wanted: ms, got: Math.round(shown[pose] * frameMs * 1000) / 1000 })),
    exactFrames: exact, seamless: Number.isInteger(exact), loopsThatFit: fits
  };
}

// Where a w × h sprite goes on the canvas. Without `size` the canvas is the sprite at `scale`. With `size` the default
// scale is the largest whole number at which the sprite still fits.
export function placeSprite(width, height, { size, scale, align = 'center', offset = [0, 0] } = {}, path = 'sequence') {
  let canvas = null;
  if (size !== undefined) {
    canvas = typeof size === 'string' ? VIDEO_SIZES[size.toLowerCase()] ?? (/^(\d{1,4})x(\d{1,4})$/i.exec(size)?.slice(1).map(Number)) : size;
    if (!Array.isArray(canvas) || canvas.length !== 2 || !canvas.every(n => Number.isInteger(n) && n >= 1 && n <= 4096) || canvas[0] * canvas[1] > 16777216) fail(`${path}.size`, `expected ${Object.keys(VIDEO_SIZES).join(', ')} or WIDTHxHEIGHT up to 4096 on a side`);
  }
  if (canvas && (width > canvas[0] || height > canvas[1])) fail(`${path}.size`, `the ${width}×${height} sprite is larger than the ${canvas[0]}×${canvas[1]} canvas`);
  const fit = canvas ? Math.min(256, Math.floor(Math.min(canvas[0] / width, canvas[1] / height))) : 1;
  const factor = integerOption(scale ?? fit, `${path}.scale`, 1, 256), w = width * factor, h = height * factor;
  canvas ??= [w, h];
  if (canvas[0] > 4096 || canvas[1] > 4096 || canvas[0] * canvas[1] > 16777216) fail(`${path}.scale`, `${w}×${h} is above the 4096-pixel limit; lower the scale`);
  if (w > canvas[0] || h > canvas[1]) fail(`${path}.scale`, `at scale ${factor} the ${width}×${height} sprite is ${w}×${h} and does not fit the ${canvas[0]}×${canvas[1]} canvas; the largest scale that fits is ${fit}`);
  if (!Object.hasOwn(ALIGN, align)) fail(`${path}.align`, `expected one of ${Object.keys(ALIGN).join(', ')}`);
  if (!Array.isArray(offset) || offset.length !== 2 || !offset.every(n => Number.isInteger(n) && Math.abs(n) <= 4096)) fail(`${path}.offset`, 'expected [x, y] in whole canvas pixels');
  const [column, row] = ALIGN[align], x = Math.floor((canvas[0] - w) * column / 2) + offset[0], y = Math.floor((canvas[1] - h) * row / 2) + offset[1];
  if (x < 0 || y < 0 || x + w > canvas[0] || y + h > canvas[1]) fail(`${path}.offset`, `the sprite would sit at ${x},${y} and leave the ${canvas[0]}×${canvas[1]} canvas; it is ${w}×${h}`);
  return { width: canvas[0], height: canvas[1], scale: factor, x, y, spriteWidth: w, spriteHeight: h };
}
// One canvas-sized RGBA frame: the sprite enlarged by whole pixels at its place, over transparency or a background.
function compose(pixels, width, height, place, background) {
  const out = new Uint8Array(place.width * place.height * 4), s = place.scale, row = new Uint8Array(place.spriteWidth * 4);
  if (background) for (let i = 0; i < out.length; i += 4) out.set(background, i);
  for (let y = 0; y < height; y++) {
    const first = ((place.y + y * s) * place.width + place.x) * 4;
    if (background) row.set(out.subarray(first, first + row.length));
    else row.fill(0);
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4, alpha = pixels[at + 3];
      if (!alpha) continue;
      let r = pixels[at], g = pixels[at + 1], b = pixels[at + 2], a = alpha;
      // Onto an opaque background the result is opaque: integer source-over, rounded to nearest.
      if (background) { r = (r * alpha + background[0] * (255 - alpha) + 127) / 255 | 0; g = (g * alpha + background[1] * (255 - alpha) + 127) / 255 | 0; b = (b * alpha + background[2] * (255 - alpha) + 127) / 255 | 0; a = 255; }
      for (let i = 0; i < s; i++) { const to = (x * s + i) * 4; row[to] = r; row[to + 1] = g; row[to + 2] = b; row[to + 3] = a; }
    }
    for (let i = 0; i < s; i++) out.set(row, first + i * place.width * 4);
  }
  return out;
}

// Builds the files of a sequence from `count` frames. `imageAt(frame)` returns { key, pixels } for a video frame;
// frames with the same key share one encoded PNG.
function build(name, sourceWidth, sourceHeight, count, imageAt, options, describe) {
  const fps = options.rate, place = placeSprite(sourceWidth, sourceHeight, options);
  let background = null;
  if (options.background !== undefined && options.background !== 'transparent') {
    background = parseColor(options.background, options.palette ?? {}, 'sequence.background');
    if (background[3] !== 255) fail('sequence.background', 'must be an opaque colour; omit it to keep the alpha');
  }
  const digits = Math.max(4, String(count).length), pattern = `${name}_%0${digits}d.png`, files = new Map(), encoded = new Map();
  for (let frame = 0; frame < count; frame++) {
    const { key, pixels } = imageAt(frame);
    if (!encoded.has(key)) {
      if ((encoded.size + 1) * place.width * place.height > MAX_UNIQUE_PIXELS) fail('sequence', `more than ${Math.floor(MAX_UNIQUE_PIXELS / (place.width * place.height))} different ${place.width}×${place.height} frames; lower the size, the frame rate or the length`);
      encoded.set(key, encodePNG(compose(pixels(), sourceWidth, sourceHeight, place, background), place.width, place.height));
    }
    files.set(`${name}_${String(frame + 1).padStart(digits, '0')}.png`, encoded.get(key));
  }
  const rate = `${fps.numerator}${fps.denominator === 1 ? '' : `/${fps.denominator}`}`, input = `-framerate ${rate} -start_number 1 -i "${pattern}"`, even = place.width % 2 === 0 && place.height % 2 === 0;
  const info = {
    format: 'pixelforge-sequence', version: 1, name, ...describe,
    fps: { label: fps.label, numerator: fps.numerator, denominator: fps.denominator }, frames: count, seconds: Math.round(count * fps.denominator / fps.numerator * 1e6) / 1e6,
    width: place.width, height: place.height, alpha: background ? 'none: opaque background' : 'straight (unpremultiplied)',
    pattern, first: 1, digits, differentFrames: encoded.size,
    placement: { scale: place.scale, x: place.x, y: place.y, width: place.spriteWidth, height: place.spriteHeight, source: [sourceWidth, sourceHeight] },
    // Run these in the sequence folder. Nothing in PixelForge runs them; ffmpeg is a separate program.
    commands: {
      prores4444: `ffmpeg ${input} -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le -vf "scale=out_color_matrix=bt709:flags=neighbor" -colorspace bt709 -color_primaries bt709 -color_trc bt709 "${name}.mov"`,
      ...(background && even && { h264: `ffmpeg ${input} -c:v libx264 -preset slow -crf 14 -pix_fmt yuv420p -vf "scale=out_color_matrix=bt709:flags=neighbor" -colorspace bt709 -color_primaries bt709 -color_trc bt709 "${name}.mp4"` })
    }
  };
  return { info, files, place };
}
const readme = info => `${info.name}: PixelForge image sequence

${info.frames} PNG files, ${info.pattern.replace(/%0(\d)d/, (_, n) => '#'.repeat(Number(n)))}, numbered from ${String(info.first).padStart(info.digits, '0')}.
${info.width} x ${info.height} pixels, ${info.fps.label} frames per second, ${info.seconds} seconds.
Alpha: ${info.alpha}.

The files carry no frame rate. Tell your editor it is ${info.fps.label}${info.fps.denominator === 1 ? '' : ` (${info.fps.numerator}/${info.fps.denominator})`}.

Premiere Pro: File > Import, select the first file and tick "Image Sequence". Then select the clip, choose
Clip > Modify > Interpret Footage and set the frame rate to ${info.fps.label}. Leave the clip at 100% scale: the
pixels are already enlarged by whole numbers, and scaling in the editor would blur them.

To make one video file with ffmpeg (a separate program), run this in this folder:

  ${info.commands.prores4444}
${info.commands.h264 ? `\nor, without alpha:\n\n  ${info.commands.h264}\n` : ''}
In a Windows batch file, write %% for each % in the file pattern.
${info.notes.length ? `\nNotes\n${info.notes.map(note => `- ${note}`).join('\n')}\n` : ''}
sequence.json holds the same facts for programs, with the timing of every pose.
`;
function finish(sequence, notes) {
  sequence.info.notes = notes;
  sequence.files.set('sequence.json', Buffer.from(JSON.stringify(sequence.info, null, 2) + '\n'));
  sequence.files.set('README.txt', Buffer.from(readme(sequence.info)));
  return { info: sequence.info, files: sequence.files };
}
const KEYS = ['fps', 'animation', 'size', 'scale', 'align', 'offset', 'background', 'loops', 'seconds', 'step'];
function common(options, allowed) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) fail('sequence', 'expected an object of options');
  for (const key of Object.keys(options)) if (!allowed.includes(key)) fail(`sequence.${key}`, `unknown option; use ${allowed.join(', ')}`);
  if (options.fps === undefined) fail('sequence.fps', 'a frame rate is required, for example 24, 25, 29.97, 30 or 60');
  return parseFrameRate(options.fps);
}

// One animation of a rendered project as a sequence: { info, files }, where files maps names to bytes.
export function createSequence(project, options = {}) {
  const rate = common(options, KEYS), names = Object.keys(project.animations), animation = options.animation ?? names[0];
  if (!Object.hasOwn(project.animations, animation)) fail('sequence.animation', `no animation named "${animation}"; choose one of: ${names.join(', ')}`);
  const sequence = project.animations[animation], frames = sequence.frames.map(index => project.frames[index]);
  const plan = planSequence(frames.map(frame => frame.duration), { fps: rate, loop: sequence.loop, loops: options.loops ?? 1, seconds: options.seconds, step: options.step ?? 1 });
  const built = build(`${project.name}-${animation}`, project.width, project.height, plan.count, frame => ({ key: sequence.frames[plan.poses[frame]], pixels: () => frames[plan.poses[frame]].data }), { ...options, rate, palette: project.palette }, { source: 'recipe', recipe: project.name, animation });
  const timing = plan.timing.map(entry => ({ pose: frames[entry.pose].name, frames: entry.frames, wanted: entry.wanted, got: entry.got })), notes = [];
  const missing = timing.filter(entry => entry.frames === 0), moved = timing.filter(entry => entry.frames > 0 && entry.got !== entry.wanted);
  if (missing.length) notes.push(`${missing.length} pose${missing.length === 1 ? ' is' : 's are'} shorter than one video frame (${Math.round(plan.frameMs * 100) / 100} ms) and never shown: ${missing.slice(0, 8).map(entry => `${entry.pose} (${entry.wanted} ms)`).join(', ')}${missing.length > 8 ? ', …' : ''}.`);
  if (moved.length) notes.push(`${moved.length} of ${timing.length} poses changed length to fit whole video frames: ${moved.slice(0, 8).map(entry => `${entry.pose} ${entry.wanted}→${entry.got} ms`).join(', ')}${moved.length > 8 ? ', …' : ''}.`);
  if (sequence.loop && options.seconds === undefined && !plan.seamless) notes.push(`One pass is ${Math.round(plan.exactFrames / (options.loops ?? 1) * 1000) / 1000} video frames, so this clip does not end exactly where the loop does and will hitch if the editor loops it.${plan.loopsThatFit ? ` ${plan.loopsThatFit} loops fit the frame grid exactly (--loops ${plan.loopsThatFit}).` : ''}`);
  if ((options.step ?? 1) > 1) notes.push(`Animated on ${options.step}s: each sampled frame is held for ${options.step} video frames.`);
  Object.assign(built.info, { loop: { loops: options.loops ?? 1, plays: sequence.loop ? 'loops' : 'once', passFrames: Math.round(plan.exactFrames / (options.loops ?? 1) * 1e6) / 1e6, seamless: sequence.loop && plan.seamless && options.seconds === undefined }, timing });
  return finish(built, notes);
}

// A prepared scene as a sequence. Every video frame is the scene at that frame's start time; the scene repeats after
// its duration.
export function createSceneSequence(scene, name, options = {}) {
  const rate = common(options, KEYS.filter(key => key !== 'animation' && key !== 'step'));
  const plan = planSequence([scene.duration], { fps: rate, loop: true, loops: options.loops ?? 1, seconds: options.seconds });
  const unit = 1000 * rate.denominator, span = scene.duration * rate.numerator, warnings = new Set(), moments = new Map(), pictures = new Map();
  const built = build(name, scene.width, scene.height, plan.count, frame => {
    const units = frame * unit % span;
    if (!moments.has(units)) {
      const view = renderScene(scene, { time: units / rate.numerator });
      for (const warning of view.warnings) warnings.add(warning);
      // Moments that look the same share one PNG. A hash finds candidates; the pixels themselves decide.
      let hash = 2166136261;
      for (const byte of view.data) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
      const alike = pictures.get(hash) ?? pictures.set(hash, []).get(hash);
      const same = alike.find(known => known.data.every((byte, at) => byte === view.data[at])) ?? alike[alike.push({ data: view.data, key: `${hash}:${alike.length}` }) - 1];
      moments.set(units, same);
    }
    const picture = moments.get(units);
    return { key: picture.key, pixels: () => picture.data };
  }, { ...options, rate }, { source: 'scene', scene: name });
  const notes = warnings.size > 3 ? [...[...warnings].slice(0, 3), `${warnings.size - 3} more warnings of the same kind at other moments.`] : [...warnings];
  if (options.seconds === undefined && !plan.seamless) notes.push(`The scene lasts ${Math.round(plan.exactFrames / (options.loops ?? 1) * 1000) / 1000} video frames, so this clip does not end exactly where the scene repeats.${plan.loopsThatFit ? ` ${plan.loopsThatFit} loops fit the frame grid exactly (--loops ${plan.loopsThatFit}).` : ''}`);
  // A shot usually wants to fill the frame; say what scene size would, at this enlargement.
  const { width, height, placement } = built.info;
  if ((placement.width !== width || placement.height !== height) && width % placement.scale === 0 && height % placement.scale === 0 && width / placement.scale <= 256 && height / placement.scale <= 256) notes.push(`The scene covers ${placement.width}×${placement.height} of the ${width}×${height} canvas. A ${width / placement.scale}×${height / placement.scale} scene fills it exactly at this scale.`);
  Object.assign(built.info, { loop: { loops: options.loops ?? 1, plays: 'loops', passFrames: Math.round(plan.exactFrames / (options.loops ?? 1) * 1e6) / 1e6, seamless: plan.seamless && options.seconds === undefined }, sceneDuration: scene.duration });
  return finish(built, notes);
}
