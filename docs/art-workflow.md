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

Diagnostics report duplicate images, empty frames, isolated visible pixels with no 8-connected neighbor, colors outside the declared palette and unusually large loop-boundary changes. Coordinates/bounds are provided, with bounded lists and omission counts. Loop warnings compare the boundary with the median nonzero adjacent change, using a minimum threshold of four pixels. These are advisory heuristics: exempt intentional holds, sparks, transparent effects, literal colors or cuts in the brief. They neither score beauty nor alter artwork. Animation timing includes expanded positions, original start times, durations and neighbor positions. Foot sliding needs authored contact points and scene movement; pixel differences alone cannot diagnose it.

## Regional corrections and scope

`pixel_patch`, CLI `patch`, and `patchRecipe` accept these canvas-coordinate changes:

```json
[
  {"grid":"frames[still]", "scope":"frame", "value":{"x":6,"y":3,"rows":["..hh", ".hgg", "~ggg"],"erase":"~"}},
  {"move":"frames[still]", "value":{"x":6,"y":3,"w":4,"h":3,"dx":1,"dy":0,"mask":["..xx",".xxx",".xxx"]}},
  {"recolor":"frames[still]", "value":{"x":7,"y":3,"w":4,"h":3,"from":"g","to":"h"}}
]
```

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

`parts` define palette grids, local anchors and local named points. Each pose's `origin` is a source-canvas point (often the ground anchor). Instances draw in listed back-to-front order. Without `attach`, `at` offsets the instance's anchor from the pose origin. With `attach`, it offsets the anchor from a named point on an **earlier** instance. Definition points use the part grid's upper-left origin. A pose can use a different part definition under the same instance name, such as an open versus curled hand. An instance with `"flipX": true` mirrors its grid, anchor and points inside the part. A pose written as `{ "name": "walk-l-1", "mirror": "walk-r-1" }` reflects an earlier pose around its origin column (pixel column c becomes 2 × originX − c), including parts, points and markers, and inherits its duration; it takes no parts, markers or origin of its own. No rotation, smoothing or automatic in-betweens are imposed.

Compiled recipes carry each pose origin as the frame anchor (one recipe-level `anchor` when every pose shares it), and each marker's position as a named frame point, so the atlas alone tells a game where the feet, hand or blade tip are. Marker names are unique within a pose.

```sh
node bin/pixelforge.js compile actor.poses.json --out actor.json --metadata actor.meta.json
node bin/pixelforge.js preview actor.json
```

The metadata exports each pose origin, resolved part anchors/points, markers, and expanded animation timing. Coordinates are **unscaled source pixels**, positive y down. For a game using `sheet.scale`, scale attachment coordinates explicitly; atlas rectangles already use exported pixels. Cue times are original milliseconds; divide by a positive playback rate in the consumer. Markers occur on entry into a pose, including repeated entries, reverse/pingpong positions and the first entry of a new loop. Nonlooping final holds do not repeatedly fire markers. PixelForge exports cues; the game owns event dispatch, collision and damage. Keep the `.poses.json` authoritative and reapply approved overlays after compilation.

## Scene and tile review

Use a separate `pixelforge-scene` version-1 manifest ([scene.schema.json](../scene.schema.json)). `assets` maps ids to recipes (inline or file references) or `{recipe, normal?, emissive?}`. `instances` draws in array order. An instance has `asset`, `at:[x,y]`, optional local `anchor`, integer `scale`, and either `frame`, `animation` or a `tilemap`. `repeat:[columns,rows]` and `step:[dx,dy]` create tile arrangements. Optional `sequence:[{time,frame|animation}]` cues choose a new state and restart that animation; a nonlooping reaction holds its final pose. Times increase strictly and stay below scene duration. Optional `trajectory:[{time,at}]` starts at time 0, linearly interpolates between authored positions and rounds to whole pixels; it holds the last position. This is an explicit preview path, not inferred movement or physics.

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

Every compiled frame is four `copy` operations from the `template` symbol, so editing the template in the compiled recipe updates the whole set. Use the same masks in a scene `tilemap` legend (`"autotile": "blob"`) or in a game.

## Lossless raster return path

```sh
node bin/pixelforge.js import corrected.png --name refined --atlas optional.atlas.json --out refined.json --metadata import.provenance.json
```

Supported PNGs are non-interlaced 8-bit RGB/RGBA with standard filters and checked chunk CRCs, at most 32 MiB compressed, 4096 per side and 16,777,216 pixels. APNG, indexed/grayscale PNG, `tRNS`, interlace and unsupported critical chunks fail clearly. No quantization, resizing, alpha modification or color-profile conversion is performed. Channel values, including RGB under alpha zero, are preserved. A single image must fit the sprite limits. Optional PixelForge/TexturePacker-style metadata requires `meta.scale:1`, equal-size untrimmed/unrotated rectangles, and supported frame counts/source-area limits; durations and expanded named sequences/loop flags survive. Inputs with at most 256 visible colors (the palette limit) return as compact palette grids, using ASCII keys first and then single-code-unit Latin letters; richer inputs use exact final `pixels`. Hidden RGB under alpha zero is preserved with explicit corrections. Neither representation claims to reconstruct the original drawing operations. Keep pose anchors/cues in their separately saved metadata; this import does not reconstruct them. Native Aseprite interchange is still future work.

## Aligned material passes

Scene assets may provide manually authored normal and emissive recipes. They must share color dimensions, frame names/order, durations, animations and atlas layout. Each exported asset directory has `color.png`, optional `normal.png`/`emissive.png`, and one common atlas JSON. `alignment.json` maps asset ids to those files. Normal RGB encodes XYZ from −1 to +1: +X right, +Y down, +Z toward the viewer. Normals are renormalized for preview; their color channels are never palette-quantized.

`lighting:{ambient,bands,scope,lights:[{at,height,radius,color}]}` supplies at most eight bounded preview lights. Each light's diffuse brightness is banded deliberately into `bands` steps and then tinted by its color, so a colored light keeps one hue per ring; ambient light is not banded. Emission remains aligned to the current pose. With the default `scope: "passes"`, assets without passes keep their authored colors. `scope: "all"` lights them too, as flat surfaces facing the viewer, so a night scene darkens the terrain and props instead of only the assets with normal maps. Disabling lighting gives the ordinary color fallback. Aligned passes are exported on a uniform grid even when the color recipe trims its own atlas. This is a CPU material review, not a physically complete lighting model: no shadow propagation, fluid simulation, bloom, raymarching or material-mask pass is implemented. Measure preview cost separately from sprite-player performance before expanding it.
