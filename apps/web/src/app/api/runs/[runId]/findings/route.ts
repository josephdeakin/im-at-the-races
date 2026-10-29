import type { NextRequest } from 'next/server';
import { getRun, listFindingsByRun } from '@races/db';
import { getDb } from '@/lib/server/db';
import { guard, notFoundError, ok } from '@/lib/server/http';
import { toFindingJson } from '@/lib/server/serializers';

export const runtime = 'nodejs';

/** Findings recorded for a run, oldest first. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  return guard(async () => {
    const { runId } = await params;
    const db = getDb();
    if (!getRun(db, runId)) return notFoundError(`Run not found: ${runId}`);
    return ok({ runId, findings: listFindingsByRun(db, runId).map(toFindingJson) });
  });
}
