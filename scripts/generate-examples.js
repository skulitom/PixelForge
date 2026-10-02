import { writeFile, mkdir } from 'node:fs/promises';
import { compileEffects, compilePoses, formatJSON } from '../src/index.js';
const rows = source => source.map(row => row.padEnd(16, '.'));
const spirit = rows([
  '........dd',
  '.......dLld',
  '..dd...dld',
  '..dLdddld',
  '...dllld',
  '....dddddd',
  '...dllhhllld',
  '..dlhhhhhhhld',
  '..dlhhhhhhhld',
  '.dlhhkhhkhhhld',
  '.dlhhkhhkhhhld',
  '.dlpphhhhpplld',
  '..dlhhhhlhlld',
  '..dlllllllld',
  '...dlllllld',
  '....dlddld',
  '....dd..dd'
]);
const palette = { d: '#245449', l: '#72b58d', L: '#c9e6a0', h: '#b6db9c', k: '#20383f', p: '#e8b09e', s: '#283d5130', g: '#f2dc93' };
const pose = (name, y, duration, blink = false) => ({ name, duration, layers: [
  { name: 'shadow', ops: [{ op: 'ellipse', x: 7, y: 21, w: 10, h: 2, color: 's' }] },
  { name: 'body', y, ops: [{ op: 'stamp', symbol: 'mossling', x: 4, y: 3 }, ...(blink ? [{ op: 'rect', x: 8, y: 12, w: 6, h: 2, color: 'h' }, { op: 'line', x: 9, y: 13, x2: 10, y2: 13, color: 'k' }, { op: 'line', x: 12, y: 13, x2: 13, y2: 13, color: 'k' }] : [])] }
] });
const forest = { version: 1, name: 'forest-spirit', width: 24, height: 24, palette, symbols: { mossling: spirit }, frames: [pose('rest', 0, 240), pose('rise', -1, 140), pose('float', -2, 220), pose('blink', -2, 100, true), pose('fall', -1, 140), pose('settle', 0, 160)], animations: { idle: { frames: ['rest', 'rise', 'float', 'blink', 'float', 'fall', 'settle'] }, bob: { frames: ['rest', 'rise', 'float'], direction: 'pingpong' }, blink: { frames: ['rest', 'blink', 'rest'], loop: false } }, sheet: { columns: 6, padding: 1, scale: 1 } };
const ember = { version: 1, name: 'ember', width: 24, height: 24, palette: { o: '#6a3344', r: '#cf5b53', a: '#f39b5d', y: '#ffdb85', w: '#fff1ca' }, symbols: { flame: rows(['........oo','.......oro','......oroo','.....orrao','....orraao','...orraaooo','..orraaaaaro','..raayyyaaro','.oraywyyyaaro','.oraywyyyaaro','.orraayyaaro','..orraaaaaro','...orrrrro','....ooooo']) }, frames: [
  { name: 'flicker-a', duration: 110, ops: [{ op: 'stamp', symbol: 'flame', x: 4, y: 5 }] },
  { name: 'flicker-b', duration: 90, from: 'flicker-a', ops: [{ op: 'clear', x: 11, y: 5, w: 4, h: 3 }, { op: 'line', x: 12, y: 4, x2: 11, y2: 9, color: 'r' }, { op: 'pixel', x: 15, y: 3, color: 'y' }] },
  { name: 'flicker-c', duration: 120, ops: [{ op: 'stamp', symbol: 'flame', x: 4, y: 4, flipX: true }] },
  { name: 'flicker-d', duration: 80, from: 'flicker-a', ops: [{ op: 'pixel', x: 8, y: 3, color: 'a' }, { op: 'pixel', x: 15, y: 1, color: 'y' }] }
], animations: { burn: { frames: ['flicker-a', 'flicker-b', 'flicker-c', 'flicker-d'] } }, sheet: { columns: 4, padding: 1 } };
const widths = [12, 9, 5, 3, 5, 9];
const coin = { version: 1, name: 'coin', width: 24, height: 24, palette: { edge: '#916240', gold: '#edbb57', light: '#ffe4a0', shade: '#c78a43' }, frames: widths.map((w, i) => ({ name: `turn-${i}`, duration: 110, ops: [
  { op: 'ellipse', x: Math.floor((24-w)/2), y: 5, w, h: 15, color: 'edge' },
  { op: 'ellipse', x: Math.floor((24-w)/2) + 1, y: 6, w: Math.max(1,w-2), h: 12, color: 'gold' },
  ...(w >= 5 ? [{ op: 'line', x: Math.floor((24-w)/2)+2, y: 8, x2: Math.floor((24-w)/2)+2, y2: 15, color: 'light' }] : []),
  ...(w > 8 ? [{ op: 'line', x: 12, y: 9, x2: 12, y2: 15, color: 'shade' }] : [])
] })), animations: { spin: { frames: widths.map((_, i) => `turn-${i}`) } }, sheet: { columns: 6, padding: 1 } };

