// Shared helpers for the Tidewatch showcase. Recipes written by these helpers are ordinary
// PixelForge version-1 JSON and remain the authoritative, hand-editable source.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const root = fileURLToPath(new URL('..', import.meta.url));
export const palette = JSON.parse(readFileSync(path.join(root, 'art/palette.json'), 'utf8'));

// PixelForge has no palette include, so each recipe carries the subset of the shared palette it uses.
export function paletteFor(...sources) {
  // Scan only grid characters (string values), never object keys such as symbol names.
  const strings = [];
  const walk = value => { if (typeof value === 'string') strings.push(value); else if (value && typeof value === 'object') Object.values(value).forEach(walk); };
  sources.forEach(walk);
  const text = strings.join('');
  const used = new Set();
  for (const [key] of Object.entries(palette)) {
    if (text.includes(key)) used.add(key);
  }
  return Object.fromEntries(Object.entries(palette).filter(([key]) => used.has(key)));
}
export function writeJSON(file, value, { force = false } = {}) {
  const target = path.resolve(root, file);
  if (existsSync(target) && !force) throw new Error(`Refusing to overwrite ${target}; pass force`);
  writeFileSync(target, JSON.stringify(value, null, 2) + '\n');
  return target;
}
