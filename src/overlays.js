// Node-side provenance for authored corrections. Source recipes stay ordinary version-1 JSON.
import { createHash } from 'node:crypto';
import { PixelError, renderProject, compareProjects } from './core.js';
import { patchRecipe } from './patch.js';

// Key ordering/formatting changes are harmless; drawing/list order remains significant.
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const recipeFingerprint = recipe => createHash('sha256').update(JSON.stringify(canonical(recipe))).digest('hex');
export function createOverlay(recipe, changes, selections = {}) {
  const overlay = { format: 'pixelforge-overlay', version: 1, base: recipeFingerprint(recipe), selections: structuredClone(selections), changes: structuredClone(changes) };
  applyOverlay(recipe, overlay); return overlay;
}
export function applyOverlay(recipe, overlay) {
  const fail = message => { throw new PixelError('overlay', message); };
  if (!overlay || Array.isArray(overlay) || overlay.format !== 'pixelforge-overlay' || overlay.version !== 1) fail('expected a version-1 pixelforge-overlay');
  for (const key of Object.keys(overlay)) if (!['format', 'version', 'base', 'selections', 'changes'].includes(key)) fail(`unknown field ${key}`);
  if (overlay.base !== recipeFingerprint(recipe)) fail('base fingerprint conflict; the generated recipe changed. Inspect the new base and author a new overlay; old coordinates were not applied.');
  if (!Array.isArray(overlay.changes) || !overlay.changes.length || overlay.changes.length > 1024) fail('expected 1–1024 changes');
  const selections = overlay.selections ?? {};
  if (!selections || typeof selections !== 'object' || Array.isArray(selections)) fail('selections must be a map of named canvas regions');
  for (const [name, selection] of Object.entries(selections)) {
    if (!selection || Array.isArray(selection) || selection.space !== 'canvas' || Object.keys(selection).some(key => !['space', 'x', 'y', 'w', 'h', 'mask'].includes(key))) fail(`selection ${name} must be a canvas region with space, x, y, w, h and optional mask`);
    if (!['x', 'y', 'w', 'h'].every(key => Number.isInteger(selection[key])) || selection.x < 0 || selection.y < 0 || selection.w < 1 || selection.h < 1 || selection.x + selection.w > recipe.width || selection.y + selection.h > recipe.height) fail(`selection ${name} must fit the canvas`);
    if (selection.mask !== undefined && (!Array.isArray(selection.mask) || selection.mask.length !== selection.h || selection.mask.some(row => typeof row !== 'string' || row.length !== selection.w || /[^x.]/.test(row)))) fail(`selection ${name} has an invalid mask`);
  }
  const changes = overlay.changes.map(change => {
    if (!change || typeof change !== 'object' || Array.isArray(change)) fail('each change must be an object');
    if (change.selection === undefined) return change;
    if (typeof change.selection !== 'string' || !Object.hasOwn(selections, change.selection)) fail(`unknown selection ${JSON.stringify(change.selection)}`);
    if (!['grid', 'move', 'recolor'].some(verb => Object.hasOwn(change, verb))) fail('named selections apply to grid, move or recolor changes');
    const { selection, ...edit } = change, { space, w, h, ...region } = selections[selection];
    return { ...edit, value: { ...region, ...(!change.grid && { w, h }), ...change.value } };
  });
  const before = renderProject(recipe), result = patchRecipe(recipe, changes), after = renderProject(result.recipe);
  return { ...result, base: overlay.base, fingerprint: recipeFingerprint(result.recipe), report: compareProjects(before, after) };
}
