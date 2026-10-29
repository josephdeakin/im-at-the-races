# stale-search fixture

Controlled race-condition demo for I'm at the Races: a React/TypeScript search
UI backed by a tiny Node API with an adjustable response delay.

## Run it

```sh
pnpm install   # from the repo root (this package joins the workspace)
pnpm build     # build the client into dist/
pnpm start     # serve API + client on http://127.0.0.1:4100
PORT=4200 pnpm start   # isolated copies (e.g. repair workspaces) use another port
```

For development with hot reload: `pnpm dev` (Vite on :4100, API on :4101).

## Routes

- `/` — **buggy** search. Every response is applied unconditionally, so a slow
  earlier response overwrites the results of a newer query.
- `/fixed` — **guarded control**. Responses whose query is no longer current
  are ignored. This authored fix exists only as a comparison control: generated
  repairs must patch the buggy path, never swap to this component.

## Reproducing the stale overwrite by hand

1. Open http://127.0.0.1:4100/
2. Set "Response delay" to `800`, type `alpha`
3. Set "Response delay" to `0`, type `beta`
4. `beta` results appear first, then the late `alpha` response replaces them
   while the input still shows `beta` — the stale overwrite.
5. Repeat on `/fixed`: the late `alpha` response is ignored.

The engine under test must reproduce this via response hold/release, not via
the delay input: no hardcoded selectors, queries, or delay values belong in
engine code.

## Tests

`pnpm test` runs three jsdom tests. One of them — "late earlier response never
overwrites newer results, in either mode" — **fails on the vulnerable code by
design** and passes once the race is repaired (FAIL_TO_PASS). Repair
verification relies on this: the pristine baseline records the failure, the
patched app must turn it green without breaking the other two tests.

## API

`GET /api/search?q=<query>&delay=<ms>` →

```json
{ "query": "alpha", "delayMs": 800, "results": ["Result 1 for \"alpha\"", "..."], "servedAt": "..." }
```

- `delay` is clamped to 0–5000 ms; default 50 ms.
- Empty `q` returns `results: []`.
- Responses are finite and read-only; there is no server state to reset.

## Stable selectors for generated tests

`search-input`, `delay-input`, `results-for`, `results-list`, `result-item`,
`mode-badge`. These exist so experiments can observe the app; the engine must
discover them, not hardcode them.
