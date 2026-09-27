# PixelForge agent authoring guide

Create a small, editable JSON recipe; validate it; render it; inspect the PNG preview; revise the source. Use compact palette grids for silhouettes, symbols for repeated objects and inherited frames for small pose changes. The renderer is deterministic. It does not use an image model.

## Project

Required: `version: 1`, `name`, `width`, `height`, `frames`.

- `name`: starts with a letter, then letters, numbers, hyphens or underscores; at most 64 characters. Frame, symbol and animation names follow the same convention. Windows device names (CON, PRN, AUX, NUL, COM1–9, LPT1–9) are reserved. Frame and animation names must also be unique ignoring case so bundles work on case-insensitive filesystems.
- `width`, `height`: integers from 1 to 256.
- `palette`: map names to literal `#RGB`, `#RGBA`, `#RRGGBB`, `#RRGGBBAA` or `transparent`. Single-character keys are usable in grids. Palette values cannot reference other palette entries. `.` and space are reserved for skipping pixels; `transparent` is reserved.
- `background`: palette name or color; defaults to transparent.
- `symbols`: map names to equal-width string arrays. A symbol is a reusable palette grid.
- `frames`: 1–256 frames. At most 4,194,304 total source pixels.
- `animations`: map names to `{frames: [frame names], direction?, loop?}`. Omit for a default animation using all frames. `direction` is `forward` (default), `reverse` or `pingpong`. Pingpong excludes repeated endpoints: a,b,c becomes a,b,c,b. `loop` defaults to true; false plays once and holds the last frame.
- `sheet`: `{columns, padding, scale}`. Defaults: up to 8 columns, 0 padding, scale 1. Padding surrounds **each** cell on every side, so the distance between adjacent contents is twice the padding. Padding and dimensions are multiplied by the integer scale. Scale 1–16; columns 1–256; padding 0–16. Atlas area must be at most 16,777,216 pixels.

Use `node bin/pixelforge.js schema` for the complete JSON Schema. Unknown fields are errors so misspelled instructions do not disappear silently. Omit optional fields to use defaults; null is not accepted.

## Frames and layers

A frame is `{name, duration?, from?, translate?, flipX?, flipY?, ops?, layers?, pixels?}`.

`duration` is 1–60000 milliseconds, default 100. `from` copies an **earlier** frame; otherwise the frame starts with the project background. Whole-frame flips happen first, then `translate: [dx, dy]`, then `ops`, then layers in array order, then final `pixels` corrections. Translation leaves newly exposed pixels transparent and clips at the canvas boundary.

Layers are `{name?, visible?, opacity?, x?, y?, ops?}`. They render to a transparent buffer of the **canvas size**, then translate by x/y, then composite in order with source-over alpha. `opacity` is 0–1, applied once to the flattened layer. Hidden layers are validated but not composited. Drawing outside a layer's own canvas is clipped **before** the layer is translated.

Transparent drawing skips pixels. Use `clear` to erase. Clearing a layer erases only that layer's own pixels; it does not erase underlying layers. A `from` frame is already flattened, so later operations can edit or erase its pixels.

`pixels` is an optional list of `{x, y, color}` corrections in **final canvas coordinates** (top-left origin). Each entry replaces the exact RGBA after all operations and layers: `transparent` erases even underlying layers; a semi-transparent color sets that exact alpha instead of blending. Coordinates are required integers inside the canvas, colors use palette names or hex, and later entries at the same coordinate win. At most 65,536 entries are allowed per frame. Original layer operations are preserved. Frames that inherit this frame also inherit its corrections before applying their own transforms. Remove a correction to reveal the original drawing beneath it. Use `pixel_patch`'s `paint` change to manage these corrections without knowing the layer structure.

## Operations

Coordinates are integers; origin is the top-left; positive y points down. x/y default to 0. Coordinates are limited to -4096–4096. Shapes with positive w/h extend w/h pixels including their origin. Out-of-bounds drawing is clipped with a warning. Explicit false/zero values are honored.

