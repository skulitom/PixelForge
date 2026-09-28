import { writeFile } from 'node:fs/promises';
import { DITHER_PATTERNS, EASINGS } from '../src/craft.js';
const int = (minimum, maximum, description) => ({ type: 'integer', minimum, maximum, ...(description ? { description } : {}) });
const num = (minimum, maximum, description) => ({ type: 'number', minimum, maximum, ...(description ? { description } : {}) });
const bool = { type: 'boolean' }, color = { type: 'string', description: 'Palette name, transparent, or #RGB/#RGBA/#RRGGBB/#RRGGBBAA.' };
const id = { type: 'string', pattern: '^[a-zA-Z][a-zA-Z0-9_-]{0,63}$', description: 'Portable name: do not use Windows device names (CON, PRN, AUX, NUL, COM1–9, LPT1–9). Frame/animation names must be unique ignoring case.' };
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const ref = name => ({ $ref: `#/$defs/${name}` });
const array = (items, maxItems = 2048) => ({ type: 'array', items, maxItems });
const xy = { x: int(-4096, 4096), y: int(-4096, 4096) }, wh = { w: int(1, 512), h: int(1, 512) };
const point = { ...array(int(-4096, 4096), 2), minItems: 2, description: '[x, y] in unscaled canvas pixels; the top-left corner of that pixel.' };
const transform = { scale: int(1, 16), flipX: bool, flipY: bool, rotate: { enum: [0, 90, 180, 270] } };
const remap = { type: 'object', propertyNames: { minLength: 1, maxLength: 1 }, additionalProperties: color, description: 'Recolor grid characters for this operation only: character → palette name or colour.' };
const operation = (op, properties, required = []) => object({ op: { const: op }, ...properties }, ['op', ...required]);
const hex = '^(transparent|#([a-fA-F0-9]{3,4}|[a-fA-F0-9]{6}|[a-fA-F0-9]{8}))$';
const pairOf = item => ({ ...array(item, 2), minItems: 2 });
const ruleRows = { ...array({ type: 'string', minLength: 1, maxLength: 8 }, 8), minItems: 1, description: 'Equal-width rows of palette keys; dot or space matches anything (match) or keeps the pixel (replace); the empty character stands for transparent.' };
const ease = { enum: EASINGS, description: 'linear (default), hold (jump at the end), in, out, inOut, overshoot or bounce.' };
const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'PixelForge project',
  ...object({
    $schema: { type: 'string' }, version: { const: 1 }, name: id,
    width: int(1, 256), height: int(1, 256),
    palette: { type: 'object', maxProperties: 257, properties: { $ref: { type: 'string', description: 'Shared palette file, resolved by the CLI and MCP relative to this recipe. Local entries add to or override it.' } }, additionalProperties: { type: 'string', pattern: hex } },
    background: color, symbols: { type: 'object', propertyNames: id, additionalProperties: ref('rows') },
    anchor: { ...point, description: 'Default pivot for every frame, exported to the atlas as anchor (exported pixels) and pivot (anchor / source size).' },
    frames: { ...array(ref('frame'), 256), minItems: 1 },
    animations: { type: 'object', minProperties: 1, maxProperties: 65527, description: 'ZIP32 bundle budget: animation count + frame count + 7 support files must not exceed 65,535.', propertyNames: id, additionalProperties: object({ frames: { ...array(id, 1024), minItems: 1 }, direction: { enum: ['forward', 'reverse', 'pingpong'] }, loop: bool }, ['frames']) },
    sheet: object({ columns: int(1, 256), padding: int(0, 16), scale: int(1, 16), trim: { type: 'boolean', description: 'Pack each frame by its visible bounds; the atlas reports trimmed rectangles with spriteSourceSize. Ignores columns.' } })
  }, ['version', 'name', 'width', 'height', 'frames']),
  $defs: {
    rows: { ...array({ type: 'string', minLength: 1, maxLength: 256 }, 256), minItems: 1, description: 'Equal-width text rows. Every character is a palette key; dot and space skip a pixel.' },
    frame: object({ name: id, duration: int(1, 60000, 'Frame duration in milliseconds; default 100.'), from: id, translate: { ...array(int(-4096, 4096), 2), minItems: 2 }, wrap: { type: 'boolean', description: 'Translation wraps around the canvas instead of clipping (scrolling tiles).' }, flipX: bool, flipY: bool,
      palette: { type: 'object', maxProperties: 256, additionalProperties: color, description: 'Recolor project palette keys for this frame only (palette cycling). Keys must exist in the project palette.' },
      anchor: point, points: { type: 'object', maxProperties: 64, propertyNames: id, additionalProperties: point, description: 'Named frame positions (hands, hit points, glyph advance), exported in the atlas in exported pixels.' },
      ops: array(ref('op')), layers: array(ref('layer'), 64), pixels: { ...array(ref('pixel'), 65536), description: 'Final canvas-coordinate RGBA replacements after ops and layers. Coordinates must be inside this canvas. Later entries win; transparent erases.' } }, ['name']),
    pixel: object({ x: int(0, 255), y: int(0, 255), color }, ['x', 'y', 'color']),
    layer: object({ name: id, visible: bool, opacity: { type: 'number', minimum: 0, maximum: 1 }, ...xy, ops: array(ref('op')) }),
    op: { oneOf: [
      operation('pixel', { ...xy, color }, ['color']),
      operation('rect', { ...xy, ...wh, color, filled: bool }, ['w', 'h', 'color']),
      operation('ellipse', { ...xy, ...wh, color, filled: bool }, ['w', 'h', 'color']),
      operation('line', { ...xy, x2: int(-4096, 4096), y2: int(-4096, 4096), color }, ['x2', 'y2', 'color']),
      operation('clear', { ...xy, ...wh }, ['w', 'h']),
      operation('fill', { ...xy, color }, ['color']),
      operation('replace', { from: color, to: color }, ['from', 'to']),
      operation('grid', { ...xy, rows: ref('rows'), ...transform, remap }, ['rows']),
      operation('stamp', { ...xy, symbol: id, ...transform, remap }, ['symbol']),
      { ...operation('copy', { ...xy, from: id, symbol: id, sx: int(0, 255), sy: int(0, 255), w: int(1, 256), h: int(1, 256), ...transform, remap }), oneOf: [{ required: ['from'] }, { required: ['symbol'] }], description: 'Copy a rectangle of a symbol (palette characters) or an earlier frame (exact RGBA).' },
      { ...operation('outline', { color, diagonal: bool, position: { enum: ['outside', 'inside', 'middle'], description: 'outside (default) surrounds the visible pixels; inside recolors their edge pixels; middle splits the width, the odd pixel outside.' }, width: int(1, 8, 'Rings of pixels; default 1.'),
        directions: { ...array({ type: 'string', pattern: '^[x.]{3}$' }, 3), minItems: 3, description: '3×3 grid centred on a visible pixel, with a dot in the centre: x marks the sides that get the line, e.g. ["...", "...", "..x"] for a drop shadow or [".x.", "...", "..."] for a top rim. Replaces diagonal.' } }, ['color']), description: 'Outline every visible pixel in this buffer (frame or layer): outside rings, inside edge rings or both, in chosen directions.' },
      { ...operation('dither', { ...xy, ...wh, color, erase: { type: 'boolean', description: 'Clear the pattern pixels instead of drawing a color.' },
        density: { oneOf: [num(0, 1), pairOf(num(0, 1))], description: 'Share of pixels drawn, 0–1 (default 0.5), or [from, to] ramping along direction.' },
        direction: { enum: ['down', 'up', 'right', 'left', 'radial'], description: 'Ramp direction for a [from, to] density; radial runs from the centre to the edge.' },
        pattern: { oneOf: [{ enum: DITHER_PATTERNS }, { ...array({ ...array(int(0, 255), 16), minItems: 1 }, 16), minItems: 1, description: 'Rows of ranks from 0 to cells − 1; low ranks turn on first, and a highest rank n gives n + 1 levels, so [[0, 1], [1, 0]] is a checkerboard at 0.5.' }], description: 'bayer4 by default. Patterns follow canvas coordinates, so neighbouring areas line up.' },
        offset: { ...point, description: 'Shift the pattern, for example to crawl it between frames.' },
        over: { oneOf: [color, { ...array(color, 64), minItems: 1 }], description: 'Only change pixels whose exact current color is listed (transparent included).' } }), anyOf: [{ required: ['color'] }, { required: ['erase'] }], description: 'Ordered dither between the current pixels and color: draws (or erases) where a canvas-anchored threshold pattern is below the density. x/y default to 0 and w/h to the canvas.' },
      { ...operation('rewrite', { ...xy, ...wh, rules: { ...array(object({ match: ruleRows, replace: ruleRows }, ['match', 'replace']), 16), minItems: 1 },
        empty: { type: 'string', minLength: 1, maxLength: 1, description: 'A non-palette character meaning a transparent pixel in match and erasure in replace.' },
        steps: int(1, 64, 'Passes over every rule; stops early when a pass changes nothing.'), chance: num(0, 1, 'Seeded probability that each match is applied.'), limit: int(1, 65536, 'Most replacements per rule per step.'),
        seed: int(0, 2147483647), rotate: { type: 'boolean', description: 'Also match the rules turned 90°, 180° and 270°.' }, mirror: { type: 'boolean', description: 'Also match the rules mirrored horizontally.' } }, ['rules']),
        description: 'Markov-style rewrite rules on this buffer: each small match grid found on exact colors is replaced, in a seeded order, without overlapping rewrites. The region defaults to the whole canvas.' }
    ] }
  }
};
await writeFile(new URL('../schema.json', import.meta.url), JSON.stringify(schema, null, 2) + '\n');

