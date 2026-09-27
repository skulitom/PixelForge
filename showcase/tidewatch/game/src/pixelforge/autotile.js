// Browser-compatible autotile rules shared by scene tilemaps and the autotile compiler. No I/O.
// A tile is split into four quadrants. Each quadrant looks at two orthogonal neighbours and the diagonal between
// them, and becomes one of five pieces: o (outer corner), h (horizontal edge), v (vertical edge), i (inner corner)
// or f (fill). Masks use N=1, NE=2, E=4, SE=8, S=16, SW=32, W=64, NW=128 for "blob" (47 reduced masks) and
// N=1, E=2, S=4, W=8 for "cardinal" (16 masks, no inner corners).
export const BLOB_BITS = { n: 1, ne: 2, e: 4, se: 8, s: 16, sw: 32, w: 64, nw: 128 };
export const CARDINAL_BITS = { n: 1, e: 2, s: 4, w: 8 };
export const QUADRANTS = { tl: ['n', 'w', 'nw'], tr: ['n', 'e', 'ne'], bl: ['s', 'w', 'sw'], br: ['s', 'e', 'se'] };
const OFFSETS = { n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0], nw: [-1, -1] };

// A diagonal only counts when both adjacent orthogonals match, so 256 raw masks reduce to 47.
export function reduceBlobMask(mask) {
  let out = mask & (BLOB_BITS.n | BLOB_BITS.e | BLOB_BITS.s | BLOB_BITS.w);
  for (const [d, a, b] of [['ne', 'n', 'e'], ['se', 's', 'e'], ['sw', 's', 'w'], ['nw', 'n', 'w']]) {
    if ((mask & BLOB_BITS[d]) && (mask & BLOB_BITS[a]) && (mask & BLOB_BITS[b])) out |= BLOB_BITS[d];
  }
  return out;
}
export const BLOB_MASKS = Object.freeze([...new Set(Array.from({ length: 256 }, (_, m) => reduceBlobMask(m)))].sort((a, b) => a - b));
export const CARDINAL_MASKS = Object.freeze(Array.from({ length: 16 }, (_, m) => m));

// `matches(dx, dy)` answers whether the neighbour at that offset belongs to the same terrain.
export function neighbourMask(mode, matches) {
  if (mode === 'cardinal') return Object.entries(CARDINAL_BITS).reduce((mask, [key, bit]) => mask | (matches(...OFFSETS[key]) ? bit : 0), 0);
  return reduceBlobMask(Object.entries(BLOB_BITS).reduce((mask, [key, bit]) => mask | (matches(...OFFSETS[key]) ? bit : 0), 0));
}
export function quadrantPieces(mode, mask) {
  const has = key => mode === 'cardinal' ? (mask & (CARDINAL_BITS[key] ?? 0)) !== 0 : (mask & BLOB_BITS[key]) !== 0;
  return Object.fromEntries(Object.entries(QUADRANTS).map(([position, [a, b, diagonal]]) => {
    if (!has(a) && !has(b)) return [position, 'o'];
    if (!has(a)) return [position, 'h'];
    if (!has(b)) return [position, 'v'];
    return [position, mode !== 'cardinal' && !has(diagonal) ? 'i' : 'f'];
  }));
}
// Template layout (tile T, quarter Q = T/2), two tiles wide and three tall:
//   row 0: [unused preview][inner corners: each quadrant is that quadrant's inner-corner piece]
//   rows 1-2: a 2x2-tile island whose quadrants supply outer corners, edges and fill.
// Returns the template's top-left pixel for a quadrant position and piece type.
const ISLAND = { tl: { o: [0, 0], h: [1, 0], v: [0, 1], f: [1, 1] }, tr: { o: [1, 0], h: [0, 0], v: [1, 1], f: [0, 1] }, bl: { o: [0, 1], h: [1, 1], v: [0, 0], f: [1, 0] }, br: { o: [1, 1], h: [0, 1], v: [1, 0], f: [0, 0] } };
const QUARTER = { tl: [0, 0], tr: [1, 0], bl: [0, 1], br: [1, 1] };
export function templatePiece(tile, position, piece) {
  const q = tile / 2, [qx, qy] = QUARTER[position];
  if (piece === 'i') return [tile + qx * q, qy * q];
  const [tx, ty] = ISLAND[position][piece];
  return [tx * tile + qx * q, tile + ty * tile + qy * q];
}
