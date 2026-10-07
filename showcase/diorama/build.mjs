// Diorama study: an original 3/4 top-down dungeon room, a floating "diorama" of 8 px tiles, built only with
// PixelForge's existing features to measure what that style asks of the toolkit. See
// docs/reports/diorama-feasibility-2026-10-07.md for the findings.
//
// Usage: node showcase/diorama/build.mjs [--force] [--theme stone|blue]
// Writes ordinary PixelForge sources into art/ (art-blue/ for the blue theme). This script is authoritative; the
// written recipes are its output. Existing files are kept unless --force is passed.
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { compileAutotile } from '../../src/authoring.js';
import { compileEffects } from '../../src/fx.js';
import { formatJSON } from '../../src/export.js';

const args = process.argv.slice(2), force = args.includes('--force');
const theme = args.includes('--theme') ? args[args.indexOf('--theme') + 1] : 'stone';
if (!['stone', 'blue'].includes(theme)) throw new Error('--theme is stone or blue');
const out = fileURLToPath(new URL(theme === 'stone' ? 'art/' : 'art-blue/', import.meta.url));
mkdirSync(out, { recursive: true });
const written = [];
function save(name, value) {
  const target = path.join(out, name);
  if (existsSync(target) && !force) throw new Error(`Refusing to overwrite ${target}; pass --force`);
  writeFileSync(target, formatJSON(value));
  written.push(name);
}

// ---------------------------------------------------------------- palette: 31 colours shared by every recipe
// A theme is the same keys with other colours: the blue theme recolours stone and floor and keeps the rest.
const palette = {
  k: '#0d0f16', K: '#171a24', // void and outline, the island's underside
  s: '#26282f', t: '#3a3a40', // wall face dark, wall face
  u: '#57534d', v: '#7a7262', w: '#9f977c', // cap shade, cap, cap light
  f: '#2e2f35', g: '#3c3d43', h: '#48484d', // floor shadow, floor, floor light
  r: '#3f2629', q: '#6b3731', p: '#8f5141', // brick and clay
  m: '#353d23', n: '#525c2d', o: '#73803a', // moss
  b: '#1c3350', c: '#27507a', d: '#3e76a0', e: '#88b6cf', E: '#d6ecf0', // water and foam
  1: '#27507a', 2: '#27507a', // water sparkles, cycled by the water variants
  x: '#45291f', y: '#73462c', z: '#a3703d', G: '#d1ad5c', // wood and brass
  l: '#a9a08a', L: '#e3ddcb', // bone, cloth light
  F: '#e2703a', Y: '#fbc95e', W: '#fff3c2', // flame
  R: '#8a2d3a' // red cloth
};
if (theme === 'blue') Object.assign(palette, { s: '#1f2a36', t: '#2c3d4f', u: '#3f5a6e', v: '#5b7f93', w: '#83a6b4', f: '#2f2723', g: '#40342c', h: '#4e4136' });
save('palette.json', palette);
const P = { $ref: 'palette.json' };

