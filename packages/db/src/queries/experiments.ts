import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { TrialKind, TrialOutcome } from '@races/contracts';
import { writeTransaction } from '../client.js';
import type { DbOrTx, RacesDatabase } from '../client.js';
import { NotFoundError } from '../errors.js';
import {
  experiments,
  runs,
  trials,
  type ExperimentRow,
  type TrialRow,
} from '../schema.js';

export interface CreateExperimentInput {
  runId: string;
  name: string;
  hypothesis: string;
  plan: Record<string, unknown>;
}

export function createExperiment(
  db: RacesDatabase,
  input: CreateExperimentInput,
): ExperimentRow {
  return writeTransaction(db, (tx) => {
    const run = tx.select({ id: runs.id }).from(runs).where(eq(runs.id, input.runId)).get();
    if (!run) throw new NotFoundError('run', input.runId);
    const now = Date.now();
    return tx
      .insert(experiments)
      .values({
        id: randomUUID(),
        runId: input.runId,
        name: input.name,
        hypothesis: input.hypothesis,
        plan: input.plan,
        status: 'running',
        createdAt: now,
        finishedAt: null,
      })
      .returning()
      .get();
  });
}

export function finishExperiment(
  db: RacesDatabase,
  experimentId: string,
  status: 'completed' | 'failed' | 'interrupted',
): ExperimentRow {
  return writeTransaction(db, (tx) => {
    const existing = tx
      .select()
      .from(experiments)
      .where(eq(experiments.id, experimentId))
      .get();
    if (!existing) throw new NotFoundError('experiment', experimentId);
    if (existing.status !== 'running') return existing;
    return tx
      .update(experiments)
      .set({ status, finishedAt: Date.now() })
      .where(and(eq(experiments.id, experimentId), eq(experiments.status, 'running')))
      .returning()
      .get();
  });
}

export function getExperiment(db: DbOrTx, experimentId: string): ExperimentRow | undefined {
  return db.select().from(experiments).where(eq(experiments.id, experimentId)).get();
}

export function listExperimentsByRun(db: DbOrTx, runId: string): ExperimentRow[] {
  return db
    .select()
    .from(experiments)
    .where(eq(experiments.runId, runId))
    .orderBy(asc(experiments.createdAt))
    .all();
}

export function createTrial(
  db: RacesDatabase,
  experimentId: string,
  kind: TrialKind,
  attempt = 0,
): TrialRow {
  return writeTransaction(db, (tx) => {
    const experiment = tx
      .select({ id: experiments.id })
      .from(experiments)
      .where(eq(experiments.id, experimentId))
      .get();
    if (!experiment) throw new NotFoundError('experiment', experimentId);
    return tx
      .insert(trials)
      .values({
        id: randomUUID(),
        experimentId,
        kind,
        outcome: null,
        detail: null,
        attempt,
        startedAt: Date.now(),
        finishedAt: null,
      })
      .returning()
      .get();
  });
}

export function finishTrial(
  db: RacesDatabase,
  trialId: string,
  outcome: TrialOutcome,
  detail: Record<string, unknown>,
): TrialRow {
  return writeTransaction(db, (tx) => {
    const existing = tx.select().from(trials).where(eq(trials.id, trialId)).get();
    if (!existing) throw new NotFoundError('trial', trialId);
    if (existing.outcome !== null) return existing;
    return tx
      .update(trials)
      .set({ outcome, detail, finishedAt: Date.now() })
      .where(and(eq(trials.id, trialId), isNull(trials.outcome)))
      .returning()
      .get();
  });
}

export function getTrial(db: DbOrTx, trialId: string): TrialRow | undefined {
  return db.select().from(trials).where(eq(trials.id, trialId)).get();
}

export function listTrialsByExperiment(db: DbOrTx, experimentId: string): TrialRow[] {
  return db
    .select()
    .from(trials)
    .where(eq(trials.experimentId, experimentId))
    .orderBy(asc(trials.startedAt))
    .all();
}

/** Every trial of a run in one join (the experiments poll path). */
export function listTrialsByRun(db: DbOrTx, runId: string): TrialRow[] {
  return db
    .select({ trial: trials })
    .from(trials)
    .innerJoin(experiments, eq(trials.experimentId, experiments.id))
    .where(eq(experiments.runId, runId))
    .orderBy(asc(trials.startedAt))
    .all()
    .map((row) => row.trial);
}
