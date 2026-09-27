---
name: pixelforge-pixel-art
description: Create and revise deterministic pixel art and animations with PixelForge JSON recipes; export PNG sheets, APNG and game metadata.
---

# PixelForge pixel art

Use this when creating pixel sprites, tiles, icons, effects or short sprite animations. PixelForge lives at the project root two directories above this skill's directory. Run its CLI with Node.js, or use its MCP tools if configured.

Read `docs/agent-guide.md` before creating the first recipe. Use `schema.json` for exact field names. Begin with one of the files in `examples/` if helpful.

1. Choose a small canvas and cohesive palette appropriate to the requested asset.
2. Write a JSON recipe in a user-appropriate output location. Use text grids and reusable symbols; reuse frames for small changes.
3. Validate with `node bin/pixelforge.js validate <recipe>`.
4. Inspect every frame with `node bin/pixelforge.js inspect <recipe> --out <frames.png>` and look at the image; use `--animation <name>` to review motion in playback order. Before changing exact pixels, read them with `--grid --region x,y,w,h`. Fix silhouette, color and timing problems and inspect again; validation alone does not prove the art is good.
5. Render with `node bin/pixelforge.js render <recipe> --out <directory>`. Choose a fresh output directory for each iteration unless replacing your own generated output intentionally.
6. Return links to the source recipe, sheet, atlas JSON and preview, with a short integration note for the intended web app or engine.

For MCP, call `pixel_help`, then `pixel_inspect` with `{ "project": recipe }` while iterating. Add `animation`, `region` or `grid: true` as needed. Call `pixel_render` to export.

Avoid gradients, subpixel geometry and antialiasing. Respect the project's requested pixel dimensions. Preserve editable source. Export at scale 1 for game assets unless the user asks for larger pixels baked into the files.
