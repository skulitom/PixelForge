import { writeFile, mkdir } from 'node:fs/promises';
import { compileEffects, compilePoses, compileNormals, formatJSON } from '../src/index.js';
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

// A normal pass derived from the spirit, and a small night scene that lights it. Move the light in the scene viewer
// (pixelbolt preview examples/forest-spirit-lit.scene.json) to see the form turn toward it.
const spiritNormals = { format: 'pixelforge-normals', version: 1, recipe: 'forest-spirit.json' };
const litSpirit = { format: 'pixelforge-scene', version: 1, name: 'forest-spirit-lit', width: 72, height: 40, duration: 1200, background: '#141a2a',
  assets: { spirit: { recipe: 'forest-spirit.json', normal: 'forest-spirit-normal.json' } },
  instances: [{ name: 'spirit', asset: 'spirit', at: [24, 8], animation: 'idle' }],
  lighting: { ambient: 0.35, bands: 4, lights: [{ at: [14, 10], height: 12, radius: 48, color: '#fff2d6' }] } };

// Fluid effects: each source is one simulated effect compiled into palette grids (pixelbolt compile x.fluid.json).
// Gases hold their sources with `rate` and colour density and temperature through ramps; liquids are FLIP water.
const fluidSource = (name, width, height, palette, effect, symbols) => ({ format: 'pixelforge-fluid', version: 1, name, width, height, palette, ...(symbols && { symbols }), effects: { [name]: effect } });
const shapeRows = (w, h, at) => Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => at(x, y) ?? '.').join(''));
const fireRamp = (keys, thresholds, dither = 0.6) => ({ field: 'temperature', colors: keys, thresholds, dither });
// The source is a disc sunk into the logs, so the flame rises from a dome; quick cooling ends it in tongues.
const campfire = fluidSource('campfire', 32, 48, { u: '#4d4558', S: '#6e6678', r: '#b8322f', o: '#f0772b', y: '#ffcc4d', W: '#fff6d1', b: '#5a3825', B: '#8a5a36', k: '#2a1c18' }, {
  frames: 24, duration: 70, loop: true, seed: 3, walls: ['bottom'], buoyancy: 0.45, vorticity: 0.45, dissipation: 0.065, cooling: 0.24,
  obstacles: [{ symbol: 'logs', x: 3, y: 40 }, { symbol: 'ground', x: 0, y: 46, draw: 'none' }],
  emitters: [{ name: 'fire', at: [16, 42], radius: 6, rate: 1, temperature: 1.1, density: 0.4, velocity: [0, -1.2], noise: 1.4, flicker: 0.6 },
    { name: 'embers', at: [16, 34], radius: 3, rate: 1, sparks: { count: 0.5, life: [8, 14], colors: ['W', 'y', 'y', 'o'], trail: true, angle: [250, 290], speed: [0.3, 0.7], drag: 0.08 } }],
  look: [{ field: 'density', colors: ['u', 'S'], thresholds: [0.16, 0.4], dither: 0.5, pattern: 'value' }, fireRamp(['r', 'o', 'y', 'W'], [0.3, 0.42, 0.62, 1], 0.5)]
}, {
  ground: ['k'.repeat(32), 'k'.repeat(32)], logs: ['....kk..............kk....', '...kBBkk..........kkBBk...', '..kBbbBBkk......kkBBbbBk..', '..kbbbbbBBkk..kkBBbbbbbk..', '...kkbbbbbBBkkBBbbbbbkk...', '.....kkkbbbbBBbbbbkkk.....', '.......kkkkbbbbkkkk.......', '...........kkkk...........'] });
