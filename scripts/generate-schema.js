import { writeFile } from 'node:fs/promises';
const int = (minimum, maximum, description) => ({ type: 'integer', minimum, maximum, ...(description ? { description } : {}) });
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
      { ...operation('outline', { color, diagonal: bool }, ['color']), description: 'Draw a 1px outline around every visible pixel in this buffer (frame or layer); diagonal also fills corners.' }
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
      parts: array(object({ name: id, part: id, at: point, attach: object({ part: id, point: id }, ['part', 'point']), flipX: { type: 'boolean', description: 'Mirror this part, its anchor and its points inside the part.' } }, ['name', 'part']), 64),
      markers: array(object({ name: id, part: id, point: id }, ['name', 'part', 'point']), 64)
    }, ['name']), anyOf: [{ required: ['parts'] }, { required: ['mirror'] }] }, 256), minItems: 1 }, animations: schema.properties.animations, sheet: schema.properties.sheet
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
      trajectory: { ...array(object({ time: int(0, 60000), at: point }, ['time', 'at']), 256), minItems: 2 },
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
for (const [file, value] of [['poses.schema.json', poses], ['scene.schema.json', scene], ['autotile.schema.json', autotile]]) await writeFile(new URL(`../${file}`, import.meta.url), JSON.stringify(value, null, 2) + '\n');
