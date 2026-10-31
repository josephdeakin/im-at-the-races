/**
 * Single-run worker loop: claim one queued run, execute it, persist the
 * terminal outcome, repeat. One active run is structural (next claim only
 * after terminal state); run one worker per database. Cancellation aborts
 * the executor and records cancelled after cleanup; a run left `running`
 * at boot belonged to a crashed worker and is marked interrupted.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import {
  AgentExecutor,
  AnthropicModelClient,
  ResponsesApiClient,
  UnavailableExecutor,
  type ExecutionContext,
  type ExecutionOutcome,
  type Executor,
  type ModelClient,
} from '@races/core';
import {
  claimNextQueuedRun,
  closeSharedDatabase,
  findRepoRoot,
  completeCancellation,
  finishRun,
  getProject,
  getRun,
  getRunStatusCounts,
  getSharedDatabase,
  markAbandonedRunningInterrupted,
  migrate,
  resolveDatabasePath,
  resolveRacesDir,
  type RacesDatabase,
  type RunRow,
} from '@races/db';
import { toProjectDto, toRunDto } from './dto.js';
import {
  DbEventSink,
  DbExperimentStore,
  FsArtifactStore,
  LocalEvidenceReader,
} from './sinks.js';

const CLAIM_POLL_MS = 1000;
const CANCEL_POLL_MS = 500;
const HEARTBEAT_MS = 30_000;
const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';

const workerId = `worker-${randomUUID().slice(0, 8)}`;
let executor: Executor | null = null;

/**
 * Single-worker lock. Boot recovery assumes it owns every `running` run, so
 * only one worker may ever hold it: the file carries the owner pid, and a
 * lock left by a dead process is reclaimed.
 */
function acquireWorkerLock(lockPath: string): void {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, workerId }));
      fs.closeSync(fd);
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      let ownerPid: number | null = null;
      try {
        const parsed = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as { pid?: unknown };
        if (typeof parsed.pid === 'number') ownerPid = parsed.pid;
      } catch {
        ownerPid = null;
      }
      if (ownerPid !== null && ownerPid !== process.pid) {
        try {
          process.kill(ownerPid, 0);
          console.error(
            `[worker] another worker (pid ${ownerPid}) already holds ${lockPath}; refusing to start`,
          );
          process.exit(1);
        } catch {
          // Owner is gone: fall through and reclaim.
        }
      }
      fs.rmSync(lockPath, { force: true });
    }
  }
  console.error(`[worker] could not acquire ${lockPath}`);
  process.exit(1);
}

function releaseWorkerLock(lockPath: string): void {
  try {
    const parsed = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as { pid?: unknown };
    if (parsed.pid === process.pid) fs.rmSync(lockPath, { force: true });
  } catch {
    // Already gone (or unreadable): nothing to release.
  }
}

function getExecutor(db: RacesDatabase): Executor {
  if (executor) return executor;
  const apiKey = process.env.RACES_MODEL_API_KEY?.trim();
  if (!apiKey) {
    console.log('[worker] RACES_MODEL_API_KEY is not set: runs will fail with MODEL_UNAVAILABLE.');
    executor = new UnavailableExecutor();
    return executor;
  }
  const modelId = process.env.RACES_MODEL?.trim() || DEFAULT_MODEL;
  const provider = process.env.RACES_MODEL_PROVIDER?.trim() || 'anthropic';
  const baseUrl = process.env.RACES_MODEL_BASE_URL?.trim() || undefined;
  let model: ModelClient;
  if (provider === 'openai-responses') {
    if (!baseUrl) {
      console.log('[worker] RACES_MODEL_BASE_URL is required for openai-responses provider.');
      executor = new UnavailableExecutor(
        'Model provider misconfigured: set RACES_MODEL_BASE_URL for the openai-responses provider.',
      );
      return executor;
    }
    model = new ResponsesApiClient({ apiKey, model: modelId, baseUrl });
  } else if (provider === 'anthropic') {
    model = new AnthropicModelClient({ apiKey, model: modelId, baseUrl });
  } else {
    console.log(`[worker] unknown RACES_MODEL_PROVIDER: ${provider}`);
    executor = new UnavailableExecutor(
      `Unknown model provider: ${provider}. Use anthropic or openai-responses.`,
    );
    return executor;
  }
  console.log(`[worker] agent executor using model ${modelId} (provider ${provider})`);
  executor = new AgentExecutor({
    model,
    modelId,
    store: new DbExperimentStore(db),
    evidence: new LocalEvidenceReader(db),
    racesDir: resolveRacesDir(),
  });
  return executor;
}

let shuttingDown = false;
let currentAbort: AbortController | null = null;

function logCounts(tag: string, db: RacesDatabase): void {
  const counts = getRunStatusCounts(db);
  console.log(
    `[worker] ${tag}: ` +
      `queued=${counts.queued} running=${counts.running} ` +
      `completed=${counts.completed} failed=${counts.failed} ` +
      `cancelled=${counts.cancelled} interrupted=${counts.interrupted}`,
  );
}

function toFinishedOutcome(outcome: ExecutionOutcome): {
  status: 'completed' | 'failed' | 'interrupted';
  errorCode?: string | null;
  errorMessage?: string | null;
} {
  if (outcome.status === 'completed') return { status: 'completed' };
  if (outcome.status === 'failed') {
    return {
      status: 'failed',
      errorCode: outcome.errorCode,
      errorMessage: outcome.errorMessage,
    };
  }
  return { status: 'interrupted', errorMessage: outcome.errorMessage };
}

