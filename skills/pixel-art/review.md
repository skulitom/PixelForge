# Fresh-eyes review of PixelForge art

Instructions for a reviewer who did not make the asset: a separate agent, a teammate, or the author following them strictly. The author knows what each shape was meant to be and so sees it; a reviewer has to report what the pixels actually show. Review only: never patch the recipe, so that critiques stay true rather than easy to fix.

You receive a recipe file or revision id, the path of the brief (usually `asset.brief.md` beside the recipe), and nothing about how the asset was made. PixelForge lives at the project root two directories above this file; run `node bin/pixelforge.js` from there, or use the same arguments with MCP `pixel_inspect`. Write review images to a scratch folder, never over the asset's files.

## Procedure

1. **Cold read, before the brief.** Run `inspect <recipe> --out <scratch>/look.png --native` (MCP: `pixel_inspect` with `native: true`) and look at the native-size sheet first, then the enlarged one. Before opening the brief, write one sentence saying what the picture shows to someone never told what it is, and the three things the eye lands on first. This goes at the top of your report, unchanged.
2. **Compare with the brief.** If the cold read did not name the subject, or missed a part the brief makes central (the face, the held object, the reaction), that is a BLOCKING read failure, whatever else passes.
3. **Mechanical evidence.** `validate <recipe>` for clipping, and `inspect --diagnostics` for findings, per-frame counts and ramp measurements. Treat them as evidence to look at, not verdicts: the brief may exempt holds, sparks or alpha.
4. **Views.** `--view silhouette` and `--view grayscale` at native size against the intended background; `--grid --region x,y,w,h` wherever a position or a line run matters; `--view tile` for tiles; a scene `preview` when the brief gives one.
5. **Animation.** `--animation <name>` shows playback order and timing, and `--view onion` the neighbouring poses. Look at key frames one at a time at full size (`--frames <name>`): the first, the last, holds, contacts, impacts, and any frame where a part is at its largest or smallest. A contact sheet shrinks each frame until a broken shape reads as fine. If you can play the APNG or the studio, watch it; if you cannot, say so.
6. **Rules.** Judge against the [craft reference](../../docs/craft-reference.md) and score the [review rubric](../../docs/review-rubric.md) blind to any score the author gave.

Look for, in order of what they cost the user:

1. The silhouette or cold read fails.
2. Murk: the lit side is not among the lightest values, or the core shadow not among the darkest.
3. Light that contradicts itself, pillow shading, brightness-only ramps.
4. Motion that pops, slides, drifts in volume or runs on one duration through an action.
5. Palette sprawl: near-duplicates, colours outside the palette, more steps than the size can show.
6. Noise: strays, speckle, dither where none is needed, translucent fringes.
7. Line quality: uneven runs, doubled corners, outlines that change treatment.

## Report

```
COLD READ: a short figure in a green hood walking right with a staff taller than itself;
the eye goes to the glowing staff tip, the pale face, the brown boots.

SCORES: read 3, form 2, motion 2, cohesion 3, appeal 2

BLOCKING
- [walk, contact-b, x 9–14, y 16–18] The near and far legs merge into one dark block at 1×; the stride
  does not read. Evidence: silhouette view. Craft reference: silhouette first.

WORTH FIXING
- [all frames] The hood ramp (keys h, H, i) keeps one hue, 4° apart (diagnostics flat-ramp).
  Craft reference: colour ramps.

NOTES
- [idle] The 600 ms hold before the breath reads as calm, as the brief asks.

FIRST FIX: separate the near and far legs in contact-b with a one-pixel gap of the body's light step.
```

- Every finding names the frame and canvas coordinates or region, the evidence (a view, a grid or a diagnostic) and the craft-reference section it falls under.
- **BLOCKING** means a cold-read failure, a broken requirement of the brief, or any rubric axis at 0 or 1. Everything else is WORTH FIXING or a NOTE.
- **FIRST FIX** is the single change with the largest gain: a region and an intent, never "redraw it".
- Never write "looks good". If you find nothing, say what you checked and what works; that is information.

## Comparison mode

When you are given two images (`a.png` and `b.png`) and a brief instead of a recipe, say which is the better asset for the brief and why in one line, then for each BLOCKING finding you are told about, whether it is still present in `a` and in `b`. Look at both at full size before reading any note about which one is newer. Do not score them: a choice between two is stable from one review to the next, separate scores are not.
