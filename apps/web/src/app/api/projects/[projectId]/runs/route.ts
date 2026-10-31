import type { NextRequest } from 'next/server';
import { CreateRunSchema, resolveRunInput } from '@races/contracts';
import { createRun, getProject, listRunsByProject } from '@races/db';
import { getDb } from '@/lib/server/db';
import {
  accepted,
  apiError,
  guard,
  isSameOriginMutation,
  notFoundError,
  ok,
  parseJsonBody,
} from '@/lib/server/http';
import { toRunJson } from '@/lib/server/serializers';

export const runtime = 'nodejs';

type RouteParams = { params: Promise<{ projectId: string }> };

export async function GET(_req: Request, { params }: RouteParams) {
  return guard(async () => {
    const { projectId } = await params;
    const db = getDb();
    if (!getProject(db, projectId)) {
      return notFoundError(`Project not found: ${projectId}`);
    }
    return ok({ projectId, runs: listRunsByProject(db, projectId).map(toRunJson) });
  });
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  return guard(async () => {
    if (!isSameOriginMutation(req)) {
      return apiError('ORIGIN_FORBIDDEN', 'Cross-origin mutations are not allowed', 403);
    }
    const { projectId } = await params;
    const db = getDb();
    if (!getProject(db, projectId)) {
      return notFoundError(`Project not found: ${projectId}`);
    }
    const body = await parseJsonBody(req, CreateRunSchema, 'Invalid run configuration');
    if (!body.ok) return body.response;
    // No execution happens here: the run is persisted as queued for the
    // worker to claim. Never launch browser work in a request.
    const { run } = createRun(db, { projectId, ...resolveRunInput(body.data) });
    return accepted({ runId: run.id, run: toRunJson(run) });
  });
}