// ---------------------------------------------------------------- blob templates
// A blob autotile template is two 8 px tiles wide and three tall. The compiler takes fill quarters from the island's
// centre shifted by a quarter, so an 8-periodic interior pattern always lines up; `edge` decides the island's rim.
function blobTemplate(pattern, edge) {
  const g = Array.from({ length: 24 }, () => Array(16).fill('.'));
  const pat = (x, y) => pattern[y % 8][x % 8];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 16; x++) g[y][x] = pat(x, y);
  // inner-corner tile (x 8-15, y 0-7): each quadrant's corner pixel faces the open diagonal
  g[0][8] = g[0][15] = g[7][8] = g[7][15] = 'k';
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const edgeX = x === 0 || x === 15, edgeY = y === 0 || y === 15;
    g[8 + y][x] = edgeX && edgeY ? '.' : edgeX || edgeY ? 'k' : edge(x, y, pat);
  }
  return g.map(row => row.join(''));
}
// Wall caps: staggered stone blocks with a lit rim inside the top edge and a shaded rim inside the bottom edge.
const capEdge = (x, y, pat) => y === 1 ? 'w' : y === 14 ? 'u' : pat(x, y);
const capTemplate = blobTemplate(['wwwwwwwu', 'vvvvvvvu', 'vvvvrvvu', 'uuuuuuuu', 'wwwuwwww', 'vvvuvvvv', 'vrvuvvvv', 'uuuuuuuu'], capEdge);
const crackedTemplate = blobTemplate(['wwwwwwwu', 'vvvkvvvu', 'vvvvkvvu', 'uuuuuuuu', 'wwwuwwnw', 'vvvuvnov', 'vrvuvvnv', 'uuuuuuuu'], capEdge);
// Autotile variants are palette swaps only, so the cracked, mossy caps are a second compiled set merged into the same
// recipe: a tilemap legend can only pick variants among one asset's frames.
const capSet = (template, frame) => compileAutotile({ format: 'pixelforge-autotile', version: 1, name: 'cap', tile: 8, mode: 'blob', palette, template, frame }).recipe;
const capA = capSet(capTemplate, 'cap-{mask}'), capB = capSet(crackedTemplate, 'capb-{mask}');
save('cap.json', { ...capA, palette: P, symbols: { template: capTemplate, cracked: crackedTemplate },
  frames: [...capA.frames, ...capB.frames.map(frame => ({ ...frame, ops: frame.ops.map(op => ({ ...op, symbol: 'cracked' })) }))] });

// Water sits below the floor: the pool's own north wall goes down into it, a dark reflection lies under that wall and
// a lit rim runs along the other sides. Four variants cycle the sparkle keys 1 and 2.
const waterSource = {
  format: 'pixelforge-autotile', version: 1, name: 'water', tile: 8, mode: 'blob', palette: P,
  template: blobTemplate(['cccccccc', 'ccccc1cc', 'cccccccc', 'cccccccc', 'cc2ccccc', 'cccccccc', 'cccccc1c', 'cccccccc'],
    (x, y, pat) => y === 1 ? 't' : y === 2 ? 's' : y === 3 ? (x === 1 || x === 14 ? 'd' : 'b') : x === 1 || x === 14 || y === 14 ? 'd' : pat(x, y)),
  frame: 'water-{mask}-{variant}', animation: 'water-{mask}',
  variants: [['c', 'd'], ['d', 'e'], ['e', 'c'], ['c', 'c']].map(([one, two], i) => ({ name: `v${i}`, duration: 180, palette: { 1: one, 2: two } }))
};
save('water.autotile.json', waterSource);
save('water.json', { ...compileAutotile({ ...waterSource, palette }).recipe, palette: P });

// ---------------------------------------------------------------- 8 px tiles: floor, faces, cliffs, waterfall
const tiles = [];
const tile = (name, rows) => tiles.push({ name, ops: [{ op: 'grid', rows }] });
tile('floor-0', Array(8).fill('gggggggg'));
tile('floor-1', ['gggggggg', 'gggggggg', 'gggfgggg', 'ggggfggg', 'gggfhggg', 'gggggggg', 'gggggggg', 'gggggggg']);
tile('floor-2', ['gggggggg', 'gghggggg', 'ggfggggg', 'gggggggg', 'gggggggg', 'gggggghg', 'ggggggfg', 'gggggggg']);
tile('floor-3', ['gggggggg', 'gggggggg', 'gggggggg', 'gggggfgg', 'gggggggg', 'gggggggg', 'gggggggg', 'gggggggg']);
tile('brick-0', ['grrrrrgg', 'grhggrgg', 'grrrrrrr', 'ggggrhgr', 'ggrrrrrr', 'ggrhggrg', 'ggrrrrrg', 'gggggggg']);
tile('brick-1', ['gggggggg', 'rrrrrggg', 'gggrhrgg', 'rrrrrrrg', 'grhgggrg', 'grrrrrrg', 'gggggggg', 'gggggggg']);
// The north face of a wall is drawn into the floor cell below it, ending in a contact line and a strip of shadow.
tile('nface-0', ['tttsttts', 'tttsttts', 'ssssssss', 'tsttttst', 'tsttttst', 'kkkkkkkk', 'ffffffff', '........']);
tile('nface-1', ['ttttstts', 'ttttstts', 'ssssssss', 'tttsttst', 'tttsttst', 'kkkkkkkk', 'ffffffff', '........']);
// The island's outer face is drawn into the void below its south edge.
tile('cliff-0', ['tttsttts', 'ssssssss', 'tsttttst', 'ssssssss', 'KKKKKKKK', 'k.k.k.k.', '........', '........']);
tile('cliff-1', ['ttttstts', 'ssssssss', 'tttsttst', 'ssssssss', 'KKKKKKKK', '.k.k.k.k', '........', '........']);
// The waterfall is two halves so neighbouring columns join without a seam; wrap scrolls each drawn column down.
const fall = { l: ['kdcedcdc', 'kcdecdec', 'kedcdced', 'kcedcdcc', 'kdcdedcd', 'kecdcedc', 'kcdedcce', 'kdecdced'],
  r: ['dcedcdck', 'cdecdcek', 'ecdcedck', 'dcedcdek', 'cdcedcck', 'edcdcedk', 'cdedccek', 'dcecdcek'] };
