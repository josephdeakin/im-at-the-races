import { randomUUID } from 'node:crypto';
import { and, asc, count, desc, eq, gt, isNull } from 'drizzle-orm';
import {
  INITIAL_RUN_PHASE,
  KNOWN_RUN_EVENT_KINDS,
  isTerminalRunStatus,
  type RunLimits,
  type RunMode,
  type RunStatus,
} from '@races/contracts';
import type { DbOrTx, RacesDatabase } from '../client.js';
import { NotFoundError } from '../errors.js';
import { projects, runEvents, runs, type RunEventRow, type RunRow } from '../schema.js';

export interface CreateRunInput {
  projectId: string;
  task: string;
  mode: RunMode;
  limits: RunLimits;
}

function requireRun(db: DbOrTx, runId: string): RunRow {
  const run = db.select().from(runs).where(eq(runs.id, runId)).get();
  if (!run) throw new NotFoundError('run', runId);
  return run;
}

function nextSequence(db: DbOrTx, runId: string): number {
  const last = db
    .select({ sequence: runEvents.sequence })
    .from(runEvents)
    .where(eq(runEvents.runId, runId))
    .orderBy(desc(runEvents.sequence))
    .limit(1)
    .get();
  return last ? last.sequence + 1 : 0;
}

function insertEvent(
  db: DbOrTx,
  runId: string,
  sequence: number,
  kind: string,
  payload: Record<string, unknown>,
): RunEventRow {
  return db
    .insert(runEvents)
    .values({
      id: randomUUID(),
      runId,
      sequence,
      kind,
      payload,
      createdAt: Date.now(),
    })
    .returning()
    .get();
}

/**
 * Atomically persist a queued run and its initial `run.created` event
 * (sequence 0). Throws NotFoundError when the project does not exist, in
 * which case nothing is persisted.
 */
export function createRun(
  db: RacesDatabase,
  input: CreateRunInput,
): { run: RunRow; event: RunEventRow } {
  return db.transaction((tx) => {
    const project = tx.select().from(projects).where(eq(projects.id, input.projectId)).get();
    if (!project) throw new NotFoundError('project', input.projectId);
    const now = Date.now();
    const run = tx
      .insert(runs)
      .values({
        id: randomUUID(),
        projectId: input.projectId,
        task: input.task,
        mode: input.mode,
        status: 'queued',
        phase: INITIAL_RUN_PHASE,
        limits: input.limits,
        cancelRequestedAt: null,
        createdAt: now,
        startedAt: null,
        finishedAt: null,
        errorCode: null,
        errorMessage: null,
      })
      .returning()
      .get();
    const event = insertEvent(tx, run.id, 0, KNOWN_RUN_EVENT_KINDS.CREATED, {
      task: input.task,
      mode: input.mode,
      limits: input.limits,
    });
    return { run, event };
  });
}

export function getRun(db: DbOrTx, runId: string): RunRow | undefined {
  return db.select().from(runs).where(eq(runs.id, runId)).get();
}

export function listRunsByProject(db: DbOrTx, projectId: string): RunRow[] {
  return db
    .select()
    .from(runs)
    .where(eq(runs.projectId, projectId))
    .orderBy(desc(runs.createdAt))
    .all();
}

/** Append one event with the next sequence number, atomically. */
export function appendEvent(
  db: RacesDatabase,
  runId: string,
  kind: string,
  payload: Record<string, unknown>,
): RunEventRow {
  return db.transaction((tx) => {
    requireRun(tx, runId);
    return insertEvent(tx, runId, nextSequence(tx, runId), kind, payload);
  });
}

const MAX_EVENTS_PER_PAGE = 1000;

/** Chronological events with sequence > after (exclusive cursor). */
export function listEvents(db: DbOrTx, runId: string, after: number): RunEventRow[] {
  return db
    .select()
    .from(runEvents)
    .where(and(eq(runEvents.runId, runId), gt(runEvents.sequence, after)))
    .orderBy(asc(runEvents.sequence))
    .limit(MAX_EVENTS_PER_PAGE)
    .all();
}

