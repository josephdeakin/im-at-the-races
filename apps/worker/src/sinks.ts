import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  appendEvent,
  createArtifact,
  createExperiment,
  createFinding,
  createRepairAttempt,
  createReproducer,
  createTrial,
  createVerificationCheck,
  finishExperiment,
  finishRepairAttempt,
  finishTrial,
  getArtifact,
  getExperiment,
  listTrialsByExperiment,
  resolveRacesDir,
  setRunPhase,
  sumArtifactBytesByRun,
  type RacesDatabase,
} from '@races/db';
import {
  RunEventSchema,
  type Artifact,
  type FindingStatus,
  type RepairAttemptStatus,
  type RunEvent,
  type RunEventKind,
  type RunEventPayloadMap,
  type TrialDetail,
  type TrialKind,
  type TrialOutcome,
  type VerificationCheckDetail,
  type VerificationCheckStatus,
} from '@races/contracts';
import { CapacityError } from '@races/core';

export const DEFAULT_ARTIFACT_CAP_MB = 250;

/** Strict: only a bare non-negative integer counts; anything else → default. */
export function parseArtifactCapMb(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_ARTIFACT_CAP_MB;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return DEFAULT_ARTIFACT_CAP_MB;
  return Number.parseInt(trimmed, 10);
}
import type {
  AgentStore,
  ArtifactStore,
  EventSink,
  EvidenceReader,
} from '@races/core';

/** Database-backed event sink for executors. */
export class DbEventSink implements EventSink {
  constructor(private readonly db: RacesDatabase) {}

  appendEvent<K extends RunEventKind>(
    runId: string,
    kind: K,
    payload: RunEventPayloadMap[K],
  ): RunEvent {
    const row = appendEvent(this.db, runId, kind, payload);
    return RunEventSchema.parse({
      id: row.id,
      runId: row.runId,
      sequence: row.sequence,
      kind: row.kind,
      payload: row.payload,
      createdAt: new Date(row.createdAt).toISOString(),
    });
  }

  setPhase(runId: string, phase: string): void {
    setRunPhase(this.db, runId, phase);
  }
}

/**
 * Filesystem + database artifact store. Files live under
 * `<racesDir>/artifacts/<runId>/`; the database row references the relative
 * path. Filenames are confined to that directory: separators and parent
 * traversal are rejected.
 */
export class FsArtifactStore implements ArtifactStore {
  constructor(
    private readonly db: RacesDatabase,
    private readonly racesDir: string = resolveRacesDir(),
  ) {}

  saveArtifact(input: {
    runId: string;
    kind: string;
    filename: string;
    mimeType: string;
    data: Uint8Array;
  }): Artifact {
    if (
      input.filename === '' ||
      input.filename.includes('/') ||
      input.filename.includes('\\') ||
      input.filename.includes('..')
    ) {
      throw new Error(`unsafe artifact filename: ${JSON.stringify(input.filename)}`);
    }
    const sizeBytes = input.data.length;
    const capBytes = parseArtifactCapMb(process.env.RACES_ARTIFACT_CAP_MB) * 1024 * 1024;
    const used = sumArtifactBytesByRun(this.db, input.runId);
    if (used + sizeBytes > capBytes) {
      throw new CapacityError(
        `Run ${input.runId} exceeded its artifact budget (${used} of ${capBytes} bytes used): refusing ${input.filename}. Earlier evidence is preserved.`,
      );
    }
    const dir = path.join(this.racesDir, 'artifacts', input.runId);
    fs.mkdirSync(dir, { recursive: true });
    const absolute = path.join(dir, input.filename);
    if (path.relative(dir, absolute).startsWith('..')) {
      throw new Error(`artifact path escapes run directory: ${input.filename}`);
    }
    fs.writeFileSync(absolute, input.data);
    const sha256 = `sha256:${createHash('sha256').update(input.data).digest('hex')}`;
    const row = createArtifact(this.db, {
      runId: input.runId,
      kind: input.kind,
      relativePath: path.posix.join('artifacts', input.runId, input.filename),
      mimeType: input.mimeType,
      sizeBytes,
      sha256,
    });
    return {
      id: row.id,
      runId: row.runId,
      kind: row.kind,
      relativePath: row.relativePath,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      sha256: row.sha256,
      createdAt: new Date(row.createdAt).toISOString(),
    };
  }
}

/** Database-backed experiment/trial/finding record store for the runner. */
export class DbExperimentStore implements AgentStore {
  constructor(private readonly db: RacesDatabase) {}