for (const [side, rows] of Object.entries(fall)) {
  tiles.push({ name: `fall-${side}-0`, duration: 90, ops: [{ op: 'grid', rows }] });
  for (let i = 1; i < 4; i++) tiles.push({ name: `fall-${side}-${i}`, duration: 90, from: `fall-${side}-0`, translate: [0, 2 * i], wrap: true });
}
save('tiles.json', { version: 1, name: 'tiles', width: 8, height: 8, palette: P, frames: tiles, animations: Object.fromEntries(Object.keys(fall).map(side => [`fall-${side}`, { frames: [0, 1, 2, 3].map(i => `fall-${side}-${i}`) }])) });

// ---------------------------------------------------------------- props: 16 x 18 canvas, anchor at the ground contact
const ANCHOR = [8, 16], props = [];
// Art sits bottom-centred on the anchor. `shadow` first draws an opaque floor-shadow ellipse: scenes cannot darken
// what lies underneath without inventing colours, so the shadow is the floor-shadow colour whatever it lands on.
function prop(name, art, { shadow = true, dy = 0 } = {}) {
  const w = art[0].length, x = ANCHOR[0] - Math.floor(w / 2), y = ANCHOR[1] - art.length + 1 + dy;
  props.push({ name, ops: [...(shadow ? [{ op: 'ellipse', x: x - 1, y: ANCHOR[1] - 2, w: w + 2, h: 4, color: 'f' }] : []), { op: 'grid', x, y, rows: art }] });
}
prop('barrel', ['.kkkkkk.', 'kzzzzzzk', 'kzyyyyzk', 'kzyxxyzk', 'kyzzzzyk', 'kxyyyyxk', 'kGzyyzGk', 'kxyyyyxk', 'kxyzzyxk', '.kkkkkk.']);
prop('pot', ['.kkkkk.', 'kpkkkpk', 'kqpppqk', 'kpppqqk', 'kqppqqk', '.kqqqk.', '..kkk..']);
prop('pot-break-0', ['.kkkkk.', 'kpkkkpk', 'kqpkpqk', 'kpkpqqk', 'kqpkqqk', '.kqqkk.', '..kkk..']);
prop('pot-break-1', ['k.p..qk', '.kq.kpk', 'kqpk.qk', '.k.pqk.'], { shadow: false });
prop('pot-shards', ['.....kq..', 'kqk...kpk', '.kpk.kqk.', 'q...kk..p'], { shadow: false });
prop('urn', ['.kkkkk.', 'kekkkek', 'kcddcck', 'kddcbck', 'kGGGGGk', 'kdcccbk', '.kbbbk.', '..kkk..']);
prop('crate', ['kkkkkkkk', 'kzzzzzzk', 'kzyyyyzk', 'kzyyyyzk', 'kxxxxxxk', 'kyxyyxyk', 'kyyxxyyk', 'kyxyyxyk', 'kkkkkkkk']);
prop('pillar', ['.kkkkkkk.', 'kuvwwwvuk', 'kvwwwwwvk', 'kuvvvvvuk', '.kkkkkkk.', ...Array(6).fill('.ksttuuk.'), 'kkkkkkkkk', 'kstttuuuk', 'kkkkkkkkk']);
prop('chest', ['.kkkkkkk.', 'kzyyyyyzk', 'kyyyyyyyk', 'kkkkGkkkk', 'kxyyGyyxk', 'kxyyyyyxk', 'kxxxxxxxk', '.kkkkkkk.']);
prop('chest-open', ['.kkkkkkk.', 'kxyyyyyxk', 'kkkkkkkkk', 'kGYkYGkGk', 'kxyyyyyxk', 'kxyyyyyxk', 'kxxxxxxxk', '.kkkkkkk.']);
prop('bones', ['.l...L', 'lLLl.l', '..l.kk'], { shadow: false });
prop('skull', ['.kkk.', 'kLLLk', 'kkLkk', '.kLk.'], { shadow: false });
prop('rubble', ['..kk..k', '.kuvkku', 'kuvukvk'], { shadow: false });
prop('candles', ['..Y...', '..W.Y.', '.kLkW.', '.kLkLk', 'kkLkLk', 'kkkkkk'], { shadow: false });
prop('banner', ['kkkkkk', 'kRRRRk', 'kRGGRk', 'kRRRRk', 'kRGRRk', 'kRRRRk', 'kRRRRk', 'kR.kRk', 'k...Rk', '....k.'], { shadow: false, dy: 1 });
prop('chain', ['.k.', 'kuk', '.k.', 'kuk', '.k.', 'kuk', '.k.', '.u.'], { shadow: false });
const web = ['lLlLl.', 'L.l.l.', 'll.L..', 'L.l...', 'l.....', '......'];
prop('cobweb', web, { shadow: false });
prop('cobweb-r', web.map(row => [...row].reverse().join('')), { shadow: false });
// Flat floor decals, placed freely so worn bricks and planks straddle tile edges.
prop('bricks-a', ['.rrrrr.rrrr', 'rrhgrrrghr.', '.rrrrrrrrrr', '..rghrr.rgr', '..rrrr..rrr'], { shadow: false });
prop('bricks-b', ['rrrr.rrr', 'rghrrghr', 'rrrrrrrr', '.rrhgr..', '.rrrrr..'], { shadow: false });
prop('bricks-c', ['.rrrrrr', '.rghrhr', 'rrrrrrr', 'rhgr...', 'rrrr...'], { shadow: false });
prop('plank', ['.kkkkk', 'kyzzyk', 'kkkkk.'], { shadow: false });
prop('plank-d', ['..kk.', '.kzyk', 'kzyk.', 'kyk..', '.k...'], { shadow: false });
// A wall torch: one bracket, four authored flames.
[['..Y..', '.YWY.', '.FYF.'], ['...Y.', '.YWY.', '.FWF.'], ['.Y...', '.YWY.', '.FYF.'], ['..Y..', '.YYF.', '.FWF.']].forEach((flame, i) =>
  props.push({ name: `torch-${i}`, duration: 110, ops: [{ op: 'grid', x: 6, y: 8, rows: ['.kkk.', 'kzGzk', '.kxk.', '..k..'] }, { op: 'grid', x: 6, y: 5, rows: flame }] }));