export interface CancelResult {
  run: RunRow;
  /** False when the call was a no-op (already terminal/cancelled). */
  changed: boolean;
}

/**
 * Idempotent cancellation.
 * - terminal run: no-op, never rewritten;
 * - queued run: transitions immediately to cancelled + finishedAt + event;
 * - running run: records cancelRequestedAt once + a cancel_requested event
 *   for the worker to observe.
 * Conditional updates keep concurrent web/worker cancellers from duplicating
 * the transition event.
 */
export function cancelRun(db: RacesDatabase, runId: string): CancelResult {
  const current = requireRun(db, runId);
  if (isTerminalRunStatus(current.status as RunStatus)) {
    return { run: current, changed: false };
  }

  if (current.status === 'queued') {
    const transitioned = db.transaction((tx) => {
      const updated = tx
        .update(runs)
        .set({ status: 'cancelled', phase: 'cancelled', finishedAt: Date.now() })
        .where(and(eq(runs.id, runId), eq(runs.status, 'queued')))
        .run();
      if (updated.changes === 0) return false;
      insertEvent(tx, runId, nextSequence(tx, runId), KNOWN_RUN_EVENT_KINDS.CANCELLED, {
        reason: 'cancelled-while-queued',
      });
      return true;
    });
    return { run: requireRun(db, runId), changed: transitioned };
  }

  const requested = db.transaction((tx) => {
    const updated = tx
      .update(runs)
      .set({ cancelRequestedAt: Date.now() })
      .where(and(eq(runs.id, runId), isNull(runs.cancelRequestedAt)))
      .run();
    if (updated.changes === 0) return false;
    insertEvent(tx, runId, nextSequence(tx, runId), KNOWN_RUN_EVENT_KINDS.CANCEL_REQUESTED, {});
    return true;
  });
  return { run: requireRun(db, runId), changed: requested };
}

export interface FinishRunOutcome {
  status: 'completed' | 'failed' | 'interrupted';
  phase?: string;
  errorCode?: string | null;
  errorMessage?: string | null;
}

/**
 * Record a terminal outcome. No-op (changed: false) when the run is already
 * terminal. Reserved for the future worker; the web app never calls this.
 */
export function finishRun(
  db: RacesDatabase,
  runId: string,
  outcome: FinishRunOutcome,
): { run: RunRow; changed: boolean } {
  const current = requireRun(db, runId);
  if (isTerminalRunStatus(current.status as RunStatus)) {
    return { run: current, changed: false };
  }
  const kind =
    outcome.status === 'completed'
      ? KNOWN_RUN_EVENT_KINDS.COMPLETED
      : outcome.status === 'failed'
        ? KNOWN_RUN_EVENT_KINDS.FAILED
        : KNOWN_RUN_EVENT_KINDS.INTERRUPTED;
  const finished = db.transaction((tx) => {
    tx.update(runs)
      .set({
        status: outcome.status,
        phase: outcome.phase ?? outcome.status,
        finishedAt: Date.now(),
        errorCode: outcome.errorCode ?? null,
        errorMessage: outcome.errorMessage ?? null,
      })
      .where(eq(runs.id, runId))
      .run();
    insertEvent(tx, runId, nextSequence(tx, runId), kind, {
      ...(outcome.errorCode ? { errorCode: outcome.errorCode } : {}),
      ...(outcome.errorMessage ? { errorMessage: outcome.errorMessage } : {}),
    });
    return true;
  });
  return { run: requireRun(db, runId), changed: finished };
}

/**
 * Transactionally claim the oldest queued run for a worker. Returns null when
 * nothing is claimable. Reserved for the future executor; the skeleton worker
 * deliberately never calls this, so runs stay queued until then.
 */
