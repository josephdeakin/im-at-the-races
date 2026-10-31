# Submission checklist

## Done in repo

- [x] `pnpm typecheck`, `pnpm test`, `pnpm build` green from the root.
- [x] AT01–AT06 exercised live (see milestone notes): claim/cancel/crash,
      scripted pair, autonomous discovery, verified repair, fixed control,
      and the failure matrix.
- [x] README: setup, environment, model boundary, limitations, cleanup.
- [x] `docs/demo.md`: 3-minute script, recorded fallback bundle, OP02 timings.
- [x] No model keys in the repo (`.env` gitignored, no `NEXT_PUBLIC_*` keys).
- [x] Demo-grade scope disclosed: localhost-only, single operator, git needed
      for repair, 2 repair attempts, obvious-pattern redaction only.

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