// Foam where the waterfall meets the channel: three authored frames.
['.EeE.eEEe.EeE.e.|eEdeEEdEeEEdeEe.|..e..e..e..e....', 'E.eEe.EeE.eEe.E.|eEEdeEEEdeEEEde.|.e..e..e..e..e..', '.eE.EeE.eEe.EeE.|EdeEEdeEEdEeEdEe|e..e..e..e..e...']
  .forEach((art, i) => props.push({ name: `foam-${i}`, duration: 120, ops: [{ op: 'grid', x: 0, y: 14, rows: art.split('|') }] }));
save('props.json', { version: 1, name: 'props', width: 16, height: 18, palette: P, anchor: ANCHOR, frames: props, animations: {
  'pot-break': { frames: ['pot-break-0', 'pot-break-1', 'pot-shards'], loop: false },
  'chest-open': { frames: ['chest', 'chest-open'], loop: false },
  torch: { frames: ['torch-0', 'torch-1', 'torch-2', 'torch-3'] }, foam: { frames: ['foam-0', 'foam-1', 'foam-2'] } } });

// ---------------------------------------------------------------- hero: 7 x 10 pixels on a 12 x 14 canvas
const head = ['..kkk..', '.kRRRk.', 'kRRRRRk'];
const pose = (body, legs, bob = 0, dx = 0) => [
  { op: 'ellipse', x: 2, y: 11, w: 8, h: 3, color: 'f' },
  { op: 'grid', x: 3 + dx, y: 2 + bob, rows: [...head, ...body] },
  { op: 'grid', x: 3 + dx, y: 10, rows: legs }
];
const front = ['kRlLlRk', '.kRRRk.', 'kvwwwvk', 'kuvGvuk', '.kuuuk.'], side = ['kRRlLk.', '.kRRk..', '.kvwwk.', '.kuvGk.', '.kuuk..'];
const apart = ['.kt.tk.', '.kk.kk.'], wide = ['kt...tk', 'kk...kk'], crossed = ['..ktk..', '..kkk..'];
const hero = [
  { name: 'idle-0', duration: 400, ops: pose(front, apart) },
  // the second idle pose breathes: the chest drops a row
  { name: 'idle-1', duration: 400, ops: pose(front.slice(0, 4), apart, 1) },
  { name: 'down-0', duration: 120, ops: pose(front, ['.kt.k..', '.kk....']) },
  { name: 'down-1', duration: 120, ops: pose(front, apart, -1) },
  { name: 'down-2', duration: 120, ops: pose(front, ['..k.tk.', '....kk.']) },
  { name: 'down-3', duration: 120, ops: pose(front, apart, -1) },
  { name: 'right-0', duration: 120, ops: pose(side, ['.kt..tk', 'kk...kk']) },
  { name: 'right-1', duration: 120, ops: pose(side, crossed, -1) },
  { name: 'right-2', duration: 120, ops: pose(side, apart) },
  { name: 'right-3', duration: 120, ops: pose(side, crossed, -1) },
  // attack to the right: wind-up with the blade raised behind, a lunging strike, a low follow-through
  { name: 'atk-0', duration: 90, ops: [...pose(side, apart), { op: 'grid', x: 0, y: 1, rows: ['L...', '.L..', '..lk', '...k'] }] },
  { name: 'atk-1', duration: 70, ops: [...pose(side, wide, 1, 1), { op: 'grid', x: 9, y: 7, rows: ['kLL'] }] },
  { name: 'atk-2', duration: 160, ops: [...pose(side, wide, 1, 1), { op: 'grid', x: 9, y: 8, rows: ['k..', '.L.', '..L'] }] }
];
save('hero.json', { version: 1, name: 'hero', width: 12, height: 14, palette: P, anchor: [6, 12], frames: hero, animations: {
  idle: { frames: ['idle-0', 'idle-1'] }, down: { frames: ['down-0', 'down-1', 'down-2', 'down-3'] },
  right: { frames: ['right-0', 'right-1', 'right-2', 'right-3'] }, attack: { frames: ['atk-0', 'atk-1', 'atk-2', 'right-0'], loop: false } } });

