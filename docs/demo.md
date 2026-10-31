# Demo guide (3 minutes + recorded fallback)

## One-click demo

```sh
pnpm install
cp .env.example .env   # add RACES_MODEL_API_KEY (worker-only)
pnpm --filter @races/core exec playwright install chromium
pnpm demo
```

`pnpm demo` (scripts/demo.cjs) prepares a fresh stale-search checkout at
/tmp/races-demo-target, starts the fixture (:4100), web (:3100), and worker
under /tmp/races-demo-live, queues the canonical investigate-repair run, and
opens the run page when the first finding lands. Logs live in
/tmp/races-demo-live/logs/; `pnpm demo:stop` stops everything. Flags:
`-- --setup-only` (start + seed, no wait), `-- --no-open` (no browser),
`-- --keep` (reuse state), `-- --timeout-mins N` (finding wait, default 20),
`-- --fixture-port N` / `-- --web-port N` (defaults 4100/3100).

The empty projects page advertises the same command for new users.

## Manual setup (rehearsed on macOS, Node 22.19, pnpm 10.15)

```sh
pnpm install
cp .env.example .env   # add RACES_MODEL_API_KEY (worker-only)
pnpm --filter @races/core exec playwright install chromium
```

Terminal 1 — fixture target (a git checkout; repair snapshots it):

```sh
cd /tmp/races-demo-target   # any git clone of fixtures/stale-search
pnpm install && pnpm build
PORT=4100 node server.mjs   # buggy / + guarded /fixed control
```

Terminal 2+3 — tool (fresh state per rehearsal):

```sh
RACES_DIR=/tmp/races-demo-live PORT=3100 pnpm --filter web start   # or pnpm dev:web
RACES_DIR=/tmp/races-demo-live pnpm dev:worker
```

Create a project (repository `/tmp/races-demo-target`, target
`http://127.0.0.1:4100/`), queue an **investigate-repair** run.

## 3-minute script

0:00 — The problem: search results belong to an older query when responses
arrive out of order. Show the fixture `/` route misbehaving by hand
(delay 800 → type alpha; delay 0 → type beta; alpha overwrites beta).

0:30 — Start (or open) the run. Timeline tab: the agent's own experiment —
baseline passes on beta, the intervention holds alpha's response until beta
completes, and the assertion fails showing alpha. Confirmation tally 3/3.

1:15 — Findings tab: the reproduced finding with expectation provenance
("results shown belong to the last query typed"), implicated file, and links
back to the evidence trials.

1:40 — Patch tab: the one-line generated diff (stale guard applied
unconditionally) produced in an isolated git worktree — never in the checkout.

2:10 — Verification tab: frozen reproducer fails on the original app, then
passes 3× on the patched app served from the workspace, plus timing
variations, natural workflow, and the project's own suite turning green.

2:45 — Close: everything on screen is persisted evidence with IDs and hashes;
nothing was hand-written for the demo. The `/fixed` route is a comparison
control, never the repair.

## Recorded fallback (no live model needed)

If the live run stalls, import the recorded bundle and browse the identical
completed run (IDs and source identity preserved):

```sh
RACES_DIR=/tmp/races-m5 node scripts/export-run.cjs <runId> /tmp/demo-bundle
RACES_DIR=/tmp/races-demo node scripts/import-run.cjs /tmp/demo-bundle
RACES_DIR=/tmp/races-demo PORT=3101 pnpm --filter web start
# open http://127.0.0.1:3101/runs/<runId>
```

Rehearsed with the M5 verified run (`6b3ebe6b-…`, 304 events, 49 files):
repair API, Patch/Verification tabs, and export downloads all replay.

## Measured timings (OP02, this machine)

| Target | Measured |
|---|---|
| Queue acknowledgement < 2s | 8 ms (`POST /runs` → 202) |
| Progress visibility < 2s | 3 ms (events poll round-trip) |
| Cancellation acknowledgement < 2s | 3 ms queued / 12 ms running |
| Worker cleanup < 10s | ~8 s running-cancel to terminal, no stray browsers |

Full investigate-repair runs measure 2–8 minutes and 10–30 model calls, so the
live demo opens a run started beforehand and narrates the recording tabs.

## If something goes wrong on stage

- Model key missing/misconfigured → runs fail fast with `MODEL_UNAVAILABLE`
  and say so; switch to the fallback bundle.
- Repair limitation (dirty checkout, no start script, stale check) → the run
  degrades to investigation-only with a logged reason; narrate the limitation
  line honestly, then switch to the fallback for the patch half.
- Worker crash → restart the worker; the run is marked `interrupted` with
  evidence preserved.
