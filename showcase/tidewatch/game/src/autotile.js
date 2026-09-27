// Blob (47-tile) autotiling shared by the recipe scaffolds, map previews and the game.
// A tile is split into four 8x8 quadrants; each quadrant looks at two orthogonal neighbors and one diagonal.
export const QUADRANTS = {
  tl: ['n', 'w', 'nw'], tr: ['n', 'e', 'ne'], bl: ['s', 'w', 'sw'], br: ['s', 'e', 'se']
};
export const BITS = { n: 1, ne: 2, e: 4, se: 8, s: 16, sw: 32, w: 64, nw: 128 };
export function quadrantType(has, [a, b, diagonal]) {
  if (!has(a) && !has(b)) return 'o';
  if (!has(a)) return 'h';
  if (!has(b)) return 'v';
  if (!has(diagonal)) return 'i';
  return 'f';
}
// Reduce an 8-neighbour mask so diagonals only count when both adjacent orthogonals are set.
export function reduceMask(mask) {
  let out = mask & (BITS.n | BITS.e | BITS.s | BITS.w);
  for (const [d, a, b] of [['ne', 'n', 'e'], ['se', 's', 'e'], ['sw', 's', 'w'], ['nw', 'n', 'w']]) {
    if ((mask & BITS[d]) && (mask & BITS[a]) && (mask & BITS[b])) out |= BITS[d];
  }
  return out;
}
export function quadrantsFor(mask) {
  const has = key => (mask & BITS[key]) !== 0;
  return Object.fromEntries(Object.entries(QUADRANTS).map(([pos, keys]) => [pos, quadrantType(has, keys)]));
}
export const blobMasks = () => [...new Set(Array.from({ length: 256 }, (_, m) => reduceMask(m)))].sort((a, b) => a - b);
export function maskAt(grid, x, y, isSame) {
  let mask = 0;
  const at = (dx, dy) => isSame(grid, x + dx, y + dy);
  if (at(0, -1)) mask |= BITS.n; if (at(1, -1)) mask |= BITS.ne; if (at(1, 0)) mask |= BITS.e; if (at(1, 1)) mask |= BITS.se;
  if (at(0, 1)) mask |= BITS.s; if (at(-1, 1)) mask |= BITS.sw; if (at(-1, 0)) mask |= BITS.w; if (at(-1, -1)) mask |= BITS.nw;
  return reduceMask(mask);
}
