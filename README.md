# I'm at the Races

A local developer tool for investigating race conditions in web apps.

Eventually, a background agent will inspect a repository and running app, generate test cases,
manipulate browser event timing, reproduce failures, generate source patches, and verify those
patches. This repository currently holds the foundation: monorepo layout, Next.js interface,
persistent run API, and shared contracts. The AI agent / execution engine is not implemented yet.

## Layout

```
apps/web            Next.js App Router UI + JSON API (Node runtime, loopback only)
apps/worker         Separate worker entry point (skeleton: no executor yet)
packages/contracts  Zod schemas + JSON-safe shared types (client-safe)
packages/db         Drizzle + SQLite (better-sqlite3) schema, migrations, query layer
packages/core       Server-side investigation modules (minimal: Executor interface)
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
```

## Development

```sh
pnpm dev         # web (http://127.0.0.1:3000) + worker skeleton together; Ctrl-C stops both
pnpm dev:web     # Next.js only, bound to loopback
pnpm dev:worker  # worker skeleton only
pnpm db:migrate  # apply pending SQLite migrations to .races/races.db
pnpm typecheck   # strict tsc across all packages
pnpm test        # vitest suites (isolated temp databases)
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

- No executor: runs stay `queued` forever and the UI says the execution engine is not
  connected. The worker skeleton only reports status counts.
- No authentication, no multi-user support — this is a single-operator local tool. Mutation
  routes reject cross-origin browser requests.
- No findings, replay evidence, or progress reporting beyond the persisted event feed.
- No `fixtures/stale-search`: the foundation task expected a pre-existing seeded search app to
  preserve, but the repository contained only a README, so there was nothing to relocate and
  no fixture verification to keep. See `fixtures/README.md`.

## Next integration step

Implement an `Executor` per `packages/core/src/index.ts`, then teach `apps/worker` the
handoff loop: `claimNextQueuedRun` (transactional) → `execute` with an `AbortSignal` wired
to `cancelRequestedAt` → stream events/artifacts → `finishRun`. The worker must own
browser and child-process cleanup in `finally` blocks. UI/API changes needed: none for the
first pass — the run page already polls whatever the worker persists.