// Seeded particle effects: every frame compiles to stamps, grids and lines on these symbols.
const emit = (at, extra) => ({ at, ...extra });
const effects = { format: 'pixelforge-fx', version: 1, name: 'effects', width: 48, height: 40,
  palette: { W: '#fff4d6', y: '#ffd166', o: '#f4843c', r: '#c2413a', s: '#d8c7a8', S: '#a38d74', u: '#6f5d52', l: '#b8dc7a', g: '#79b15a', G: '#3f7a4a', q: '#a9a6c4', Q: '#6b6888' },
  symbols: { hot: ['W'], warm: ['y'], cool: ['o'], ash: ['r'], 'flash-0': ['..W..', '.WyW.', 'WyWyW', '.WyW.', '..W..'], 'flash-1': ['W...W', '..y..', '.y.y.', '..y..', 'W...W'],
    'ember-big': ['yW', 'oy'], ember: ['y'], 'ember-dim': ['o'], 'ember-end': ['r'], 'puff-big': ['.sss.', 'ssssS', 'SSSSu'], puff: ['.sS', 'sSu'], 'puff-small': ['sS'],
    'leaf-a': ['lg.', '.gG'], 'leaf-b': ['.l', 'gG'], 'leaf-c': ['gl', 'G.'], 'chip-a': ['qQ', 'Q.'], 'chip-b': ['q', 'Q'], 'chip-c': ['.q', 'qQ'], 'chip-d': ['q'] },
  anchor: [24, 36],
  effects: {
    sparks: { frames: 9, duration: 55, seed: 11, emitters: [
      emit([24, 30], { name: 'flash', burst: 1, life: 2, shapes: ['flash-0', 'flash-1'], play: 'once' }),
      emit([24, 30], { name: 'burst', area: [3, 2], burst: 12, angle: [205, 335], speed: [1.8, 3.4], gravity: [0, 0.32], drag: 0.04, life: [6, 9], floor: 36, bounce: 0.35, shapes: ['hot', 'warm', 'cool', 'ash'], trail: { color: 'r', length: 1 } })] },
    embers: { frames: 16, duration: 70, loop: true, seed: 4, emitters: [
      emit([24, 35], { area: [12, 2], rate: 0.5, angle: [255, 285], speed: [0.6, 1.1], life: [12, 18], sway: { amplitude: [1, 0], period: 7 }, shapes: ['ember-big', 'ember', 'ember-dim', 'ember-end'], dissolve: 0.25 })] },
    dust: { frames: 8, duration: 70, seed: 6, emitters: [[22, [178, 196], 'left'], [26, [344, 362], 'right']].map(([x, angle, name]) =>
      emit([x, 35], { name, area: [4, 1], burst: 4, angle, speed: [1.2, 2.2], drag: 0.22, gravity: [0, -0.04], life: [7, 9], shapes: ['puff-big', 'puff', 'puff-small'], dissolve: 0.4 })) },
    leaves: { frames: 12, duration: 70, seed: 9, emitters: [
      emit([24, 18], { area: [10, 4], burst: 8, angle: [200, 340], speed: [1, 2.2], gravity: [0, 0.18], drag: 0.14, life: [10, 12], sway: { amplitude: [1.4, 0], period: 6 },
        shapes: [['leaf-a', 'leaf-b'], ['leaf-b', 'leaf-c'], ['leaf-c', 'leaf-a']], play: 'loop', remaps: [{}, { g: 'l' }, { G: 'g', g: 'l' }], dissolve: 0.25 })] },
    shatter: { frames: 12, duration: 60, seed: 3, emitters: [
      emit([24, 26], { area: [6, 4], burst: 9, angle: [205, 335], speed: [2, 3.5], gravity: [0, 0.45], drag: 0.02, life: 12, floor: 35, bounce: 0.3, shapes: [['chip-a'], ['chip-b'], ['chip-c'], ['chip-d']] })] }
  } };