// ---------------------------------------------------------------- slash smear: a crescent, thinned and dissolved
const crescent = thin => Array.from({ length: 14 }, (_, y) => Array.from({ length: 10 }, (_, x) => {
  const outer = Math.hypot(x - 1.5, y - 6.5), inner = Math.hypot(x + 1.5 + thin, y - 6.5);
  return outer > 7.2 || inner < 7.2 || x < 2 ? '.' : outer > 6.2 ? 'E' : 'L';
}).join(''));
save('slash.json', { version: 1, name: 'slash', width: 16, height: 14, palette: P, anchor: [2, 9], frames: [
  // An empty frame: a scene instance always shows a frame, so the smear waits as 'none' until its cue.
  { name: 'none', duration: 60 },
  { name: 'slash-0', duration: 60, ops: [{ op: 'grid', x: 4, y: 0, rows: crescent(0) }] },
  { name: 'slash-1', duration: 60, ops: [{ op: 'grid', x: 4, y: 0, rows: crescent(2) }, { op: 'dither', erase: true, density: 0.35, pattern: 'bayer2' }] },
  { name: 'slash-2', duration: 60, ops: [{ op: 'grid', x: 4, y: 0, rows: crescent(3) }, { op: 'dither', erase: true, density: 0.7, pattern: 'bayer2' }] }
], animations: { idle: { frames: ['none'] }, slash: { frames: ['slash-0', 'slash-1', 'slash-2', 'none'], loop: false } } });