| op | Properties | Behavior |
| --- | --- | --- |
| `pixel` | x, y, color | One pixel, source-over alpha |
| `rect` | x, y, w, h, color, filled? | Filled by default; false draws a 1px outline |
| `ellipse` | x, y, w, h, color, filled? | Pixel-center ellipse inside the bounding box |
| `line` | x, y, x2, y2, color | 1px integer line; both endpoints included |
| `clear` | x, y, w, h | Set a rectangle to fully transparent black |
| `fill` | x, y, color | Four-connected flood fill matching the seed's exact RGBA; replaces RGBA |
| `replace` | from, to | Replace every exact RGBA match in the current buffer |
| `grid` | x, y, rows, scale?, flipX?, flipY?, rotate? | Draw palette rows; dot and space skip |
| `stamp` | x, y, symbol, scale?, flipX?, flipY?, rotate? | Place a named symbol |

Rectangle/ellipse/clear w/h are integers 1–512. Grid and symbol rows must be rectangular, at most 256×256 characters, and use defined palette keys. Grid/stamp scale is 1–16. Flip X/Y before rotation; rotation is 0, 90, 180 or 270 degrees clockwise; then scale. x/y locates the transformed grid's upper-left corner. Geometry is never anti-aliased.

## Inspecting

Look at every frame before exporting. Inspection renders its images in memory; the CLI saves the contact sheet only when given `--out file.png`. MCP inspection also saves an immutable recipe revision for later calls, without exporting assets.

- **Contact sheet**: one PNG with the selected frames left to right, top to bottom, on a neutral checkerboard with dark gutters. The response lists each cell's frame name and duration, plus the layout (`columns`, `rows`, `scale`, `gap`). The default is every frame in project order. `animation` shows one sequence in playback order, including reverse and pingpong. `frames` lists frame names in any order. The automatic scale is the largest, at most 16, that keeps each cell within 256px and the sheet within 1024px. `scale` (1–16) overrides it, up to a 4096px sheet. `background` is `checker` (default), `transparent`, a palette name or a hex color, such as your game's backdrop.
- **Palette-key grids** (`grid: true`, CLI `--grid`): each distinct selected frame read back in the recipe's grid format. A pixel whose exact RGBA matches a single-character palette key shows that key; `.` is fully transparent. Any other color, whether a multi-character palette name, a literal hex color or a semi-transparent blend, gets a legend symbol: a digit, letter or punctuation mark that is not a palette key. Symbols belong to the recipe, not the request: multi-character palette names come first, in palette order, then other colors in the order frames use them. Every readback of the same recipe therefore agrees, and each response lists only the symbols it uses. `?` counts any colors left once the symbols run out. Grids are limited to 16,384 pixels in total. MCP prints them with x/y rulers; the CLI returns JSON `rows` that start at the region's top-left corner.
- **Region** (`region: {x, y, w, h}`, CLI `--region x,y,w,h`): crops every cell and grid to a canvas rectangle. Smaller regions are shown larger, so you can compare a face across a blink or read the pixels around a joint without printing the whole canvas.

## Patching

Change a recipe with small edits instead of rewriting it. Over MCP, send the full recipe once: every successful response from `pixel_validate`, `pixel_inspect`, `pixel_patch` and `pixel_render` includes a `revision` id, and those tools accept `revision` in place of `project`. Revisions are immutable recipe snapshots saved in `<MCP --out directory>/.revisions/`, including edits that have never been exported. Restart with the same output directory to keep using earlier ids as undo points. Use an absolute `--out` path so changing the working directory does not change the store. Older ids can also be recovered from recipes in existing render folders under that directory. Unknown or damaged revisions produce an error; stored snapshots are never silently replaced. Snapshots are retained until you explicitly remove their files; keep the output directory backed up. The CLI patches files instead.

`changes` apply in order:

| Change | Effect |
| --- | --- |
| `{"set": path, "value": v}` | Replace a value, or add an object field |
| `{"insert": path, "value": v}` | Insert into a list before the selected item; `[-]` appends |
| `{"remove": path}` | Delete an object field or list item |
| `{"paint": "frames[blink]", "value": [{"x": 9, "y": 7, "color": "k"}]}` | Set exact pixels in final canvas coordinates after all layers; `transparent` erases |

Paths use the same form as error paths, with an optional `project.` prefix: `frames[3].duration`, `palette.k`, `symbols.mossling[9]`, `sheet.padding`. In a list, `[name]` selects the item whose `name`, or string value, matches, and `[-]` is the end: `frames[blink].layers[body].ops[2].x2`, `animations.idle.frames[-]`. Quote unusual keys: `palette["dark.green"]`. Intermediate fields must exist, except that an insert can create the list it inserts into; `set` may add the final object field. Frame `ops` draw before the frame's layers. Use `paint` to correct the visible result directly; use `set` or `insert` inside layer `ops` when changing how that layer is drawn.

