import { getProject } from '@races/db';
import { getDb } from '@/lib/server/db';
import { guard, notFoundError, ok } from '@/lib/server/http';
import { toProjectJson } from '@/lib/server/serializers';

export const runtime = 'nodejs';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  return guard(async () => {
    const { projectId } = await params;
    const row = getProject(getDb(), projectId);
    if (!row) return notFoundError(`Project not found: ${projectId}`);
    return ok({ project: toProjectJson(row) });
  });
}
