import type { NextRequest } from 'next/server';
import {
  getRun,
  listArtifactsByRun,
  listRepairAttemptsByRun,
  listReproducersByRun,
  listVerificationChecksByRun,
} from '@races/db';
import { getDb } from '@/lib/server/db';
import { guard, notFoundError, ok } from '@/lib/server/http';
import {
  toArtifactJson,
  toRepairAttemptJson,
  toReproducerJson,
  toVerificationCheckJson,
} from '@/lib/server/serializers';

export const runtime = 'nodejs';

/** Repair record for a run: frozen reproducers, patch attempts, the check matrix, and repro export artifacts. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  return guard(async () => {
    const { runId } = await params;
    const db = getDb();
    if (!getRun(db, runId)) return notFoundError(`Run not found: ${runId}`);
    return ok({
      runId,
      reproducers: listReproducersByRun(db, runId).map(toReproducerJson),
      attempts: listRepairAttemptsByRun(db, runId).map(toRepairAttemptJson),
      checks: listVerificationChecksByRun(db, runId).map(toVerificationCheckJson),
      reproArtifacts: listArtifactsByRun(db, runId)
        .filter((row) => row.kind.startsWith('repro-'))
        .map(toArtifactJson),
    });
  });
}
