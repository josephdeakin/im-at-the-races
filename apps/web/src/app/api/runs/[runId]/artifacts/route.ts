import type { NextRequest } from 'next/server';
import { getRun, listArtifactsByRun } from '@races/db';
import { getDb } from '@/lib/server/db';
import { guard, notFoundError, ok } from '@/lib/server/http';
import { toArtifactJson } from '@/lib/server/serializers';

export const runtime = 'nodejs';

/** All artifacts recorded for a run, oldest first. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  return guard(async () => {
    const { runId } = await params;
    const db = getDb();
    if (!getRun(db, runId)) return notFoundError(`Run not found: ${runId}`);
    return ok({ runId, artifacts: listArtifactsByRun(db, runId).map(toArtifactJson) });
  });
}
