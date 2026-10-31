# I'm at the Races

A local developer tool for investigating race conditions in web apps.

A background agent inspects a repository and running app, generates timing experiments,
manipulates browser event timing (HTTP hold/release), reproduces failures, freezes a
regression test, generates a source patch in an isolated checkout, and verifies the patch
against the frozen test plus timing variations and the project's own checks. The web UI
shows a synchronized timeline, findings, the patch diff, and the verification matrix.
Configure `RACES_MODEL_API_KEY` (plus `RACES_MODEL`/`RACES_MODEL_PROVIDER`/
`RACES_MODEL_BASE_URL` for non-Anthropic endpoints) to enable the agent; without a key,
runs fail fast with `MODEL_UNAVAILABLE`.

## Layout

```
apps/web            Next.js App Router UI + JSON API (Node runtime, loopback only)
apps/worker         Worker claim/execute/finish loop (agent executor + model tools)
packages/contracts  Zod schemas + JSON-safe shared types (client-safe)
packages/db         Drizzle + SQLite (better-sqlite3) schema, migrations, query layer
packages/core       Server-side investigation modules (Executor, trial runner, matchers)
tooling/tsconfig    Shared strict TypeScript configs
fixtures/stale-search  Controlled stale-results demo (buggy `/` + guarded `/fixed` control)
scripts/            Run-bundle export/import for the recorded demo fallback
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
cp .env.example .env  # then add RACES_MODEL_API_KEY (worker-only, never NEXT_PUBLIC_*)
pnpm db:migrate  # create/update .races/races.db (also runs automatically on boot)
pnpm --filter @races/core exec playwright install chromium  # browser for trials
```

Then `pnpm dev` (web on http://127.0.0.1:3000 + worker), create a project pointing at
a repository and its running app, and queue an investigate or investigate-repair run.

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
| `RACES_MODEL_API_KEY` | unset → runs fail `MODEL_UNAVAILABLE` | `apps/worker` only (loaded from `.env`, never committed) |
| `RACES_MODEL` | `claude-sonnet-4-5-20250929` | `apps/worker` only |
| `RACES_MODEL_PROVIDER` | `anthropic` (`openai-responses` supported) | `apps/worker` only |
| `RACES_MODEL_BASE_URL` | provider default | `apps/worker` only |
| `RACES_ARTIFACT_CAP_MB` | `250` per run | `apps/worker` (evidence budget; excess captures are skipped and labeled) |

Never expose a model key through a `NEXT_PUBLIC_*` variable — that prefix bundles the value
into client JavaScript.

Model boundary (please read before pointing this at a real project): source excerpts,
browser observations, and recorded traffic excerpts are sent to the configured model
provider. This tool is local-first, not offline. Recorded URLs and excerpts pass through
obvious-pattern redaction (known secret query keys, bearer/basic credentials), but page
text and screenshots are kept verbatim — use synthetic demo data for anything sensitive.

## Persistence

SQLite lives at `.races/races.db` (WAL mode, busy timeout, foreign keys on) so the web and
worker processes share it safely. Tables: `projects`, `runs`, `run_events` (unique sequence
per run), `artifacts` (with size/hash), `experiments`, `trials`, `findings`, `reproducers`,
`repair_attempts`, `verification_checks`. Migrations are versioned in
`packages/db/src/migrations.ts` and apply transactionally; run state changes that append
events use transactions as well. Artifact bytes live under `.races/artifacts/<runId>/`.

Run status (`queued → running → completed|failed|cancelled|interrupted`) is separate from the
investigation phase (`queued`, then worker-owned phases). Event polling is cursor-based:
`GET /api/runs/[runId]/events?after=<sequence>`; the response shape is kept suitable for a
later SSE stream.

## Current limitations

- Every agent run costs model latency and tokens (a full investigate-repair run
  is typically 10–30 calls over 2–8 minutes). Point targets at the fixture or
  another synthetic app. Run one worker per database.
- No authentication, no multi-user support — this is a single-operator local tool
  bound to loopback. Mutation routes reject cross-origin browser requests.
- Repair needs a git checkout: dirty tracked files under the target subpath refuse
  isolation, and the target package needs `build`/`start` scripts plus a
  regression suite that asserts correct behavior (a suite pinning the bug can
  never verify — see `fixtures/stale-search/README.md`).
- The isolated checkout is not an OS security sandbox: local commands run with
  the developer's machine permissions. Trusted local projects only.
- Assertion operators are `textContains`/`textEquals`; repairs are capped at 2
  attempts; evidence is capped at 250 MiB per run (excess captures are skipped
  and labeled, never silently dropped).
- History is append-only: reruns create new linked runs; nothing is mutated.

## Cleanup

Evidence is preserved until explicitly removed. To wipe local state, stop the
web/worker processes and delete the runtime directory (default `.races/`, or
`$RACES_DIR`); repair workspaces live under `<racesDir>/workspaces/` and go with
it. If a worktree outlives a crash, `git worktree prune` it from the target repo.

## Demo and submission

- `docs/demo.md`: the 3-minute demo script, the recorded fallback bundle
  (export/import scripts that preserve run IDs and source identity), measured
  OP02 timings, and rehearsal notes.
- `docs/submission-checklist.md`: release checklist, including the organiser
  items that must be verified from the event portal (deadline, timezone,
  eligibility, video upload).
