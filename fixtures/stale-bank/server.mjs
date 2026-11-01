import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = new URL('.', import.meta.url);
const distDir = fileURLToPath(new URL('./dist/', here));

const DEFAULT_PORT = 4200;
const DEFAULT_DELAY_MS = 50;
const MAX_DELAY_MS = 5000;
const START_BALANCE_CENTS = 10000;
const MAX_AMOUNT_CENTS = 1000000;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/** Correct, serialized books: every transfer applies in arrival order. */
export function createBooks() {
  return { balanceCents: START_BALANCE_CENTS, ledger: [], nextId: 1 };
}

export function resetBooks(books) {
  books.balanceCents = START_BALANCE_CENTS;
  books.ledger.length = 0;
  books.nextId = 1;
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

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleTransfer(req, res, url, books) {
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    sendJson(res, 400, { error: 'invalid JSON body' });
    return;
  }
  const amountCents = body.amountCents;
  const to = typeof body.to === 'string' ? body.to.trim() : '';
  if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > MAX_AMOUNT_CENTS) {
    sendJson(res, 400, { error: 'amountCents must be a positive integer' });
    return;
  }
  if (to === '') {
    sendJson(res, 400, { error: 'to is required' });
    return;
  }
  const delayMs = clampDelay(url.searchParams.get('delay') ?? body.delay);
  // Books apply in arrival order; only the response is delayed. This models
  // network latency: the books stay correct while responses arrive out of
  // order, which is exactly what the buggy client mishandles.
  if (amountCents > books.balanceCents) {
    sendJson(res, 402, { error: 'insufficient funds', balanceCents: books.balanceCents });
    return;
  }
  books.balanceCents -= amountCents;
  const entry = {
    id: books.nextId++,
    to,
    amountCents,
    balanceAfterCents: books.balanceCents,
    servedAt: new Date().toISOString(),
  };
  books.ledger.push(entry);
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  if (res.writableEnded) return;
  sendJson(res, 200, {
    transferId: entry.id,
    to,
    amountCents,
    delayMs,
    balanceCents: entry.balanceAfterCents,
    servedAt: entry.servedAt,
  });
}

async function handleStatic(req, res, url, books) {
  let pathname = decodeURIComponent(url.pathname);
  // Every app visit reseeds the demo account, so each trial and each manual
  // visit starts from $100.00 without needing an explicit reset call.
  if (pathname === '/' || pathname === '/fixed') resetBooks(books);
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

export function createBooksHandler(books = createBooks()) {
  return (req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (url.pathname === '/api/transfer' && req.method === 'POST') {
          await handleTransfer(req, res, url, books);
        } else if (url.pathname === '/api/balance' && req.method === 'GET') {
          sendJson(res, 200, { balanceCents: books.balanceCents });
        } else if (url.pathname === '/api/reset' && req.method === 'POST') {
          resetBooks(books);
          sendJson(res, 200, { balanceCents: books.balanceCents });
        } else if (req.method === 'GET' || req.method === 'HEAD') {
          await handleStatic(req, res, url, books);
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

export function createRequestHandler() {
  return createBooksHandler();
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number.parseInt(process.env.PORT ?? '', 10) || DEFAULT_PORT;
  createServer(createRequestHandler()).listen(port, '127.0.0.1', () => {
    console.log(`stale-bank fixture: http://127.0.0.1:${port}/ (buggy), /fixed (guarded control)`);
  });
}
