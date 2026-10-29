# I'm at the Races — milestones

Derived from `im-at-the-races-prd.md` (v1.0, 29 October 2026). Each milestone is
one focused work package: one agent, one goal, one gate. Demo-grade quality
throughout — complete journey over hardening.

Demo-grade simplifications apply to all milestones: single worker assumed
(crash recovery best-effort), redaction covers obvious headers/cookies only,
no SSE (cursor polling stands), accessibility means named controls plus a
keyboard-navigable event list.

## M0 — Stale-search fixture (unblocks everything)

- **Goal:** check in the controlled buggy app plus a fixed control variant.
- **PRD scope:** fixture assumption behind AT02–AT05; §8 `fixtures/stale-search`.
- **Surfaces:** new `fixtures/stale-search/` (workspace glob already covers it);
  document its start command and which response order is buggy.
- **Must include:** React/TS search UI with two overlapping requests; reverse
  delivery order visibly shows stale results; a fixed variant (guard) used only
  as a control, never as the repair output; read-only workflow, finite HTTP
  responses.
- **Gate:** manual check — normal order passes, reversed order shows stale
  results, fixed variant passes reversed order. Record the commands in
  `fixtures/stale-search/README.md`.

## M1 — Claim loop + persistence review

- **Goal:** a run can be claimed and driven to a terminal state with events
  persisted; page reload loses nothing.
- **PRD scope:** UX01–UX03 (config validation), AR01–AR02 (claim,
  heartbeat-lite, one active run), §8 lifecycle/status/phase, OP02
  acknowledgement targets (best-effort).
- **Surfaces:** `packages/core/src` (implement `Executor` per existing
  interface), `apps/worker/src/index.ts` (handoff loop: `claimNextQueuedRun` →
  execute with `AbortSignal` → `finishRun`), `packages/db` (new tables only as
  needed).
- **First task:** review the foundation agent's output (schemas, migrations,
  API routes, `RunMonitor` polling) and fix defects before building on it.
- **Out of scope:** any browser work (stub executor emits phase events and
  completes).
- **Gate:** AT01 — create project/run, refresh and recover state, exactly one
  claim, queued and running cancellation coherent.
  `pnpm typecheck && pnpm test && pnpm build`.

## M2 — Real execution: scripted HTTP race runner

- **Goal:** execute a versioned experiment plan against Playwright with HTTP
  hold/release and persisted evidence.
- **PRD scope:** EX01–EX03 (baseline vs. intervention, hold/release, completion
  criteria), EV01–EV02 (ordered events, screenshots/values), §5 repeatability/
  cleanup, plan validation errors.
- **Surfaces:** `packages/core` (plan schema + runner + Playwright browser
  module; add `playwright` dependency), `packages/contracts` (plan/result Zod
  schemas), `packages/db` (experiments, trials tables), worker wiring.
- **Must include:** logical request matchers (method + URL/body predicates +
  occurrence, never URL alone); baseline-then-intervention with equivalent
  actions; per-trial timeouts, 15 s max hold, 64 KiB body excerpts; safe abort
  resolving held traffic; a hand-written scripted plan proving the path.
- **Out of scope:** model calls, generated plans, repair.
- **Gate:** AT02 — GUI shows real requests, holds, releases, snapshots,
  assertion results from the scripted plan; cancellation cleans up the browser.
  No fixture-specific logic in engine code (grep-reviewable: no hardcoded
  search terms/selectors). Re-run AT01.

## M3 — Autonomous investigation loop

- **Goal:** the agent reads source + browser, generates its own experiment
  plans, and saves findings with provenance.
- **PRD scope:** AG01–AG03 (source/browser tools, hypotheses, expectation
  rationale), §4 tool contract (`listFiles/searchCode/readFile`,
  `observePage/act/readEvidence`, `runExperiment`, `finish`), context/feedback
  rules, FI01–FI02 (finding standard, 3 confirmations, "reproduced" = 2 of 3
  violating the same check), OP01 budgets (10 min, 30 model calls, 6 plans).
- **Surfaces:** `packages/core` (agent orchestrator, tool implementations,
  Muse API client reading `RACES_MODEL_API_KEY` in worker only),
  `packages/db` (findings table), `packages/contracts` (tool-arg schemas,
  finding DTOs).
- **Decisions recorded:** P0-minimum assertion predicates are `textContains` and
  `textEquals` over `data-testid` text; a confirmation attempt re-runs the full
  baseline+intervention pair and both outcomes are reported (a violation counts
  only when its baseline passes and the intervention violates the same check);
  coverage record is `{pagesVisited, workflowsTested, experimentsRun}` with
  separate `unresolvedSuspicions`/`limitations` lists. `runExperiment` has
  explore/confirm modes (one tool, not two). Model provider is configurable:
  `anthropic` (Messages API) or `openai-responses` (Responses API via
  `RACES_MODEL_BASE_URL`); Responses transcripts interleave call/output pairs
  because the Meta endpoint rejects adjacent same-type function items.
