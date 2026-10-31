import type { NextRequest } from 'next/server';
import { RunModeSchema } from '@races/contracts';
import { createRun, getRun } from '@races/db';
import { getDb } from '@/lib/server/db';
import {
  accepted,
  apiError,
  guard,
  isSameOriginMutation,
  notFoundError,
  validationError,
} from '@/lib/server/http';
import { toRunJson } from '@/lib/server/serializers';

export const runtime = 'nodejs';

/**
 * Rerun an investigation: creates a NEW run with the same task, mode, and
 * limits, linked to the source run in its own event log. Historical evidence
 * is never mutated; the new run executes fresh trials under the worker.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  return guard(async () => {
    if (!isSameOriginMutation(req)) {
      return apiError('ORIGIN_FORBIDDEN', 'Cross-origin mutations are not allowed', 403);
    }
    const { runId } = await params;
    const db = getDb();
    const source = getRun(db, runId);
    if (!source) return notFoundError(`Run not found: ${runId}`);
    const mode = RunModeSchema.safeParse(source.mode);
    if (!mode.success) return validationError('Stored run has an unknown mode', null);
    const { run } = createRun(db, {
      projectId: source.projectId,
      task: source.task,
      mode: mode.data,
      limits: source.limits,
      rerunOf: runId,
    });
    return accepted({ runId: run.id, run: toRunJson(run) });
  });
}
