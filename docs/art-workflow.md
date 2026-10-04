# Deliberate pixel art with PixelForge

PixelForge supplies exact pixels and inexpensive revisions. The author still has to design the silhouette, choose meaningful color shapes and judge the motion. The [quality lab](art-quality-lab.md) is an original worked example, with both an unsuccessful room blockout and its revised result. It is a self-reviewed study, not independent evidence of Animal Well parity.

## Write a brief outside the recipe

Keep an `asset.brief.md` beside the authoritative source. Record:

- Native dimensions and intended display scale. Review at 1× and the intended integer scale.
- Three silhouette landmarks and the negative spaces that distinguish the subject.
- Palette roles: outline, occlusion, shadow, local color, illuminated plane, accent. State light direction.
- Material rules: growth direction for plants, planes for stone, expansion/fragmentation for effects.
- Outline treatment and any deliberate isolated pixels or alpha blends.
- Action intent, contact/release/impact poses, timing, ground origin and attachments.
- Scene role: focal subject, navigable surface, background or foreground framing.
- Acceptance judgments, revisions, remaining weaknesses and source provenance.

Briefs and review notes are sidecars. Do not add these fields to a version-1 sprite recipe.

## Quality checkpoints

1. **Silhouette.** Author a connected contour with a few strong landmarks. Inspect `--view silhouette --native`; record whether identity survives without interior detail. Reshape an ambiguous outline before adding texture.
2. **Large color groups.** Use `--view grayscale` against the intended background. A connected shadow plane should describe a surface. Remove scattered texture that does not explain form.
3. **Materials.** Compare related assets. Leaves branch from stems; stone highlights follow planes; water flows and collects; crystal breaks along a fault and leaves debris. Palette swaps alone do not establish material behavior.
4. **Key poses.** Author contact, compression, passing and extension for locomotion; anticipation, release and recovery for an action. Replacing a drawn part is often more useful than translating the same stamp.
5. **Timing.** Inspect `--animation run --view onion --diagnostics`, then actually watch the studio or exported APNG. Sheets and timing strips cannot show perceived weight. Repeated poses/holds remain valid. The studio timeline uses expanded animation order, including repeated occurrences; pink is previous and cyan next. Once-only animations have no wrapped neighbor.
6. **Scene.** Use `preview room.scene.json` to check native size, value separation, density, overlap and reaction/aftermath. A good sprite can fail against its background. Keep a failed comparison when it teaches a specific correction.
7. **Revision.** Read the regional grid; make a bounded patch; inspect its changed-pixel report. Preserve unrelated poses deliberately. Keep an undo revision and recheck motion after the correction.

These are authoring decisions, not user permission gates. Passing validation, increasing frame count, or producing many variants does not pass an artistic checkpoint.

## Inspection options

