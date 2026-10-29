# I'm at the Races

A local developer tool for investigating race conditions in web apps.

Eventually, a background agent will inspect a repository and running app, generate test cases,
manipulate browser event timing, reproduce failures, generate source patches, and verify those
patches. This repository currently holds the foundation (monorepo layout, Next.js interface,
persistent run API, shared contracts) plus a working worker claim/execute/finish loop driven by
a scripted experiment runner: versioned plans, Playwright execution with HTTP hold/release,
baseline-vs-intervention trials, and screenshot/value evidence — driven by an autonomous
agent loop (source/browser tools, generated plans, confirmations, findings with provenance).
Configure `RACES_MODEL_API_KEY` (plus `RACES_MODEL_PROVIDER`/`RACES_MODEL_BASE_URL` for
non-Anthropic endpoints) to enable it.

## Layout

```
apps/web            Next.js App Router UI + JSON API (Node runtime, loopback only)
apps/worker         Worker claim/execute/finish loop (agent executor + model tools)
packages/contracts  Zod schemas + JSON-safe shared types (client-safe)
packages/db         Drizzle + SQLite (better-sqlite3) schema, migrations, query layer
packages/core       Server-side investigation modules (Executor, trial runner, matchers)
tooling/tsconfig    Shared strict TypeScript configs
fixtures/           Empty: the expected stale-search fixture was absent (see below)
.races/             Runtime data (SQLite DB + artifacts), gitignored, created on first run
```

Internal dependencies use `workspace:*`. One lockfile (`pnpm-lock.yaml`) is committed;
`packageManager` is pinned to pnpm 10.15.1 and Node 22 is the supported LTS (see `.nvmrc`).

Boundaries: client code cannot import the database, filesystem, model credentials, or browser
execution modules. `packages/db` and `packages/core` import `server-only`; the web app never
imports `packages/core`; all web reads/writes go through `src/lib/server/*` or the API routes.
Next.js never launches Playwright or runs investigations inside a request.

## Setup

Requirements: Node 22, pnpm 10.

```sh
pnpm install     # installs + builds workspace packages (postinstall)
pnpm db:migrate  # create/update .races/races.db (also runs automatically on boot)
pnpm --filter @races/core exec playwright install chromium  # browser for trials
```

## Development

```sh
pnpm dev         # web (http://127.0.0.1:3000) + worker skeleton together; Ctrl-C stops both
pnpm dev:web     # Next.js only, bound to loopback
pnpm dev:worker  # worker skeleton only
pnpm db:migrate  # apply pending SQLite migrations to .races/races.db
pnpm typecheck   # strict tsc across all packages
pnpm test        # vitest suites (isolated temp databases; excludes the fixture target)
pnpm test:fixture # stale-search fixture suite: 1 test fails by design until the race is repaired
pnpm build       # packages + production Next.js build + worker build
```

Then open [http://127.0.0.1:3000/projects](http://127.0.0.1:3000/projects) in a browser
(`/` redirects there).

## Environment

All variables are optional; see `.env.example`. Defaults work out of the box.

| Variable | Default | Read by |
|---|---|---|
| `RACES_DIR` | `<repo>/.races` (resolved from the workspace root regardless of cwd) | `apps/web`, `apps/worker` |
| `PORT` | `3000` | `apps/web` (Next.js convention) |
| `RACES_MODEL_API_KEY` | unset, not read yet | future: `apps/worker` only |

Never expose a model key through a `NEXT_PUBLIC_*` variable — that prefix bundles the value
into client JavaScript.

## Persistence

SQLite lives at `.races/races.db` (WAL mode, busy timeout, foreign keys on) so the web and
worker processes share it safely. Tables: `projects`, `runs`, `run_events` (unique sequence
per run), `artifacts`. Migrations are versioned in `packages/db/src/migrations.ts` and apply
transactionally; run state changes that append events use transactions as well.

Run status (`queued → running → completed|failed|cancelled|interrupted`) is separate from the
investigation phase (`queued`, then worker-owned phases). Event polling is cursor-based:
`GET /api/runs/[runId]/events?after=<sequence>`; the response shape is kept suitable for a
later SSE stream.

## Current limitations

- Every run executes a live model investigation against its project target URL:
  point the target at the fixture for meaningful results, and expect model
  latency and token usage per run. Run one worker per database.
- No authentication, no multi-user support — this is a single-operator local tool. Mutation
  routes reject cross-origin browser requests.
- No findings, replay evidence, or progress reporting beyond the persisted event feed.
- `fixtures/stale-search` is the controlled stale-results demo (buggy `/` + guarded
  `/fixed` control). See `fixtures/stale-search/README.md`.

## Next integration step

Build isolated repair and verification (M5): freeze the reproducer, generate a
patch in a separate checkout, and re-run the frozen test plus timing variations
with an honest verification matrix. The agent loop, runner, and debugger stay
as they are.
