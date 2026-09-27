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

A frame is `{name, duration?, from?, translate?, flipX?, flipY?, ops?, layers?}`.

`duration` is 1–60000 milliseconds, default 100. `from` copies an **earlier** frame; otherwise the frame starts with the project background. Whole-frame flips happen first, then `translate: [dx, dy]`, then `ops`, then layers in array order. Translation leaves newly exposed pixels transparent and clips at the canvas boundary.

Layers are `{name?, visible?, opacity?, x?, y?, ops?}`. They render to a transparent buffer of the **canvas size**, then translate by x/y, then composite in order with source-over alpha. `opacity` is 0–1, applied once to the flattened layer. Hidden layers are validated but not composited. Drawing outside a layer's own canvas is clipped **before** the layer is translated.

Transparent drawing skips pixels. Use `clear` to erase. Clearing a layer erases only that layer's own pixels; it does not erase underlying layers. A `from` frame is already flattened, so later operations can edit or erase its pixels.

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

Look at every frame before exporting. Inspection renders in memory and writes nothing; the CLI saves the contact sheet only when given `--out file.png`.

- **Contact sheet**: one PNG with the selected frames left to right, top to bottom, on a neutral checkerboard with dark gutters. The response lists each cell's frame name and duration, plus the layout (`columns`, `rows`, `scale`, `gap`). The default is every frame in project order. `animation` shows one sequence in playback order, including reverse and pingpong. `frames` lists frame names in any order. The automatic scale is the largest, at most 16, that keeps each cell within 256px and the sheet within 1024px. `scale` (1–16) overrides it, up to a 4096px sheet. `background` is `checker` (default), `transparent`, a palette name or a hex color, such as your game's backdrop.
- **Palette-key grids** (`grid: true`, CLI `--grid`): each distinct selected frame read back in the recipe's grid format. A pixel whose exact RGBA matches a single-character palette key shows that key; `.` is fully transparent. Any other color, whether a multi-character palette name, a literal hex color or a semi-transparent blend, gets a legend symbol: a digit, letter or punctuation mark that is not a palette key. One legend covers every grid in the response. `?` counts any colors left once the symbols run out. Grids are limited to 16,384 pixels in total. MCP prints them with x/y rulers; the CLI returns JSON `rows` that start at the region's top-left corner.
- **Region** (`region: {x, y, w, h}`, CLI `--region x,y,w,h`): crops every cell and grid to a canvas rectangle. Smaller regions are shown larger, so you can compare a face across a blink or read the pixels around a joint without printing the whole canvas.

## Efficient workflow

1. Use a 16×16 or 24×24 canvas and 4–8 colors. Establish the silhouette as a readable grid.
2. Save repeated components as symbols. Name colors semantically for shape operations; use one-character palette keys in grids.
3. Build one good resting pose. Create frames with `from` for small changes, or stamp body parts in separate layers for movement.
4. Start at 80–200ms per frame. Add holds intentionally by increasing a pose's duration. Group sequences by behavior: idle, walk, jump, impact.
5. Validate, inspect, fix, repeat; render when the art is right. A valid JSON document can still have a bad silhouette, wrong facing or a jerky loop. Check each animation's contact sheet, and read a region grid before editing exact pixels.
6. Save the JSON source with the output bundle. Inherit poses instead of repainting the entire image where possible.

## Calling the tool

CLI: `node bin/pixelforge.js inspect sprite.json --out sprite-frames.png`, optionally with `--animation idle` or `--grid --region 4,6,8,6`; then `node bin/pixelforge.js render sprite.json --out output/sprite`.

MCP: call `pixel_help` once. While iterating, call `pixel_inspect` with `{ "project": <recipe> }` plus any inspection options; `pixel_validate` is a cheaper check without images. When the art is right, call `pixel_render` with `{ "project": <recipe> }`. Rendering returns output paths and a magnified first-frame PNG preview. Every render gets a unique output directory, so iterations do not overwrite earlier results.

Exports include a TexturePacker-style RGBA atlas, named sequences, exact durations, individual frames, APNGs, CSS and a Canvas player. `sheet.scale` applies to every raster export and atlas coordinate. Metadata coordinates are already scaled; do not multiply them again. The browser player's optional `scale` is an additional display scale.

For grid-based game engines, prefer padding 0. For atlas importers, use the exact frame rectangles. Atlas animations list **expanded playback order** (including reverse/pingpong) and a loop flag.

At most 20,000 operations and 67,108,864 estimated drawing pixels are accepted. Animation exports across all sequences are also limited to 67,108,864 scaled pixels. CLI/MCP transport errors and render errors provide actionable paths; don't suppress them.