// ---------------------------------------------------------------- shards: a pixelforge-fx burst
const shardsSource = { format: 'pixelforge-fx', version: 1, name: 'shards', width: 32, height: 24, palette: P,
  symbols: { a: ['qp'], b: ['p', 'q'], c: ['k'], d: ['rq'] },
  effects: { burst: { frames: 10, duration: 50, seed: 7, emitters: [
    { at: [16, 18], burst: 7, angle: [200, 340], speed: [1.4, 2.6], gravity: [0, 0.38], life: [7, 10], floor: 21, bounce: 0.3, shapes: [['a'], ['b'], ['c'], ['d']] }
  ] } } };
save('shards.fx.json', shardsSource);
const shards = compileEffects({ ...shardsSource, palette }).recipe;
save('shards.json', { ...shards, palette: P, frames: [...shards.frames, { name: 'none' }] });

// ---------------------------------------------------------------- the room
// W wall, F floor, P pool, V waterfall, . void. The extra row at the bottom holds the cliffs below the island.
const MAP = [
  '.......WWWW.......',
  '..WWWWWWVVWWWWWW..',
  '..WFFFFFPPFFFFFW..',
  'WWWFFFFFPPFFFFFWWW',
  'WFFFFFFFPPFFFFFFFW',
  'WFFFFFPPPPPPFFFFFW',
  'WFFFFFPPPPPPFFFFFW',
  'WFFFFFFFFFFFFFFFFW',
  'WWWFFFFFFFFFFFFWWW',
  '..WFFFFFFFFFFFFW..',
  '..WWWWWFFFFWWWWW..',
  '......WFFFFW......',
  '......WWWWWW......',
  '..................'
];
const at = (x, y) => MAP[y]?.[x] ?? '.', island = c => 'WFPV'.includes(c);
// A seeded integer hash for decoration choices, so the room is the same on every run.
const hash = (x, y, s = 0) => { let v = (x * 374761393 + y * 668265263 + s * 2246822519) >>> 0; v = Math.imul(v ^ (v >>> 13), 1274126177) >>> 0; return (v ^ (v >>> 16)) / 4294967296; };
const cells = pick => MAP.map((row, y) => [...row].map((c, x) => pick(c, x, y) ?? '.').join(''));
// A tilemap legend sees only "same character or not" around a cell, so every layer that depends on what lies next
// to a cell (faces below walls, cliffs below the island, waterfall halves, bricks next to walls) is a character
// map computed here.
const floorRows = cells((c, x, y) => c !== 'F' ? null : (at(x - 1, y) === 'W' || at(x + 1, y) === 'W' || at(x, y + 1) === 'W') && hash(x, y, 1) < 0.35 ? (hash(x, y, 2) < 0.5 ? 'B' : 'b') : 'F');
const faceRows = cells((c, x, y) => (c === 'F' || c === 'P') && at(x, y - 1) === 'W' ? (hash(x, y, 3) < 0.5 ? 'n' : 'N') : null);
const cliffRows = cells((c, x, y) => !island(c) && island(at(x, y - 1)) ? (hash(x, y, 4) < 0.5 ? 'c' : 'C') : null);
const capRows = cells(c => c === 'W' ? 'W' : null);
const waterRows = cells(c => c === 'P' ? 'p' : c === 'V' ? 'v' : null);
const fallRows = cells((c, x, y) => c !== 'V' ? null : at(x - 1, y) === 'V' ? 'R' : 'L');

