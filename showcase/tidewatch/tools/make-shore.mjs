// One-time scaffold: hand-drawn coastline masks -> shaded 8x8 quarter symbols -> 47 blob tiles x 4 foam phases.
// After generation, art/recipes/shore.json (symbols + frames) is the authoritative, editable source.
import { paletteFor, writeJSON } from './common.mjs';
import { blobMasks, quadrantsFor } from './autotile.mjs';

// Island: a 2x2-tile sand island inset 4px, with hand-placed 1px recessions away from quarter boundaries.
const island = [
  '................................', '................................', '................................', '................................',
  '.......#####..####....###.......', '.....##############..######.....', '....########################....', '....########################....',
  '....########################....', '....########################....', '.....#######################....', '.....#######################....',
  '.....######################.....', '....#######################.....', '....########################....', '....########################....',
  '....########################....', '....#######################.....', '....#######################.....', '.....######################.....',
  '.....#######################....', '....########################....', '....########################....', '....########################....',
  '....########################....', '....########################....', '.....######################.....', '.......###...######..####.......',
  '................................', '................................', '................................', '................................'
];
// Lake: sand everywhere except one water tile (plus the 4px shore band that belongs to the sand tiles).
const lake = Array.from({ length: 48 }, (_, y) => Array.from({ length: 48 }, (_, x) => {
  const inside = x >= 12 && x <= 35 && y >= 12 && y <= 35;
  const cx = x < 24 ? x - 12 : 35 - x, cy = y < 24 ? y - 12 : 35 - y; // distance into the water from the nearer edge
  const rounded = (cy === 0 && cx < 3) || (cy === 1 && cx < 1) || (cx === 0 && cy < 3) || (cx === 1 && cy < 1);
  return inside && !rounded ? '.' : '#';
}).join(''));
// Seamless 16x16 sand texture, indexed by global template coordinates.
const texture = [
  'SSSSSSSSSSSSSSSS', 'SSSSSSSSSSSsSSSS', 'SSSdSSSSSSSSdSSS', 'SSSSSSSSSSSSSSSS',
  'SSSSSSSsSSSSSSSS', 'SSSSSSSSdSSSSSSS', 'SsSSSSSSSSSSSSdS', 'SSSSSSSSSSSSSSSS',
  'SSSSSSSSSSSSSSSS', 'SSSSSSSSSSdSSSSS', 'SSSSsSSSSSSSSSSS', 'SSSSSdSSSSSSSsSS',
  'SSSSSSSSSSSSSSSS', 'SdSSSSSSSSSSSSSS', 'SSSSSSSSSsSSSSSS', 'SSSSSSSSSSSSSSSS'
];
function shade(mask, outside) {
  const h = mask.length, w = mask[0].length;
  const land = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? outside : mask[y][x] === '#';
  return mask.map((row, y) => [...row].map((_, x) => {
    if (land(x, y)) {
      // South-facing bank only where open water continues below (not beside a one-pixel side notch).
      const open = dy => !land(x, y + dy) && !land(x, y + dy + 1) && (!land(x - 1, y + dy) || !land(x + 1, y + dy));
      if (open(1)) return 'D';
      if (open(2)) return 'd';
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!land(x + dx, y + dy)) return 'd';
      if (!land(x, y - 2) || !land(x - 2, y)) return 's';
      return texture[y % 16][x % 16];
    }
    let best = Infinity;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) if (land(x + dx, y + dy)) best = Math.min(best, Math.hypot(dx, dy));
    return best <= 1.5 ? '!' : best <= 2.5 ? '@' : best <= 3.5 ? '$' : '.';
  }).join(''));
}
const crop = (rows, x, y) => rows.slice(y, y + 8).map(row => row.slice(x, x + 8));
const shadedIsland = shade(island, false), shadedLake = shade(lake, true);
const symbols = {};
// Island tiles: TL(0,0) TR(1,0) BL(0,1) BR(1,1); quarter types follow from which neighbours are water.
const islandQuarters = {
  'tl-o': [0, 0], 'tr-h': [8, 0], 'bl-v': [0, 8], 'br-f': [8, 8],
  'tl-h': [16, 0], 'tr-o': [24, 0], 'bl-f': [16, 8], 'br-v': [24, 8],
  'tl-v': [0, 16], 'tr-f': [8, 16], 'bl-o': [0, 24], 'br-h': [8, 24],
  'tl-f': [16, 16], 'tr-v': [24, 16], 'bl-h': [16, 24], 'br-o': [24, 24]
};
for (const [key, [x, y]] of Object.entries(islandQuarters)) symbols[`q-${key}`] = crop(shadedIsland, x, y);
// Inner corners come from the sand tiles diagonal to the lake's water tile.
for (const [key, [x, y]] of Object.entries({ 'br-i': [8, 8], 'bl-i': [32, 8], 'tr-i': [8, 32], 'tl-i': [32, 32] })) symbols[`q-${key}`] = crop(shadedLake, x, y);
const phases = [
  { '!': 'tint1', '@': 'tint2', '$': 'foam-soft', duration: 240 },
  { '!': 'tint1', '@': 'w', '$': 'tint3', duration: 200 },
  { '!': 'w', '@': 'foam-soft', '$': 'tint3', duration: 260 },
  { '!': 'foam-soft', '@': 'tint2', '$': 'tint3', duration: 340 }
];
const frames = [], animations = {};
for (const mask of blobMasks()) {
  const q = quadrantsFor(mask), names = [];
  phases.forEach((phase, p) => {
    const name = `shore-${mask}-${p}`; names.push(name);
    frames.push({ name, duration: phase.duration, ops: [
      { op: 'stamp', symbol: `q-tl-${q.tl}`, x: 0, y: 0 }, { op: 'stamp', symbol: `q-tr-${q.tr}`, x: 8, y: 0 },
      { op: 'stamp', symbol: `q-bl-${q.bl}`, x: 0, y: 8 }, { op: 'stamp', symbol: `q-br-${q.br}`, x: 8, y: 8 },
      ...['!', '@', '$'].map(marker => ({ op: 'replace', from: marker, to: phase[marker] }))
    ] });
  });
  if (mask === 255) animations.interior = { frames: [names[0]] };
}
animations.foam = { frames: ['shore-0-0', 'shore-0-1', 'shore-0-2', 'shore-0-3'] };
const palette = {
  ...paletteFor(symbols, ['w']),
  '!': '#ff00f1', '@': '#ff00f2', '$': '#ff00f3',
  tint1: '#97e3e388', tint2: '#97e3e366', tint3: '#97e3e344', 'foam-soft': '#effcffaa'
};
writeJSON('art/recipes/shore.json', { version: 1, name: 'shore', width: 16, height: 16, palette, symbols, frames, animations, sheet: { columns: 16 } }, { force: process.argv.includes('--force') });
console.log('pieces', Object.keys(symbols).length, 'frames', frames.length);
