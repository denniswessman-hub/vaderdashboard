/**
 * Lokal utvecklingsserver. Kör samma _worker.js som Cloudflare Pages,
 * men serverar statiska filer från disk.
 *
 *   node dev-server.mjs             -> riktiga API:er
 *   MOCK=1 node dev-server.mjs      -> syntetiska data (för test utan nät)
 *
 * Kräver Node 18 eller senare.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from './dist/_worker.js';
import { mockForecast } from './mock-data.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), 'dist');
const PORT = Number(process.env.PORT || 8788);
const MOCK = process.env.MOCK === '1';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const ASSETS = {
  async fetch(request) {
    const url = new URL(request.url);
    let path = normalize(decodeURIComponent(url.pathname));
    if (path === '/' || path.endsWith('/')) path += 'index.html';
    if (path.includes('..')) return new Response('nej', { status: 400 });
    try {
      const body = await readFile(join(ROOT, path));
      return new Response(body, {
        headers: { 'content-type': TYPES[extname(path)] || 'application/octet-stream' },
      });
    } catch {
      return new Response('404', { status: 404 });
    }
  },
};

createServer(async (req, res) => {
  const request = new Request(new URL(req.url, `http://localhost:${PORT}`), { method: req.method });
  let response;

  if (MOCK && request.url.includes('/api/forecast')) {
    const u = new URL(request.url);
    response = new Response(JSON.stringify(mockForecast(Number(u.searchParams.get('lat')), Number(u.searchParams.get('lon')))),
      { headers: { 'content-type': 'application/json' } });
  } else if (MOCK && request.url.includes('/api/geo')) {
    response = new Response(JSON.stringify({
      results: [{ name: 'Sundsvall', kommun: 'Sundsvalls kommun', lan: 'Västernorrlands län', lat: 62.3908, lon: 17.3069 }],
    }), { headers: { 'content-type': 'application/json' } });
  } else {
    response = await worker.fetch(request, { ASSETS });
  }

  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(PORT, () => {
  console.log(`Väderdashboard på http://localhost:${PORT}${MOCK ? '  (MOCK-läge)' : ''}`);
});
