import 'server-only';
import {
  ArtifactSchema,
  ExperimentSchema,
  FindingSchema,
  ProjectSchema,
  RepairAttemptSchema,
  ReproducerSchema,
  RunEventSchema,
  RunSchema,
  TrialDetailSchema,
  TrialSchema,
  VerificationCheckSchema,
  type Artifact,
  type Experiment,
  type Finding,
  type Project,
  type RepairAttempt,
  type Reproducer,
  type Run,
  type RunEvent,
  type Trial,
  type VerificationCheck,
} from '@races/contracts';
import type {
  ArtifactRow,
  ExperimentRow,
  FindingRow,
  ProjectRow,
  RepairAttemptRow,
  ReproducerRow,
  RunEventRow,
  RunRow,
  TrialRow,
  VerificationCheckRow,
} from '@races/db';

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
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    createdAt: iso(row.createdAt),
  });
}

export function toExperimentJson(row: ExperimentRow): Experiment {
  return ExperimentSchema.parse({
    id: row.id,
    runId: row.runId,
    name: row.name,
    hypothesis: row.hypothesis,
    plan: row.plan,
    status: row.status,
    createdAt: iso(row.createdAt),
    finishedAt: nullableIso(row.finishedAt),
  });
}

export function toTrialJson(row: TrialRow): Trial {
  return TrialSchema.parse({
    id: row.id,
    experimentId: row.experimentId,
    kind: row.kind,
    attempt: row.attempt,
    outcome: row.outcome,
    detail: row.detail === null ? null : TrialDetailSchema.parse(row.detail),
    startedAt: iso(row.startedAt),
    finishedAt: nullableIso(row.finishedAt),
  });
}

export function toFindingJson(row: FindingRow): Finding {
  return FindingSchema.parse({
    id: row.id,
    runId: row.runId,
    experimentId: row.experimentId,
    title: row.title,
    status: row.status,
    expectationProvenance: row.expectationProvenance,
    explanation: row.explanation,
    implicatedCode: row.implicatedCode,
    sourceIdentity: row.sourceIdentity,
    createdAt: iso(row.createdAt),
  });
}

export function toReproducerJson(row: ReproducerRow): Reproducer {
  return ReproducerSchema.parse({
    id: row.id,
    runId: row.runId,
    findingId: row.findingId,
    experimentId: row.experimentId,
    bundlePath: row.bundlePath,
    testHash: row.testHash,
    planHash: row.planHash,
    checkHash: row.checkHash,
    checkId: row.checkId,
    createdAt: iso(row.createdAt),
  });
}

export function toRepairAttemptJson(row: RepairAttemptRow): RepairAttempt {
  return RepairAttemptSchema.parse({
    id: row.id,
    runId: row.runId,
    reproducerId: row.reproducerId,
    attempt: row.attempt,
    workspacePath: row.workspacePath,
    sourceIdentity: row.sourceIdentity,
    diff: row.diff,
    status: row.status,
    createdAt: iso(row.createdAt),
    finishedAt: nullableIso(row.finishedAt),
  });
}

export function toVerificationCheckJson(row: VerificationCheckRow): VerificationCheck {
  return VerificationCheckSchema.parse({
    id: row.id,
    runId: row.runId,
    reproducerId: row.reproducerId,
    repairAttemptId: row.repairAttemptId,
    name: row.name,
    status: row.status,
    detail: row.detail,
    createdAt: iso(row.createdAt),
  });
}
