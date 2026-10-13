# 0.8.0

Renamed from PixelForge to Pixelbolt. The `pixelforge` command, the `pixelforge-*` recipe formats and the MCP tool names are unchanged.

The bundle is now `pixelbolt.mcpb` (checksum `pixelbolt.mcpb.sha256`), and portable Studio builds are named `PixelboltStudio-<version>-<target>`. The `pixelforge` alias stays for at least two releases.

Pixelbolt turns editable JSON recipes into pixel art and sprite animation. `pixelbolt.mcpb` contains the local Node.js MCP server, its eight tools, schemas and authoring help. The server makes no network requests.

Download `pixelbolt.mcpb` and open it in Claude Desktop, or use Settings -> Extensions -> install from file. Choose a workspace for recipes and generated artwork, then ask the agent to call `pixel_help`. The bundle uses the client's Node.js runtime (20 or newer); it does not include Node.js.

Download `pixelbolt.mcpb.sha256` beside the bundle to check its SHA-256:

```sh
sha256sum --check pixelbolt.mcpb.sha256
gh attestation verify pixelbolt.mcpb --repo skulitom/Pixelbolt --signer-workflow skulitom/Pixelbolt/.github/workflows/release.yml
```

On PowerShell, `(Get-FileHash pixelbolt.mcpb -Algorithm SHA256).Hash` should match the hash in the checksum file.

The GitHub release makes the bundle available immediately. MCP Registry publication is a separate, manually dispatched step after testing; see [Publishing](https://github.com/skulitom/Pixelbolt/blob/main/docs/PUBLISHING.md).
