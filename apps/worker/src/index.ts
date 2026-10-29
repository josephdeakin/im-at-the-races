/**
 * Worker skeleton for "I'm at the Races".
 *
 * Today this process only proves the operational plumbing: it resolves the
 * shared .races database, applies migrations, and reports run counts. It
 * deliberately NEVER claims or completes runs — there is no executor yet, so
 * runs must remain queued until the experiment engine is connected.
 *
 * Future handoff (see @races/core Executor):
 *   1. claim a queued run transactionally (claimNextQueuedRun)
 *   2. execute it with an Executor, streaming events via the EventSink
 *   3. persist the terminal outcome (finishRun) and artifacts
 *   4. own browser/process cleanup in finally blocks, honouring
 *      cancelRequestedAt via the ExecutionContext AbortSignal
 */
import {
  closeSharedDatabase,
  getRunStatusCounts,
  getSharedDatabase,
  migrate,
  resolveDatabasePath,
} from '@races/db';

const HEARTBEAT_MS = 30_000;

function logCounts(tag: string): void {
  const { db } = getSharedDatabase();
  const counts = getRunStatusCounts(db);
  console.log(
    `[worker] ${tag}: ` +
      `queued=${counts.queued} running=${counts.running} ` +
      `completed=${counts.completed} failed=${counts.failed} ` +
      `cancelled=${counts.cancelled} interrupted=${counts.interrupted}`,
  );
}

function boot(): void {
  const dbPath = resolveDatabasePath();
  console.log('[worker] starting (skeleton, no executor connected)');
  console.log(`[worker] database: ${dbPath}`);

  const { sqlite } = getSharedDatabase();
  const { applied } = migrate(sqlite);
  console.log(
    applied.length === 0
      ? '[worker] database up to date'
      : `[worker] applied migrations: ${applied.join(', ')}`,
  );

  logCounts('status');
  console.log(
    '[worker] execution engine not connected: queued runs will remain queued. ' +
      'Connect an Executor (see packages/core) to start claiming runs.',
  );

  // Intentionally referenced: the heartbeat keeps the process alive until SIGINT/SIGTERM.
  const heartbeat = setInterval(() => logCounts('heartbeat'), HEARTBEAT_MS);

  const shutdown = (signal: string) => {
    console.log(`[worker] received ${signal}, shutting down`);
    clearInterval(heartbeat);
    closeSharedDatabase();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

boot();
