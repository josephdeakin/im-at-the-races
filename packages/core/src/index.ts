import type { Artifact, Project, Run, RunEvent, RunLimits } from '@races/contracts';

/**
 * Investigation phases for the future executor. Status (queued/running/...)
 * stays separate: phase describes what a running investigation is doing.
 * The `phase` column is free-form so new phases need no migration; these
 * constants are the agreed vocabulary.
 */
export const INVESTIGATION_PHASES = {
  QUEUED: 'queued',
  CLAIMED: 'claimed',
  INSPECTING: 'inspecting',
  EXPERIMENTING: 'experimenting',
  REPAIRING: 'repairing',
  VERIFYING: 'verifying',
  DONE: 'done',
} as const;

export type InvestigationPhase =
  (typeof INVESTIGATION_PHASES)[keyof typeof INVESTIGATION_PHASES];

export const INVESTIGATION_PHASE_LABELS: Record<InvestigationPhase, string> = {
  queued: 'Queued',
  claimed: 'Claimed',
  inspecting: 'Inspecting',
  experimenting: 'Experimenting',
  repairing: 'Repairing',
  verifying: 'Verifying',
  done: 'Done',
};

/** Append-only sink the executor uses to record progress. */
export interface EventSink {
  appendEvent(
    runId: string,
    kind: string,
    payload: Record<string, unknown>,
  ): Promise<RunEvent> | RunEvent;
  setPhase(runId: string, phase: string): Promise<void> | void;
}

/** Artifact store the executor uses for traces, screenshots and patches. */
export interface ArtifactStore {
  saveArtifact(input: {
    runId: string;
    kind: string;
    filename: string;
    mimeType: string;
    data: Uint8Array;
  }): Promise<Artifact> | Artifact;
}

export interface ExecutionContext {
  run: Run;
  project: Project;
  limits: RunLimits;
  events: EventSink;
  artifacts: ArtifactStore;
  /** Aborted when the run is cancelled or the worker shuts down. */
  signal: AbortSignal;
}

export type ExecutionOutcome =
  | { status: 'completed' }
  | { status: 'failed'; errorCode: string; errorMessage: string }
  | { status: 'interrupted'; errorMessage: string };

/**
 * The experiment engine plugs in here. The production worker will:
 * claim queued run (transactional) -> execute with an Executor ->
 * persist events/outcome -> own browser/process cleanup in finally blocks.
 */
export interface Executor {
  readonly name: string;
  execute(ctx: ExecutionContext): Promise<ExecutionOutcome>;
}
