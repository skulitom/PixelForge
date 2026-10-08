# Art review rubric

Validation answers whether a recipe is well formed; a brief's criteria answer whether the art does what was asked. Neither says whether it is good. This rubric scores that, on five axes from 0 to 4 against written anchors, so that two judges looking at the same asset land in the same place. The [fresh-eyes review](../skills/pixel-art/review.md) uses it to decide what blocks, and the [benchmark](https://github.com/skulitom/PixelForge/blob/main/benchmark/README.md) uses it to compare runs. What each axis looks for is explained in the [craft reference](craft-reference.md).

## How to judge

- **Judge blind.** Look at the native-size sheet, an enlarged sheet and the animation before reading anything about how the asset was made, which tool or model made it, or other judges' scores. Read the brief so you know what was asked.
- **Judge the final output,** at native size first. An enlargement helps you find a problem; it is not where the asset will be seen.
- **Use the anchors, not your mood.** When an asset sits between two anchors, choose the lower one unless every part of the higher anchor holds.
- **Never judge your own work as a judge.** The author's self-review is useful, but it is not a rubric score. A model never rates a run it took part in.
- **Score `motion` only when the asset is animated.**
- **Write a note** for any 0, 1 or 4: what you saw and where (frame, coordinates).

```json
{ "judge": "human:alex", "scores": { "read": 3, "form": 2, "motion": 3, "cohesion": 3, "appeal": 2 }, "note": "Clear arcs; the coat loses its light side in recoil-2." }
```

## `read`: silhouette and readability

What the eye gets at 1×, at a glance.

| | |
| --- | --- |
| 0 | Nobody could name the subject unprompted. |
| 1 | The subject can be named, but important parts fuse with each other or with the background. |
| 2 | Named at first glance; one or two important parts blur at native size. |
| 3 | Every important part survives at native size, and the silhouette alone identifies the subject. |
| 4 | Identified instantly, and the eye goes to the intended focal point first. |

## `form`: light, volume and material

| | |
| --- | --- |
| 0 | Flat colour, or shading no single light could produce. |
| 1 | A light direction is implied but inconsistent, or the shading follows the outline or only darkens. |
| 2 | One consistent light and believable volume on the big forms, but every material looks the same. |
| 3 | One consistent light, ramps that shift hue, and materials that can be told apart by their shading. |
| 4 | Everything in 3, plus restrained secondary light (bounce, rim or glow) that deepens the form. |

## `motion`: timing, spacing and arcs

Animations only.

| | |
| --- | --- |
| 0 | No movement reads: frames pop, teleport or barely change. |
| 1 | The movement can be followed but is mechanical: even spacing and timing on an action, straight paths. |
| 2 | Key poses and varied timing, but in-betweens slide, volumes drift or loose parts move rigidly. |
| 3 | Anticipation, action and follow-through (or a seamless cycle), with eased spacing, arcs and loose parts that trail. |
| 4 | Everything in 3, with weight: holds, smears and impact frames placed where they hit hardest. |

## `cohesion`: clean pixels and one style

Palette, pixel craft, and consistency across every asset the brief asked for.

| | |
| --- | --- |
| 0 | Colours clash, pixel sizes or styles are mixed, or noise covers the asset. |
| 1 | A single style executed carelessly: strays, jagged lines, banding or soft edges throughout. |
| 2 | Clean main forms; a handful of strays, jagged runs or outline inconsistencies remain. |
| 3 | Clusters, outlines and dither are deliberate and consistent; the palette works as a system across the set. |
| 4 | Nothing a pixel artist would move for cleanliness. |

## `appeal`: would you use it

| | |
| --- | --- |
| 0 | Unusable. |
| 1 | A placeholder that would certainly be replaced. |
| 2 | Good enough to ship in a small project, without distinction. |
| 3 | Has an idea and some charm; worth showing. |
| 4 | Worth putting on the project's front page. |

## Provenance

Scoring craft on a few named axes with a written anchor for every score, judged blind and kept apart from brief compliance, follows the craft rubric of [aseprite-ai-artist](https://github.com/with-pebbly/aseprite-ai-artist) (MIT). The axis names are kept so scores can be compared across the two tools; the anchor text is PixelForge's own.
