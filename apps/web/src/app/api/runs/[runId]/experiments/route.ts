import type { NextRequest } from 'next/server';
import { getRun, listExperimentsByRun, listTrialsByExperiment } from '@races/db';
import { getDb } from '@/lib/server/db';
import { guard, notFoundError, ok } from '@/lib/server/http';
import { toExperimentJson, toTrialJson } from '@/lib/server/serializers';

export const runtime = 'nodejs';

/** Experiments for a run with their trials nested (plan + outcomes + details). */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  return guard(async () => {
    const { runId } = await params;
    const db = getDb();
    if (!getRun(db, runId)) return notFoundError(`Run not found: ${runId}`);
    const experiments = listExperimentsByRun(db, runId).map((row) => ({
      ...toExperimentJson(row),
      trials: listTrialsByExperiment(db, row.id).map(toTrialJson),
    }));
    return ok({ runId, experiments });
  });
}
