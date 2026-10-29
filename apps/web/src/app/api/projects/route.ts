import path from 'node:path';
import type { NextRequest } from 'next/server';
import { CreateProjectSchema } from '@races/contracts';
import { createProject, listProjects } from '@races/db';
import { getDb } from '@/lib/server/db';
import {
  apiError,
  created,
  guard,
  isSameOriginMutation,
  ok,
  readJsonBody,
  validationError,
} from '@/lib/server/http';
import { toProjectJson } from '@/lib/server/serializers';

export const runtime = 'nodejs';

export async function GET() {
  return guard(async () => ok({ projects: listProjects(getDb()).map(toProjectJson) }));
}

export async function POST(req: NextRequest) {
  return guard(async () => {
    if (!isSameOriginMutation(req)) {
      return apiError('ORIGIN_FORBIDDEN', 'Cross-origin mutations are not allowed', 403);
    }
    const body = await readJsonBody(req);
    if (!body.ok) return validationError('Request body must be valid JSON', null);
    const parsed = CreateProjectSchema.safeParse(body.value);
    if (!parsed.success) {
      return validationError('Invalid project', parsed.error.issues);
    }
    // Defense in depth: the contract check is platform-regex based so it can
    // run in any JS runtime; re-check with the real platform semantics here.
    if (!path.isAbsolute(parsed.data.repositoryPath)) {
      return validationError('Repository path must be an absolute path', null);
    }
    const project = toProjectJson(createProject(getDb(), parsed.data));
    return created({ project });
  });
}
