// Prints ready-to-paste MCP settings for this folder. It only prints: no agent's configuration file is read or
// changed.   --json   the same settings as one JSON document (used by automated checks)
import path from 'node:path';
import { app, folder, node } from './layout.mjs';

const server = { command: node, args: [path.join(app, 'bin', 'pixelforge.js'), 'mcp', '--out', path.join(folder, 'output')] };
const json = JSON.stringify({ mcpServers: { pixelforge: server } }, null, 2);
// JSON string escapes are also valid TOML basic-string escapes, so Windows paths survive in both.
const toml = `[mcp_servers.pixelforge]\ncommand = ${JSON.stringify(server.command)}\nargs = [${server.args.map(value => JSON.stringify(value)).join(', ')}]`;
const clients = [
  { id: 'claude-code', name: 'Claude Code', format: 'json', text: json, where: 'Save as .mcp.json in your project folder. If that file already lists\nservers, add the "pixelforge" entry to its "mcpServers".' },
  { id: 'claude-desktop', name: 'Claude Desktop', format: 'json', text: json, where: 'Settings > Developer > Edit Config shows claude_desktop_config.json. If it\nalready lists servers, add the "pixelforge" entry to its "mcpServers".\nRestart Claude Desktop afterwards.' },
  { id: 'codex', name: 'Codex', format: 'toml', text: toml, where: 'Add to config.toml in the .codex folder of your user profile.' },
  { id: 'cursor', name: 'Cursor', format: 'json', text: json, where: 'Save as mcp.json in the .cursor folder of your user profile, or of one\nproject. If that file already lists servers, add the "pixelforge" entry to\nits "mcpServers".' }
];

if (process.argv.includes('--json')) console.log(JSON.stringify({ folder, server, clients }, null, 2));
else {
  const rule = name => `---- ${name} ${'-'.repeat(70 - name.length)}`;
  console.log(`PixelForge: connect your coding agent
=====================================

These settings start PixelForge's MCP server from this folder:
  ${folder}

Copy the block for your agent into its settings. This helper only prints;
it does not read or change any configuration file. If you move this folder,
run the helper again. Files your agent renders are saved in the "output"
folder here.
`);
  for (const client of clients) console.log(`${rule(client.name)}\n${client.where}\n\n${client.text}\n`);
  console.log(`${rule('Then')}\nAsk your agent to call pixel_help. It explains the recipe format and the\neight PixelForge tools.`);
}