// Three lobes held for a few frames while they expand, then thinning away; shading keeps their form as they go.
const lobe = (at, radius, start) => ({ at, radius, rate: 1, ...(start && { start }), end: start + 3, density: 1.5, expand: 1.1, noise: 0.9, flicker: 0.4 });
const smokePuff = fluidSource('smoke-puff', 32, 32, { k: '#121019', d: '#5d5872', m: '#9a95ad', l: '#cfcadb', w: '#f8f6fc' }, {
  frames: 19, duration: 60, seed: 5, buoyancy: 0, weight: -0.03, vorticity: 0.4, dissipation: 0.17, drag: 0.12,
  emitters: [lobe([16, 14], 2.5, 0), lobe([10, 18], 2, 1), lobe([22, 18], 2, 2), lobe([16, 21], 2, 3)],
  look: [{ field: 'density', colors: ['m', 'l'], thresholds: [0.18, 0.6], dither: 0.2 }, { field: 'shadow', colors: ['d'], thresholds: [0.5], dither: 0.3 }, { field: 'light', colors: ['w'], thresholds: [0.5], dither: 0.3 }],
  outline: 'k', cleanup: { strays: true }
});
// A short, hot, expanding source makes one fireball; weak buoyancy lets it rise without tearing into a ring.
const explosion = fluidSource('explosion', 64, 64, { W: '#fffbe6', y: '#ffd34d', o: '#ff8a2b', r: '#d6402b', R: '#8f2a2e', s: '#b3a5ad', S: '#867882', k: '#5a4e5b' }, {
  frames: 32, duration: 60, seed: 7, buoyancy: 0.14, vorticity: 0.35, dissipation: 0.13, cooling: 0.16, drag: 0.08,
  emitters: [{ name: 'flash', at: [32, 36], radius: 10, burst: 1, temperature: 2.6 },
    { name: 'blast', at: [32, 36], radius: 5, rate: 1, end: 4, density: 2.4, temperature: 3, expand: 4.4, noise: 1.4, flicker: 0.5 },
    { name: 'debris', at: [32, 36], radius: 4, burst: 1, sparks: { count: 16, life: [10, 16], colors: ['W', 'y', 'y', 'o', 'r'], trail: true, angle: [185, 355], speed: [3, 5], gravity: [0, 0.12], drag: 0.03, follow: 0 } }],
  look: [{ field: 'density', colors: ['k', 'S'], thresholds: [0.12, 0.45], dither: 0.6, pattern: 'value' }, { field: 'light', colors: ['s'], thresholds: [0.3], dither: 0.4 },
    fireRamp(['R', 'r', 'o', 'y', 'W'], [0.3, 0.5, 0.85, 1.4, 2.2], 0.5)],
  cleanup: { strays: true }
});
const steamVent = fluidSource('steam-vent', 32, 48, { q: '#7d8ca3', Q: '#b4c2d6', w: '#eef4fb', p: '#4a5160', P: '#6f7889', h: '#9aa3b3', k: '#262a33' }, {
  frames: 24, duration: 70, loop: true, seed: 2, walls: ['bottom'], buoyancy: 0.45, vorticity: 0.4, dissipation: 0.1, cooling: 0.05, drag: 0.04,
  obstacles: [{ symbol: 'pipe', x: 11, y: 42 }],
  // Three short jets a loop, each rolling into its own puff that widens, drifts and fades as it rises; between jets a
  // drain clears the nozzle, so every puff lets go.
  emitters: [0, 8, 16].flatMap((start, i) => [
    { name: `puff-${i + 1}`, at: [16, 40], radius: 2.5, rate: 1, start, end: start + 2, density: 1.3, temperature: 1, velocity: [[-0.3, 0.4, 0][i], -2.6], expand: 1.4, noise: 1 },
    { name: `gap-${i + 1}`, at: [16, 39], area: [8, 4], rate: 1, start: start + 3, end: start + 8, density: -1, temperature: -1 }]),
  look: [{ field: 'density', colors: ['q', 'Q', 'w'], thresholds: [0.12, 0.45, 0.9], dither: 0.5, pattern: 'value' }], cleanup: { strays: true }
}, { pipe: ['kkkkkkkkkk', 'kPhhhhhhPk', 'kpPPPPPPpk', '.kpPPPPpk.', '.kpPPPPpk.', '.kpPPPPpk.'] });
// Two comets orbit the centre; a wide swirl that pulls inward winds their trails into two spiral arms with dark space
// between them, and sparkles fly off the heads.
const orbiter = (phase, reach, density) => ({ name: phase ? 'west' : 'east', at: [24, 24], radius: 2, rate: 1, density, temperature: 1, orbit: { radius: reach, period: 24, ...(phase && { phase }) },
  sparks: { count: 0.5, life: [6, 12], colors: ['W', 'c', 'm'], angle: [0, 360], speed: [0.4, 0.9], follow: 0.3, drag: 0.08 } });
