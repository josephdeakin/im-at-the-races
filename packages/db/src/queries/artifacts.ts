import { randomUUID } from 'node:crypto';
import { asc, eq, sum } from 'drizzle-orm';
import type { DbOrTx, RacesDatabase } from '../client.js';
import { NotFoundError } from '../errors.js';
import { artifacts, runs, type ArtifactRow } from '../schema.js';

export interface CreateArtifactInput {
  runId: string;
  kind: string;
  relativePath: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
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
        sizeBytes: input.sizeBytes,
        sha256: input.sha256,
        createdAt: Date.now(),
      })
      .returning()
      .get();
  });
}

/** Total recorded artifact bytes for a run (capacity accounting). */
export function sumArtifactBytesByRun(db: DbOrTx, runId: string): number {
  const row = db
    .select({ total: sum(artifacts.sizeBytes) })
    .from(artifacts)
    .where(eq(artifacts.runId, runId))
    .get();
  const total = row?.total;
  if (total === null || total === undefined) return 0;
  return typeof total === 'number' ? total : Number(total);
}

export function getArtifact(db: DbOrTx, artifactId: string): ArtifactRow | undefined {
  return db.select().from(artifacts).where(eq(artifacts.id, artifactId)).get();
}

export function listArtifactsByRun(db: DbOrTx, runId: string): ArtifactRow[] {
  return db
    .select()
    .from(artifacts)
    .where(eq(artifacts.runId, runId))
    .orderBy(asc(artifacts.createdAt))
    .all();
}