- **Out of scope:** repair, patch UI (findings readable via existing run page
  + API).
- **Gate:** AT03 — on the buggy fixture with no prewritten action list, the
  agent produces a plan (saved with tool history) whose baseline passes and
  intervention exposes the stale overwrite; all confirmation outcomes recorded
  separately. Re-run AT01–AT02.

## M4 — Visual race debugger

- **Goal:** a developer can see the late response, the overwrite, and why it's
  wrong, from saved evidence alone.
- **PRD scope:** UI01–UI05 (layout, synchronized replay, snapshots/inspector,
  play/pause/scrub, before/after alignment), §7 explanation sentence,
  empty/failure states, accessibility minimum.
- **Surfaces:** `apps/web` (run workspace: Timeline, Findings views; finding
  detail with Source content; new API reads for experiments/trials/artifacts as
  needed).
- **Must include:** one selected event drives request lanes
  (start/capture/hold/release), snapshot, inspector; event time and capture time
  shown side by side; keyboard-accessible event list; "Rerun experiment" creates
  new evidence, never overwrites; red+green never the only signal.
- **Out of scope:** patch/verification views (M5 adds them into the finding
  detail).
- **Gate:** the M3 stale-overwrite failure is understandable from saved
  evidence: selecting the late response updates every panel and exposes expected
  vs. actual side by side. Desktop 1280 px; narrower stacks without hiding
  evidence.

## M5 — Freeze, isolated repair, verification

- **Goal:** frozen reproducer fails on original, generated patch in isolation
  passes it, all gates reported honestly.
- **PRD scope:** RP01 (export + hash + fail-for-stated-reason), RP02–RP03
  (worktree, distinct port, protected-hash checks, no weakening), VF01
  (original fails / patched 3× passes / normal workflow / 2 timing variations /
  project checks), RP04 (diff + matrix + export), §6 bounded outcome
  (2 attempts, "verification incomplete/failed" labels).
- **Surfaces:** `packages/core` (freeze/export, workspace manager, repair agent
  with bounded edit/command tools, verification runner), `packages/db` (repair
  attempts, verification checks tables), `apps/web` (Patch + Verification
  finding tabs, export download).
- **Decisions this agent makes and records:** snapshot format (recommend: git
  worktree + recorded commit hash; dirty tree → investigation-only with
  explanation); port allocation; hash algorithm and covered bytes; the two fixed
  timing variations; no-worse-than-original rule for pre-existing project check
  failures.
- **Gate:** AT04 + AT05 — exported test fails on original for the stated
  assertion ID; actual source diff produced in isolation with protected hashes
  unchanged; patched app passes frozen test, baseline, variations, and project
  checks; comparison view shows corrected result. Fixed fixture used as control
  only. Re-run AT01–AT03.

## M6 — Harden and present

- **Goal:** truthful failure behavior everywhere, repeatable demo,
  submission-ready repo.
- **PRD scope:** AT06 failure matrix, §9 remaining reliability/privacy items
  (capacity-exhaustion behavior, cleanup docs, secret-free exports/logs), §10
  cut order, 3-minute demo + recorded fallback bundle, README, submission
  assets, deadline/rules verification.
- **Surfaces:** whole repo; demo fallback artifact (recommend: seed script or
  exported run bundle preserving run IDs + source identity — not "don't delete
  the DB").
- **Must include:** each AT06 case mapped to its expected outcome (inconclusive
  / runner error / failed) and manually exercised once; full rehearsal from
  documented setup on the demo machine; OP02 timings measured once and recorded.
- **Gate:** AT06 passes; rehearsal succeeds; submission checklist complete. If
  repair is incomplete, ship explicitly discovery-only — never present partial
  work as satisfying the PRD.

## Validation rules

- Every milestone ends with `pnpm typecheck && pnpm test && pnpm build` from
  the repo root, plus its stated gate.
- Cross-milestone regression: each agent re-runs all prior gates that its
  milestone could break (M2 re-runs AT01; M3 re-runs AT01–AT02; M5 re-runs
  AT01–AT03).
- Highest-risk validation is the M3 gate (AT03): genuine agent-generated
  discovery is the release decision's core claim. If M3 slips, cut M4 polish
  and M5's second timing variation before touching it.

## Risks

- **M0 blocks M2–M5.** If the fixture agent stalls, all downstream agents stall.
  Mitigation: M0 is the smallest milestone; run it first and alone.
- **Trial/time budget arithmetic (OP01):** ~10–15 browser trials plus model
  calls inside 10 minutes is tight; M3 and M5 agents must measure real trial
  durations early and report back rather than silently exceeding budgets.
- **Muse API/tool-schema specifics** are confirmed during M3 integration (PRD
  §10 decision); if the SDK constrains tool shape, M3 adapts the §4 contract
  and records the change.