// Moss: a decal the size of the map. The renderer cannot see the scene's floor, so the floor is painted here as a
// marker colour M, clumps are dithered over it, rewrite rules clean them up and the marker is erased.
const OX = 8, OY = 6; // the map's offset in the scene
const moss = [{ op: 'grid', rows: MAP.flatMap(row => Array(8).fill([...row].map(c => (c === 'F' ? 'M' : '.').repeat(8)).join(''))) }];
// Each clump is a few overlapping radial-noise dithers, a dense core inside a fuzzy rim, at seeded offsets.
const parts = [];
for (const [cx, cy, size, seed] of [[30, 58, 30, 3], [108, 40, 22, 5], [78, 76, 26, 9], [36, 22, 14, 11], [118, 28, 10, 15], [92, 84, 10, 17]]) for (let i = 0; i < 5; i++) {
  const w = Math.max(4, Math.round(size * (0.45 + 0.4 * hash(seed, i, 1)))), h = Math.max(3, Math.round(w * (0.55 + 0.25 * hash(seed, i, 2))));
  parts.push({ x: Math.round(cx + (hash(seed, i, 3) - 0.5) * size * 0.7 - w / 2), y: Math.round(cy + (hash(seed, i, 4) - 0.5) * size * 0.4 - h / 2), w, h, seed: seed * 10 + i });
}
for (const p of parts) moss.push({ op: 'dither', x: p.x, y: p.y, w: p.w, h: p.h, color: 'n', density: [1, 0.1], direction: 'radial', pattern: 'noise', seed: p.seed, over: 'M' });
// Cellular clean-up: a moss pixel bare on three sides goes, a bare pixel mossy on three sides fills.
moss.push({ op: 'rewrite', steps: 2, rotate: true, seed: 4, rules: [
  { match: ['.M.', 'MnM', '...'], replace: ['...', '.M.', '...'] },
  { match: ['.n.', 'nMn', '...'], replace: ['...', '.n.', '...'] }
] });
for (const p of parts) moss.push({ op: 'dither', x: p.x + 2, y: p.y + 1, w: Math.max(2, p.w - 4), h: Math.max(2, p.h - 3), color: 'o', density: [0.55, 0], direction: 'radial', pattern: 'noise', seed: p.seed + 500, over: 'n' });
// A shadow along each clump's lower edge and a darker fringe on its left.
moss.push({ op: 'rewrite', chance: 0.8, seed: 6, rules: [{ match: ['n', 'M'], replace: ['m', '.'] }, { match: ['o', 'M'], replace: ['n', '.'] }, { match: ['Mn'], replace: ['.m'] }] });
moss.push({ op: 'replace', from: 'M', to: 'transparent' });
save('moss.json', { version: 1, name: 'moss', width: MAP[0].length * 8, height: MAP.length * 8, palette: { ...P, M: '#ff00ff' }, frames: [{ name: 'moss', ops: moss }] });