The CLI and MCP `pixel_inspect` support `view: color|silhouette|grayscale|onion|tile`, `native`, `diagnostics`, and `maxCells` in addition to existing frame/animation/region/grid options. CLI spellings are `--view`, `--native`, `--diagnostics`, `--max-cells`. Silhouette uses one opaque light tone for every visible pixel, including translucent ones. Grayscale uses weighted RGB luma and retains alpha. Tile repeats each frame 3×3 and reports seam evidence (see [Scene and tile review](#scene-and-tile-review)); it repeats whole frames, so it takes no region. None modifies source pixels; grids always report original pixels.

With `--out review.png --native`, the CLI also writes `review.native.png`, checking both paths before writing. MCP returns an additional native-size PNG. Sampled sheets explicitly report total/shown/omitted and original sequence positions. Their cell durations are original holds, **not** a playable retiming of the sampled sequence. `pixel_render` automatically bounds large previews to at most 256 cells (fewer for large canvases), still exports every animation entry, and returns `playback` pointing to its HTML preview.

`--layers body,head` / `layers: ["body","head"]` isolates named layers through frame inheritance and transforms. It respects layer visibility/opacity and omits background, frame-level operations and final canvas corrections: those pixels have no layer identity. The original recipe is validated before isolating. `--reference earlier.json` / `reference: "revision-id"` adds a same-origin changed-pixel comparison; the CLI writes `review.reference.png` when a diff image exists and `--out` is supplied.

Diagnostics report duplicate images, empty frames, isolated visible pixels with no 8-connected neighbor, colors outside the declared palette, unusually large loop-boundary changes. Per-frame stats also count the pixels a `cleanup` patch change would alter: `corners` (doubled L-shaped steps in one-pixel lines) and `strays` (pixels whose eight neighbours share one other colour). These are counts, not findings: in finished, hand-drawn art most L-steps are deliberate highlight strokes or small rounded corners, and most specks are texture. Check them on rotated, rewritten, compiled or imported frames. Coordinates/bounds are provided, with bounded lists and omission counts. Loop warnings compare the boundary with the median nonzero adjacent change, using a minimum threshold of four pixels. These are advisory heuristics: exempt intentional holds, sparks, transparent effects, literal colors or cuts in the brief. They neither score beauty nor alter artwork. Animation timing includes expanded positions, original start times, durations and neighbor positions. Foot sliding needs authored contact points and scene movement; pixel differences alone cannot diagnose it.

## Regional corrections and scope

`pixel_patch`, CLI `patch`, and `patchRecipe` accept these canvas-coordinate changes:

```json
[
  {"grid":"frames[still]", "scope":"frame", "value":{"x":6,"y":3,"rows":["..hh", ".hgg", "~ggg"],"erase":"~"}},
  {"move":"frames[still]", "value":{"x":6,"y":3,"w":4,"h":3,"dx":1,"dy":0,"mask":["..xx",".xxx",".xxx"]}},
  {"recolor":"frames[still]", "value":{"x":7,"y":3,"w":4,"h":3,"from":"g","to":"h"}}
]
```

Another canvas change, `{"cleanup":"frames[still]", "value":{"corners":true, "strays":true}}`, proposes pixel-art cleanup as ordinary corrections, after Pixel Composer's De-Corner and De-Stray filters. It accepts the same optional region, `mask` and `scope`, plus `colors` to limit which original colours may change, and reports how many corners and strays it fixed. It is never applied on its own: preview it, read the changed pixels, and keep eyes, sparks and deliberate right angles.

Grid dots/spaces preserve pixels. Erasure needs an explicit non-palette character such as `~`; it may not be a dot or space. Masks match region size: `x` selects, `.` preserves. Move captures selected RGBA before clearing, so overlapping moves carry highlights and existing corrections. Selected transparent pixels also move and replace destination pixels. Every selected destination must fit; moves do not silently clip.

Regional batches have a 67,108,864 estimated-pixel work limit, including full-frame comparisons needed to preserve dependent poses. Split large batches or reduce scope when that budget is exceeded. Failures leave the source untouched.

The default scope is `inherited`, preserving existing propagation. `scope: "frame"` preserves other poses by recording compensating final-canvas corrections on affected dependents. The edit report lists those protected frames. These corrections intentionally pin those pixels, including their current color: later palette edits will not recolor literal compensations. Use earlier revisions to undo. To edit a named set of frames, submit one change per target with `scope: "frame"`; to alter all instances of a shared drawing, patch its symbol rows instead.

Named selections live in an overlay sidecar with `space: "canvas"`. They do not follow a moving body part. For part-local work, edit that part definition in a pose source and recompile.

## Rebuild-safe overlays

```sh
node bin/pixelforge.js overlay base.json --changes edits.json --selections regions.json --out corrections.json
node bin/pixelforge.js patch rebuilt-base.json --changes corrections.json --out approved.json --image difference.png
```

`regions.json` maps names to `{space:"canvas",x,y,w,h,mask?}`. A grid/move/recolor change can reference one with `selection:"fern-tip"`; its value supplies action-specific fields. `createOverlay` and `applyOverlay` offer the same JavaScript API.

An overlay carries a SHA-256 fingerprint of the whole base, canonicalized by object-key order but preserving array order. Rebuilding the same base reproduces the correction. Overlays made only of canvas changes (`paint`, `grid`, `move`, `recolor`) also record per-frame evidence: a fingerprint of every frame they target and of every frame inheriting from those, the frame each change addresses, and the palette colors the changes paint with. When the base changed elsewhere (another frame's duration, a new animation, a different pose), the overlay still applies and reports `rebased: true`. **Any change to a frame it touches, to the frame a path addresses, or to a palette color it uses is a conflict**, and nothing is applied. Overlays with structural `set`/`insert`/`remove` edits keep the whole-recipe rule. The tool never guesses that an old coordinate still identifies the same feature; after a conflict, inspect the new base and create a new overlay. Keep the generator, overlay and resulting recipe, and identify which file is authoritative. The quality lab demonstrates this with its fern correction.

## Authored poses, attachments and cues

Use a `pixelforge-poses` version-1 sidecar, described by [poses.schema.json](../poses.schema.json). It compiles into ordinary sprite recipes; it does not change their rendering semantics.

```json
{
  "format":"pixelforge-poses", "version":1, "name":"held-lamp", "width":16, "height":16,
  "palette":{"g":"#72967d","y":"#e7ce89"},
  "parts":{
    "arm":{"rows":["ggg","..g"],"anchor":[0,0],"points":{"grip":[2,1]}},
    "lamp":{"rows":["y","y"],"anchor":[0,0],"points":{"light":[0,1]}}
  },
  "poses":[{"name":"rest","duration":180,"origin":[4,5],"parts":[
    {"name":"forearm","part":"arm"},
    {"name":"held","part":"lamp","attach":{"part":"forearm","point":"grip"}}
  ],"markers":[{"name":"light","part":"held","point":"light"}]}]
}
```

`parts` define palette grids, local anchors and local named points. Each pose's `origin` is a source-canvas point (often the ground anchor). Instances draw in listed back-to-front order. Without `attach`, `at` offsets the instance's anchor from the pose origin. With `attach`, it offsets the anchor from a named point on an **earlier** instance. Definition points use the part grid's upper-left origin. A pose can use a different part definition under the same instance name, such as an open versus curled hand. An instance with `"flipX": true` mirrors its grid, anchor and points inside the part. A pose written as `{ "name": "walk-l-1", "mirror": "walk-r-1" }` reflects an earlier pose around its origin, including parts, points and markers, and inherits its duration; it takes no parts, markers or origin of its own. The origin becomes the frame anchor, which names the corner between pixel columns originX − 1 and originX, and the mirror reflects around that corner: pixel column c becomes 2 × originX − 1 − c. That is the same reflection as the runtime's `drawFrame` with `flipX` and engines that flip around the atlas pivot, so a compiled left-facing pose and a runtime-flipped right-facing one draw identical pixels. Centre a symmetric front view on the origin corner (for example columns 12–27 around origin x 20) and the side views mirror around the same line. No rotation, smoothing or automatic in-betweens are imposed unless you ask for them.

An instance with `"rotate": 30` turns its part clockwise by whole degrees (−360 to 360) around the centre of the part's anchor pixel, after any flip, and its points turn with it, so a held item stays in the hand. The rotated grid is baked into the compiled recipe as an ordinary, editable symbol named `<part>-r<degrees>` (`-fr` when flipped). Rotation never invents colours: three Scale2x passes enlarge the grid eight times, which rounds staircase edges, and each output pixel samples the enlarged grid where its rotated centre lands (the RotSprite approach). Right angles are exact. A cleanup pass then removes doubled corners the resampling leaves; set `"cleanup": false` to keep the raw result (`<part>-r<degrees>-raw`). Small parts lose detail at odd angles, so inspect the symbol and correct it by patching the compiled recipe or drawing a replacement part for key poses.

A pose written as `{ "name": "swing-1", "tween": { "from": "raise", "to": "strike", "t": 0.33, "ease": "in" } }` is an in-between of two earlier authored or tweened poses with the same part instances in the same order and the same attachments. Its origin, each instance's `at` offset and each `rotate` interpolate by the eased `t` and round to whole pixels and degrees; part definitions, flips and cleanup switch at the eased halfway point. Easing presets are `linear` (default), `hold`, `in`, `out`, `inOut`, `overshoot` and `bounce`. A tween takes no parts or origin, does not inherit markers (add its own if it needs cues) and cannot start from a mirrored pose; mirror the finished tween instead. [examples/swing.poses.json](../examples/swing.poses.json) rotates one sword through an eased swing. In-betweens are a starting point, not a substitute for authored contact, anticipation and recovery poses.

Compiled recipes carry each pose origin as the frame anchor (one recipe-level `anchor` when every pose shares it), and each marker's position as a named frame point, so the atlas alone tells a game where the feet, hand or blade tip are. Marker names are unique within a pose.

```sh
node bin/pixelforge.js compile actor.poses.json --out actor.json --metadata actor.meta.json
node bin/pixelforge.js preview actor.json
```

The metadata exports each pose origin, resolved part anchors/points, markers, and expanded animation timing. Coordinates are **unscaled source pixels**, positive y down. For a game using `sheet.scale`, scale attachment coordinates explicitly; atlas rectangles already use exported pixels. Cue times are original milliseconds; divide by a positive playback rate in the consumer. Markers occur on entry into a pose, including repeated entries, reverse/pingpong positions and the first entry of a new loop. Nonlooping final holds do not repeatedly fire markers. PixelForge exports cues; the game owns event dispatch, collision and damage. Keep the `.poses.json` authoritative and reapply approved overlays after compilation.

## Scene and tile review

Use a separate `pixelforge-scene` version-1 manifest ([scene.schema.json](../scene.schema.json)). `assets` maps ids to recipes (inline or file references) or `{recipe, normal?, emissive?}`. `instances` draws in array order. An instance has `asset`, `at:[x,y]`, optional local `anchor`, integer `scale`, and either `frame`, `animation` or a `tilemap`. The anchor is one `[x, y]` in asset pixels (default `[0, 0]`), or `"frame"` to place every drawn frame by its own atlas anchor (per-frame or recipe-level), so an animated placement follows anchors that change between poses, as `drawFrame` does in a game. Tilemaps take `[x, y]` only. `repeat:[columns,rows]` and `step:[dx,dy]` create tile arrangements. Optional `sequence:[{time,frame|animation}]` cues choose a new state and restart that animation; a nonlooping reaction holds its final pose. Times increase strictly and stay below scene duration. Optional `trajectory:[{time,at,ease?}]` starts at time 0, interpolates between authored positions and rounds to whole pixels; it holds the last position. Each key's `ease` shapes the segment that starts at it: `linear` (default), `hold` (stay, then jump at the next key), `in`, `out`, `inOut`, `overshoot` or `bounce`. This is an explicit preview path, not inferred movement or physics.

```sh
node bin/pixelforge.js preview examples/quality/hollow.scene.json
node bin/pixelforge.js scene examples/quality/hollow.scene.json --out output/room-review
```

The scene viewer offers playback, scrubbing, native size, grayscale, a pixel-density overlay, lighting controls (pick any light and move it) and scene-settings download. Changes are in memory until downloaded. The export includes `scene.json`, lit/unlit stills, a browser viewer, aligned color/material atlases, and `alignment.json`. Serve its folder over HTTP for module loading, or use `preview` with the original manifest. Large rooms should be composed in a game: this review format is bounded to 256×256, 64 assets, 256 placement declarations, 4,096 expanded draws, 4,194,304 combined source-pass pixels, and 4,194,304 drawn pixels per view. Clipping warnings name the placements that overhang. It does not run a world state machine.

Assets can be inlined, or referenced so the manifest stays small: `"assets": { "lamp": "../recipes/lamp.json", "tower": { "recipe": "tower.json", "normal": "tower-normal.json" } }`. The CLI (`scene`, `preview`) resolves those files relative to the manifest, and their own palette references relative to each recipe; the MCP `pixel_scene` tool resolves them inside its root and also accepts `{"revision": id}`. The exported `scene.json` is the resolved, self-contained manifest.

A **tilemap** placement draws a whole character map as one declaration:

```json
{ "name": "ground", "asset": "shore", "at": [0, 0], "tilemap": {
  "rows": ["~~..", "~...", "~~.."],
  "legend": {
    "~": { "frames": ["water-a0", "water-b0"] },
    ".": { "animation": "shore-{mask}", "autotile": "blob", "match": ".g" }
  }
} }
```

`tile` defaults to the asset size. A legend entry names one `frame` or `animation`, or lists `frames`/`animations` variants that are picked deterministically by cell position, so repeated terrain does not tile visibly. With `autotile: "blob"` or `"cardinal"`, `{mask}` in the names becomes the cell's neighbour mask, computed from neighbours whose characters are in `match` (default: the same character). Neighbours outside the map count as empty unless `outside: "match"`. A legend entry set to `null` marks context cells: they are never drawn but count for other entries' `match`, so a review window cut from a larger map can carry a one-tile ring of the surrounding terrain (placed at a negative `at`) and its edge tiles still see their real neighbours. Every referenced name is checked when the scene is prepared; errors name the cell, e.g. `tilemap.rows[2][5]`. Masks and quarter pieces are the same ones the autotile compiler uses.

`inspectTile(renderProject(recipe), frameName)` and `inspect --view tile` return a 3×3 repeat plus advisory seam evidence per axis. `doubledRows` (left/right wrap) and `doubledColumns` (top/bottom wrap) list lines where both opposite edges carry the same color that differs from its inner neighbours, which doubles into a 2px seam. `wrapSteps` counts large value steps across the wrap, compared with `interiorMaxSteps`, the busiest interior boundary. `suspicious` is true when a quarter or more of the lines double, or the wrap has more large steps than any interior boundary (a gradient or texture that does not continue). A stroke that merely touches one edge is not flagged. This is evidence to inspect, not proof that a tile is defective. Distinguish spatial variants from animations by selecting explicit frames in scene placements. Fractional scales are rejected; larger integer source pixels are highlighted for review. There is no automated style/palette harmonization, ground-speed solver or general scene editor.

## Autotile templates

A `pixelforge-autotile` source ([autotile.schema.json](../autotile.schema.json)) turns one small drawing into a complete terrain set. The template is two tiles wide and three tall:

```text
[ unused preview ][ inner corners  ]   each quadrant of the inner-corner tile is that quadrant's inner-corner piece
[   2×2-tile island (outer corners, edges and fill)   ]
```

Draw it like a tiny island in the sea: the island's four corner quadrants are outer corners, the quadrants between them are edges, and its center is fill, all consistent at quadrant boundaries. `mode: "blob"` (default) builds the 47-tile set from eight neighbours (N=1, NE=2, E=4, SE=8, S=16, SW=32, W=64, NW=128; a diagonal counts only when both adjacent sides match). `mode: "cardinal"` builds 16 tiles from four neighbours (N=1, E=2, S=4, W=8) without inner corners. `frame` names each tile with `{mask}`. Optional `variants` (up to 16, each with a `name`, `duration` and frame `palette`) multiply the set for palette-cycled animation (surf, glowing lava), with `{variant}` in the frame name and an optional per-mask `animation`.

```sh
node bin/pixelforge.js autotile shore.autotile.json --out shore.json
```

Every compiled frame is one `autotile` operation naming its neighbour mask, drawn from the `template` symbol, so a frame reads as `{"op": "autotile", "symbol": "template", "mask": 23}` and editing the template in the compiled recipe updates the whole set. Use the same masks in a scene `tilemap` legend (`"autotile": "blob"`) or in a game.

## Particle effects

A `pixelforge-fx` source ([fx.schema.json](../fx.schema.json)) describes seeded particle emitters, after Pixel Composer's particle system, and compiles them into an ordinary recipe: every frame becomes `stamp`, `grid` and `line` operations on the source's own symbols. Inspect, patch, overlay and export the result like any other recipe; editing a symbol in it redraws every particle that uses it.

```json
{ "format": "pixelforge-fx", "version": 1, "name": "fx", "width": 48, "height": 40,
  "palette": { "W": "#fff4d6", "y": "#ffd166", "o": "#f4843c", "r": "#c2413a" },
  "symbols": { "hot": ["W"], "warm": ["y"], "cool": ["o"], "ash": ["r"] },
  "effects": { "sparks": { "frames": 9, "duration": 55, "seed": 11, "emitters": [
    { "at": [24, 30], "burst": 12, "angle": [205, 335], "speed": [1.8, 3.4], "gravity": [0, 0.32], "life": [6, 9],
      "floor": 36, "bounce": 0.35, "shapes": ["hot", "warm", "cool", "ash"], "trail": { "color": "r", "length": 1 } } ] } } }
```

```sh
node bin/pixelforge.js compile examples/effects.fx.json --out output/effects.json --metadata output/effects.meta.json
node bin/pixelforge.js preview examples/effects.fx.json   # the studio shows the compiled recipe
```

Each effect becomes frames `<effect>-0`, `<effect>-1`… and an animation named after the effect. An emitter spawns a `burst` at frame `start` or a `rate` of particles per frame until `end`, inside an `area` box centred on `at`. Per-particle values are picked from `[min, max]` ranges: `angle` (degrees clockwise, 0 right, 90 down, 270 up), `speed` (pixels per frame) and `life` (frames). Each frame velocity gains `gravity` and an optional `attract` pull, loses `drag`, and moves the particle; a `floor` stops it, with optional `bounce`. `sway` adds a drawn wobble (x follows a sine, y a cosine). `shapes` is one symbol sequence, or several with one picked per particle; `play` spreads it over the life (`life`, default), steps one per frame from a random start (`loop`, for flutter) or steps and holds (`once`, for hand-drawn flashes). `remaps` gives colour variants, `trail` draws a one-pixel streak from an earlier position, and `dissolve` thins the last share of each life through an ordered-dither `pattern` (a Bayer name or a custom rank matrix, as for the `dither` operation; `[[0, 1, 2], [1, 2, 0], [2, 0, 1]]` dissolves along diagonals).

Randomness is a seeded hash keyed by effect seed, emitter, spawn frame and particle, with a separate salt per property, so changing one range does not reshuffle the others, and the same source always compiles to the same recipe. A looping effect (`loop: true`, which needs a finite `life`) warms up for whole cycles with spawns keyed by their frame in the cycle, so the particles in flight at frame 0 are exactly those alive at the end. Particles partly off the canvas are cropped into grids and trails keep only on-canvas pixels, so compiled effects never clip. Metadata reports spawned particles, the most alive at once, operations and culled particles per effect.

The compiler makes behaviour cheap to try; it does not supply it. Give each material its own motion and shapes (fire rises and fades, stone chips arc and settle, leaves flutter), keep particle counts low enough to read at native size, and review playback. [examples/effects.fx.json](../examples/effects.fx.json) holds sparks, looping embers, landing dust, falling leaves and stone shards. Tidewatch's [effects source](../showcase/tidewatch/art/effects/fx.fx.json) shows a production set: sampled bursts for leaves and shards, a placed cluster (one emitter per puff) with a custom dissolve pattern for smoke, and hand-drawn frame sequences played by single particles.

### Game timing: timelines and cues

When an effect has to match the game (the hit lands at 300 ms, the whole thing lasts 900), give it a `timeline` in milliseconds instead of `frames` and `duration`:

```json
"hit": { "timeline": { "length": 900, "rate": 15, "cues": { "impact": { "time": 300, "at": [24, 36] }, "cool": 600 } }, "emitters": [
  { "name": "sparks", "at": [24, 34], "burst": 10, "start": "impact", "angle": [200, 340], "speed": [1.6, 3], "life": [5, 8], "shapes": ["hot", "warm", "cool", "ash"] },
  { "name": "smoulder", "at": [24, 35], "rate": 0.6, "start": "impact", "end": "cool", "life": [6, 9], "shapes": ["ember", "ember-dim", "ember-end"] } ] }
```

With `rate` (frames per second), each span between cues gets a whole number of near-equal frames, so every cue starts a frame and the frames end exactly at `length`. Use `times` instead to list the start of every frame yourself, for example two quick 50 ms frames at contact; each cue must then be one of them. An emitter's `start` and `end` take a cue's name as well as a frame number. A cue written as `{ "time": 300, "at": [24, 36] }` also puts a point of that name on the frame it starts, so the atlas carries the moment and its position to game code; the compile metadata lists every cue's time and frame. Emitter values stay per frame (speed in pixels per frame, life in frames), so a different `rate` changes how fast particles move in time while the length and cue times stay put. Retune motion after changing the rate. For timing written as code, draw loops (below) take the same `timeline`.

## Animations written as code

Motion is often easiest to state as code: an arc that eases, a swing that decays, squash on landing, light that flickers, a ring that spreads and cools. A game usually already has that code as a draw loop. PixelForge runs such a loop through a pixel-art Canvas 2D context and samples it on a timeline, so the same function that paints a smooth browser canvas compiles into an ordinary recipe. Nothing in the method is specific to one kind of effect.

```js
// slime.loop.mjs: ordinary canvas code plus a few fields that say how to make pixels of it.
export default {
  name: 'slime', width: 48, height: 48,
  palette: { s: '#22202e', G: '#2f6b4a', g: '#4fb06a', l: '#b7f0a1', k: '#14131c' },
  timeline: { length: 900, rate: 12, cues: { land: { time: 600, at: [24, 40] } } },
  draw(ctx, t) {                                   // t in seconds
    ctx.save(); ctx.translate(24.5, 40 - lift(t)); ctx.scale(squashX(t), squashY(t));
    ctx.fillStyle = '#4fb06a'; /* path… */ ctx.fill();
    ctx.restore();
    ctx.point('feet', 24.5, 40 - lift(t));         // a named point on this frame, exported to the atlas
  }
};
```

```sh
node bin/pixelforge.js compile examples/slime.loop.mjs --out slime.json --metadata slime.meta.json
node bin/pixelforge.js preview examples/lantern.loop.mjs     # every command that reads a recipe also reads a loop
```

![Two draw loops, each drawn twice from the same module: smooth in a browser canvas above, pixel art through PixelForge below. A lantern swings with a banded glow; a slime crouches, jumps and lands.](images/draw-loops.png)

*[examples/lantern.loop.mjs](../examples/lantern.loop.mjs) and [examples/slime.loop.mjs](../examples/slime.loop.mjs): the browser's Canvas 2D above, PixelForge below, at the same moments.*

The context keeps the drawing calls (paths, arcs, ellipses, curves, rectangles, transforms, save and restore, clip, gradients, shadows, `globalAlpha`, `lighter` and `destination-out`, `fillText`, `drawImage`) and translates what pixel art cannot use:

- **No anti-aliasing.** Fills take the pixels whose centres are inside. Strokes under 1.5 pixels are one pixel wide: a pixel is lit when the path crosses the diamond inscribed in it, and pixels that only fill the inside of an L are dropped, independently of drawing direction, so mirrored paths give mirrored pixels. Wider strokes take the pixels within half the width (round joins). Like crisp canvas code, put one-pixel lines and symmetric shapes on pixel centres (`x + 0.5`).
- **Palette keys, never quantization.** A CSS colour (`#hex`, `rgb()`, `hsl()`) that equals an opaque palette colour uses that key; `colors` maps any other colour text to a key (`{ "orange": "o" }`). Unmapped colours fail the compile together, with how often each was drawn. Palette keys can be used directly as styles too.
- **Soft values become pixel decisions.** Alpha, gradient stops and shadow blur give each pixel a coverage. A solid key dithers by coverage through `pattern` (`soft: "threshold"` draws at half coverage and above instead). A gradient between two solid keys hands over through the same pattern.
- **Light on ramps.** Keys listed in `ramps` (coolest first) behave as light: coverage scales a key's level, `lighter` adds levels up, and the result bands along the ramp above its `floor` (0.1 by default). A radial glow ends in hard rings, a fading key cools down the ramp instead of turning translucent, and a shadow in a ramp colour is a banded glow. `breakup` and `cluster` break the bands into seeded clumps; `flicker: true` reseeds them every frame. A solid key drawn on top covers the light.
- **Sprites stay authored.** `drawImage` takes a symbol name or `{ rows }` of palette keys. It resizes by nearest neighbour, mirrors exactly, turns quarter turns exactly and other angles by RotSprite to the nearest degree, and places on whole pixels. Draw forms as sprites and give code the motion: the lantern's body is a symbol; the swing, rope and light are code.
- **Time is sampled, not streamed.** `timeline` takes `length`, `rate` or `times`, and `cues`, exactly as for particle effects: about 12 frames a second instead of the loop's 60, with every cue starting a frame and the frames ending at `length`. `draw(ctx, t, { ms, frame, duration })` gets the moment in seconds.
- **Game handoff.** `ctx.point(name, x, y)` puts a named point on the frame; a cue with `at` does the same for its frame. Both reach the atlas. `ctx.layer(name)` sends what follows to a named recipe layer for inspection with `--layers`.

`units` maps drawing units to pixels, so code written for a larger game canvas can be compiled at native size (`units: 0.5` halves every coordinate, radius and blur), and `snap: true` rounds translations to whole pixels so a shape moved with `translate` keeps identical pixels. Calls a browser canvas has but the pixel context does not (`getImageData`, patterns, filters, dashes, conic gradients, `arcTo`, `Path2D`) are errors naming the call, never silent no-ops; `lineCap`, `lineJoin`, image smoothing and similar settings are accepted and ignored.

Draw loops are code, so they run on your machine through the CLI or `compileLoop` from `src/drawloop.js`; the MCP server does not execute them. Pass the compiled recipe to MCP tools. For deterministic output across JavaScript engines, use `sinDeg`, `cosDeg`, `ease` and `random` from `src/craft.js` instead of `Math.sin` and `Math.random` in the loop. `rampRows` and `frameStarts` from the same file are the ramp and timing steps on their own, for generator scripts that build recipes directly.

Code suits motion, timing and energy. It does not design forms: a silhouette drawn with `ellipse` calls will look assembled. Keep characters and props authored as symbols or poses, inspect the compiled frames, and keep hand corrections as overlays: they reapply when the loop is rebuilt and refuse to apply when it changed the frames they touch. [The investigation](reports/code-first-animation.md) records where the method came from and what was tested.

## Lossless raster return path

```sh
node bin/pixelforge.js import corrected.png --name refined --atlas optional.atlas.json --out refined.json --metadata import.provenance.json
```

Supported PNGs are non-interlaced 8-bit RGB/RGBA with standard filters and checked chunk CRCs, at most 32 MiB compressed, 4096 per side and 16,777,216 pixels. APNG, indexed/grayscale PNG, `tRNS`, interlace and unsupported critical chunks fail clearly. No quantization, resizing, alpha modification or color-profile conversion is performed. Channel values, including RGB under alpha zero, are preserved. A single image must fit the sprite limits. Optional PixelForge/TexturePacker-style metadata requires `meta.scale:1`, equal-size untrimmed/unrotated rectangles, and supported frame counts/source-area limits; durations and expanded named sequences/loop flags survive. Inputs with at most 256 visible colors (the palette limit) return as compact palette grids, using ASCII keys first and then single-code-unit Latin letters; richer inputs use exact final `pixels`. Hidden RGB under alpha zero is preserved with explicit corrections. Neither representation claims to reconstruct the original drawing operations. Keep pose anchors/cues in their separately saved metadata; this import does not reconstruct them. Native Aseprite interchange is still future work.

## Aligned material passes

Scene assets may provide manually authored normal and emissive recipes. They must share color dimensions, frame names/order, durations, animations and atlas layout. Each exported asset directory has `color.png`, optional `normal.png`/`emissive.png`, and one common atlas JSON. `alignment.json` maps asset ids to those files. Normal RGB encodes XYZ from −1 to +1: +X right, +Y down, +Z toward the viewer. Normals are renormalized for preview; their color channels are never palette-quantized.

`lighting:{ambient,bands,scope,lights:[{at,height,radius,color}]}` supplies at most eight bounded preview lights. Each light's diffuse brightness is banded deliberately into `bands` steps and then tinted by its color, so a colored light keeps one hue per ring; ambient light is not banded. Emission remains aligned to the current pose. With the default `scope: "passes"`, assets without passes keep their authored colors. `scope: "all"` lights them too, as flat surfaces facing the viewer, so a night scene darkens the terrain and props instead of only the assets with normal maps. Disabling lighting gives the ordinary color fallback. Aligned passes are exported on a uniform grid even when the color recipe trims its own atlas. This is a CPU material review, not a physically complete lighting model: no shadow propagation, fluid simulation, bloom, raymarching or material-mask pass is implemented. Measure preview cost separately from sprite-player performance before expanding it.