// Sidecar formats evolve independently; compiled sprite recipes remain version 1.
const poses = {
  $schema: schema.$schema, title: 'PixelForge authored poses',
  ...object({ format: { const: 'pixelforge-poses' }, version: { const: 1 }, name: id, width: int(1, 256), height: int(1, 256), palette: schema.properties.palette,
    parts: { type: 'object', maxProperties: 256, propertyNames: id, additionalProperties: object({ rows: ref('rows'), anchor: point, points: { type: 'object', propertyNames: id, additionalProperties: point } }, ['rows']) },
    poses: { ...array({ ...object({ name: id, duration: int(1, 60000), origin: point,
      mirror: { ...id, description: 'Reflect an earlier pose around its origin column (parts, points and markers); omit parts, markers and origin.' },
      tween: { ...object({ from: id, to: id, t: num(0, 1, 'Position between the two poses.'), ease }, ['from', 'to', 't']), description: 'An in-between of two earlier authored or tweened poses with the same part instances: origin, offsets and angles interpolate and round; part definitions and flips switch at the eased halfway point. Omit parts and origin; markers are not inherited.' },
      parts: array(object({ name: id, part: id, at: point, attach: object({ part: id, point: id }, ['part', 'point']), flipX: { type: 'boolean', description: 'Mirror this part, its anchor and its points inside the part.' },
        rotate: int(-360, 360, 'Whole degrees clockwise around the part anchor pixel, after any flip. The rotated grid is baked into an editable symbol named <part>-r<degrees> (-fr when flipped); points turn with it; right angles are exact.'),
        cleanup: { type: 'boolean', description: 'Remove doubled corners the rotation leaves (default true; false names the symbol with -raw).' } }, ['name', 'part']), 64),
      markers: array(object({ name: id, part: id, point: id }, ['name', 'part', 'point']), 64)
    }, ['name']), anyOf: [{ required: ['parts'] }, { required: ['mirror'] }, { required: ['tween'] }] }, 256), minItems: 1 }, animations: schema.properties.animations, sheet: schema.properties.sheet
  }, ['format', 'version', 'name', 'width', 'height', 'parts', 'poses']), $defs: schema.$defs
};
const recipeSchema = { ...schema }; delete recipeSchema.$schema; delete recipeSchema.$defs; delete recipeSchema.title;
const assetRef = { oneOf: [ref('recipe'), { type: 'string', description: 'Recipe file, resolved by the CLI relative to the scene or inside the MCP root.' }, object({ revision: { type: 'string', pattern: '^[a-f0-9]{12}$' } }, ['revision'])] };
const legendEntry = { oneOf: [{ type: 'string', description: 'Frame name.' }, object({ frame: { type: 'string' }, frames: array({ type: 'string' }, 64), animation: { type: 'string' }, animations: array({ type: 'string' }, 64),
  autotile: { enum: ['blob', 'cardinal'], description: 'Substitute {mask} in the names with the 47-value blob or 16-value cardinal neighbour mask.' }, match: { type: 'string', description: 'Characters counted as the same terrain; default: this character.' } }),
  { type: 'null', description: 'Context cell: never drawn, but other entries can match it (for example terrain just outside a reviewed window of a larger map).' }] };
