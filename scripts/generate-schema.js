import { writeFile } from 'node:fs/promises';
const int = (minimum, maximum, description) => ({ type: 'integer', minimum, maximum, ...(description ? { description } : {}) });
const bool = { type: 'boolean' }, color = { type: 'string', description: 'Palette name, transparent, or #RGB/#RGBA/#RRGGBB/#RRGGBBAA.' };
const id = { type: 'string', pattern: '^[a-zA-Z][a-zA-Z0-9_-]{0,63}$', description: 'Portable name: do not use Windows device names (CON, PRN, AUX, NUL, COM1–9, LPT1–9). Frame/animation names must be unique ignoring case.' };
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const ref = name => ({ $ref: `#/$defs/${name}` });
const array = (items, maxItems = 2048) => ({ type: 'array', items, maxItems });
const xy = { x: int(-4096, 4096), y: int(-4096, 4096) }, wh = { w: int(1, 512), h: int(1, 512) };
const transform = { scale: int(1, 16), flipX: bool, flipY: bool, rotate: { enum: [0, 90, 180, 270] } };
const operation = (op, properties, required = []) => object({ op: { const: op }, ...properties }, ['op', ...required]);
const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'PixelForge project',
  ...object({
    $schema: { type: 'string' }, version: { const: 1 }, name: id,
    width: int(1, 256), height: int(1, 256),
    palette: { type: 'object', maxProperties: 256, additionalProperties: { type: 'string', pattern: '^(transparent|#([a-fA-F0-9]{3,4}|[a-fA-F0-9]{6}|[a-fA-F0-9]{8}))$' } },
    background: color, symbols: { type: 'object', propertyNames: id, additionalProperties: ref('rows') },
    frames: { ...array(ref('frame'), 256), minItems: 1 },
    animations: { type: 'object', minProperties: 1, propertyNames: id, additionalProperties: object({ frames: { ...array(id, 1024), minItems: 1 }, direction: { enum: ['forward', 'reverse', 'pingpong'] }, loop: bool }, ['frames']) },
    sheet: object({ columns: int(1, 256), padding: int(0, 16), scale: int(1, 16) })
  }, ['version', 'name', 'width', 'height', 'frames']),
  $defs: {
    rows: { ...array({ type: 'string', minLength: 1, maxLength: 256 }, 256), minItems: 1, description: 'Equal-width text rows. Every character is a palette key; dot and space skip a pixel.' },
    frame: object({ name: id, duration: int(1, 60000, 'Frame duration in milliseconds; default 100.'), from: id, translate: { ...array(int(-4096, 4096), 2), minItems: 2 }, flipX: bool, flipY: bool, ops: array(ref('op')), layers: array(ref('layer'), 64) }, ['name']),
    layer: object({ name: id, visible: bool, opacity: { type: 'number', minimum: 0, maximum: 1 }, ...xy, ops: array(ref('op')) }),
    op: { oneOf: [
      operation('pixel', { ...xy, color }, ['color']),
      operation('rect', { ...xy, ...wh, color, filled: bool }, ['w', 'h', 'color']),
      operation('ellipse', { ...xy, ...wh, color, filled: bool }, ['w', 'h', 'color']),
      operation('line', { ...xy, x2: int(-4096, 4096), y2: int(-4096, 4096), color }, ['x2', 'y2', 'color']),
      operation('clear', { ...xy, ...wh }, ['w', 'h']),
      operation('fill', { ...xy, color }, ['color']),
      operation('replace', { from: color, to: color }, ['from', 'to']),
      operation('grid', { ...xy, rows: ref('rows'), ...transform }, ['rows']),
      operation('stamp', { ...xy, symbol: id, ...transform }, ['symbol'])
    ] }
  }
};
await writeFile(new URL('../schema.json', import.meta.url), JSON.stringify(schema, null, 2) + '\n');
