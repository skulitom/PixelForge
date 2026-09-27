import { writeFile, mkdir } from 'node:fs/promises';
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
await mkdir(new URL('../examples/', import.meta.url), { recursive: true });
for (const project of [forest, ember, coin]) await writeFile(new URL(`../examples/${project.name}.json`, import.meta.url), JSON.stringify(project, null, 2) + '\n');
