#!/usr/bin/env node
// Checks a benchmark run against its brief's machine criteria and prints the results as JSON.
// Usage: node benchmark/check.mjs <brief.json> <output.json | output.png> [--atlas atlas.json]
// The output is a PixelForge recipe, or a native-size PNG (a sprite sheet with an unscaled atlas, frames keyed by name
// with durations and optional `animations`; Aseprite's meta.frameTags also work). Exit code 1 when a check fails.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { renderProject } from '../src/core.js';
import { importPNG } from '../src/import.js';
import { resolveReferences } from '../src/resolve.js';
import { checkRun, briefProblems, animationsFromTags } from './checks.mjs';

const usage = 'usage: node benchmark/check.mjs <brief.json> <output.json|output.png> [--atlas atlas.json]';
const readJSON = async file => JSON.parse(await readFile(file, 'utf8'));
async function renderRecipe(file) {
  const recipe = await readJSON(file);
  const { document } = await resolveReferences(recipe, { baseDir: path.dirname(path.resolve(file)) });
  return renderProject(document);
}
// Frame names from other editors ("walk 0.png") become portable PixelForge names; atlas animations follow them.
function portableNames(atlas) {
  const renamed = new Map(), used = new Set();
  for (const name of Object.keys(atlas.frames)) {
    let clean = name.replace(/\.[a-z]+$/i, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^[^a-zA-Z]+/, '').slice(0, 60) || 'frame';
    for (let n = 2; used.has(clean); n++) clean = `${clean.replace(/-\d+$/, '')}-${n}`;
    used.add(clean); renamed.set(name, clean);
  }
  const frames = Object.fromEntries(Object.entries(atlas.frames).map(([name, entry]) => [renamed.get(name), entry]));
  const animations = atlas.animations && Object.fromEntries(Object.entries(atlas.animations).map(([key, value]) => [key, { ...value, frames: value.frames.map(name => renamed.get(name) ?? name) }]));
  return { ...atlas, frames, ...(animations && { animations }) };
}

try {
  const args = process.argv.slice(2), at = args.indexOf('--atlas');
  const atlasFile = at === -1 ? undefined : args.splice(at, 2)[1];
  if (args.length !== 2 || (at !== -1 && !atlasFile)) throw new Error(usage);
  const [briefFile, outputFile] = args, brief = await readJSON(briefFile);
  const problems = briefProblems(brief);
  if (problems.length) throw new Error(`${briefFile}: ${problems.join('; ')}`);
  let project;
  if (/\.png$/i.test(outputFile)) {
    const atlas = atlasFile && portableNames(animationsFromTags(await readJSON(atlasFile)));
    project = renderProject(importPNG(await readFile(outputFile), { name: 'run', ...(atlas && { atlas }) }).recipe);
  } else project = await renderRecipe(outputFile);
  const base = brief.setup.base && await renderRecipe(path.resolve(path.dirname(briefFile), brief.setup.base));
  const report = checkRun(brief, project, { base });
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exitCode = report.failed ? 1 : 0;
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
