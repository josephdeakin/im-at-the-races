# stale-odds fixture

A home-win odds feed pushed over a WebSocket. The client applies every push
unconditionally, so a slow earlier update overwrites newer odds: a stale
read over a socket instead of over HTTP.

## The race

Each **Request update** sends `{ type: 'subscribe', delay }` down the
socket. The server versions pushes in arrival order (v1 at 2.50, v2 at 1.80,
then a rotating ladder) and delays each push by its requested `delay`.

1. Request an update with delay 800 (slow v1 @ 2.50).
2. Request an update with delay 0 (fast v2 @ 1.80).
3. The display shows 1.80, then the late v1 push lands and the display jumps
   back to 2.50 — stale odds. The feed below books both pushes in arrival
   order, proving the server sent v2 first.

`/` is buggy; `/fixed` ignores pushes older than the newest version seen.

## API

- `GET /api/odds` returns the current `{ version, price }` without
  consuming a version (v0 has `price: null`).
- `POST /api/reset` reseeds the feed to v0.
- `WS /api/odds` takes `{ type: 'subscribe', requestId, delay }` and pushes
  `{ type: 'odds', requestId, version, price, delayMs, servedAt }` after
  `delay` ms. `delay` is clamped to 0–5000 ms; default 50 ms.

Loading `/` or `/fixed` also reseeds the feed, and the app calls reset on
mount (then reads the snapshot), which covers vite dev mode too, where the
API server never sees the page load; the server additionally reseeds when it
serves `/` itself.

## Stable selectors for generated tests

`odds-amount`, `delay-input`, `request-button`, `feed-list`, `feed-item`,
`mode-badge`, `connection-badge`. These exist so experiments can observe
the app; the engine must discover them, not hardcode them.
