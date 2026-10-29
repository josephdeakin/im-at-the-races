# Worker

Separate Node/TypeScript entry point (`src/index.ts`) for the future
experiment engine. Run with `pnpm dev:worker` from the repo root.

Current behaviour (skeleton):

- Opens the shared SQLite database under `.races/` and applies migrations.
- Logs per-status run counts on boot and every 30 seconds.
- Exits cleanly on SIGINT/SIGTERM.

What it deliberately does NOT do yet:

- Claim queued runs (`claimNextQueuedRun` exists in `@races/db` but is never
  called here), execute investigations, or record outcomes. Runs stay queued
  and the web UI says the execution engine is not connected.

Next integration step: implement an `Executor` (see `packages/core`), poll
for queued runs, claim one transactionally, execute it with an `AbortSignal`
wired to `cancelRequestedAt`, stream events/artifacts, then `finishRun`.
The worker must own browser and child-process cleanup in `finally` blocks.
