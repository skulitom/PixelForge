# Contributing to PixelForge

Contributions from people and agents are welcome. Keep the project focused on editable pixel art recipes, deterministic exports and a useful inspect/revise loop.

## Local setup

Install Node.js 20 or newer, clone your fork and run:

```sh
npm test
node bin/pixelforge.js preview
```

There are no dependencies to install and no build step. The preview studio opens at `http://127.0.0.1:4747`. Run CLI commands from the repository root.

Read [AGENTS.md](AGENTS.md) for the architecture and project constraints. Agents authoring artwork should also read the [pixel art skill](skills/pixel-art/SKILL.md) and [authoring reference](docs/agent-guide.md).

## Propose a change

Open an issue for substantial features or format changes so the scope can be discussed first. For a bug, include the Node.js version, operating system, exact command, expected result, actual result and a minimal recipe if relevant. Remove private paths and credentials from logs.

External contributors should use a branch in their fork and submit a focused pull request. Explain the user-visible result and how you verified it. Documentation fixes and small bug fixes can go straight to a pull request. Agents working for the repository owner follow the standing direct-to-`main` commit and push authorization in [AGENTS.md](AGENTS.md); routine confirmation or a pull request is not required after review and successful checks.

## Verify your work

- Run `npm test` after functional changes. Add a regression test when fixing behavior that the existing tests do not cover.
- Keep runtime validation, [schema.json](schema.json) and [the authoring reference](docs/agent-guide.md) aligned. Regenerate the schemas (`schema.json`, `poses.schema.json`, `scene.schema.json`, `autotile.schema.json`) with `node scripts/generate-schema.js` when intentionally changing a format, and review the diff.
- When intentionally changing bundled examples, use `node scripts/generate-examples.js` and review the recipes and rendered artwork.
- For changes to binary exports, also check with an independent decoder. The optional `scripts/verify-exports.py` check uses Python and Pillow after `npm run demo`. If `output/forest-spirit` already exists, preserve or move that output before running the demo again. `scripts/verify-trim.py` checks trimmed atlases the same way and needs no prior output.
- For studio changes, check the preview at narrow and wide sizes, keyboard access, and animation playback. For artwork changes, inspect every frame, not just recipe validity.

Keep the core and runtime dependency-free. Use Node.js standard APIs for the CLI, file formats and local server. Preserve the text-first workflow, overwrite protection, loopback binding and explicit server asset allowlist.

New code, documentation and original example artwork contributed to this repository are covered by its [MIT license](LICENSE). Only contribute material you have the right to license this way.
