import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import type { TrialKind, TrialOutcome } from '@races/contracts';
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
  return db.transaction((tx) => {
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
  return db.transaction((tx) => {
    const existing = tx
      .select()
      .from(experiments)
      .where(eq(experiments.id, experimentId))
      .get();
    if (!existing) throw new NotFoundError('experiment', experimentId);
    return tx
      .update(experiments)
      .set({ status, finishedAt: Date.now() })
      .where(eq(experiments.id, experimentId))
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
  return db.transaction((tx) => {
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
  return db.transaction((tx) => {
    const existing = tx.select().from(trials).where(eq(trials.id, trialId)).get();
    if (!existing) throw new NotFoundError('trial', trialId);
    return tx
      .update(trials)
      .set({ outcome, detail, finishedAt: Date.now() })
      .where(eq(trials.id, trialId))
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