// Dithered sky bands, a shading band limited to one colour, an inside rim light, grown cracks and moss, a drop line.
const band = (y, h, color, density) => ({ op: 'dither', x: 0, y, w: 48, h, color, density });
const shrine = { version: 1, name: 'shrine', width: 48, height: 40,
  palette: { a: '#2a2140', b: '#43305a', e: '#6b4668', f: '#a8606a', u: '#2c3b2f', v: '#3f5a3a', k: '#1d1a2b', s: '#6d6a8a', S: '#4d4a6a', h: '#9e9bbd', c: '#2f2b45', m: '#6fa34f', M: '#46703f', g: '#5fc7b8', G: '#d6fff1' },
  symbols: { rune: ['..g..', '.g.g.', 'g.g.g', '.g.g.', '..g..'] },
  frames: [
    { name: 'idle', duration: 400, layers: [
      { name: 'sky', ops: [
        { op: 'rect', x: 0, y: 0, w: 48, h: 30, color: 'a' }, band(8, 10, 'b', [0, 1]), { op: 'rect', x: 0, y: 18, w: 48, h: 6, color: 'b' }, band(18, 8, 'e', [0, 1]),
        { op: 'rect', x: 0, y: 26, w: 48, h: 4, color: 'e' }, band(26, 4, 'f', [0, 0.75]), { op: 'rect', x: 0, y: 30, w: 48, h: 10, color: 'v' }, band(30, 10, 'u', [0.25, 1])] },
      { name: 'stone', ops: [
        { op: 'ellipse', x: 16, y: 6, w: 16, h: 12, color: 's' }, { op: 'rect', x: 16, y: 12, w: 16, h: 22, color: 's' },
        { op: 'pixel', x: 26, y: 13, color: 'c' },
        { op: 'rewrite', x: 18, y: 12, w: 12, h: 20, rules: [{ match: ['c.', '.s'], replace: ['..', '.c'] }], mirror: true, limit: 1, steps: 9, seed: 7 },
        { op: 'dither', x: 24, y: 6, w: 8, h: 28, color: 'S', density: [0, 1], direction: 'right', over: 's' },
        { op: 'outline', color: 'h', position: 'inside', directions: ['xx.', 'x..', '...'] },
        { op: 'outline', color: 'k' },
        { op: 'rewrite', empty: '_', rules: [{ match: ['_', 'k'], replace: ['.', 'm'] }], chance: 0.7, seed: 2 },
        { op: 'rewrite', rules: [{ match: ['m', 'h'], replace: ['.', 'M'] }, { match: ['m', 's'], replace: ['.', 'M'] }], chance: 0.6, seed: 3 },
        { op: 'stamp', symbol: 'rune', x: 19, y: 20 },
        { op: 'outline', color: 'k', directions: ['...', '...', '.x.'] }] }
    ] },
    { name: 'glow', from: 'idle', duration: 240, palette: { g: 'G' }, ops: [{ op: 'stamp', symbol: 'rune', x: 19, y: 20 }] }
  ],
  animations: { pulse: { frames: ['idle', 'glow'] } } };

