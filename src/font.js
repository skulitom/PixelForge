// Browser-compatible built-in pixel font for the `text` drawing operation: printable ASCII, capitals 7 pixels tall,
// lowercase 5, descenders 1 below the baseline, so a line is 8 rows. Letters and punctuation are as wide as their
// ink (1 to 5 pixels); digits are all 5 wide so that counters and timers do not jitter. The letter, digit and basic
// punctuation shapes come from the Tidewatch showcase font; all of it is original PixelForge artwork.
const SHAPES = {
  A: '.###.|#...#|#...#|#####|#...#|#...#|#...#', B: '####.|#...#|#...#|####.|#...#|#...#|####.', C: '.###.|#...#|#....|#....|#....|#...#|.###.',
  D: '####.|#...#|#...#|#...#|#...#|#...#|####.', E: '#####|#....|#....|####.|#....|#....|#####', F: '#####|#....|#....|####.|#....|#....|#....',
  G: '.###.|#...#|#....|#.###|#...#|#...#|.####', H: '#...#|#...#|#...#|#####|#...#|#...#|#...#', I: '.###.|..#..|..#..|..#..|..#..|..#..|.###.',
  J: '..###|...#.|...#.|...#.|...#.|#..#.|.##..', K: '#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#', L: '#....|#....|#....|#....|#....|#....|#####',
  M: '#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#', N: '#...#|##..#|#.#.#|#..##|#...#|#...#|#...#', O: '.###.|#...#|#...#|#...#|#...#|#...#|.###.',
  P: '####.|#...#|#...#|####.|#....|#....|#....', Q: '.###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#', R: '####.|#...#|#...#|####.|#.#..|#..#.|#...#',
  S: '.###.|#...#|#....|.###.|....#|#...#|.###.', T: '#####|..#..|..#..|..#..|..#..|..#..|..#..', U: '#...#|#...#|#...#|#...#|#...#|#...#|.###.',
  V: '#...#|#...#|#...#|#...#|#...#|.#.#.|..#..', W: '#...#|#...#|#...#|#.#.#|#.#.#|##.##|#...#', X: '#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#',
  Y: '#...#|#...#|.#.#.|..#..|..#..|..#..|..#..', Z: '#####|....#|...#.|..#..|.#...|#....|#####',
  a: '.....|.....|.###.|....#|.####|#...#|.####', b: '#....|#....|####.|#...#|#...#|#...#|####.', c: '.....|.....|.###.|#....|#....|#...#|.###.',
  d: '....#|....#|.####|#...#|#...#|#...#|.####', e: '.....|.....|.###.|#...#|#####|#....|.###.', f: '..##.|.#...|####.|.#...|.#...|.#...|.#...',
  g: '.....|.....|.####|#...#|#...#|.####|....#|.###.', h: '#....|#....|####.|#...#|#...#|#...#|#...#', i: '..#..|.....|.##..|..#..|..#..|..#..|.###.',
  j: '...#.|.....|..##.|...#.|...#.|...#.|#..#.|.##..', k: '#....|#....|#..#.|#.#..|##...|#.#..|#..#.', l: '.##..|..#..|..#..|..#..|..#..|..#..|.###.',
  m: '.....|.....|##.#.|#.#.#|#.#.#|#.#.#|#...#', n: '.....|.....|####.|#...#|#...#|#...#|#...#', o: '.....|.....|.###.|#...#|#...#|#...#|.###.',
  p: '.....|.....|####.|#...#|#...#|####.|#....|#....', q: '.....|.....|.####|#...#|#...#|.####|....#|....#', r: '.....|.....|#.##.|##..#|#....|#....|#....',
  s: '.....|.....|.####|#....|.###.|....#|####.', t: '.#...|.#...|####.|.#...|.#...|.#..#|..##.', u: '.....|.....|#...#|#...#|#...#|#..##|.##.#',
  v: '.....|.....|#...#|#...#|#...#|.#.#.|..#..', w: '.....|.....|#...#|#...#|#.#.#|#.#.#|.#.#.', x: '.....|.....|#...#|.#.#.|..#..|.#.#.|#...#',
  y: '.....|.....|#...#|#...#|#...#|.####|....#|.###.', z: '.....|.....|#####|...#.|..#..|.#...|#####',
  0: '.###.|#...#|#..##|#.#.#|##..#|#...#|.###.', 1: '..#..|.##..|..#..|..#..|..#..|..#..|.###.', 2: '.###.|#...#|....#|...#.|..#..|.#...|#####',
  3: '#####|...#.|..#..|...#.|....#|#...#|.###.', 4: '...#.|..##.|.#.#.|#..#.|#####|...#.|...#.', 5: '#####|#....|####.|....#|....#|#...#|.###.',
  6: '..##.|.#...|#....|####.|#...#|#...#|.###.', 7: '#####|....#|...#.|..#..|.#...|.#...|.#...', 8: '.###.|#...#|#...#|.###.|#...#|#...#|.###.',
  9: '.###.|#...#|#...#|.####|....#|...#.|.##..',
  '.': '.|.|.|.|.|.|#', ',': '..|..|..|..|..|.#|.#|#.', '!': '#|#|#|#|#|.|#', '?': '.###.|#...#|....#|...#.|..#..|.....|..#..',
  "'": '#|#|.', '-': '....|....|....|####|....|....|....', ':': '.|.|#|.|.|#|.', ';': '..|..|.#|..|..|.#|.#|#.',
  '(': '.#|#.|#.|#.|#.|#.|.#', ')': '#.|.#|.#|.#|.#|.#|#.', '/': '....#|...#.|...#.|..#..|.#...|.#...|#....', '"': '#.#|#.#|...',
  '+': '.....|.....|..#..|.###.|..#..|.....|.....', '*': '.....|#.#.#|.###.|#####|.###.|#.#.#|.....',
  '#': '.#.#.|.#.#.|#####|.#.#.|#####|.#.#.|.#.#.', $: '..#..|.####|#.#..|.###.|..#.#|####.|..#..', '%': '##..#|##.#.|...#.|..#..|.#...|.#.##|#..##',
  '&': '.##..|#..#.|#.#..|.#...|#.#.#|#..#.|.##.#', '<': '...#|..#.|.#..|#...|.#..|..#.|...#', '=': '....|....|####|....|####|....|....',
  '>': '#...|.#..|..#.|...#|..#.|.#..|#...', '@': '.###.|#...#|#.###|#.#.#|#.###|#....|.###.', '[': '##|#.|#.|#.|#.|#.|##',
  '\\': '#....|.#...|.#...|..#..|...#.|...#.|....#', ']': '##|.#|.#|.#|.#|.#|##', '^': '.#.|#.#|...', _: '....|....|....|....|....|....|....|####',
  '`': '#.|.#|..', '{': '..#|.#.|.#.|#..|.#.|.#.|..#', '|': '#|#|#|#|#|#|#', '}': '#..|.#.|.#.|..#|.#.|.#.|#..', '~': '.....|.....|.##.#|#.##.|.....|.....|.....'
};
export const FONT_HEIGHT = 8, FONT_CAP_HEIGHT = 7, FONT_SPACE = 3;
const GLYPHS = new Map([[' ', { width: FONT_SPACE, rows: Array(FONT_HEIGHT).fill('.'.repeat(FONT_SPACE)) }]]);
for (const [character, shape] of Object.entries(SHAPES)) {
  const drawn = shape.split('|'), full = Math.max(...drawn.map(row => row.length));
  let rows = Array.from({ length: FONT_HEIGHT }, (_, y) => (drawn[y] ?? '').padEnd(full, '.'));
  // Trim to the ink, except for digits, which stay tabular.
  if (!/\d/.test(character)) {
    const inked = Array.from({ length: full }, (_, x) => rows.some(row => row[x] === '#')), left = inked.indexOf(true), right = inked.lastIndexOf(true);
    rows = rows.map(row => row.slice(left, right + 1));
  }
  GLYPHS.set(character, { width: rows[0].length, rows });
}
// Every character the font can draw, in code order.
export const FONT_CHARACTERS = [...GLYPHS.keys()].sort().join('');

