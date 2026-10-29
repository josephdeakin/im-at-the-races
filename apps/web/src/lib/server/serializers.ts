import 'server-only';
import {
  ArtifactSchema,
  ProjectSchema,
  RunEventSchema,
  RunSchema,
  type Artifact,
  type Project,
  type Run,
  type RunEvent,
} from '@races/contracts';
import type { ArtifactRow, ProjectRow, RunEventRow, RunRow } from '@races/db';

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function nullableIso(ms: number | null): string | null {
  return ms === null ? null : iso(ms);
}

/** Map storage rows (ms timestamps) to the shared JSON contract. */
export function toProjectJson(row: ProjectRow): Project {
  return ProjectSchema.parse({
    id: row.id,
    name: row.name,
    repositoryPath: row.repositoryPath,
    targetUrl: row.targetUrl,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  });
}

export function toRunJson(row: RunRow): Run {
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

export function toRunEventJson(row: RunEventRow): RunEvent {
  return RunEventSchema.parse({
    id: row.id,
    runId: row.runId,
    sequence: row.sequence,
    kind: row.kind,
    payload: row.payload,
    createdAt: iso(row.createdAt),
  });
}

export function toArtifactJson(row: ArtifactRow): Artifact {
  return ArtifactSchema.parse({
    id: row.id,
    runId: row.runId,
    kind: row.kind,
    relativePath: row.relativePath,
    mimeType: row.mimeType,
    createdAt: iso(row.createdAt),
  });
}
