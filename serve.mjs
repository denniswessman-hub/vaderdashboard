/** Minimal statisk server för lokal körning: node serve.mjs -> http://localhost:8788
 *  Positionering kräver https eller localhost, därför den här i stället för att
 *  öppna index.html direkt från disk. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT || 8788);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.md': 'text/plain; charset=utf-8',
};

createServer(async (req, res) => {
  let path = normalize(decodeURIComponent(req.url.split('?')[0]));
  if (path === '/' || path.endsWith('/')) path += 'index.html';
  if (path.includes('..')) { res.writeHead(400).end('nej'); return; }
  try {
    const body = await readFile(join(ROOT, path));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end('404');
  }
}).listen(PORT, () => console.log(`Väderdashboard på http://localhost:${PORT}`));
