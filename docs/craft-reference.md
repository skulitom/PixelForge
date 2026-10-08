# Pixel-art craft reference

Starting points for the decisions the [art workflow](art-workflow.md) asks you to make, each paired with the PixelForge view or diagnostic that shows the problem. They are conventions, not laws: a brief or a deliberate style overrides any of them, and every number is a first guess to check at native size and in playback. The [review rubric](review-rubric.md) and the [fresh-eyes review](../skills/pixel-art/review.md) judge against this page.

## Colour ramps

A ramp is the run of colours one material passes through from shadow to light. Declare it in `ramps`, dark to light, so `shade`, scene shade placements and ramp lighting stay on it, and read it in `inspect --diagnostics`: `ramps[]` lists each step's `lightness` and `chroma` (OKLab ×100) and the `hueShift` between the darkest and lightest coloured steps.

- **Steps.** Three steps (shadow, base, light) suit a 16 px sprite; four or five suit 32 px and larger surfaces. A step you cannot point to in the art can go. Neighbouring steps must be told apart at 1×: `near-duplicate` flags used colours closer than about 2.
- **Value spacing.** Roughly even `lightness` gaps read as a smooth form. One gap much smaller than the rest merges two steps; one much larger makes a hard band. `ramp-order` flags a step that is not lighter than the one before it.
- **Hue shift.** A shadow is rarely the same hue made darker. Under warm light, turn shadows toward blue or purple and lights toward yellow; under cool light, the reverse. Shift both ends, not only the darkest step. `flat-ramp` fires when the coloured steps stay within 10° of one hue.
- **Saturation.** Chroma usually peaks in the middle steps. A highlight more saturated than its base reads as glow or a different material; a near-grey darkest step is normal.
- **Sharing.** Materials that touch can share their dark steps (one shadow colour for cloth and skin), which unifies the picture and saves slots. Share the exact colour rather than adding a near-duplicate.
- **Outlines.** An outline from a darker step of each material's own ramp (a selective outline) reads softer than black everywhere. Keep the darkest line for the silhouette edge against the background.

## Value and readability

- **Squint test.** In `--view grayscale`, the subject's lit side should be among the lightest values in the picture and its core shadow among the darkest. When every surface sits in the bottom third of the value range the sprite reads as murk; limited palettes invite this, because "shaded" becomes the darkest step everywhere.
- **Silhouette first.** `--view silhouette` at native size must still say what the subject is. If it does not, no shading will rescue it: reshape the contour, open negative space between limbs and body, exaggerate the identifying part.
- **Separation.** Check the subject against the background it will stand on (`preview` a scene). One value step between the subject's edge and the background loses the edge; a darker outline or a lit rim (`outline` with `position: "inside"` and `directions`) restores it.
- **Detail budget.** Detail smaller than the reading size is noise. At 16 px, single pixels must carry meaning (an eye, a buckle); texture belongs on surfaces six pixels or more across.

## Lines and clusters

- **Line runs.** A curve steps in runs that grow or shrink steadily (1, 1, 2, 2, 3 or 3, 2, 1); runs that jump (1, 3, 1, 4) look jagged. A 45° line is runs of one, a 2:1 slope runs of two. Read exact runs with `--grid --region`.
- **Corners.** An L-shaped step inside a one-pixel line thickens it at that point. Diagnostics count them as `corners`; a `cleanup` patch previews the fix. Keep the ones where the line turns deliberately.
- **Clusters.** Group pixels of one colour into shapes that describe something. A lone pixel (`isolated`, `strays`) reads as dirt unless it is an eye, a highlight or a spark.
- **Pillow shading.** Shading that follows the outline inward (dark rim, light centre) ignores the light. Shade by direction: surfaces facing away from the light take the shadow step whatever the outline does.
- **Banding.** One-pixel stripes of successive ramp steps hugging the same edge read as contour lines. Vary their widths, end one step before the next, or merge steps.
- **Anti-aliasing.** An in-between step belongs inside the sprite, where both neighbours are known. Against transparency it fringes on every background the art was not drawn for; a game sprite should not have it (`translucent` counts partly transparent pixels).
- **Dither.** Use it for transitions and large flat areas (a sky, ground, a shading band limited with `over`), not across a whole small sprite, where it turns to noise at 1×.

## Size budgets

Common starting proportions for characters, in canvas pixels. A larger canvas allows more detail; it does not require it.

| Character height | Head | Eyes | Hands and feet |
| --- | --- | --- | --- |
| 8–12 px | about half the height | none, or one pixel | none: limbs are single lines or omitted |
| 16 px | 5–8 px | one pixel, or 1×2 | 1–2 px blobs; feet 2–3 px wide |
| 24 px | 7–10 px | 1×2 or 2×2 | 2×2 mittens; feet 3–4 px |
| 32 px | 8–12 px stylized, 5–6 px realistic | 2×2 to 2×3, room for a highlight | 3×3 mittens with a one-pixel thumb |
| 48–64 px | a fifth to a seventh of the height when realistic | shaped, with lids | fingers separated by one-pixel gaps |

