# Using PixelForge assets in games

The bundle deliberately keeps the interchange format simple: RGBA PNGs plus JSON frame rectangles. Every frame retains the full canvas and common origin; no trimming or rotation is performed during atlas packing. Use nearest-neighbor filtering and whole-pixel placement for crisp rendering.

## Phaser

Load the exported sheet with Phaser's [atlas loader and texture manager](https://docs.phaser.io/phaser/concepts/textures):

```js
preload() {
  this.load.atlas('spirit', 'assets/forest-spirit.png', 'assets/forest-spirit.atlas.json');
}
create() {
  this.add.sprite(200, 200, 'spirit', 'rest').setScale(4);
}
```

Set `pixelArt: true` in the game configuration. The atlas's extra `animations` object is PixelForge metadata; import it explicitly when building your engine's animation definitions. Each entry contains an expanded list of frame names, the total duration, and a loop flag. Per-frame durations live in `frames[name].duration` in milliseconds. Do not assume a constant frame rate when a recipe uses unequal durations.

## Godot, Unity and other grid importers

Set `sheet.padding` to `0`. Cell dimensions are `project.width × sheet.scale` and `project.height × sheet.scale`. Set your importer to multiple sprites or a frame grid and use `sheet.columns` horizontal cells. A partially filled last row contains transparent unused cells; use only the number of frames in the JSON.

Alternatively, import the PNGs in `frames/`, which removes any need for atlas slicing. Transfer the duration in milliseconds for each frame into the engine's frame-delay or keyframe controls. The source canvas is not trimmed, so the same pivot/origin keeps frames aligned.

## Canvas

The exported `player.js` provides a complete player, without an engine or runtime package dependency:

```js
import { SpritePlayer } from './player.js';
const player = await SpritePlayer.load(canvas, './forest-spirit.atlas.json', { scale: 4 });
player.play('idle');
player.pause();
player.resume();
player.play('blink'); // A once-only sequence holds its last frame.
// Release the animation loop when the component is removed:
player.destroy();
```

Use an HTTP server for module imports/fetch. The separate `preview.html` and APNGs work directly from disk. APNGs follow the [PNG specification](https://www.w3.org/TR/png-3/) and use full-frame source replacement, preserving transparency without motion trails.

## Atlas contract

```json
{
  "frames": {
    "rest": {
      "frame": { "x": 1, "y": 1, "w": 24, "h": 24 },
      "rotated": false,
      "trimmed": false,
      "spriteSourceSize": { "x": 0, "y": 0, "w": 24, "h": 24 },
      "sourceSize": { "w": 24, "h": 24 },
      "duration": 240
    }
  },
  "animations": {
    "idle": { "frames": ["rest"], "loop": true, "duration": 240 }
  },
  "meta": { "image": "forest-spirit.png", "size": { "w": 26, "h": 26 }, "scale": "1" }
}
```

`frame` gives the exact source rectangle in the PNG, including export scale but excluding surrounding transparent padding. `meta.scale` records the scale already applied; do not multiply coordinates by it. The TexturePacker-style frame layout is intended for existing atlas importers, but engine-specific integration should be checked in your target engine; this repository tests the bundled Canvas runtime and binary exports.
