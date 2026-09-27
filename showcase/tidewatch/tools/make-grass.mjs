// One-time scaffold: hand-drawn turf masks -> shaded 8x8 quarters -> 47 blob tiles of grass over sand (transparent outside).
// After generation, art/recipes/grass.json is the authoritative, editable source.
import { paletteFor, writeJSON } from './common.mjs';
import { blobMasks, quadrantsFor } from './autotile.mjs';

// Turf inset 3px with 1px recessions placed away from quarter boundaries.
const island = [
  '................................', '................................', '................................', '......##########..########......',
  '....######..################....', '...##########################...', '...##########################...', '...##########################...',
  '...##########################...', '....#########################...', '....#########################...', '...##########################...',
  '...#########################....', '...#########################....', '...##########################...', '...##########################...',
  '...##########################...', '...##########################...', '...##########################...', '...#########################....',
  '....########################....', '....#########################...', '...##########################...', '...##########################...',
  '...##########################...', '...##########################...', '...##########################...', '....########################....',
  '......########..####..######....', '................................', '................................', '................................'
];
const lake = Array.from({ length: 48 }, (_, y) => Array.from({ length: 48 }, (_, x) => {
  const inside = x >= 13 && x <= 34 && y >= 13 && y <= 34;
  const cx = x < 24 ? x - 13 : 34 - x, cy = y < 24 ? y - 13 : 34 - y;
  const rounded = (cy === 0 && cx < 2) || (cx === 0 && cy < 2);
  return inside && !rounded ? '.' : '#';
}).join(''));
const texture = [
  'hhhhhhhhhhhhhhhh', 'hhhhhhhhhhjhhhhh', 'hhjhhhhhhhhjhhhh', 'hhhjhhhhhhhhhhhh',
  'hhhhhhhhhhhhhhgh', 'hhhhhhhjhhhhhhhh', 'hhhhhhjhjhhhhhhh', 'hghhhhhhhhhhhhhh',
  'hhhhhhhhhhhhhhhh', 'hhhhhhhhhhhhjhhh', 'hhhhjhhhhhhjhhhh', 'hhhhhjhhhhhhhhhh',
  'hhhhhhhhhgghhhhh', 'hhhhhhhhhhhhhhhh', 'hjhhhhhhhhhhhhjh', 'hhjhhhhhhhhhhhhj'
];
function shade(mask, outside) {
  const h = mask.length, w = mask[0].length;
  const land = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? outside : mask[y][x] === '#';
  return mask.map((row, y) => [...row].map((_, x) => {
    if (land(x, y)) {
      if (!land(x, y + 1)) return 'g';
      if (!land(x + 1, y)) return 'g';
      if (!land(x, y - 1) || !land(x - 1, y)) return 'j';
      if (!land(x - 1, y - 1) || !land(x + 1, y + 1)) return !land(x + 1, y + 1) ? 'g' : 'j';
      return texture[y % 16][x % 16];
    }
    // Outside the turf: blades on the sunlit north edge, a cast shadow on the south edge.
    if (land(x, y + 1) && land(x, y + 2) && [1, 2, 5, 9, 10, 13].includes(x % 16)) return x % 4 === 1 ? 'l' : 'j';
    if (land(x, y + 2) && land(x, y + 3) && land(x, y + 1) === false && [2, 10].includes(x % 16)) return 'l';
    if (land(x, y - 1)) return '_';
    if (land(x + 1, y) && [4, 11].includes(y % 16)) return 'j';
    return '.';
  }).join(''));
}
const crop = (rows, x, y) => rows.slice(y, y + 8).map(row => row.slice(x, x + 8));
const shadedIsland = shade(island, false), shadedLake = shade(lake, true);
const symbols = {};
const islandQuarters = {
  'tl-o': [0, 0], 'tr-h': [8, 0], 'bl-v': [0, 8], 'br-f': [8, 8],
  'tl-h': [16, 0], 'tr-o': [24, 0], 'bl-f': [16, 8], 'br-v': [24, 8],
  'tl-v': [0, 16], 'tr-f': [8, 16], 'bl-o': [0, 24], 'br-h': [8, 24],
  'tl-f': [16, 16], 'tr-v': [24, 16], 'bl-h': [16, 24], 'br-o': [24, 24]
};
for (const [key, [x, y]] of Object.entries(islandQuarters)) symbols[`q-${key}`] = crop(shadedIsland, x, y);
for (const [key, [x, y]] of Object.entries({ 'br-i': [8, 8], 'bl-i': [32, 8], 'tr-i': [8, 32], 'tl-i': [32, 32] })) symbols[`q-${key}`] = crop(shadedLake, x, y);
const frames = blobMasks().map(mask => {
  const q = quadrantsFor(mask);
  return { name: `grass-${mask}`, ops: [
    { op: 'stamp', symbol: `q-tl-${q.tl}`, x: 0, y: 0 }, { op: 'stamp', symbol: `q-tr-${q.tr}`, x: 8, y: 0 },
    { op: 'stamp', symbol: `q-bl-${q.bl}`, x: 0, y: 8 }, { op: 'stamp', symbol: `q-br-${q.br}`, x: 8, y: 8 }
  ] };
});
const palette = paletteFor(symbols);
writeJSON('art/recipes/grass.json', { version: 1, name: 'grass', width: 16, height: 16, palette, symbols, frames, animations: { tiles: { frames: frames.map(f => f.name) } }, sheet: { columns: 16 } }, { force: process.argv.includes('--force') });
console.log('pieces', Object.keys(symbols).length, 'frames', frames.length, 'palette', Object.keys(palette).join(''));