const magicSwirl = fluidSource('magic-swirl', 48, 48, { v: '#3d2a6b', p: '#7a44c9', m: '#c06cf0', c: '#6fe3f2', W: '#f4f0ff' }, {
  frames: 24, duration: 60, loop: true, seed: 9, buoyancy: 0, vorticity: 0.2, dissipation: 0.075, cooling: 0.22, drag: 0.05,
  emitters: [{ name: 'swirl', at: [24, 24], radius: 20, rate: 1, vortex: 1.3, expand: -1 }, orbiter(0, 15, 1.3), orbiter(165, 11, 1), { name: 'core', at: [24, 24], radius: 2.5, rate: 1, density: 0.6, temperature: 0.7 }],
  look: [{ field: 'density', colors: ['v', 'p', 'm'], thresholds: [0.14, 0.35, 0.7], dither: 0.5, pattern: 'value' }, fireRamp(['c', 'W'], [0.5, 0.85], 0.4)]
});
const torch = fluidSource('torch', 16, 32, { r: '#c23b2e', o: '#f57f2a', y: '#ffd257', W: '#fff7d6', b: '#5c3a24', B: '#8c5a32', g: '#8a8f99', G: '#c4c8cf', k: '#221a1c' }, {
  frames: 16, duration: 70, loop: true, seed: 4, buoyancy: 0.45, vorticity: 0.45, dissipation: 0.14, cooling: 0.34, drag: 0.03,
  obstacles: [{ symbol: 'torch', x: 5, y: 22 }],
  emitters: [{ name: 'flame', at: [8.5, 22.5], radius: 4, rate: 1, temperature: 1.1, velocity: [0, -1], noise: 0.8, flicker: 0.35 },
    { name: 'embers', at: [8.5, 15], radius: 1.5, rate: 1, sparks: { count: 0.15, life: [5, 8], colors: ['W', 'y', 'o'], trail: true, angle: [255, 285], speed: [0.3, 0.5] } }],
  look: [fireRamp(['r', 'o', 'y', 'W'], [0.32, 0.44, 0.64, 0.98], 0.5)]
}, { torch: ['kGGGGGk', 'kgGGGgk', '.kgggk.', '.kBbbk.', '.kBbbk.', '.kBbbk.', '.kBbbk.', '.kBbbk.', '.kBbbk.', '..kkk..'] });
// Water: a body colour, then depth bands from a one-pixel highlight on the surface down to the deep colour.
const water = { B: '#1d3f7a', b: '#2f6fc0', c: '#5fb4e8', w: '#dff6ff' }, stone = { r: '#5b5568', R: '#433e50', k: '#2b2735' };
const waterLook = (deep, threshold = 0.5) => [{ field: 'density', colors: ['b'], thresholds: [threshold], dither: 0 }, { field: 'depth', colors: ['w', 'c', 'b', 'B'], thresholds: [1, 2, 4, deep], dither: 0 }];
const spray = (at, start, count, extra = {}) => ({ name: 'spray', at, radius: 2, burst: 1, start, density: 0, sparks: { count, life: [6, 12], colors: ['w', 'w', 'c'], size: 2, angle: [225, 315], speed: [1.2, 2.4], gravity: [0, 0.22], drag: 0.02, follow: 0, ...extra } });
// The drop falls from near rest, so it visibly speeds up; a low flip share damps the waves so the pool comes to rest.
const splash = fluidSource('splash', 48, 40, water, {
  kind: 'liquid', frames: 36, duration: 60, seed: 3, walls: ['left', 'right', 'bottom'], flip: 0.5, drag: 0.07, tension: 1.2,
  fill: [{ x: 0, y: 28, w: 48, h: 12 }, { at: [24, 7], radius: 2.5, velocity: [0, 0.5] }],
  emitters: [spray([24, 28], 10, 8, { speed: [1.6, 3] })], look: waterLook(7), cleanup: { strays: true }
});
// Water pours over a mossy lip and falls down the cliff face into a basin; a steady source keeps the fall in one place
// from cycle to cycle, spray rises where it lands, and the basin's right lip spills through the open right edge, so the level
// settles by itself.
const waterfall = fluidSource('waterfall', 48, 64, { ...water, ...stone, L: '#7b7590', m: '#5f9a4a' }, {
  kind: 'liquid', frames: 24, duration: 60, loop: true, seed: 5, warmup: 4, substeps: 3, walls: ['left'], flip: 0.6, drag: 0.03,
  obstacles: [{ symbol: 'cliff', x: 0, y: 12 }, { symbol: 'basin', x: 0, y: 49 }], fill: [{ x: 18, y: 49, w: 22, h: 12 }],
  emitters: [{ name: 'source', at: [12, 8.5], area: [8, 6], rate: 1, velocity: [0.5, 0.2] },
    { name: 'spray', at: [22, 48], radius: 2, rate: 1, density: 0, sparks: { count: 0.8, life: [4, 8], colors: ['w', 'c'], angle: [220, 320], speed: [0.8, 2], gravity: [0, 0.2], follow: 0 } }],
  look: [...waterLook(8), { field: 'speed', colors: ['c', 'w'], thresholds: [3, 4.2], dither: 0.5 }], cleanup: { strays: true }
}, {
  // Rock in strata: a dark seam every five rows, a lit edge along the face.
  cliff: shapeRows(19, 52, (x, y) => {
    const face = y < 3 ? 18 : 15 + [0, 1, 0, -1, 0, 1, 1, 0][Math.floor(y / 6) % 8];
    return x > face ? null : y === 0 ? 'm' : x === face ? 'k' : x === face - 1 ? 'L' : y % 5 === 0 || (x + Math.floor(y / 5) * 3) % 9 === 0 ? 'R' : 'r';
  }),
  // The basin's floor ends at a lip; water over the lip spills down outside it and leaves through the open bottom.
  basin: shapeRows(44, 15, (x, y) => (y >= 12 || (x >= 40 && y >= 1) ? (x === 40 && y < 12 ? 'L' : y === 12 || (x * 2 + y) % 7 === 0 ? 'R' : 'r') : null))
});
// A drop gathers under the stalactite, falls and splashes; a slow soak drains as much as each drop adds.
const drip = fluidSource('drip', 16, 32, { ...water, ...stone }, {
  kind: 'liquid', frames: 24, duration: 70, loop: true, seed: 2, warmup: 3, walls: ['left', 'right', 'bottom'], flip: 0, drag: 0.08, tension: 1.6,
  obstacles: [{ symbol: 'rock', x: 0, y: 0 }, { symbol: 'ground', x: 0, y: 29 }], fill: [{ x: 1, y: 25, w: 14, h: 4 }],
  // A bead hangs at the tip, held still by velocity [0, 0], and swells when the wider emitter joins; when both stop,
  // the drop falls. Fast water is drawn by its speed as well, so the falling drop never thins out of sight.
  emitters: [{ name: 'bead', at: [8, 7.5], radius: 1.4, rate: 1, end: 8, velocity: [0, 0] }, { name: 'swell', at: [8, 8], radius: 1.7, rate: 1, start: 4, end: 8, velocity: [0, 0] },
    { ...spray([8, 25], 20, 3), sparks: { ...spray([8, 25], 20, 3).sparks, life: [4, 8], speed: [0.8, 1.4], size: 1 } },
    { name: 'soak', at: [8, 27], area: [14, 4], rate: 1, density: -0.01 }],
  look: [{ field: 'density', colors: ['b'], thresholds: [0.5], dither: 0 }, { field: 'depth', colors: ['w', 'c'], thresholds: [1, 2], dither: 0 }, { field: 'speed', colors: ['c'], thresholds: [1], dither: 0 }], cleanup: { strays: true }
}, {
  rock: ['RrrrrRrrrrRrrrrR', 'rrrRrrrrRrrrrRrr', '...rrrRrrrrRr...', '....RrrrrRrr....', '.....rrRrrr.....', '......rrrr......', '.......rR.......'],
  ground: ['R..............R', 'R..............R', 'RRRRRRRRRRRRRRRR']
});
// A stoppered round-bottom flask: pulses from below heave the surface while bubbles rise and pop.
const flask = shapeRows(32, 40, (x, y) => {
  const dx = x - 15.5, d = Math.sqrt(dx * dx + (y - 26.5) * (y - 26.5)), side = Math.abs(dx);
  if (y >= 2 && y < 4 && side < 5) return y === 2 ? 'k' : 'h';
  if (y >= 2 && y < 17 && side < 4 && side >= 2.5) return side >= 3.5 ? 'k' : 'h';
  if (d >= 10.5 && d < 12.5 && !(y < 17 && side < 2.5)) return d >= 11.5 ? 'k' : (dx < 0 && y < 26.5 ? 'H' : 'h');
  return null;
});
const potion = fluidSource('potion', 32, 40, { G: '#1f6a3f', g: '#3fa34d', l: '#8be36a', w: '#e6ffc9', k: '#1b1a26', h: '#8fa3b8', H: '#e4f0ff' }, {
  kind: 'liquid', frames: 24, duration: 70, loop: true, seed: 8, walls: ['bottom'], gravity: [0, 0.25], flip: 0.8, drag: 0.04,
  obstacles: [{ symbol: 'flask', x: 0, y: 0 }], fill: [{ at: [15.5, 26.5], radius: 10.5, x: 0, y: 22, w: 32, h: 18 }],
  emitters: [{ name: 'heat', at: [15.5, 34], area: [8, 2], rate: 1, density: 0, velocity: [0, -2], pulse: { amplitude: 1, period: 12 } },
    { name: 'boil', at: [15.5, 24], area: [18, 4], rate: 1, density: 0, noise: 0.5 },
    // Bubbles start across the bottom and rise mostly under their own lift, so the stirring only sways them; they pop
    // where they leave the liquid.
    { name: 'bubbles', at: [15.5, 33.5], area: [14, 3], rate: 1, density: 0, sparks: { count: 0.3, life: [24, 32], colors: ['w'], size: 2, angle: 270, speed: 0.8, gravity: [0, -0.1], drag: 0.05, follow: 0.2, pop: true } }],
  look: [{ field: 'density', colors: ['g'], thresholds: [0.5], dither: 0 }, { field: 'depth', colors: ['w', 'l', 'g', 'G'], thresholds: [1, 2, 4, 9], dither: 0 }], cleanup: { strays: true }
}, { flask });
const fluids = { campfire, 'smoke-puff': smokePuff, explosion, 'steam-vent': steamVent, 'magic-swirl': magicSwirl, torch, splash, waterfall, drip, potion };

await mkdir(new URL('../examples/', import.meta.url), { recursive: true });
// Authored sources are pretty-printed; compiled recipes use the CLI's compact formatting.
const authored = { 'forest-spirit': forest, ember, coin, shrine, caption, 'effects.fx': effects, 'swing.poses': swing, 'forest-spirit.normals': spiritNormals, 'forest-spirit-lit.scene': litSpirit, ...Object.fromEntries(Object.entries(fluids).map(([name, source]) => [`${name}.fluid`, source])) };
const compiled = { effects: compileEffects(effects).recipe, swing: compilePoses(swing).recipe, 'forest-spirit-normal': compileNormals({ ...spiritNormals, recipe: forest }).recipe };
for (const [name, value] of Object.entries(authored)) await writeFile(new URL(`../examples/${name}.json`, import.meta.url), JSON.stringify(value, null, 2) + '\n');
for (const [name, value] of Object.entries(compiled)) await writeFile(new URL(`../examples/${name}.json`, import.meta.url), formatJSON(value));
