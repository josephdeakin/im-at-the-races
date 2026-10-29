import {
  ProjectSchema,
  RunSchema,
  type Project,
  type Run,
} from '@races/contracts';
import type { ProjectRow, RunRow } from '@races/db';

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function nullableIso(ms: number | null): string | null {
  return ms === null ? null : iso(ms);
}

/** Map storage rows (ms timestamps) to the shared JSON contract. */
export function toProjectDto(row: ProjectRow): Project {
  return ProjectSchema.parse({
    id: row.id,
    name: row.name,
    repositoryPath: row.repositoryPath,
    targetUrl: row.targetUrl,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  });
}

export function toRunDto(row: RunRow): Run {
  return RunSchema.parse({
    id: row.id,
    projectId: row.projectId,
    task: row.task,
    mode: row.mode,
    status: row.status,
    phase: row.phase,
    limits: row.limits,
    cancelRequestedAt: nullableIso(row.cancelRequestedAt),
    createdAt: iso(row.createdAt),
    startedAt: nullableIso(row.startedAt),
    finishedAt: nullableIso(row.finishedAt),
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
  });
}
