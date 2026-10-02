// Prints ready-to-paste MCP settings for this folder. It only prints: no agent's configuration file is read or
// changed.   --json   the same settings as one JSON document (used by automated checks)
import path from 'node:path';
import { app, folder, node } from './layout.mjs';

const server = { command: node, args: [path.join(app, 'bin', 'pixelforge.js'), 'mcp', '--out', path.join(folder, 'output')] };
const json = JSON.stringify({ mcpServers: { pixelforge: server } }, null, 2);
// JSON string escapes are also valid TOML basic-string escapes, so Windows paths survive in both.
const toml = `[mcp_servers.pixelforge]\ncommand = ${JSON.stringify(server.command)}\nargs = [${server.args.map(value => JSON.stringify(value)).join(', ')}]`;
// One line for the agents that have an "mcp add" command, written to work in Command Prompt and in PowerShell.
// The separator is quoted on purpose: PowerShell removes a bare -- before a script shim (how npm installs these
// tools) passes the arguments on, and the tool then reads --out as its own option. Double quotes protect spaces
// and "&" in both shells, but not the characters below, so a folder with one of them gets no one-line command.
const shellSafe = [server.command, ...server.args].every(value => !/["%$`]/.test(value));
const added = `pixelforge "--" "${server.command}" "${server.args[0]}" mcp --out "${server.args[3]}"`;
const clients = [
  { id: 'claude-code', name: 'Claude Code', format: 'json', text: json, where: 'Save as .mcp.json in your project folder. If that file already lists\nservers, add the "pixelforge" entry to its "mcpServers".', command: `claude mcp add --scope user ${added}`, effect: 'It adds PixelForge for all your projects; leave out\n"--scope user" to add it to the current project only.' },
  { id: 'claude-desktop', name: 'Claude Desktop', format: 'json', text: json, where: 'Settings > Developer > Edit Config shows claude_desktop_config.json. If it\nalready lists servers, add the "pixelforge" entry to its "mcpServers".\nRestart Claude Desktop afterwards.' },
  { id: 'codex', name: 'Codex', format: 'toml', text: toml, where: 'Add to config.toml in the .codex folder of your user profile.', command: `codex mcp add ${added}`, effect: 'It writes the same entry to that config.toml.' },
  { id: 'cursor', name: 'Cursor', format: 'json', text: json, where: 'Save as mcp.json in the .cursor folder of your user profile, or of one\nproject. If that file already lists servers, add the "pixelforge" entry to\nits "mcpServers".' }
].map(({ command, effect, ...client }) => ({ ...client, command: command && shellSafe ? command : null, ...(command && { effect }) }));

if (process.argv.includes('--json')) console.log(JSON.stringify({ folder, server, clients: clients.map(({ effect, ...client }) => client) }, null, 2));
else {
  const rule = name => `---- ${name} ${'-'.repeat(70 - name.length)}`;
  console.log(`PixelForge: connect your coding agent
=====================================

These settings start PixelForge's MCP server from this folder:
  ${folder}

Copy the block for your agent into its settings, or run the one-line command
where there is one. This helper only prints; it does not read or change any
configuration file. If you move this folder, run the helper again. Files your
agent renders are saved in the "output" folder here.
`);
  for (const client of clients) {
    console.log(`${rule(client.name)}\n${client.where}\n\n${client.text}\n`);
    if (client.command) console.log(`Or run this one line in Command Prompt or PowerShell instead.\n${client.effect}\n\n${client.command}\n`);
    else if (client.effect) console.log('No one-line command is offered here: this folder\'s path has a character\n(" % $ or `) that command shells treat specially. Use the block above.\n');
  }
  console.log(`${rule('Then')}\nAsk your agent to call pixel_help. It explains the recipe format and the\neight PixelForge tools.`);
}
