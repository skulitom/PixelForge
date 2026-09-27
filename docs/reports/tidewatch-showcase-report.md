# Tidewatch: stretching PixelForge on a top-down game

27 September 2026 · Baseline `1e47c22` (0.1.0) · Windows 11, Node v24.19.0 · Browser checks in the Chromium pane of the Claude desktop app.

## Summary

I built [Tidewatch](../../showcase/tidewatch/README.md), a small top-down action-adventure, to find where PixelForge helps and where it runs out. Everything visual is PixelForge output:

- 29 recipes and 2 pose sources, giving 527 frames and 77 animations.
- A 47-tile blob autotile set for sand and one for grass.
- Palette-cycled surf.
- A pose-compiled keeper (40 poses, four facings) and a pose-compiled crab.
- Normal and emissive passes for the buildings.
- Effects and a 76-glyph font.

The browser game reads PixelForge atlases directly, including the pose markers that set the sword's reach, and composites the material passes into dusk and night lighting.

**Verdict.** PixelForge handled every pixel I asked it to. Its core was reliable: rendering, exports, PNG import, patch reports and error paths. I found no rendering or export bugs. The gaps are at the edges an agent hits when making a *game* rather than a sprite: tilemaps and autotiles, pivots and per-frame metadata, trimmed atlases, shared or animated palettes, outlines, scene lighting, and parts of the MCP surface. The workarounds are in the showcase's `tools/` and `game/src`, and each one is recorded below.

| | Count | Highest severity |
| --- | --- | --- |
| Bugs (reproduced) | 4 | P2: the MCP server exits on an oversized message |
| Suspected bug | 1 | P3: `SpritePlayer.load` can wait forever on `image.decode()` |
| Missing features | 10 | Tilemaps/autotiles, pivots, trimming |
| Friction points | 5 | — |

The five changes that would have saved the most work, in order:

1. Keep the MCP server alive on oversized input and align its limit with the format.
2. Add a tilemap layer to scenes, plus a region copy for autotile templates.
3. Add pivots and free-form per-frame points to plain recipes and the atlas.
4. Offer trimmed atlas export, since the format already has `trimmed`/`spriteSourceSize`.
5. Support a shared palette file plus palette cycling or remap.

## What held up well

- **Deterministic, fast export.** All 29 recipes export to atlases, aligned passes and APNG previews in about 0.8 s. The committed exports are verified against the recipes in CI (`npm run check:tidewatch`, in `test/tidewatch.test.js`).
- **Error messages an agent can act on.** Examples: `project.frames[1].ops[0].rows[9]: all rows must be 32 characters wide`, and `changes[0].value.rows[1]: unknown palette character "x"`. Each pointed at the exact row or patch.
- **Pose compiler.** Attachment points made the walk cycle cheap: legs expose a hip point and the torso a neck point, so passing poses lift the whole upper body. A sword-arm part attaches at a shoulder point. The compiled `hit` markers became the game's attack hitbox with no measuring by hand. A bad item-get pose was fixed in the pose source and recompiled in seconds.
- **MCP revisions and patches.**
  - Revision ids are content-derived and stable across server restarts.
  - A 5-pixel `grid` patch reported exactly those 5 pixels, with `scope: "frame"` protecting other frames.
  - Onion views and diagnostics caught two crab walk frames that duplicated idle frames.
- **Lossless PNG import.** The 40-frame keeper atlas and the lighthouse normal atlas round-trip with identical RGBA, durations and all 14 animations, in 64 ms.
- **Material passes.** Aligned normal and emissive recipes worked unchanged in a custom renderer. PixelForge's alignment check matches frame names, durations, animations and sizes, which caught mistakes early.

## Bugs

### TW-B1 — P2: an oversized MCP message terminates the server

**Area:** `src/mcp.js` read loop. **Status:** reproduced.

`startMCP` throws `MCP message exceeds 2 MiB` inside the `for await` loop. That rejects the whole server promise, so the CLI prints `{"ok":false,"error":"MCP message exceeds 2 MiB"}` to stderr and exits with code 1. The offending request never gets a JSON-RPC reply, and the client's next write fails with EOF.

