# Submission copy (Cerebral Valley portal)

Paste-ready text. Verify track, deadline, and problem-statement wording
against the live portal before filing (see `docs/submission-checklist.md`).

## One-liner

I'm at the Races: a Muse Spark agent that forces web-app race conditions
into the open, proves them, patches them, and proves the patch.

## Description

Two $30 transfers should leave $40. When the slower first response lands
last, the balance jumps back to $70 — while the ledger shows $60 out. Money
created from thin air, by nothing more exotic than responses arriving out
of order.

Every response was individually correct. Happy-path tests pass. The bug
only exists in the ordering, so developers find it in production — in
payments, checkout totals, inventory counts, live odds, and search results.

I'm at the Races hunts this bug class on purpose:

1. A Muse Spark agent reads the repository and observes the running app.
2. It designs a timing experiment and holds/releases real browser HTTP
   responses with Playwright to force the bad order.
3. An executable assertion proves the failure; three confirmation attempts
   separate a reproduced finding from a flake.
4. The reproducer is frozen as a regression test with recorded hashes.
5. A patch is generated in an isolated git worktree — the original
   checkout is never touched.
6. Verification reruns the frozen test on the original (must fail) and on
   the patch (must pass 3×), plus timing variations, the natural workflow,
   and the project's own suite.

The UI is a visual race debugger: synchronized timeline, network lanes,
before/after screenshots, findings with expectation provenance, the patch
diff, and the verification matrix. Muse Spark vision adds a labelled
plain-language explanation of the decisive screenshot. It is marked
"model explanation — not evidence" everywhere it appears; verdicts come
only from executable assertions.

## Meta AI tooling

- **Muse Spark** (`muse-spark-1.3-contributor`) via the Meta Model API
  (Responses API, `https://api.meta.ai/v1`) is the default and primary
  model: agent investigation, experiment design, repair generation, and
  screenshot explanation.
- A full investigate-repair run is typically 10–30 model calls over
  2–8 minutes. Per-run model, call count, and token usage are recorded in
  the run's event log and shown in the run header.
- Built with the hackathon's $150 Meta Model API credits. Anthropic is an
  optional, explicitly selected fallback and is not used for the demo run.

## What it is not

Local-first, not offline: source excerpts and browser observations go to
the configured model provider. Single operator, loopback only, no auth.
Repairs are capped at 2 attempts in an isolated checkout that is not an OS
sandbox. A green verification means "verified for the tested cases" —
never "this app is race-free." Demo data is synthetic.

## Links to provide on the portal

- Repository: (paste URL of the submitted commit)
- Demo video (3 minutes, captioned): (paste URL)
- Short clip (30 seconds, community/bonus): (paste URL)
- Recorded fallback: export with `pnpm export-run`, replay per
  `docs/demo.md` — no model key needed.

## Demo in one paragraph (if the portal asks)

Open on the bank bug by hand ($70 after $60 out). Open the pre-started
run: baseline passes at $40, the intervention holds the first response
and the assertion fails at $70, confirmed 3/3. Show the finding, the
one-line patch from the isolated worktree, and the verification matrix
turning green. Close on the persisted evidence. Full script:
`docs/demo.md`.
