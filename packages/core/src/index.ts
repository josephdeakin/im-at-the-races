import type {
  Artifact,
  Project,
  Run,
  RunEvent,
  RunEventKind,
  RunEventPayloadMap,
  RunLimits,
} from '@races/contracts';

/**
 * Investigation phase vocabulary. Status (queued/running/...) stays separate:
 * phase describes what a running investigation is doing. The `phase` column
 * is free-form so new phases need no migration.
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

export { AbortError, CapacityError, isCapacityError, sleep } from './runner/util.js';
export { RequestTracker, type RequestCandidate } from './runner/matchers.js';
export { redactExcerpt, redactUrl } from './runner/redact.js';
export { launchBrowser } from './runner/browser.js';
export {
  executeTrial,
  RESPONSE_EXCERPT_MAX_BYTES,
  type TrialRequest,
  type TrialResult,
  type TrialStore,
} from './runner/trial.js';
export {
  runExperiment,
  type ExperimentRequest,
  type ExperimentResult,
  type ExperimentStore,
  type StoredExperiment,
  type StoredTrial,
} from './runner/experiment.js';
export { STALE_SEARCH_PLAN_TEMPLATE } from './plans/stale-search.js';
export {
  AnthropicModelClient,
  ModelAuthError,
  ModelError,
  type ModelClient,
  type ModelMessage,
  type ModelResponse,
  type ModelToolDefinition,
} from './agent/model.js';
export { ResponsesApiClient } from './agent/responses.js';
export {
  AGENT_TOOL_DEFINITIONS,
  dispatchTool,
  ExplorationPage,
  type AgentBudgets,
  type AgentToolDeps,
  type AgentTrialRunner,
  type EvidenceReader,
} from './agent/tools.js';
export { computeReproduced, type ReproduceVerdict } from './agent/reproduce.js';
export {
  AgentExecutor,
  REAL_TRIAL_RUNNER,
  UnavailableExecutor,
  type AgentExecutorOptions,
  type AgentStore,
  type FindingStore,
} from './agent/orchestrator.js';

/** Append-only sink the executor uses to record progress. */
export interface EventSink {
  appendEvent<K extends RunEventKind>(
    runId: string,
    kind: K,
    payload: RunEventPayloadMap[K],
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