export function claimNextQueuedRun(
  db: RacesDatabase,
  workerId: string,
): RunRow | null {
  return db.transaction((tx) => {
    const candidate = tx
      .select()
      .from(runs)
      .where(eq(runs.status, 'queued'))
      .orderBy(asc(runs.createdAt))
      .limit(1)
      .get();
    if (!candidate) return null;
    const claimed = tx
      .update(runs)
      .set({ status: 'running', phase: 'claimed', startedAt: Date.now() })
      .where(and(eq(runs.id, candidate.id), eq(runs.status, 'queued')))
      .returning()
      .get();
    if (!claimed) return null;
    insertEvent(tx, claimed.id, nextSequence(tx, claimed.id), KNOWN_RUN_EVENT_KINDS.STARTED, {
      workerId,
    });
    return claimed;
  });
}

export interface PhaseResult {
  run: RunRow;
  /** False when the call was a no-op (run already terminal). */
  changed: boolean;
}

/**
 * Update a run's phase and append the corresponding `run.phase` event
 * atomically. No-op when the run is already terminal: terminal runs keep
 * their final phase.
 */
export function setRunPhase(db: RacesDatabase, runId: string, phase: string): PhaseResult {
  const current = requireRun(db, runId);
  if (isTerminalRunStatus(current.status as RunStatus)) {
    return { run: current, changed: false };
  }
  db.transaction((tx) => {
    tx.update(runs).set({ phase }).where(eq(runs.id, runId)).run();
    insertEvent(tx, runId, nextSequence(tx, runId), KNOWN_RUN_EVENT_KINDS.PHASE, { phase });
  });
  return { run: requireRun(db, runId), changed: true };
}

/**
 * Worker acknowledgement of a running-run cancellation: transitions
 * running -> cancelled with finishedAt and a `run.cancelled` event.
 * Idempotent: already-terminal runs are returned unchanged.
 */
export function completeCancellation(db: RacesDatabase, runId: string): CancelResult {
  const current = requireRun(db, runId);
  if (isTerminalRunStatus(current.status as RunStatus)) {
    return { run: current, changed: false };
  }
  const transitioned = db.transaction((tx) => {
    const updated = tx
      .update(runs)
      .set({ status: 'cancelled', phase: 'cancelled', finishedAt: Date.now() })
      .where(and(eq(runs.id, runId), eq(runs.status, 'running')))
      .run();
    if (updated.changes === 0) return false;
    insertEvent(tx, runId, nextSequence(tx, runId), KNOWN_RUN_EVENT_KINDS.CANCELLED, {
      reason: 'cancelled-while-running',
    });
    return true;
  });
  return { run: requireRun(db, runId), changed: transitioned };
}

/**
 * Boot recovery for a single-worker deployment: any run still marked running
 * when the worker starts must belong to a crashed process (this worker runs
 * one run at a time and finishes it before claiming the next). Mark each
 * interrupted with evidence preserved; never touch terminal runs.
 */
export function markAbandonedRunningInterrupted(
  db: RacesDatabase,
  workerId: string,
): { runIds: string[] } {
  const abandoned = db.select().from(runs).where(eq(runs.status, 'running')).all();
  const runIds: string[] = [];
  for (const run of abandoned) {
    db.transaction((tx) => {
      const updated = tx
        .update(runs)
        .set({ status: 'interrupted', phase: 'interrupted', finishedAt: Date.now() })
        .where(and(eq(runs.id, run.id), eq(runs.status, 'running')))
        .run();
      if (updated.changes === 0) return;
      insertEvent(tx, run.id, nextSequence(tx, run.id), KNOWN_RUN_EVENT_KINDS.INTERRUPTED, {
        reason: 'worker-restarted-while-running',
        workerId,
      });
      runIds.push(run.id);
    });
  }
  return { runIds };
}

/** Live counts per status for worker heartbeats and ops views. */
export function getRunStatusCounts(db: DbOrTx): Record<RunStatus, number> {
  const rows = db
    .select({ status: runs.status, total: count() })
    .from(runs)
    .groupBy(runs.status)
    .all();
  const counts: Record<RunStatus, number> = {
    queued: 0,
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    interrupted: 0,
  };
  for (const row of rows) {
    if (row.status in counts) {
      counts[row.status as RunStatus] = row.total;
    }
  }
  return counts;
}
