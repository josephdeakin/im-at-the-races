import fs from 'node:fs';
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
  parseJsonBody,
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
    const body = await parseJsonBody(req, CreateProjectSchema, 'Invalid project');
    if (!body.ok) return body.response;
    // Defense in depth: the contract check is platform-regex based so it can
    // run in any JS runtime; re-check with the real platform semantics here.
    if (!path.isAbsolute(body.data.repositoryPath)) {
      return validationError('Repository path must be an absolute path', null);
    }
    // Fail fast on a path the worker could never read, instead of at run time.
    let stat: fs.Stats | null = null;
    try {
      stat = fs.statSync(body.data.repositoryPath);
    } catch {
      stat = null;
    }
    if (!stat) {
      return validationError(
        `Repository path does not exist: ${body.data.repositoryPath}`,
        null,
      );
    }
    if (!stat.isDirectory()) {
      return validationError(
        `Repository path is not a directory: ${body.data.repositoryPath}`,
        null,
      );
    }
    const project = toProjectJson(createProject(getDb(), body.data));
    return created({ project });
  });
}
