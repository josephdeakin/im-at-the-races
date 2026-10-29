import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import type { FindingStatus } from '@races/contracts';
import type { DbOrTx, RacesDatabase } from '../client.js';
import { NotFoundError } from '../errors.js';
import { experiments, findings, runs, type FindingRow } from '../schema.js';

export interface CreateFindingInput {
  runId: string;
  experimentId: string;
  title: string;
  status: FindingStatus;
  expectationProvenance: string;
  explanation: string;
  implicatedCode: { path: string; excerpt: string | null; exists: boolean }[];
  sourceIdentity: string;
}

export function createFinding(db: RacesDatabase, input: CreateFindingInput): FindingRow {
  return db.transaction((tx) => {
    const run = tx.select({ id: runs.id }).from(runs).where(eq(runs.id, input.runId)).get();
    if (!run) throw new NotFoundError('run', input.runId);
    const experiment = tx
      .select({ id: experiments.id })
      .from(experiments)
      .where(eq(experiments.id, input.experimentId))
      .get();
    if (!experiment) throw new NotFoundError('experiment', input.experimentId);
    return tx
      .insert(findings)
      .values({
        id: randomUUID(),
        runId: input.runId,
        experimentId: input.experimentId,
        title: input.title,
        status: input.status,
        expectationProvenance: input.expectationProvenance,
        explanation: input.explanation,
        implicatedCode: input.implicatedCode,
        sourceIdentity: input.sourceIdentity,
        createdAt: Date.now(),
      })
      .returning()
      .get();
  });
}

export function listFindingsByRun(db: DbOrTx, runId: string): FindingRow[] {
  return db
    .select()
    .from(findings)
    .where(eq(findings.runId, runId))
    .orderBy(asc(findings.createdAt))
    .all();
}
