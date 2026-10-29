import type { NextRequest } from 'next/server';
import { cancelRun } from '@races/db';
import { getDb } from '@/lib/server/db';
import { apiError, guard, isSameOriginMutation, ok } from '@/lib/server/http';
import { toRunJson } from '@/lib/server/serializers';

export const runtime = 'nodejs';

/**
 * Idempotent cancellation. Queued runs transition to cancelled immediately;
 * running runs get a recorded cancellation request for the worker to honour.
 * Terminal runs are returned unchanged (guard maps unknown runs to 404).
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
    const { run, changed } = cancelRun(getDb(), runId);
    return ok({ run: toRunJson(run), changed });
  });
}
