import type { NextRequest } from 'next/server';
import { getProject, getRepairAttempt, getRun } from '@races/db';
import { getDb } from '@/lib/server/db';
import {
  apiError,
  guard,
  isSameOriginMutation,
  notFoundError,
  ok,
  validationError,
} from '@/lib/server/http';
import { storedDiffToPatch } from '@/lib/patch';
import { applyPatchToRepo, PatchApplyError } from '@/lib/server/patch-apply';

export const runtime = 'nodejs';

/**
 * Apply a repair attempt to the project's repository on a fresh branch.
 * Refuses dirty trees and unconvertible diffs; the current branch is never
 * touched and changes are left uncommitted for review.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string; attemptId: string }> },
) {
  return guard(async () => {
    if (!isSameOriginMutation(req)) {
      return apiError('ORIGIN_FORBIDDEN', 'Cross-origin mutations are not allowed', 403);
    }
    const { runId, attemptId } = await params;
    const db = getDb();
    const run = getRun(db, runId);
    if (!run) return notFoundError(`Run not found: ${runId}`);
    const attempt = getRepairAttempt(db, attemptId);
    if (!attempt || attempt.runId !== runId) {
      return notFoundError(`Repair attempt not found: ${attemptId}`);
    }
    const project = getProject(db, run.projectId);
    if (!project) return notFoundError(`Project not found: ${run.projectId}`);
    const converted = storedDiffToPatch(attempt.diff);
    if (!converted.ok) return validationError(converted.error, null);
    try {
      const result = await applyPatchToRepo(
        project.repositoryPath,
        converted.patch,
        `races/run-${runId.slice(0, 8)}-attempt-${attempt.attempt}`,
      );
      return ok({ runId, attemptId, repositoryPath: project.repositoryPath, ...result });
    } catch (err) {
      if (err instanceof PatchApplyError) {
        if (err.code === 'NOT_A_REPO') return validationError(err.message, null);
        if (err.code === 'DIRTY_TREE' || err.code === 'CONFLICT') {
          return apiError('CONFLICT', err.message, 409);
        }
        return apiError('INTERNAL_ERROR', err.message, 500);
      }
      throw err;
    }
  });
}
