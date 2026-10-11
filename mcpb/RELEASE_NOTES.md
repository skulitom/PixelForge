PixelForge turns editable JSON recipes into pixel art and sprite animation. `pixelforge.mcpb` contains the local Node.js MCP server, its eight tools, schemas and authoring help. The server makes no network requests.

Download `pixelforge.mcpb` and open it in Claude Desktop, or use Settings -> Extensions -> install from file. Choose a workspace for recipes and generated artwork, then ask the agent to call `pixel_help`. The bundle uses the client's Node.js runtime (20 or newer); it does not include Node.js.

Download `pixelforge.mcpb.sha256` beside the bundle to check its SHA-256:

```sh
sha256sum --check pixelforge.mcpb.sha256
gh attestation verify pixelforge.mcpb --repo skulitom/PixelForge --signer-workflow skulitom/PixelForge/.github/workflows/release.yml
```

On PowerShell, `(Get-FileHash pixelforge.mcpb -Algorithm SHA256).Hash` should match the hash in the checksum file.

The GitHub release makes the bundle available immediately. MCP Registry publication is a separate, manually dispatched step after testing; see [Publishing](https://github.com/skulitom/PixelForge/blob/main/docs/PUBLISHING.md).