// One sword drawn once, rotated around its grip; eased tweens accelerate the swing into the strike.
const tip = [{ name: 'tip', part: 'blade', point: 'tip' }], held = rotate => [{ name: 'blade', part: 'sword', rotate }];
const swing = { format: 'pixelforge-poses', version: 1, name: 'swing', width: 40, height: 40,
  palette: { k: '#1d1a2b', b: '#7a4a32', y: '#e8b04a', w: '#eef3ff', s: '#9aa7c7', S: '#5d6a8f' },
  parts: { sword: { rows: ['....k............', '...kyk...........', 'kkkkykkkkkkkkkk..', 'kbbkykwwwwwwwwwkk', 'kkkkykssssssssSk.', '...kyk.kkkkkkkk..', '....k............'], anchor: [2, 3], points: { tip: [16, 3] } } },
  poses: [
    { name: 'raise', duration: 180, origin: [20, 24], parts: held(-135), markers: tip },
    { name: 'strike', duration: 90, origin: [20, 24], parts: held(30), markers: tip },
    { name: 'swing-1', duration: 50, tween: { from: 'raise', to: 'strike', t: 0.33, ease: 'in' } },
    { name: 'swing-2', duration: 50, tween: { from: 'raise', to: 'strike', t: 0.67, ease: 'in' } },
    { name: 'follow', duration: 160, origin: [20, 24], parts: held(50) }
  ],
  animations: { swing: { frames: ['raise', 'swing-1', 'swing-2', 'strike', 'follow'], loop: false } } };

// A lower third for video: 240 × 32 fills the width of a 1080p frame at scale 8. The panel opens, the title is typed
// in, and the last pose holds. Every duration is a whole number of frames at 30 and at 60 frames per second.
const panel = width => [{ op: 'rect', x: 0, y: 4, w: 3, h: 24, color: 'gold' }, ...(width ? [{ op: 'rect', x: 3, y: 4, w: width, h: 24, color: 'panel' }, { op: 'rect', x: 3, y: 27, w: width, h: 1, color: 'edge' }] : [])];
const title = 'PIXELFORGE', line = 'text to pixels, frame by frame';
const caption = { version: 1, name: 'caption', width: 240, height: 32, palette: { panel: '#141824e6', edge: '#0b0e16', gold: '#f2dc93', ink: '#f2f0e4', soft: '#9fb6c9' },
  frames: [
    { name: 'bar', duration: 100, ops: panel(0) },
    { name: 'open-1', duration: 100, ops: panel(70) },
    { name: 'open-2', duration: 100, ops: panel(150) },
    { name: 'open-3', duration: 100, ops: panel(210) },
    ...[3, 6, 10].map((letters, i) => ({ name: `type-${i + 1}`, duration: 100, ops: [...panel(210), { op: 'text', x: 11, y: 8, text: title.slice(0, letters), color: 'ink' }] })),
    { name: 'shown', duration: 2000, ops: [...panel(210), { op: 'text', x: 11, y: 8, text: title, color: 'ink' }, { op: 'text', x: 11, y: 18, text: line, color: 'soft' }] }
  ],
  animations: { in: { frames: ['bar', 'open-1', 'open-2', 'open-3', 'type-1', 'type-2', 'type-3', 'shown'], loop: false }, hold: { frames: ['shown'] } },
  sheet: { columns: 2, padding: 1 } };

await mkdir(new URL('../examples/', import.meta.url), { recursive: true });
// Authored sources are pretty-printed; compiled recipes use the CLI's compact formatting.
const authored = { 'forest-spirit': forest, ember, coin, shrine, caption, 'effects.fx': effects, 'swing.poses': swing };
const compiled = { effects: compileEffects(effects).recipe, swing: compilePoses(swing).recipe };
for (const [name, value] of Object.entries(authored)) await writeFile(new URL(`../examples/${name}.json`, import.meta.url), JSON.stringify(value, null, 2) + '\n');
for (const [name, value] of Object.entries(compiled)) await writeFile(new URL(`../examples/${name}.json`, import.meta.url), formatJSON(value));
