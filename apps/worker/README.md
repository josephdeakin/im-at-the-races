# Worker

Separate Node/TypeScript entry point (`src/index.ts`) that owns all
investigation execution. Run with `pnpm dev:worker` from the repo root
(or `pnpm --filter worker start` on the built output).

Current behaviour:

- Opens the shared SQLite database under `.races/` (or `$RACES_DIR`) and
  applies migrations. Takes a single-worker lock file; a second worker
  refuses to start, and a lock left by a dead process is reclaimed.
- Claims one queued run at a time (`claimNextQueuedRun`), executes it via
  the `AgentExecutor` in `@races/core`, and persists the terminal outcome
  (`finishRun` / cancellation). One active run is structural: run one
  worker per database.
- Model: Muse Spark (`muse-spark-1.3-contributor`) via the Meta Model
  API (`openai-responses`, `https://api.meta.ai/v1`) by default, from
  `RACES_MODEL_API_KEY` (worker-only, never `NEXT_PUBLIC_*`). Anthropic
  is an explicitly selected fallback. With no key, runs fail fast with
  `MODEL_UNAVAILABLE`.
- Cancellation is polled and aborts the executor; runs left `running`
  by a crashed worker are marked `interrupted` at boot. On completed
  runs a best-effort Muse Spark vision note over the decisive screenshot
  is appended, labelled "model explanation, not evidence"; it never
  affects any verdict.
- Exits cleanly on SIGINT/SIGTERM.