const scene = {
  $schema: schema.$schema, title: 'PixelForge scene review',
  ...object({ format: { const: 'pixelforge-scene' }, version: { const: 1 }, name: id, width: int(1, 256), height: int(1, 256), background: color, duration: int(1, 60000),
    assets: { type: 'object', maxProperties: 64, additionalProperties: { oneOf: [assetRef, object({ recipe: assetRef, normal: assetRef, emissive: assetRef }, ['recipe'])] } },
    instances: array(object({ name: { type: 'string' }, asset: { type: 'string' }, at: point, anchor: point, scale: int(1, 16), frame: id, animation: id,
      repeat: { ...array(int(1, 32), 2), minItems: 2 }, step: point,
      trajectory: { ...array(object({ time: int(0, 60000), at: point, ease: { ...ease, description: `Shape of the segment starting at this key: ${ease.description} Positions round to whole pixels.` } }, ['time', 'at']), 256), minItems: 2 },
      sequence: array(object({ time: int(0, 59999), frame: id, animation: id }, ['time']), 64),
      tilemap: object({ tile: point, rows: { ...array({ type: 'string', minLength: 1, maxLength: 256 }, 256), minItems: 1 }, legend: { type: 'object', propertyNames: { minLength: 1, maxLength: 1 }, additionalProperties: legendEntry }, outside: { enum: ['empty', 'match'] } }, ['rows', 'legend'])
    }, ['asset', 'at']), 256),
    lighting: object({ ambient: { type: 'number', minimum: 0, maximum: 1 }, bands: int(2, 16), scope: { enum: ['passes', 'all'], description: 'passes (default) lights only assets with normal/emissive passes; all also lights plain assets as flat surfaces.' }, lights: array(object({ at: point, height: int(1, 256), radius: int(1, 512), color }, ['at']), 8) })
  }, ['format', 'version', 'name', 'width', 'height', 'assets', 'instances']), $defs: { ...schema.$defs, recipe: recipeSchema }
};
const autotile = {
  $schema: schema.$schema, title: 'PixelForge autotile template',
  description: 'A template two tiles wide and three tall: row 0 holds an unused preview tile and an inner-corner tile; rows 1–2 hold a 2×2-tile island whose quadrants give outer corners, edges and fill. Compiles to a recipe whose frames copy four quarters each.',
  ...object({ format: { const: 'pixelforge-autotile' }, version: { const: 1 }, name: id, tile: int(2, 128, 'Even tile size in pixels.'), mode: { enum: ['blob', 'cardinal'] }, palette: schema.properties.palette,
    template: { ...ref('rows'), description: 'tile × 3 rows of tile × 2 characters.' },
    frame: { type: 'string', pattern: '\\{mask\\}', description: 'Frame name template; {mask} is the neighbour mask and {variant} the variant name.' },
    variants: { ...array(object({ name: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,16}$' }, duration: int(1, 60000), palette: { type: 'object', additionalProperties: color } }, ['name']), 16), minItems: 1 },
    animation: { type: 'string', pattern: '\\{mask\\}', description: 'Optional per-mask animation over the variants, in order.' },
    sheet: schema.properties.sheet
  }, ['format', 'version', 'name', 'tile', 'template', 'frame']), $defs: schema.$defs
};
const range = (minimum, maximum, description) => ({ oneOf: [num(minimum, maximum), pairOf(num(minimum, maximum))], description: `${description} [min, max] picks per particle.` });
const vector = (minimum, maximum, description) => ({ ...pairOf(num(minimum, maximum)), ...(description && { description }) });
const emitter = object({
  name: id, at: vector(-4096, 4096, 'Spawn centre [x, y] in canvas pixels.'), area: { ...pairOf(int(1, 256)), description: 'Spawn box [w, h] centred on at; default [1, 1].' },
  burst: int(1, 1024, 'Particles spawned at start (each cycle when looping).'), rate: num(0.001, 64, 'Particles per frame from start until end.'),
  start: int(0, 255, 'Frame of the burst or first spawn; default 0.'), end: int(1, 256, 'Frame where a rate emitter stops; default the last.'),
  life: { oneOf: [int(1, 256), pairOf(int(1, 256))], description: 'Frames a particle lives; [min, max] picks per particle. Required to loop or dissolve; otherwise particles live to the end.' },
  angle: range(-3600, 3600, 'Launch direction in degrees, clockwise: 0 right, 90 down, 270 up. Default [0, 360].'), speed: range(0, 64, 'Launch speed in pixels per frame; default 0.'),
  gravity: vector(-8, 8, 'Acceleration [x, y] added each frame.'), drag: num(0, 1, 'Share of velocity lost each frame.'),
  attract: { ...object({ at: vector(-4096, 4096), strength: num(-8, 8, 'Acceleration toward at (negative repels); default 0.5.') }, ['at']), description: 'Pull every particle toward a point.' },
  sway: { ...object({ amplitude: vector(0, 32, 'Drawn offset [x, y]: x follows a sine and y a cosine, from a random phase.'), period: num(1, 256, 'Frames per cycle; default 8.') }, ['amplitude']), description: 'Wobble, added when drawing (drifting leaves, rising embers).' },
  floor: int(-4096, 4096, 'Particles never go below this y.'), bounce: num(0, 1, 'Share of downward speed returned at the floor; default 0 (they settle).'),
  shapes: { oneOf: [{ ...array(id, 64), minItems: 1 }, { ...array({ ...array(id, 64), minItems: 1 }, 64), minItems: 1 }], description: 'Symbol names drawn centred on the particle: one sequence, or a list of sequences with one picked per particle.' },
  play: { enum: ['life', 'loop', 'once'], description: 'life spreads the sequence over the lifetime (default); loop steps one symbol per frame from a random start; once steps and holds the last.' },
  remaps: { ...array(remap, 64), description: 'Colour variants; each particle picks one.' },
  trail: { ...object({ color, length: int(1, 16, 'Frames back the streak reaches; default 2.') }, ['color']), description: 'A one-pixel streak from an earlier position, drawn under the particle.' },
  dissolve: num(0, 1, 'Share of the life, at its end, during which the particle thins out through an ordered-dither pattern.'),
  pattern: { oneOf: [{ enum: DITHER_PATTERNS }, { ...array({ ...array(int(0, 255), 16), minItems: 1 }, 16), minItems: 1 }], description: 'Dissolve pattern, as for the dither operation: bayer2, bayer4 (default), bayer8 or a matrix of ranks, e.g. [[0, 1, 2], [1, 2, 0], [2, 0, 1]] for diagonal stripes.' }
}, ['at', 'shapes']);
const fx = {
  $schema: schema.$schema, title: 'PixelForge particle effects',
  description: 'Seeded particle emitters compiled into an ordinary recipe: one frame sequence and animation per effect (frames <effect>-0, <effect>-1…), drawn with stamp, grid and line operations on these symbols. Deterministic for a given seed.',
  ...object({ format: { const: 'pixelforge-fx' }, version: { const: 1 }, name: id, width: int(1, 256), height: int(1, 256), palette: schema.properties.palette,
    symbols: { type: 'object', minProperties: 1, propertyNames: id, additionalProperties: ref('rows') }, anchor: schema.properties.anchor,
    effects: { type: 'object', minProperties: 1, maxProperties: 64, propertyNames: id, additionalProperties: object({ frames: int(1, 256), duration: { oneOf: [int(1, 60000), array(int(1, 60000), 256)], description: 'Milliseconds per frame, or one per frame; default 100.' },
      loop: { type: 'boolean', description: 'Seamless loop: the simulation warms up so particles in flight at frame 0 are those alive at the end. Needs a finite life.' }, seed: int(0, 2147483647, 'Default 1.'), emitters: { ...array(emitter, 16), minItems: 1 } }, ['frames', 'emitters']) },
    sheet: schema.properties.sheet
  }, ['format', 'version', 'name', 'width', 'height', 'symbols', 'effects']), $defs: schema.$defs
};
for (const [file, value] of [['poses.schema.json', poses], ['scene.schema.json', scene], ['autotile.schema.json', autotile], ['fx.schema.json', fx]]) await writeFile(new URL(`../${file}`, import.meta.url), JSON.stringify(value, null, 2) + '\n');