// Lays text out as rows of "#" and ".". Lines are split at "\n"; `spacing` is the gap between glyphs, `lineHeight` the
// distance from one line's top to the next, and `align` how shorter lines sit in the block. `reject(message)` is
// called for text the font cannot draw and must throw.
export function layoutText(text, { spacing = 1, lineHeight = 10, align = 'left' } = {}, reject = message => { throw new Error(message); }) {
  const lines = text.split('\n').map(line => {
    const glyphs = [...line].map(character => GLYPHS.get(character) ?? reject(`no glyph for ${JSON.stringify(character)}; the built-in font draws printable ASCII (letters, digits and ${'!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'}) and line breaks`));
    return { text: line, glyphs, width: glyphs.reduce((sum, glyph) => sum + glyph.width, 0) + spacing * Math.max(0, glyphs.length - 1) };
  });
  const width = Math.max(1, ...lines.map(line => line.width)), height = (lines.length - 1) * lineHeight + FONT_HEIGHT, cells = Array.from({ length: height }, () => Array(width).fill('.'));
  for (const [index, line] of lines.entries()) {
    let x = align === 'center' ? Math.floor((width - line.width) / 2) : align === 'right' ? width - line.width : 0;
    for (const glyph of line.glyphs) {
      for (let y = 0; y < FONT_HEIGHT; y++) for (let i = 0; i < glyph.width; i++) if (glyph.rows[y][i] === '#') cells[index * lineHeight + y][x + i] = '#';
      x += glyph.width + spacing;
    }
  }
  return { width, height, rows: cells.map(row => row.join('')), lines: lines.map(line => ({ text: line.text, width: line.width })) };
}
// The size a text block will have, for placing it: { width, height, lines: [{ text, width }] }.
export function measureText(text, options) { const { width, height, lines } = layoutText(text, options); return { width, height, lines }; }
