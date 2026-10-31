import { trialIdOf } from '@races/contracts';
import { getExperiment, getRun, getTrial, listEvents } from '@races/db';
import { getDb } from '@/lib/server/db';
import { guard, notFoundError, ok } from '@/lib/server/http';
import { toRunEventJsonSafe } from '@/lib/server/serializers';

export const runtime = 'nodejs';

/**
 * Trial-scoped events for before/after evidence comparison. The trial must
 * belong to the run; a trial from another run 404s the same as a missing one.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ runId: string; trialId: string }> },
) {
  return guard(async () => {
    const { runId, trialId } = await params;
    const db = getDb();
    if (!getRun(db, runId)) return notFoundError(`Run not found: ${runId}`);
    const trial = getTrial(db, trialId);
    const experiment = trial ? getExperiment(db, trial.experimentId) : undefined;
    if (!trial || !experiment || experiment.runId !== runId) {
      return notFoundError(`Trial not found in run: ${trialId}`);
    }
    const events = listEvents(db, runId, -1)
      .map(toRunEventJsonSafe)
      .filter((event) => trialIdOf(event) === trialId);
    return ok({ runId, trialId, events });
  });
}
