---
name: pixelforge-pixel-art
description: Create and revise deterministic pixel art and animations with PixelForge JSON recipes; export PNG sheets, APNG and game metadata.
---

# PixelForge pixel art

Use this when creating pixel sprites, tiles, icons, effects or short sprite animations. PixelForge lives at the project root two directories above this skill's directory. Run its CLI with Node.js, or use its MCP tools if configured.

Read `docs/agent-guide.md` before creating the first recipe. Use `schema.json` for exact field names. Begin with one of the files in `examples/` if helpful.

For finished artwork, also read `docs/art-workflow.md` and the worked before/after study in `docs/art-quality-lab.md`. Establish a small art brief outside the recipe: native/display size, three silhouette landmarks, palette roles, light direction, material rules, outline treatment, action intent, contact/origin and scene role. Record the actual strengths and failures of each review. A rendered file, frame count or passing test is not evidence of artistic quality. These checkpoints do not require user permission.

Work in this order: **silhouette → large connected color shapes → material accents → authored action poses → timing → scene integration**. Do not mass-generate variants before the resting silhouette and one action read well. Use primitive geometry as a blockout; revise contours and connected color groups deliberately. Noise and extra glow cannot fix weak structure. Design different behaviors for water, fire and crystal rather than recoloring identical geometry.

1. Choose a small canvas and cohesive palette appropriate to the requested asset.
2. Write a JSON recipe in a user-appropriate output location. Use text grids and reusable symbols; reuse frames for small changes.
3. Validate with `node bin/pixelforge.js validate <recipe>`.
4. Inspect every frame with `node bin/pixelforge.js inspect <recipe> --out <frames.png> --native --diagnostics` and look at both sizes. Review `--view silhouette` and `--view grayscale` against the intended background; use `--animation <name> --view onion` for previous/next poses in playback order. Watch the studio/APNG too: a static sheet is not motion review. Before changing exact pixels, read them with `--grid --region x,y,w,h`. `node bin/pixelforge.js patch <recipe> --changes <changes.json>` previews a targeted edit and lists every pixel it changes, including inherited poses; add `--out <new recipe>` to save it. Use grid/mask patches for coherent shapes; dots preserve and an explicit erase character clears. Choose `scope: "frame"` when other poses must retain their current pixels; otherwise edits propagate.
5. Render with `node bin/pixelforge.js render <recipe> --out <directory>`. Choose a fresh output directory for each iteration unless replacing your own generated output intentionally.
6. Return links to the source recipe, sheet, atlas JSON and preview, with a short integration note for the intended web app or engine.

For MCP, call `pixel_help`, then `pixel_inspect` with `{ "project": recipe }`, adding `animation`, `region` or `grid: true` as needed. Later calls take the returned `revision` instead of the full recipe. Revisions persist in the configured output directory across restarts, including unexported work; keep using the same absolute `--out` path. Fix problems with `pixel_patch` and check that only the intended pixels changed. Use `{ "paint": "frames[blink]", "value": [{ "x": 9, "y": 7, "color": "k" }] }` inside `changes` for exact canvas-coordinate corrections after all layers. `transparent` erases; palette and hex colors replace exact RGBA. The original layers stay editable, and inherited frames also receive the correction. The same changes work with the CLI patch command. Call `pixel_render` with the final revision to export; the bundle includes the patched recipe and the response previews all frames. Add `animation` to preview a sequence in playback order.

Avoid gradients, subpixel geometry and antialiasing. Respect the project's requested pixel dimensions. Preserve editable source. Export at scale 1 for game assets unless the user asks for larger pixels baked into the files.

Use the pose compiler for named parts, authored shape replacements, attachments and cue metadata. Keep the pose source authoritative. Use fingerprinted overlays for approved corrections after a generator rebuild; a changed base must be reviewed before creating a new overlay. Use a bounded scene manifest to review overlapping silhouettes, value hierarchy, density and persistent aftermath. PNG import can preserve a native RGB/RGBA editor correction without pretending to reconstruct drawing operations. Optional normal/emissive passes come after the base art works.

Advisory findings are prompts to inspect, not commands to delete pixels. Exempt intentional holds, eyes, sparks, literal colors and alpha blends in the brief. Keep original assets and failed comparisons. If asked for a named game's quality level, make original art and report what the visible evidence supports; do not equate new features or automated tests with matching that game's art direction.
