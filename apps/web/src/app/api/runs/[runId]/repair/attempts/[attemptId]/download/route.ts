import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getRepairAttempt, getRun } from '@races/db';
import { getDb } from '@/lib/server/db';
import { guard, notFoundError, validationError } from '@/lib/server/http';
import { storedDiffToPatch } from '@/lib/patch';

export const runtime = 'nodejs';

/**
 * Download a repair attempt as an applyable unified patch. The stored
 * evidence diff is converted (carried paths relativized, new files
 * synthesized); anything unfaithful is a 422, never a corrupt file.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ runId: string; attemptId: string }> },
) {
  return guard(async () => {
    const { runId, attemptId } = await params;
    const db = getDb();
    const run = getRun(db, runId);
    if (!run) return notFoundError(`Run not found: ${runId}`);
    const attempt = getRepairAttempt(db, attemptId);
    if (!attempt || attempt.runId !== runId) {
      return notFoundError(`Repair attempt not found: ${attemptId}`);
    }
    const converted = storedDiffToPatch(attempt.diff);
    if (!converted.ok) return validationError(converted.error, null);
    const filename = `races-${runId.slice(0, 8)}-attempt-${attempt.attempt}.patch`;
    return new NextResponse(converted.patch, {
      status: 200,
      headers: {
        'content-type': 'text/x-patch; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"`,
      },
    });
  });
}
