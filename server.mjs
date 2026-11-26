import { createServer } from 'node:http';
import { open } from 'node:fs/promises';
import { extname } from 'node:path';

const root = new URL('./public/', import.meta.url);
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3000);

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.geojson': 'application/geo+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }

  const [pathname] = request.url.split('?', 1);
  const asset = pathname === '/' ? 'index.html' : pathname.slice(1);
  const type = contentTypes[extname(asset)];
  if (!type || !/^(?:[a-z0-9-]+\/)*[a-z0-9-]+\.[a-z0-9]+$/.test(asset)) {
    response.writeHead(404).end();
    return;
  }

  try {
    const file = await open(new URL(asset, root), 'r');
    if (request.method === 'HEAD') {
      await file.close();
      response.writeHead(200, { 'Content-Type': type }).end();
      return;
    }

    response.writeHead(200, {
      'Content-Type': type,
      'X-Content-Type-Options': 'nosniff',
    });
    const stream = file.createReadStream();
    stream.on('error', () => response.destroy());
    response.on('close', () => stream.destroy());
    stream.pipe(response);
  } catch (error) {
    response.writeHead(error.code === 'ENOENT' ? 404 : 500).end();
  }
}).listen(port, host, () => {
  console.log(`NonLa Wander đang chạy tại http://${host}:${port}`);
});