```js
// Node, from the repo root. A single 2.3 MB pixel_validate call:
import { spawn } from 'node:child_process';
const s = spawn(process.execPath, ['bin/pixelforge.js', 'mcp', '--out', 'output/mcp'], { stdio: ['pipe', 'pipe', 'pipe'] });
s.on('exit', code => console.log('exit', code));            // → exit 1
const send = m => s.stdin.write(JSON.stringify(m) + '\n');
send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
const pixels = Array.from({ length: 65536 }, (_, i) => ({ x: i % 256, y: i >> 8, color: '#123456' }));
send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'pixel_validate', arguments: { project: { version: 1, name: 'big', width: 256, height: 256, frames: [{ name: 'a', pixels }] } } } });
```

**Expected:** a JSON-RPC error for id 2, such as `-32600` with the size limit, after which the server keeps serving. **Suggested fix:** when a line exceeds the cap, discard it up to the next newline, reply with an error (using the id if it can be recovered cheaply, otherwise `null`), and continue the loop. Add a regression test: an oversized line, then a `ping` that still succeeds.

### TW-B2 — P3: the recipe format allows requests the MCP transport rejects

**Area:** limits in `src/core.js` and `src/import.js` versus `src/mcp.js`. **Status:** reproduced.

The format accepts 65,536 `pixels` corrections per frame. One such frame serializes to about 2.3 MB, which is over the 2 MiB MCP line limit. The same happens after PNG import: a 256×256 image with more than 80 colours imports as explicit pixels, and wrapping that recipe in a `pixel_validate` call makes a **2.43 MB** message. Imported editor art at the maximum canvas therefore cannot enter the MCP workflow, and given TW-B1, trying it kills the server.

**Suggested fix:** either raise the transport cap above what the format can express (a 256×256 frame of explicit pixels is roughly 2.5 MB; 16 MiB would cover realistic multi-frame imports), or document the cap next to the format limits and have `import` warn when its output exceeds it.

### TW-B3 — P3: `inspectTile` reports seams backwards

**Area:** `src/scene.js` `inspectTile`. **Status:** reproduced.

The helper flags rows and columns whose first and last pixels differ. Repeating tiles don't need identical opposite edges, and identical edges often cause the visible seam: two touching copies of the same edge column double up.

```js
import { renderProject, inspectTile } from './src/index.js';
const tile = ops => renderProject({ version: 1, name: 't', width: 8, height: 8, palette: { g: '#4a9a4a', k: '#1b1528' }, frames: [{ name: 't', ops: [{ op: 'rect', w: 8, h: 8, color: 'g' }, ...ops] }] });
// A dark line on both edges repeats as an obvious 2px seam, yet reports nothing:
inspectTile(tile([{ op: 'line', x: 0, y: 0, x2: 0, y2: 7, color: 'k' }, { op: 'line', x: 7, y: 0, x2: 7, y2: 7, color: 'k' }])).mismatches; // { horizontal: [], vertical: [] }
// A seamless tile with one short stroke touching the left edge is flagged:
inspectTile(tile([{ op: 'pixel', x: 0, y: 3, color: 'k' }, { op: 'pixel', x: 1, y: 3, color: 'k' }])).mismatches; // { horizontal: [3], vertical: [] }
```

The same false positive appeared on Tidewatch's water tiles. The helper is also unreachable from the CLI and MCP. **Suggested fix:** keep the 3×3 repeat image, which is the useful part, and replace `mismatches` with evidence that means something. For example, report *doubled edges* (identical opposite columns or rows that also differ from their inner neighbours) and *edge contrast* (large colour jumps across the wrap), clearly labelled as heuristics. Expose it as `inspect --tile` and `pixel_inspect { tile: true }`.

### TW-B4 — P3: clipping warnings carry no location

**Area:** `src/core.js` `put()` and `warnings`. **Status:** reproduced.

Every clip anywhere in a recipe collapses into one string, `Some drawing falls outside the canvas and is clipped.`, with no frame, operation path or pixel count. A single stray pixel in one of 12 water frames took manual arithmetic to find. The rest of PixelForge reports exact paths (`project.frames[2].ops[0]`), so this stands out.

**Suggested fix:** keep the deduplicated message for humans, and add a bounded `clipped` list to the render result and the `validate`/`inspect` output, e.g. `[{ path: 'project.frames[2].ops[0]', pixels: 1 }]`.

### TW-B5 — P3, suspected: `SpritePlayer.load` can wait forever on `image.decode()`

**Area:** `src/runtime.js` (the exported `player.js`). **Status:** observed in the game's own loader, which used the same pattern; not reproduced in a normal foreground tab.

