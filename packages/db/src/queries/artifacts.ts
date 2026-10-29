import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import type { DbOrTx, RacesDatabase } from '../client.js';
import { NotFoundError } from '../errors.js';
import { artifacts, runs, type ArtifactRow } from '../schema.js';

export interface CreateArtifactInput {
  runId: string;
  kind: string;
  relativePath: string;
  mimeType: string;
}

/** Record an artifact produced by a run (trace, screenshot, patch diff...). */
export function createArtifact(db: RacesDatabase, input: CreateArtifactInput): ArtifactRow {
  return db.transaction((tx) => {
    const run = tx.select({ id: runs.id }).from(runs).where(eq(runs.id, input.runId)).get();
    if (!run) throw new NotFoundError('run', input.runId);
    return tx
      .insert(artifacts)
      .values({
        id: randomUUID(),
        runId: input.runId,
        kind: input.kind,
        relativePath: input.relativePath,
        mimeType: input.mimeType,
        createdAt: Date.now(),
      })
      .returning()
      .get();
  });
}

export function listArtifactsByRun(db: DbOrTx, runId: string): ArtifactRow[] {
  return db
    .select()
    .from(artifacts)
    .where(eq(artifacts.runId, runId))
    .orderBy(asc(artifacts.createdAt))
    .all();
}
