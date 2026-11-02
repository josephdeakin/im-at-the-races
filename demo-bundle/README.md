# Recorded canonical run (fallback demo)

Complete verified investigate-repair run `14490d7a-7072-4626-ab5d-f24cce7bae23`
on the stale-bank fixture, recorded live with Muse Spark
(`muse-spark-1.3-contributor`, Meta Model API) on 2026-11-01:
reproduced finding confirmed 3-of-3, verified patch in 1 attempt,
18 model calls (125,746 input / 9,914 output tokens), 366 events,
49 artifact files, 15 verification checks.

Replay it with no model key:

```sh
pnpm install
RACES_DIR=/tmp/races-demo node scripts/import-run.cjs demo-bundle
RACES_DIR=/tmp/races-demo PORT=3101 pnpm --filter web start
# open http://127.0.0.1:3101/runs/14490d7a-7072-4626-ab5d-f24cce7bae23
```

Every tab replays from persisted evidence: timeline, findings, patch,
verification matrix, and the labelled Muse Spark vision note.
Import verifies each artifact's sha256 against the bundled bytes and
refuses a bundle whose files do not match. All demo data is synthetic.