In the desktop app's hidden browser pane, `await image.decode()` stayed pending until something forced a paint. The page never finished loading until a screenshot was taken. Switching the loader to `onload`/`onerror` fixed it immediately. Background tabs in some browsers may behave the same way. **Suggested fix:** resolve on `load`/`error` (optionally calling `decode()` afterwards without awaiting it for rendering).

## Missing features

Ranked by how much each cost while building a tile-based game. Each item names the demo need, the workaround used, and a suggested shape for the feature.

### TW-M1 — Tilemaps and autotile authoring

- **Need:** a 40×32 island with water, sand and grass layers.
- **Limits hit:**
  - Scenes allow **256 placement declarations**, but a single 240×160 screen with three tile layers needs about 310.
  - `repeat` only covers uniform rectangles.
  - There is no way to copy a sub-rectangle of a symbol or earlier frame. The standard autotile workflow (draw one small island and one lake, then slice them into 8×8 quarters) can't be expressed.
- **Workaround:** a script sliced hand-drawn masks into 20 quarter symbols, and the recipe composes the 47 blob tiles with stamps. Scene previews repeat a single water variant, and the game engine draws the map itself.
- **Suggestion:**
  - A scene `tilemap` instance: `{ asset, tile: [16,16], rows: ["..~~", ...], legend: { "~": "water-a0" } }`, counted as one placement.
  - A `copy` op that takes a rectangle from a symbol or earlier frame.
  - Optionally a small `autotile` compiler that turns a template into blob or Wang frames.

### TW-M2 — Pivots and free-form per-frame metadata

- **Need:** every prop's ground contact point for y-sorting, a font's glyph advances, and hitboxes.
- **Workaround:** a hand-measured anchor table in `game/src/world.js`; glyph widths measured from exported pixels at runtime.
- **Available today:** only compiled poses carry origins and points.
- **Suggestion:** an optional recipe-level `anchor` with a per-frame override, emitted as the TexturePacker `pivot`, plus a per-frame `points`/`tags` map in the atlas, the same shape the pose compiler already produces.

### TW-M3 — Trimmed atlases and per-frame bounds

All frames share one canvas, and atlases are always untrimmed. Trimming each frame to its visible bounds would shrink the atlas by:

- 75% for the keeper (64,000 → 16,226 px)
- 75% for the slash arcs
- 82% for the effects
- 46% for the crab

The atlas JSON already has `trimmed`, `spriteSourceSize` and `sourceSize`. **Suggestion:** `sheet.trim: true`, keeping the full-canvas origin in `spriteSourceSize`.

### TW-M4 — Shared palettes, palette animation and remaps

- **Shared palettes:** 29 recipes carry copies of one 57-colour palette. There is no include, so the scaffolds copy a subset into each file.
- **Palette cycling:** surf and water animate by per-frame `replace` ops with unique marker colours that never appear in the final art: 564 replace ops across the shore set.
- **Remaps:** colour variants (flowers, a white hurt flash) need duplicated grids.
- **Suggestion:**
  - `palette: { "$file": "palette.json" }`, or a CLI-resolved include.
  - A per-frame `palette` override for cycling.
  - `stamp`/`grid` `remap: { "1": "4" }`.

### TW-M5 — Outline operation

Foliage built from clusters needs one silhouette outline around their union. **Workaround:** 1px-dilated copies of every cluster symbol, stamped in a layer underneath. **Suggestion:** a `layer.outline` colour, or an `outline` op that works from alpha.

### TW-M6 — Scene lighting for whole scenes

`renderScene` only lights assets that ship a normal or emissive pass. In a night preview, terrain, props and characters stay at full daylight while the lighthouse goes dark. I verified this in the exported `scene.png` and in the viewer.

Other scene limits:

- Scene manifests must inline every recipe (the headland review is 544 KB), with no file references.
- The viewer's sliders move only `lights[0]`.
- The clipping warning (`5537 drawn pixels clipped at scene bounds`) does not name the placements.

**Suggestion:**

- Apply ambient light to all assets, treating a missing normal as flat `#8080ff`.
- Allow `{ "$file": "recipes/lighthouse.json" }` asset references, resolved by the CLI.
- Offer per-light controls.

### TW-M7 — MCP coverage and response size