async function executeClaimedRun(db: RacesDatabase, claimed: RunRow): Promise<void> {
  const projectRow = getProject(db, claimed.projectId);
  if (!projectRow) {
    finishRun(db, claimed.id, {
      status: 'failed',
      errorCode: 'PROJECT_MISSING',
      errorMessage: `Project ${claimed.projectId} no longer exists.`,
    });
    return;
  }

  const abort = new AbortController();
  currentAbort = abort;
  const cancelWatcher = setInterval(() => {
    try {
      const current = getRun(db, claimed.id);
      if (current?.cancelRequestedAt != null) abort.abort();
    } catch (err) {
      console.error(`[worker] cancel watcher failed for run ${claimed.id}:`, err);
    }
  }, CANCEL_POLL_MS);

  try {
    const ctx: ExecutionContext = {
      run: toRunDto(claimed),
      project: toProjectDto(projectRow),
      limits: toRunDto(claimed).limits,
      events: new DbEventSink(db),
      artifacts: new FsArtifactStore(db),
      signal: abort.signal,
    };
    let outcome: ExecutionOutcome;
    try {
      outcome = await getExecutor(db).execute(ctx);
    } catch (err) {
      outcome =
        err instanceof Error && err.name === 'AbortError'
          ? { status: 'interrupted', errorMessage: 'Run aborted.' }
          : {
              status: 'failed',
              errorCode: 'EXECUTOR_ERROR',
              errorMessage: err instanceof Error ? err.message : String(err),
            };
    }

    const latest = getRun(db, claimed.id);
    if (latest?.cancelRequestedAt != null) {
      completeCancellation(db, claimed.id);
      console.log(`[worker] run ${claimed.id} cancelled`);
    } else if (!latest) {
      console.error(`[worker] run ${claimed.id} disappeared during execution`);
    } else {
      const finished = toFinishedOutcome(outcome);
      finishRun(db, claimed.id, { ...finished, phase: 'done' });
      console.log(`[worker] run ${claimed.id} ${finished.status}`);
    }
  } finally {
    clearInterval(cancelWatcher);
    currentAbort = null;
  }
}

async function pollOnce(db: RacesDatabase): Promise<void> {
  if (shuttingDown) return;
  let claimed: RunRow | null;
  try {
    claimed = claimNextQueuedRun(db, workerId);
  } catch (err) {
    console.error('[worker] claim failed:', err);
    return;
  }
  if (!claimed) return;
  // A run cancelled between listing and claiming still claims (the claim only
  // checks status=queued, and cancel-while-queued flips to cancelled — but a
  // cancel request racing the claim deserves an immediate terminal record
  // rather than wasted execution).
  const fresh = getRun(db, claimed.id);
  if (fresh?.cancelRequestedAt != null) {
    completeCancellation(db, claimed.id);
    console.log(`[worker] run ${claimed.id} cancelled before start`);
    return;
  }
  console.log(`[worker] claimed run ${claimed.id} (executor: ${getExecutor(db).name})`);
  await executeClaimedRun(db, claimed);
}

function boot(): void {
  // Repo-root .env (the script's cwd is apps/worker under pnpm --filter).
  // Real environment variables always win over .env entries.
  dotenv.config({ path: path.join(findRepoRoot(), '.env') });
  const dbPath = resolveDatabasePath();
  console.log(`[worker] starting (${workerId})`);
  console.log(`[worker] database: ${dbPath}`);

  const lockPath = path.join(path.dirname(dbPath), 'worker.lock');
  acquireWorkerLock(lockPath);
  process.on('exit', () => releaseWorkerLock(lockPath));

  const { db, sqlite } = getSharedDatabase();
  const { applied } = migrate(sqlite);
  console.log(
    applied.length === 0
      ? '[worker] database up to date'
      : `[worker] applied migrations: ${applied.join(', ')}`,
  );

  const { runIds } = markAbandonedRunningInterrupted(db, workerId);
  for (const runId of runIds) {
    console.log(`[worker] run ${runId} marked interrupted (abandoned by a previous worker)`);
  }

  logCounts('status', db);

  let busy = false;
  const pollTimer = setInterval(() => {
    if (busy || shuttingDown) return;
    busy = true;
    void pollOnce(db).finally(() => {
      busy = false;
    });
  }, CLAIM_POLL_MS);

  const heartbeat = setInterval(() => {
    if (!shuttingDown) logCounts('heartbeat', db);
  }, HEARTBEAT_MS);

  const shutdown = (signal: string) => {
    if (shuttingDown) {
      console.log('[worker] second signal received, exiting immediately');
      process.exit(1);
    }
    shuttingDown = true;
    console.log(`[worker] received ${signal}, finishing current run then exiting`);
    clearInterval(pollTimer);
    clearInterval(heartbeat);
    currentAbort?.abort();
    // The in-flight run (if any) lands via the normal path: abort ->
    // interrupted outcome, or cancelled when a request exists. Wait briefly
    // for the poll cycle to persist it; boot recovery covers a hard kill.
    const started = Date.now();
    const waiter = setInterval(() => {
      if (!busy || Date.now() - started > 10_000) {
        clearInterval(waiter);
        closeSharedDatabase();
        process.exit(0);
      }
    }, 100);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Surface programming errors loudly instead of silently stalling the loop.
  process.on('unhandledRejection', (err) => {
    console.error('[worker] unhandled rejection:', err);
  });
}

boot();
