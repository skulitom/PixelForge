# PixelForge art benchmark

Fixed briefs for testing whether a workflow (a PixelForge version, its guidance, the fresh-eyes review loop, a model, or another tool) makes better art, so that such claims rest on recorded runs rather than on features. It answers the open validation item in the [competitive review](../docs/competitive-review.md#validation-before-claiming-an-advantage) and the benchmark the [art-quality roadmap](../docs/reports/pixelforge-art-quality-roadmap.md#how-to-test-whether-pixelforge-actually-improves) asks for. No run has been recorded yet, so nothing here supports a quality claim.

## The briefs

| Brief | What it tests | Machine checks | Judged |
| --- | --- | --- | --- |
| [`icon`](briefs/icon.json) | A complete object at 16×16 in the 16-colour PICO-8 palette, readable on a dark and a light slot | canvas, one named frame, palette and alpha, empty margin | cold read, light, materials |
| [`walker`](briefs/walker.json) | A 24×24 character held on model through an idle and a walk, with a swinging lantern | canvas, palette, frame counts, loops and durations, feet on one row, height | cold read, gait, follow-through, on model |
| [`tile`](briefs/tile.json) | Two 16×16 floor tiles that repeat seamlessly and swap for each other | canvas, frames, palette, 8 colours per tile, opaque, seam evidence, shared edge ring | repeat, variant |
| [`revision`](briefs/revision.json) | A precise change to existing art ([the lantern skink](../examples/quality/skink.json)) in two named frames only | canvas, palette, the new tail tip, no unrequested pixel in any frame, both frames' tails identical | taper |

A brief file holds `brief`, the paragraphs handed to the agent; `setup`, with the canvas, the palette and an optional `base` recipe; and `criteria`, each either a machine `check` or `judge: true`. Every requirement in the text is a criterion, and each criterion is checked by the tool its `check` names or by a judge. A brief that changes gets a new `revision`; results from different revisions are not compared. The briefs are original to PixelForge and kept out of the examples, so a memorized sample cannot pass for general ability.

## Running a brief

1. **One fresh session per attempt**, started in an empty folder outside this repository, with PixelForge available through its MCP server or its CLI by absolute path. For `revision`, copy the base recipe (or its rendered sheet and atlas, for another tool) into that folder. Do not point the agent at `benchmark/`: the criteria and earlier runs are there.
2. **Hand over exactly the brief's paragraphs**, joined by blank lines, plus one sentence naming where to save the result: a recipe for PixelForge, or a PNG sprite sheet at native size with a JSON atlas for another tool. Nothing else; the agent's own skills choose the path, and that choice is part of what is measured.
3. **Do not intervene.** If the agent asks a genuine question, answer from the brief only and record it as an intervention.
4. **Capture the evidence** when the agent says it is done: the output, an `inspect --native` sheet, for animations each animation's sheet and APNG, the agent's final report verbatim, and from the harness's log the wall time, tool calls, input and output tokens and number of revisions.
5. **Check the mechanics:** `node benchmark/check.mjs benchmark/briefs/<id>.json <output.json | output.png> [--atlas atlas.json]` prints each machine criterion with its evidence and exits with 1 when one fails. A PNG is imported losslessly; frames are keyed by name with durations, and the atlas's `animations` or Aseprite's `meta.frameTags` name the animations. Editor file names such as `walk 0.png` become portable frame names.
6. **Judge blind.** Rename the evidence to run numbers, hide tools, models and workflows, and have at least two judges score the [review rubric](../docs/review-rubric.md) and pass or fail each judged criterion. A model never judges a run it took part in.
7. **Repeat.** Run each brief at least three times per workflow and report every attempt, failures included, not only the best.

## Scoring

Keep three results apart, because they answer different questions:

| | Question | Decided by |
| --- | --- | --- |
| Compliance | Did it do what the brief said? | machine checks and judged criteria passed |
| Craft | Is it good? | blind rubric scores, per axis |
| Cost | What did it take? | minutes, tool calls, tokens, revisions, interventions, unrequested pixels |

Do not fold them into one number: the weighting would decide the ranking. Report the median and the spread across attempts for each, and keep the assets and the judges' notes as the actual evidence.

## Comparisons worth running

- **Ablation**, with one model: the pixel-art skill alone; plus the [fresh-eyes review loop](../docs/art-workflow.md#review-by-fresh-eyes); plus the [craft reference](../docs/craft-reference.md). This separates better instructions from better tools.
- **Other tools**, with the same briefs and model: for example [aseprite-ai-artist](https://github.com/with-pebbly/aseprite-ai-artist), whose sprite sheet and Aseprite JSON export the checker reads directly. Record the setup steps each tool needed.

## Recording a run

Store each attempt in `benchmark/runs/<date>-<brief>-<workflow>-<attempt>/` with its output, sheets, APNG, the agent's final report and a `run.json`:

```json
{
  "brief": "walker", "briefRevision": 1, "date": "2026-10-08", "attempt": 1,
  "tool": "PixelForge 0.7.1 at <commit>", "workflow": "skill + fresh-eyes review", "model": "<model id>",
  "metrics": { "minutes": 14, "toolCalls": 52, "inputTokens": 410000, "outputTokens": 38000, "revisions": 9, "interventions": 0 },
  "check": "<the checker's JSON output>",
  "judged": { "read": [true, true], "gait": [false, true], "lantern": [true, true], "on-model": [true, true] },
  "ratings": [{ "judge": "human:alex", "scores": { "read": 3, "form": 2, "motion": 2, "cohesion": 3, "appeal": 2 }, "note": "…" }]
}
```

Machine checks verify the brief's mechanics; `seamless` reuses PixelForge's advisory seam evidence. None of them measures taste, which is why judged criteria and the rubric exist.

The approach (fixed, complete briefs with tool-checked criteria, scored separately from a blind craft rubric, with cost recorded but not ranked) follows the benchmark of [aseprite-ai-artist](https://github.com/with-pebbly/aseprite-ai-artist) (MIT). See the [competitive review](../docs/competitive-review.md#adopted-from-aseprite-ai-artist).