- **Exaggerate identity.** Make what identifies the subject (a hat, a weapon, ears, a lantern) a pixel or two larger than realism suggests. Big heads and eyes buy readability at small sizes; realistic proportions need about 48 px to read.
- **Odd or even.** A face with an odd width has a centre column for a nose or a one-pixel mouth; an even width centres a two-pixel mouth. Decide before drawing the head, because it fixes where the eyes go.
- **Keep sizes across frames.** A limb or head that gains or loses a pixel between poses reads as wobble. Compare poses with `--view onion` and `--grid` on the same region.

## Timing and spacing

PixelForge durations are milliseconds per frame. These starting values are for game sprites; adjust them by watching the APNG or the studio at native size.

| Motion | Frames | Duration per frame |
| --- | --- | --- |
| Idle breathing or bob | 2–4 | 150–400 ms, with a one-pixel rise on the inhale |
| Blink | one closed frame | 80–120 ms, after a long open hold |
| Walk cycle | 4–8 | 80–150 ms |
| Run cycle | 6–8 | 60–100 ms |
| Attack | anticipation 1–3, strike 1–2, impact 1, recovery 2–4 | 80–150, 30–60, 80–200 and 80–150 ms |
| Jump | crouch 1–2, rise, apex, fall, land 1–2 | longest at the apex and on the landing squash |
| Hit flash | 1 | 40–80 ms, the pose remapped to white or an accent |
| Burst effect | 3–8 | fast birth (30–60 ms), slower decay (80–150 ms) |

- **Spacing makes easing.** At pixel scale, easing is the distance between successive positions: 1, 2, 4, 4, 2, 1 pixels starts slow, travels fast and settles. Equal distances read mechanical, which suits only constant motion such as a scrolling cloud. Pose `tween` easings and scene trajectory `ease` produce these spacings.
- **Vary the timing of actions.** Hold the poses that matter (anticipation, contact, impact) and pass quickly through in-betweens. Locomotion cycles are the exception: even timing is normal there.
- **Anticipate.** Before a fast action, move briefly the other way: a crouch before a jump, a wind-up before a swing. Heavier actors anticipate longer.
- **Land the impact.** The frame after contact can be held (hit-stop) and exaggerated with a smear, a flash or a squash. A pose shown for under about 50 ms registers only as blur; make sure that is the intent.
- **Walk mechanics.** Contact (legs apart, heel down), down (weight lands, body a pixel lower), passing (legs cross) and up (push-off, body a pixel higher), then the same for the other leg; arms swing against the legs. A four-frame cycle keeps contact and passing for each leg.
- **Contact and volume.** A foot carrying weight stays on the same pixel; check it with `--view onion` and a scene placement with `anchor: "frame"`. A body keeps its pixel volume between frames unless squash and stretch is intended.
- **Loops.** The last frame must lead into the first; `loop-jump` measures the boundary. For video, prefer durations that are whole video frames (`validate --fps`).

## Signs of generated or unrevised art

Reviewers recognize these at a glance. Most have a PixelForge view or finding that exposes them.

| Sign | How to see it | Fix |
| --- | --- | --- |
| Brightness-only ramps | `flat-ramp`, `ramps[].hueShift` | Rebuild the ramp with a hue shift; change the palette keys, not the drawing |
| Near-identical colours | `near-duplicate` | Merge the keys |
| Shapes left as primitives: perfect ellipses, rectangles, straight bands | contact sheet at native size | Redraw contours with a grid patch; break the regularity |
| Pillow shading, banding | `--view grayscale` | Shade from the light; vary band widths |
| Noise or dither everywhere | native-size sheet, `strays` | Group into clusters; keep dither for transitions |
| Stray single pixels | `isolated`, `strays` | Remove them, or make them deliberate |
| Jagged runs and doubled corners | `--grid --region`, `corners` | Even the runs; preview a `cleanup` patch |
| Perfect mirror symmetry | `--view silhouette` | Turn the pose; offset hair, props and light |
| Mixed pixel sizes | native-size sheet | Do not `scale` stamps, grids or text beside 1× art |
| One duration on every frame of an action | inspect timing | Hold key poses; shorten in-betweens |
| Sliding feet, drifting volume | `--view onion`, anchored scene | Pin contacts; keep part sizes |
| Translucent fringes | `translucent` per frame | Opaque colours; alpha only for declared shadows and glows |
| More colours than the size can show | `colors` per frame | Remove steps nobody can find |

## Provenance

The topics follow the gaps found when comparing PixelForge's guidance with the pixel-art rulebook of [aseprite-ai-artist](https://github.com/with-pebbly/aseprite-ai-artist) (MIT): see the [competitive review](competitive-review.md#adopted-from-aseprite-ai-artist). The text, numbers and tables here are written for PixelForge from widely taught conventions; none of that rulebook's text or templates is copied.
