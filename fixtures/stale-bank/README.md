# stale-bank fixture

Controlled race-condition demo for I'm at the Races: a React/TypeScript bank
transfer UI backed by a tiny Node API with serialized books and an adjustable
response delay.

The server is correct — every transfer applies in arrival order. The **client**
is buggy: it applies every transfer response unconditionally, so a slow
earlier response overwrites the balance left by a newer transfer (lost
update). Two $30 transfers then show $70.00 instead of $40.00 while the ledger
records $60 out — money from thin air.

## Run it

```sh
pnpm install   # from the repo root (this package joins the workspace)
pnpm build     # build the client into dist/
pnpm start     # serve API + client on http://127.0.0.1:4200
PORT=4300 pnpm start   # isolated copies (e.g. repair workspaces) use another port
```

For development with hot reload: `pnpm dev` (Vite on :4200, API on :4201).

## Routes

- `/` — **buggy** bank. Every transfer response sets the balance, so a late
  earlier response resurrects money a newer transfer already spent.
- `/fixed` — **guarded control**. Balance updates from transfers older than the
  latest issued one are ignored (every transfer is still booked). This
  authored fix exists only as a comparison control: generated repairs must
  patch the buggy path, never swap to this component.

## Reproducing the lost update by hand

1. Open http://127.0.0.1:4200/
2. Set "Response delay" to `800`, transfer `$30` to `rent`
3. Set "Response delay" to `0`, transfer `$30` to `savings`
4. Balance drops to `$40.00`, then the late `rent` response puts it back to
   `$70.00` — while the ledger shows both transfers ($60 out)
5. Repeat on `/fixed`: the balance stays at `$40.00`

The engine under test must reproduce this via response hold/release, not via
the delay input: no hardcoded selectors, amounts, or delay values belong in
engine code.

## Tests

`pnpm test` runs four jsdom tests. One of them — "late earlier transfer never
overwrites a newer balance, in either mode" — **fails on the vulnerable code
by design** and passes once the race is repaired (FAIL_TO_PASS). Repair
verification relies on this: the pristine baseline records the failure, the
patched app must turn it green without breaking the other three tests.

## API

`POST /api/transfer` with `{ "amountCents": 3000, "to": "rent", "delay": 800 }` →

```json
{ "transferId": 1, "to": "rent", "amountCents": 3000, "delayMs": 800, "balanceCents": 7000, "servedAt": "..." }
```

- `delay` is clamped to 0–5000 ms; default 50 ms.
- Overdrafts are rejected with `402 insufficient funds`.
- `GET /api/balance` returns `{ "balanceCents": N }`.
- `POST /api/reset` restores the $100.00 opening balance (test/manual escape hatch).
- Loading `/` or `/fixed` also reseeds the account, so every visit and every
  trial starts from $100.00. The app calls reset on mount (then reads the
  balance), which covers vite dev mode too, where the API server never sees
  the page load; the server additionally reseeds when it serves `/` itself.

## Stable selectors for generated tests

`balance-amount`, `amount-input`, `to-input`, `delay-input`,
`transfer-button`, `ledger-list`, `ledger-item`, `mode-badge`. These exist so
experiments can observe the app; the engine must discover them, not hardcode
them.
