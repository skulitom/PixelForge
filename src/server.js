import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createBundle, createZip } from './export.js';
import { renderProject, MAX_REQUEST_BYTES } from './core.js';
import { prepareScene } from './scene.js';

const routes = new Map([
  ['/', ['../studio/index.html', 'text/html; charset=utf-8']],
  ['/studio.css', ['../studio/studio.css', 'text/css; charset=utf-8']],
  ['/studio.js', ['../studio/studio.js', 'text/javascript; charset=utf-8']],
  ['/core.js', ['./core.js', 'text/javascript; charset=utf-8']],
  ['/craft.js', ['./craft.js', 'text/javascript; charset=utf-8']],
  ['/authoring.js', ['./authoring.js', 'text/javascript; charset=utf-8']],
  ['/autotile.js', ['./autotile.js', 'text/javascript; charset=utf-8']],
  ['/scene.js', ['./scene.js', 'text/javascript; charset=utf-8']],
  ['/scene-player.js', ['../studio/scene-player.js', 'text/javascript; charset=utf-8']],
  ['/scene.css', ['../studio/scene.css', 'text/css; charset=utf-8']],
  ['/scene.html', ['../studio/scene.html', 'text/html; charset=utf-8']],
  ['/examples/quality/skink.json', ['../examples/quality/skink.json', 'application/json']],
  ['/schema.json', ['../schema.json', 'application/json']],
  ...['forest-spirit', 'ember', 'coin', 'shrine', 'swing', 'effects'].map(name => [`/examples/${name}.json`, [`../examples/${name}.json`, 'application/json']])
]);
export async function startStudio({ port = 4747, project, quiet = false } = {}) {
  const scene = project?.format === 'pixelforge-scene';
  if (project) { if (scene) prepareScene(project); else renderProject(project); }
  const server = http.createServer(async (req, res) => {
    const address = server.address(), hosts = [`127.0.0.1:${address.port}`, `localhost:${address.port}`];
    const reply = (status, type, body) => { res.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'" }); res.end(body); };
    if (!hosts.includes(req.headers.host) || (req.headers.origin && !hosts.some(h => req.headers.origin === `http://${h}`))) { reply(403, 'text/plain', 'Only same-origin local requests are accepted.'); return; }
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (req.method === 'POST' && url.pathname === '/api/export') {
        if (!req.headers['content-type']?.startsWith('application/json')) { reply(415, 'text/plain', 'Send application/json'); return; }
        let size = 0; const chunks = [];
        for await (const data of req) {
          size += data.length;
          if (size > MAX_REQUEST_BYTES) { reply(413, 'text/plain', `Project exceeds ${MAX_REQUEST_BYTES} bytes`); return; }
          chunks.push(data);
        }
        const bundle = await createBundle(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        res.setHeader('Content-Disposition', `attachment; filename="${bundle.project.name}.zip"`);
        reply(200, 'application/zip', createZip(bundle.files)); return;
      }
      if (req.method !== 'GET') { reply(405, 'text/plain', 'Method not allowed'); return; }
      if (scene && url.pathname === '/') { reply(200, 'text/html; charset=utf-8', await readFile(new URL('../studio/scene.html', import.meta.url))); return; }
      if (scene && url.pathname === '/scene.json') { reply(200, 'application/json', JSON.stringify(project)); return; }
      if (url.pathname === '/scene.json') { reply(200, 'application/json', await readFile(new URL('../examples/quality/hollow.scene.json', import.meta.url))); return; }
      if (url.pathname === '/project.json') { reply(200, 'application/json', JSON.stringify(project ?? null)); return; }
      if (!routes.has(url.pathname)) { reply(404, 'text/plain', 'Not found'); return; }
      const [file, type] = routes.get(url.pathname);
      reply(200, type, await readFile(new URL(file, import.meta.url)));
    } catch (error) { reply(400, 'application/json', JSON.stringify({ error: error.message })); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  if (!quiet) console.log(`PixelForge studio: http://127.0.0.1:${server.address().port}\nPress Ctrl+C to stop.`);
  return server;
}
