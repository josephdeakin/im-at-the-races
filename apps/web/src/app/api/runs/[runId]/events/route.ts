import type { NextRequest } from 'next/server';
import { EventsQuerySchema } from '@races/contracts';
import { getRun, listEvents } from '@races/db';
import { getDb } from '@/lib/server/db';
import { guard, notFoundError, ok, validationError } from '@/lib/server/http';
import { toRunEventJsonSafe } from '@/lib/server/serializers';

export const runtime = 'nodejs';

/**
 * Cursor-poll endpoint for persisted events. `after` is exclusive: clients
 * pass the last sequence they have rendered and receive everything newer,
 * plus `nextAfter` to use as the next cursor. The status/phase snapshot lets
 * clients stop polling at terminal states; the shape is forward-compatible
 * with a future SSE stream carrying the same payloads.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  return guard(async () => {
    const { runId } = await params;
    const db = getDb();
    const run = getRun(db, runId);
    if (!run) return notFoundError(`Run not found: ${runId}`);
    const rawAfter = req.nextUrl.searchParams.get('after') ?? undefined;
    const parsed = EventsQuerySchema.safeParse({ after: rawAfter });
    if (!parsed.success) {
      return validationError('Invalid cursor', parsed.error.issues);
    }
    const events = listEvents(db, runId, parsed.data.after).map(toRunEventJsonSafe);
    const nextAfter =
      events.length > 0 ? events[events.length - 1].sequence : parsed.data.after;
    return ok({
      runId,
      status: run.status,
      phase: run.phase,
      events,
      nextAfter,
    });
  });
}