// Scene positions: the ground line of a cell, nudged by dx, dy.
const cell = (x, y, dx = 0, dy = 0) => [OX + x * 8 + 4 + dx, OY + y * 8 + 7 + dy];
const place = (name, frame, pos, extra = {}) => ({ name, asset: 'props', frame, at: pos, anchor: 'frame', ...extra });
const decals = [['bricks-a', 2, 7], ['bricks-b', 15, 6, 1, 2], ['bricks-c', 6, 9], ['bricks-b', 10, 4, 3, 0], ['bricks-c', 13, 3, 0, -2], ['plank', 6, 5, -2, 0], ['plank-d', 12, 7, 2, -2], ['plank', 11, 9, 0, 1]];
const standing = [
  ['pillar', 3, 2, 0, 1], ['pillar', 14, 2, 0, 1], ['barrel', 1, 4], ['barrel', 1, 5, 1, 1], ['pot', 2, 4, 2], ['crate', 16, 7],
  ['pot', 16, 4], ['urn', 16, 5], ['pot', 15, 4, 1, -1], ['barrel', 3, 9], ['pot', 4, 9, 2, 1], ['crate', 14, 9], ['pot', 13, 9, 1, 1],
  ['candles', 10, 11, -2, -1], ['candles', 7, 11, -2, -1], ['bones', 5, 7, 0, -2], ['skull', 12, 6], ['rubble', 11, 3, 0, -1], ['rubble', 5, 8, 0, 1]
];
const byGround = list => list.map(([frame, x, y, dx, dy]) => place(frame, frame, cell(x, y, dx, dy))).sort((a, b) => a.at[1] - b.at[1]);
// The timeline: the hero walks in, strikes at 1200 ms, the smear and the pot break follow, then the chest opens.
// Scene instances cannot follow one another, so every cue is a hand-written time.
const strike = 1200, hit = strike + 90, heroEnd = cell(10, 8, 1, -2), potAt = cell(12, 8, -1, -2);
const instances = [
  { name: 'floor', asset: 'tiles', at: [OX, OY], tilemap: { rows: floorRows, legend: { F: { frames: ['floor-0', 'floor-0', 'floor-3', 'floor-1', 'floor-2', 'floor-0'] }, b: 'brick-0', B: 'brick-1' } } },
  { name: 'water', asset: 'water', at: [OX, OY], tilemap: { rows: waterRows, legend: { p: { animation: 'water-{mask}', autotile: 'blob', match: 'pv' }, v: null } } },
  { name: 'moss', asset: 'moss', at: [OX, OY], frame: 'moss' },
  ...byGround(decals),
  { name: 'faces', asset: 'tiles', at: [OX, OY], tilemap: { rows: faceRows, legend: { n: 'nface-0', N: 'nface-1' } } },
  { name: 'cliffs', asset: 'tiles', at: [OX, OY], tilemap: { rows: cliffRows, legend: { c: 'cliff-0', C: 'cliff-1' } } },
  { name: 'caps', asset: 'cap', at: [OX, OY], tilemap: { rows: capRows, legend: { W: { frames: ['cap-{mask}', 'cap-{mask}', 'capb-{mask}'], autotile: 'blob' } } } },
  { name: 'falls', asset: 'tiles', at: [OX, OY], tilemap: { rows: fallRows, legend: { L: { animation: 'fall-l' }, R: { animation: 'fall-r' } } } },
  // cobwebs in the inner corners where the north face meets a side wall, foam at the waterfall's foot
  place('cobweb', 'cobweb', [OX + 1 * 8 + 3, OY + 4 * 8 + 5]), place('cobweb', 'cobweb-r', [OX + 17 * 8 - 3, OY + 4 * 8 + 5]),
  { name: 'foam', asset: 'props', animation: 'foam', at: [OX + 8 * 8 + 8, OY + 2 * 8 + 2], anchor: 'frame' },
  ...[[5, 2], [12, 2]].map(([x, y]) => ({ name: 'torch', asset: 'props', animation: 'torch', at: cell(x, y, 0, -6), anchor: 'frame' })),
  ...byGround(standing),
  place('chest', 'chest', cell(8, 11, 4, -1), { sequence: [{ time: 2000, animation: 'chest-open' }] }),
  place('target-pot', 'pot', potAt, { sequence: [{ time: hit, animation: 'pot-break' }] }),
  // Scenes draw in list order, so the hero is simply drawn after every prop.
  { name: 'hero', asset: 'hero', animation: 'right', at: heroEnd, anchor: 'frame', trajectory: [{ time: 0, at: cell(4, 8, 0, -2) }, { time: strike, at: heroEnd }],
    sequence: [{ time: strike, animation: 'attack' }, { time: strike + 700, animation: 'idle' }] },
  { name: 'slash', asset: 'slash', animation: 'idle', at: [heroEnd[0] + 3, heroEnd[1] - 4], anchor: 'frame', sequence: [{ time: hit - 20, animation: 'slash' }] },
  { name: 'shards', asset: 'shards', frame: 'none', at: [potAt[0] - 16, potAt[1] - 21], sequence: [{ time: hit, animation: 'burst' }] },
  // chains and a banner hang off the island's south edge
  ...[[3, 11], [13, 11], [8, 13], [10, 13]].map(([x, y]) => place('chain', 'chain', cell(x, y, -1, 1))),
  place('banner', 'banner', cell(4, 10, 0, 6))
];
save('room.scene.json', {
  format: 'pixelforge-scene', version: 1, name: `diorama-${theme}`, width: 160, height: 128, duration: 2400, background: palette.k,
  assets: { tiles: 'tiles.json', cap: 'cap.json', water: 'water.json', moss: 'moss.json', props: 'props.json', hero: 'hero.json', slash: 'slash.json', shards: 'shards.json' },
  instances
});
console.log(JSON.stringify({ ok: true, directory: out, files: written }));
