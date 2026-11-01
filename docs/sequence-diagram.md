# Sequence diagram: investigate, repair, verify

Render with any Mermaid renderer (VS Code Mermaid preview,
[mermaid.live](https://mermaid.live), or `npx @mermaid-js/mermaid-cli`).
Screenshot the render for the video or submission docs.

```mermaid
sequenceDiagram
    autonumber
    participant D as Developer
    participant W as Web UI (Next.js)
    participant K as Worker (claim loop)
    participant A as Muse Spark agent
    participant T as Target app (Playwright)

    D->>W: create project (repo path + target URL)
    D->>W: queue investigate-repair run
    W->>K: run waits queued
    K->>K: claimNextQueuedRun (one active run)
    K->>A: execute with budgets (calls, plans, time)
    A->>A: read source (listFiles/searchCode/readFile)
    A->>T: observePage + act (discover workflow)
    A->>T: runExperiment: baseline trial
    T-->>A: pass ($40.00 correct)
    A->>T: runExperiment: intervention (hold early, release late)
    T-->>A: violation ($70.00 stale overwrite)
    A->>T: runExperiment confirm x3
    T-->>A: 3-of-3 violations, same check
    A->>K: finish: reproduced finding + provenance
    Note over K: freeze reproducer, record test/plan/check hashes
    K->>K: create isolated git worktree (original untouched)
    K->>A: repair: generate patch in worktree
    A-->>K: diff (stale guard applied)
    K->>T: frozen test on ORIGINAL: must fail
    T-->>K: fails for stated assertion
    K->>T: frozen test on PATCHED x3 + timing variations
    T-->>K: all pass
    K->>K: project build/typecheck/test (no-worse-than-baseline)
    K->>K: vision note over decisive screenshot (labelled, non-verdict)
    K->>W: completed: timeline, finding, patch, verification matrix
    W->>D: review evidence, export patch + test
```
