# Regression test: Stale transfer response overwrites newer balance (lost update)

Frozen timing reproducer. Fails on the vulnerable app, passes once fixed.

## Run it

```sh
pnpm add -D playwright@1.49.1
npx playwright install chromium
# start the app under test, then:
REPRO_TARGET_URL=http://127.0.0.1:4110/ npx playwright test repro.spec.ts
```

## Reading the result

- Exit 0: all checks passed under the recorded delivery schedule.
- `REPRO-CHECK-FAILED <id>`: the app still exhibits the bug; the named check
  failed with expected/observed values printed alongside.
- `REPRO-ERROR <stage>`: the setup failed (unreachable app, missing
  selector, unmatched traffic). This is not a verdict about the bug.

## Provenance

- Source identity: git:fe172c4713d5c7a6326f34ab92298fc631ff40a1:subpath-clean+1-untracked
- Plan: `plan.json` (schema v1)
- Manifest: `manifest.json` pins content hashes and versions.
- The test needs only Playwright and a running app; no model access.
