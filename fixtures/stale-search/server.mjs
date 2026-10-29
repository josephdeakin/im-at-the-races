import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = new URL('.', import.meta.url);
const distDir = fileURLToPath(new URL('./dist/', here));

const DEFAULT_PORT = 4100;
const DEFAULT_DELAY_MS = 50;
const MAX_DELAY_MS = 5000;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/** Deterministic fake results so every query is distinguishable in the UI. */
export function resultsFor(query) {
  return [1, 2, 3].map((n) => `Result ${n} for "${query}"`);
}

function clampDelay(raw) {
  const n = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_DELAY_MS;
  return Math.min(n, MAX_DELAY_MS);
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function handleSearch(req, res, url) {
  const query = url.searchParams.get('q') ?? '';
  const delayMs = clampDelay(url.searchParams.get('delay'));
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  if (res.writableEnded) return;
  sendJson(res, 200, {
    query,
    delayMs,
    results: query === '' ? [] : resultsFor(query),
    servedAt: new Date().toISOString(),
  });
}

async function handleStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  // SPA fallback: unknown non-file paths serve index.html (e.g. /fixed).
  if (!extname(pathname)) pathname = '/index.html';
  const filePath = normalize(join(distDir, `.${sep}${pathname}`));
  if (!filePath.startsWith(distDir)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, {
      'content-type': CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream',
      'content-length': data.length,
    });
    res.end(data);
  } catch {
    if (extname(pathname) === '.html' || pathname.endsWith('/index.html')) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not built yet. Run `pnpm build` first, or use `pnpm dev`.\n');
    } else {
      res.writeHead(404).end('not found');
    }
  }
}

export function createRequestHandler() {
  return (req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (url.pathname === '/api/search' && req.method === 'GET') {
          await handleSearch(req, res, url);
        } else if (req.method === 'GET' || req.method === 'HEAD') {
          await handleStatic(req, res, url);
        } else {
          res.writeHead(405).end('method not allowed');
        }
      } catch (err) {
        if (!res.writableEnded) {
          res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
          res.end(`server error: ${(err && err.message) || err}\n`);
        }
      }
    })();
  };
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number.parseInt(process.env.PORT ?? '', 10) || DEFAULT_PORT;
  createServer(createRequestHandler()).listen(port, '127.0.0.1', () => {
    console.log(`stale-search fixture: http://127.0.0.1:${port}/ (buggy), /fixed (guarded control)`);
  });
}