  createExperiment(
    runId: string,
    input: { name: string; hypothesis: string; plan: Record<string, unknown> },
  ): { id: string } {
    return createExperiment(this.db, { runId, ...input });
  }

  finishExperiment(experimentId: string, status: 'completed' | 'failed' | 'interrupted'): void {
    finishExperiment(this.db, experimentId, status);
  }

  createTrial(experimentId: string, kind: TrialKind, attempt = 0): { id: string } {
    return createTrial(this.db, experimentId, kind, attempt);
  }

  finishTrial(trialId: string, outcome: TrialOutcome, detail: TrialDetail): void {
    finishTrial(this.db, trialId, outcome, detail);
  }

  getExperiment(experimentId: string) {
    const row = getExperiment(this.db, experimentId);
    if (!row) return undefined;
    return { id: row.id, runId: row.runId, plan: row.plan };
  }

  listTrials(experimentId: string) {
    return listTrialsByExperiment(this.db, experimentId).map((row) => ({
      id: row.id,
      kind: row.kind,
      attempt: row.attempt,
      outcome: row.outcome,
      detail: row.detail,
    }));
  }

  createFinding(input: {
    runId: string;
    experimentId: string;
    title: string;
    status: FindingStatus;
    expectationProvenance: string;
    explanation: string;
    implicatedCode: { path: string; excerpt: string | null; exists: boolean }[];
    sourceIdentity: string;
  }): { id: string } {
    return createFinding(this.db, input);
  }

  createReproducer(input: {
    runId: string;
    findingId: string;
    experimentId: string;
    bundlePath: string;
    testHash: string;
    planHash: string;
    checkHash: string;
    checkId: string;
  }): { id: string } {
    return createReproducer(this.db, input);
  }

  createRepairAttempt(input: {
    runId: string;
    reproducerId: string;
    attempt: number;
    workspacePath: string;
    sourceIdentity: string;
  }): { id: string } {
    return createRepairAttempt(this.db, input);
  }

  finishRepairAttempt(id: string, input: { diff: string; status: RepairAttemptStatus }): void {
    finishRepairAttempt(this.db, id, input);
  }

  createVerificationCheck(input: {
    runId: string;
    reproducerId: string;
    repairAttemptId: string | null;
    name: string;
    status: VerificationCheckStatus;
    detail: VerificationCheckDetail;
  }): { id: string } {
    return createVerificationCheck(this.db, input);
  }
}

const EVIDENCE_TEXT_MAX_BYTES = 64 * 1024;

/**
 * Pick the screenshot the vision note should describe. Trial captures taken
 * after a held response is released carry the decisive moment (the stale
 * value on screen); prefer the last of those, else the last image at all.
 */
export function pickVisionArtifact<T extends { relativePath: string }>(
  images: readonly T[],
): T | null {
  if (images.length === 0) return null;
  for (let i = images.length - 1; i >= 0; i -= 1) {
    if (images[i].relativePath.includes('post-release')) return images[i];
  }
  return images[images.length - 1];
}

/** Local evidence reader for the agent's readEvidence tool. */
export class LocalEvidenceReader implements EvidenceReader {
  constructor(
    private readonly db: RacesDatabase,
    private readonly racesDir: string = resolveRacesDir(),
  ) {}

  readEvidence(artifactId: string): {
    kind: string;
    mimeType: string;
    sizeBytes: number;
    text: string | null;
    note: string;
  } {
    const row = getArtifact(this.db, artifactId);
    if (!row) throw new Error(`Unknown artifact: ${artifactId}`);
    const absolute = path.resolve(this.racesDir, row.relativePath);
    if (absolute !== this.racesDir && !absolute.startsWith(`${this.racesDir}${path.sep}`)) {
      throw new Error(`Artifact path escapes runtime directory: ${artifactId}`);
    }
    let data: Buffer;
    try {
      data = fs.readFileSync(absolute);
    } catch {
      throw new Error(`Artifact file missing: ${artifactId}`);
    }
    const textable =
      (row.mimeType.startsWith('text/') || row.mimeType === 'application/json') &&
      data.length <= EVIDENCE_TEXT_MAX_BYTES;
    return {
      kind: row.kind,
      mimeType: row.mimeType,
      sizeBytes: data.length,
      text: textable ? data.toString('utf8') : null,
      note: textable
        ? 'Full artifact text above.'
        : 'Binary or oversized artifact: text not inlined. Screenshots are for the human reviewer; rely on recorded values and assertion results.',
    };
  }
}
