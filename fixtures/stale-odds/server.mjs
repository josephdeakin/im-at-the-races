import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = new URL('.', import.meta.url);
const distDir = fileURLToPath(new URL('./dist/', here));

const DEFAULT_PORT = 4300;
const DEFAULT_DELAY_MS = 50;
const MAX_DELAY_MS = 5000;
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_WS_PAYLOAD = 1024 * 1024;

/** Deterministic price ladder: version n takes ladder[(n - 1) % len]. */
const PRICE_LADDER = ['2.50', '1.80', '3.20', '2.10', '4.00', '1.65'];

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/** Correct, serialized feed: every subscription versions in arrival order. */
export function createFeed() {
  return { version: 0, price: null };
}

export function resetFeed(feed) {
  feed.version = 0;
  feed.price = null;
}

export function priceForVersion(version) {
  return PRICE_LADDER[(version - 1) % PRICE_LADDER.length];
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

function sendTextFrame(socket, text) {
  const payload = Buffer.from(text, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  socket.write(Buffer.concat([header, payload]));
}

/** Minimal RFC 6455 server: single-frame text, ping/pong, close. */
function handleSocket(socket, feed) {
  let buffer = Buffer.alloc(0);
  let message = [];
  let closed = false;

  const send = (obj) => {
    if (!closed) sendTextFrame(socket, JSON.stringify(obj));
  };

  const onMessage = (text) => {
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (!msg || msg.type !== 'subscribe') return;
    // Versions assign in arrival order; only the push is delayed. This models
    // network latency: the feed stays correct while messages arrive out of
    // order, which is exactly what the buggy client mishandles.
    const version = ++feed.version;
    const price = priceForVersion(version);
    feed.price = price;
    const delayMs = clampDelay(msg.delay);
    const payload = {
      type: 'odds',
      requestId: msg.requestId ?? null,
      version,
      price,
      delayMs,
      servedAt: new Date().toISOString(),
    };
    setTimeout(() => send(payload), delayMs);
  };

  const parseFrames = () => {
    for (;;) {
      if (buffer.length < 2) return;
      const fin = (buffer[0] & 0x80) !== 0;
      const opcode = buffer[0] & 0x0f;
      const masked = (buffer[1] & 0x80) !== 0;
      let length = buffer[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffer.length < 10) return;
        const big = buffer.readBigUInt64BE(2);
        if (big > BigInt(MAX_WS_PAYLOAD)) {
          socket.destroy();
          return;
        }
        length = Number(big);
        offset = 10;
      }
      if (!masked || length > MAX_WS_PAYLOAD) {
        socket.destroy();
        return;
      }
      if (buffer.length < offset + 4 + length) return;
      const mask = buffer.subarray(offset, offset + 4);
      const payload = buffer.subarray(offset + 4, offset + 4 + length);
      for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
      buffer = buffer.subarray(offset + 4 + length);
      if (opcode === 0x8) {
        closed = true;
        socket.end(Buffer.from([0x88, 0x00]));
        return;
      }
      if (opcode === 0x9) {
        socket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload]));
        continue;
      }
      if (opcode === 0xa) continue;
      if (opcode === 0x0) {
        message.push(payload);
        if (!fin) continue;
        onMessage(Buffer.concat(message).toString('utf8'));
        message = [];
        continue;
      }
      if (opcode === 0x1) {
        if (!fin) {
          message = [payload];
          continue;
        }
        onMessage(payload.toString('utf8'));
      }
    }
  };

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > 4 * MAX_WS_PAYLOAD) {
      socket.destroy();
      return;
    }
    try {
      parseFrames();
    } catch {
      socket.destroy();
    }
  });
  socket.on('error', () => {});
}

function handleUpgrade(req, socket, feed) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const key = req.headers['sec-websocket-key'];
  if (url.pathname !== '/api/odds' || typeof key !== 'string' || key === '') {
    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  const accept = createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  handleSocket(socket, feed);
}

async function handleStatic(req, res, url, feed) {
  let pathname = decodeURIComponent(url.pathname);
  // Every app visit reseeds the demo feed, so each trial and each manual
  // visit starts from v0 without needing an explicit reset call.
  if (pathname === '/' || pathname === '/fixed') resetFeed(feed);
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

export function createFeedHandler(feed = createFeed()) {
  return (req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (url.pathname === '/api/odds' && req.method === 'GET' && req.headers.upgrade === undefined) {
          sendJson(res, 200, { version: feed.version, price: feed.price });
        } else if (url.pathname === '/api/reset' && req.method === 'POST') {
          resetFeed(feed);
          sendJson(res, 200, { version: feed.version, price: feed.price });
        } else if (req.method === 'GET' || req.method === 'HEAD') {
          await handleStatic(req, res, url, feed);
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
  const feed = createFeed();
  const server = createServer(createFeedHandler(feed));
  server.on('upgrade', (req, socket) => handleUpgrade(req, socket, feed));
  return server;
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number.parseInt(process.env.PORT ?? '', 10) || DEFAULT_PORT;
  createRequestHandler().listen(port, '127.0.0.1', () => {
    console.log(`stale-odds fixture: http://127.0.0.1:${port}/ (buggy), /fixed (guarded control)`);
  });
}
