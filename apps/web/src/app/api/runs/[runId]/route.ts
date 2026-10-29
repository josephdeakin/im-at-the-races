import { getRun } from '@races/db';
import { getDb } from '@/lib/server/db';
import { guard, notFoundError, ok } from '@/lib/server/http';
import { toRunJson } from '@/lib/server/serializers';

export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  return guard(async () => {
    const { runId } = await params;
    const row = getRun(getDb(), runId);
    if (!row) return notFoundError(`Run not found: ${runId}`);
    return ok({ run: toRunJson(row) });
  });
}
