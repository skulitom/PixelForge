# PixelForge

To **use** PixelForge for artwork, start with [the pixel art skill](skills/pixel-art/SKILL.md), [the authoring guide](docs/agent-guide.md) and [schema.json](schema.json). [llms.txt](llms.txt) indexes the public documentation; [README.md](README.md) includes CLI and MCP setup. The instructions below apply when **contributing to the toolkit**.

This is an agent-first pixel art toolkit. Keep the core and runtime free of dependencies. Use standard Node.js APIs for the CLI, PNG/APNG encoding, ZIP and the local server. No build step is required.

- `src/core.js`: browser-compatible recipe validation/rasterization/atlas packing and inspection (contact sheets, palette-key grids).
- `src/export.js`, `src/png.js`: deterministic file exports.
- `src/mcp.js`, `src/server.js`: agent and studio interfaces.
- `src/runtime.js`: exported Canvas animation player.
- `studio/`: plain HTML/CSS/JS preview studio; it shares the core renderer.
- `schema.json`: generated with `node scripts/generate-schema.js`.
- `examples/`: generated with `node scripts/generate-examples.js`.

Run `npm test` after functional changes. Keep the schema, authoring reference and runtime validation aligned. Binary export changes should also be checked with an independent image decoder. Do not replace the text-first workflow with a UI-only drawing tool.

Never silently overwrite source recipes or generated assets. MCP renders create unique folders. The preview server must stay on loopback with an explicit asset allowlist and no arbitrary file-writing endpoints.
