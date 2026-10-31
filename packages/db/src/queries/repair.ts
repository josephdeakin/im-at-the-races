import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import type {
  RepairAttemptStatus,
  VerificationCheckDetail,
  VerificationCheckStatus,
} from '@races/contracts';
import type { DbOrTx, RacesDatabase } from '../client.js';
import { NotFoundError } from '../errors.js';
import {
  experiments,
  findings,
  repairAttempts,
  reproducers,
  runs,
  verificationChecks,
  type RepairAttemptRow,
  type ReproducerRow,
  type VerificationCheckRow,
} from '../schema.js';

export interface CreateReproducerInput {
  runId: string;
  findingId: string;
  experimentId: string;
  bundlePath: string;
  testHash: string;
  planHash: string;
  checkHash: string;
  checkId: string;
}

export function createReproducer(db: RacesDatabase, input: CreateReproducerInput): ReproducerRow {
  return db.transaction((tx) => {
    const run = tx.select({ id: runs.id }).from(runs).where(eq(runs.id, input.runId)).get();
    if (!run) throw new NotFoundError('run', input.runId);
    const finding = tx
      .select({ id: findings.id })
      .from(findings)
      .where(eq(findings.id, input.findingId))
      .get();
    if (!finding) throw new NotFoundError('finding', input.findingId);
    const experiment = tx
      .select({ id: experiments.id })
      .from(experiments)
      .where(eq(experiments.id, input.experimentId))
      .get();
    if (!experiment) throw new NotFoundError('experiment', input.experimentId);
    return tx
      .insert(reproducers)
      .values({ id: randomUUID(), ...input, createdAt: Date.now() })
      .returning()
      .get();
  });
}

export function listReproducersByRun(db: DbOrTx, runId: string): ReproducerRow[] {
  return db
    .select()
    .from(reproducers)
    .where(eq(reproducers.runId, runId))
    .orderBy(asc(reproducers.createdAt))
    .all();
}

export interface CreateRepairAttemptInput {
  runId: string;
  reproducerId: string;
  attempt: number;
  workspacePath: string;
  sourceIdentity: string;
}

export function createRepairAttempt(
  db: RacesDatabase,
  input: CreateRepairAttemptInput,
): RepairAttemptRow {
  return db.transaction((tx) => {
    const reproducer = tx
      .select({ id: reproducers.id })
      .from(reproducers)
      .where(eq(reproducers.id, input.reproducerId))
      .get();
    if (!reproducer) throw new NotFoundError('reproducer', input.reproducerId);
    return tx
      .insert(repairAttempts)
      .values({
        id: randomUUID(),
        runId: input.runId,
        reproducerId: input.reproducerId,
        attempt: input.attempt,
        workspacePath: input.workspacePath,
        sourceIdentity: input.sourceIdentity,
        diff: '',
        status: 'running',
        createdAt: Date.now(),
        finishedAt: null,
      })
      .returning()
      .get();
  });
}

export function finishRepairAttempt(
  db: RacesDatabase,
  attemptId: string,
  input: { diff: string; status: RepairAttemptStatus },
): RepairAttemptRow {
  return db.transaction((tx) => {
    const existing = tx
      .select()
      .from(repairAttempts)
      .where(eq(repairAttempts.id, attemptId))
      .get();
    if (!existing) throw new NotFoundError('repair-attempt', attemptId);
    return tx
      .update(repairAttempts)
      .set({ diff: input.diff, status: input.status, finishedAt: Date.now() })
      .where(eq(repairAttempts.id, attemptId))
      .returning()
      .get();
  });
}

export function listRepairAttemptsByRun(db: DbOrTx, runId: string): RepairAttemptRow[] {
  return db
    .select()
    .from(repairAttempts)
    .where(eq(repairAttempts.runId, runId))
    .orderBy(asc(repairAttempts.attempt))
    .all();
}

export interface CreateVerificationCheckInput {
  runId: string;
  reproducerId: string;
  repairAttemptId: string | null;
  name: string;
  status: VerificationCheckStatus;
  detail: VerificationCheckDetail;
}

export function createVerificationCheck(
  db: RacesDatabase,
  input: CreateVerificationCheckInput,
): VerificationCheckRow {
  return db.transaction((tx) => {
    const reproducer = tx
      .select({ id: reproducers.id })
      .from(reproducers)
      .where(eq(reproducers.id, input.reproducerId))
      .get();
    if (!reproducer) throw new NotFoundError('reproducer', input.reproducerId);
    if (input.repairAttemptId) {
      const attempt = tx
        .select({ id: repairAttempts.id })
        .from(repairAttempts)
        .where(eq(repairAttempts.id, input.repairAttemptId))
        .get();
      if (!attempt) throw new NotFoundError('repair-attempt', input.repairAttemptId);
    }
    return tx
      .insert(verificationChecks)
      .values({ id: randomUUID(), ...input, createdAt: Date.now() })
      .returning()
      .get();
  });
}

export function listVerificationChecksByRun(db: DbOrTx, runId: string): VerificationCheckRow[] {
  return db
    .select()
    .from(verificationChecks)
    .where(eq(verificationChecks.runId, runId))
    .orderBy(asc(verificationChecks.createdAt))
    .all();
}
