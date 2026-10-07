# Diorama study

An original 3/4 top-down dungeon room in the "floating diorama" style: 8-pixel tiles, wall caps with front faces, a sunken pool fed by a waterfall, props, torches, moss, cliffs and chains, and a 7×10 hero who walks in, strikes and breaks a pot. It was built with PixelForge's existing features to find out what that style asks of the toolkit. The findings and proposed changes are in [the feasibility report](../../docs/reports/diorama-feasibility-2026-10-07.md).

![The study room at 4×](../../docs/images/diorama/room.png)

[Animated GIF](../../docs/images/diorama/room.gif) · [Blue theme](../../docs/images/diorama/room-blue.png)

## Build and view

```sh
node showcase/diorama/build.mjs --force
node bin/pixelforge.js preview showcase/diorama/art/room.scene.json
```

`build.mjs` is the authoritative source. It writes `art/`, refusing to overwrite existing files unless you pass `--force`. `--theme blue` writes the same room with a blue-stone palette to `art-blue/`.

| File in `art/` | What it is |
| --- | --- |
| `palette.json` | 31 colours, linked by every recipe |
| `cap.json` | Two 47-tile blob sets for the wall caps, plain and cracked, merged into one recipe |
| `water.autotile.json` → `water.json` | The sunken pool: a 47-tile blob set with four palette-cycled variants |
| `tiles.json` | Floor variants, brick patches, north wall faces, cliff faces and the scrolling waterfall halves |
| `props.json` | Barrels, pots, crates, pillars, chest, torch, foam, banner, chains, cobwebs and floor decals |
| `hero.json` | Idle, walk down, walk right and a three-pose attack |
| `slash.json` | The strike's smear |
| `shards.fx.json` → `shards.json` | The pot's debris, a seeded particle burst |
| `moss.json` | A map-sized moss decal, dithered and cleaned up with rewrite rules |
| `room.scene.json` | The scene: six tilemaps, the decal and 42 placed props, actors and effects |