`paint` accepts a frame path by name or index and 1–65,536 `{x, y, color}` entries. Coordinates match inspection grids, with no layer-offset conversion. It updates the frame's `pixels` corrections, retaining only the last correction at each coordinate. Palette references stay editable. Remove `frames[blink].pixels` to reveal that frame's original drawing, or use an earlier revision to undo the whole patch.

A patch is atomic: if any change fails, or the result does not validate, the source and earlier revisions stay unchanged and no result revision is saved. MCP saves successful base and result revisions; the CLI saves only the outputs requested by flags. Patching reports:

- `edits`: each change with its resolved index path (`at`) and the value it replaced (`before`), or `created`. Paint edits report the number of submitted pixels; the comparison below reports their visible effects.
- `frames.changed`: every frame whose pixels differ, including frames that inherit from an edited frame, with a pixel count and bounding box. Up to 16 changed pixels are listed with canvas coordinates and palette-key characters (`from`, `to`); larger changes are summarized as color transitions. `unchanged`, `added`, `removed` and `durations` complete the picture, and `animations` lists changed sequences and loop settings.
- A before/after PNG (MCP) with one row per changed, added or removed frame: before on the left, after on the right. It is cropped to the changed area plus 2 pixels when no frames were added or removed.

CLI: `node bin/pixelforge.js patch sprite.json --changes fix.json` previews the report. `--changes -` reads the changes from stdin as a JSON list. Add `--out sprite-v2.json` to save the patched recipe and `--image diff.png` for the before/after image; existing files are kept unless you pass `--force`.

## Efficient workflow

1. Use a 16×16 or 24×24 canvas and 4–8 colors. Establish the silhouette as a readable grid.
2. Save repeated components as symbols. Name colors semantically for shape operations; use one-character palette keys in grids.
3. Build one good resting pose. Create frames with `from` for small changes, or stamp body parts in separate layers for movement.
4. Start at 80–200ms per frame. Add holds intentionally by increasing a pose's duration. Group sequences by behavior: idle, walk, jump, impact.
5. Validate, inspect, patch, repeat; render when the art is right. A valid JSON document can still have a bad silhouette, wrong facing or a jerky loop. Check each animation's contact sheet, read a region grid before editing exact pixels, and confirm each patch changed only the pixels you meant to change.
6. Save the JSON source with the output bundle. Inherit poses instead of repainting the entire image where possible.

## Calling the tool

CLI: `node bin/pixelforge.js inspect sprite.json --out sprite-frames.png`, optionally with `--animation idle` or `--grid --region 4,6,8,6`; `node bin/pixelforge.js patch sprite.json --changes fix.json --out sprite-v2.json` for targeted edits; then `node bin/pixelforge.js render sprite.json --out output/sprite`.

MCP: call `pixel_help` once. Send `{ "project": <recipe> }` to `pixel_inspect` (plus any inspection options) or `pixel_validate`, a cheaper check without images. Afterwards pass `{ "revision": <id> }` instead of the recipe, and use `pixel_patch` for edits. When the art is right, call `pixel_render` with the revision. Rendering returns output paths, including the recipe as `name.pixel.json`, and a PNG contact sheet of **every frame**. Its `preview` metadata gives the region, sheet layout and cell names/durations. Add `"animation": "idle"` to preview that sequence in expanded playback order, including repeated poses; all animations are still exported. The inline preview is static; exported APNGs and `preview.html` play the animation. Every render gets a unique output directory, so iterations do not overwrite earlier results.

Exports include a TexturePacker-style RGBA atlas, named sequences, exact durations, individual frames, APNGs, CSS and a Canvas player. `sheet.scale` applies to every raster export and atlas coordinate. Metadata coordinates are already scaled; do not multiply them again. The browser player's optional `scale` is an additional display scale.

For grid-based game engines, prefer padding 0. For atlas importers, use the exact frame rectangles. Atlas animations list **expanded playback order** (including reverse/pingpong) and a loop flag.

At most 20,000 operations and 67,108,864 estimated drawing pixels are accepted. Animation exports across all sequences are also limited to 67,108,864 scaled pixels. CLI/MCP transport errors and render errors provide actionable paths; don't suppress them.
