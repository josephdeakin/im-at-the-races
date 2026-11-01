# Submission checklist

## Done in repo

- [x] `pnpm typecheck`, `pnpm test`, `pnpm build` green from the root
      (re-verified 2026-10-31 after the CODE_REVIEW.md fix pass:
      127 tests across contracts/db/core/web/worker; fixture suite shows
      only its labelled FAIL_TO_PASS red, by design).
- [x] AT01–AT06 exercised live (see milestone notes): claim/cancel/crash,
      scripted pair, autonomous discovery, verified repair, fixed control,
      and the failure matrix.
- [x] README: setup, environment, model boundary, limitations, cleanup.
- [x] `docs/demo.md`: 3-minute script, recorded fallback bundle, OP02 timings.
- [x] No model keys in the repo (`.env` gitignored, no `NEXT_PUBLIC_*` keys).
- [x] Demo-grade scope disclosed: localhost-only, single operator, git needed
      for repair, 2 repair attempts, obvious-pattern redaction only.
- [x] Meta-first pass (2026-11-01): worker defaults to Muse Spark via
      `openai-responses` + `https://api.meta.ai/v1`; Anthropic is an explicit
      fallback. Run header shows a Muse Spark badge with recorded model
      calls/tokens parsed from the persisted run log.
- [x] Muse Spark vision shipped as a labelled extra: worker appends a
      "model explanation, not evidence" note over the last screenshot;
      Findings view badges it as such. Verdicts never read it.
- [x] Canonical Meta run recorded live (run `14490d7a`, stale-bank):
      reproduced finding, verified patch in 1 attempt, all required
      verification gates green, 18 model calls (125,746 in / 9,914 out
      tokens), vision note appended. Fallback bundle exported to
      `/tmp/demo-bundle-canonical` (366 events, 49 files).
- [x] Paste-ready portal copy in `docs/submission.md`.
- [x] Gates re-run 2026-11-01 after the Meta-first pass: `pnpm typecheck`,
      `pnpm test` (195 tests), `pnpm build` all green.

## Organiser items (verify from the current event portal before release)

- [ ] Exact deadline, timezone, and eligibility rules.
- [ ] Repository access requirements (public/private, branch, commit pin).
- [ ] Demonstration video: record from `docs/demo.md` (narration + captions),
      upload per portal instructions.
- [ ] Product description and required disclosures (model provider usage,
      local-first/not-offline boundary, synthetic demo data).
- [ ] Dependency versions pinned: see `pnpm-lock.yaml`, `packageManager`,
      `.nvmrc` (Node 22 / pnpm 10), `playwright@1.49.1` in
      `packages/core/package.json`.
- [ ] Known limitations: README "Current limitations" section.