- **Coverage:** MCP exposes the five sprite tools only. Pose compilation, scenes, overlays, `inspectTile` and import are CLI/JS-only, so an MCP-only agent could not have reviewed the Tidewatch scene or compiled the keeper.
- **Response size:** `pixel_render` lists every exported file as an absolute path. For the 188-frame shore recipe that is **40,419 characters** (about 10K tokens) on every render, almost all `frames/*.png`.
- **Suggestion:** add `pixel_compile`, `pixel_scene` and `pixel_import`, and return `{ directory, counts, atlas, sheet, playback }` with the full list available on request.

### TW-M8 — Pose authoring conveniences

Part instances cannot be mirrored, so the left-facing keeper parts are programmatic mirrors of the right-facing ones, with anchors and points flipped by the scaffold.

Overlays are all-or-nothing per base fingerprint. Changing one unrelated frame duration in the crab pose source (`idle-0`, 900 → 950 ms) invalidates a pixel correction on `snap-2`. I understand the design is deliberately conservative. For a pose source under active iteration, though, every edit means re-authoring corrections.

**Suggestion:** `flipX` on pose instances with mirrored anchor and point resolution, and per-frame fingerprints so overlays on untouched frames survive.

### TW-M9 — A game-oriented runtime helper

`SpritePlayer` owns and resizes one canvas per sprite. A game that draws hundreds of sprites into one canvas needs `frameAt(atlas, animation, time)` and `drawFrame(ctx, atlas, name, x, y, { flip })`. Tidewatch wrote its own (`game/src/assets.js`, `render.js`). Exporting the lookup the player already has would help every engine-less web game.

### TW-M10 — Wrap-around translate

`translate` clips. Scrolling tile animations (water, conveyors, clouds) must draw each stamp twice and accept clipping warnings. **Suggestion:** `translate: [dx, dy], wrap: true`.

## Friction and smaller notes

- **Names are unique ignoring case.** This is deliberate, for case-insensitive filesystems, but a font cannot name glyphs `A` and `a`. Tidewatch uses `uA`/`la`/`n0`/`period` plus a separate character map.
- **Null-prototype maps from `compilePoses`.** `symbols` and `metadata.poses` fail `assert.deepStrictEqual` against the same data parsed from a file until they are JSON-normalised.
- **Generator key order.** JavaScript orders integer-like object keys first, so a scaffold that builds frames from `{ A: …, 0: … }` silently reorders the atlas. This isn't a PixelForge bug; a short note in the authoring guide would help generator authors.
- **`inspect` layout.** The contact sheet ignores `sheet.columns`; that's fine, but surprising the first time.
- **Studio.** The studio worked for a 40-frame, 57-part pose recipe. Its onion titles correctly name playback neighbours, including once-only ends.

## Evidence and reproduction

| Check | Result |
| --- | --- |
| `npm test` | 74/74 (68 existing + 6 new Tidewatch tests: recipe validity, compiled pose freshness, export freshness, pass alignment, autotile coverage, headless quest completion) |
| Asset export | 29 recipes → 91 files in about 0.8 s; `--check` compares JSON exactly, PNGs by decoded RGBA and APNGs by frame-control chunks, so zlib differences between Node releases don't cause false failures |
| MCP | inspect 60–80 ms, patch 91 ms, 188-frame render 340 ms; oversized message kills the server (TW-B1) |
| Import | Keeper and normal atlases round-trip losslessly in 64 ms; a rich 256×256 import makes a 2.43 MB MCP message |
| Game | Title → quest → dusk → ignition → night → stats card completed with deterministic stepping; combat, drops, damage, fainting and respawn checked |
| Game cost per frame | Day about 0.7–1.0 ms; night with lighting and beam 5.5–8 ms (desktop Chromium, measured over 60 stepped frames) |

Reproduce:

```sh
npm test
npm run check:tidewatch
npm run play:tidewatch
node bin/pixelforge.js scene showcase/tidewatch/art/scenes/tidewatch-headland-night.scene.json --out output/tidewatch-scene
```

Raw notes, in the order I hit them, are in [findings-log.md](../../showcase/tidewatch/notes/findings-log.md). The self-assessment of the art is in [art-review.md](../../showcase/tidewatch/notes/art-review.md).

## Not covered

The browser pane was hidden for most of the session. `requestAnimationFrame` was throttled and screenshots could be stale, so gameplay checks used the game's deterministic `advance()` hook and canvas captures rather than real-time play. I did not test on a phone, in Safari or Firefox, or with a human playtester. No toolkit source was changed; every item above is reported, not fixed.
