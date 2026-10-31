import type { z } from 'zod';
import type {
  ArtifactSchema,
  CreateProjectSchema,
  CreateRunSchema,
  EventsQuerySchema,
  ExperimentSchema,
  ExperimentStatusSchema,
  ProjectSchema,
  RunLimitsSchema,
  RunModeSchema,
  RunSchema,
  RunStatusSchema,
} from './schemas.js';

export type RunStatus = z.infer<typeof RunStatusSchema>;
export type RunMode = z.infer<typeof RunModeSchema>;
export type RunLimits = z.infer<typeof RunLimitsSchema>;
export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;
export type CreateRunInput = z.infer<typeof CreateRunSchema>;
export type EventsQuery = z.infer<typeof EventsQuerySchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type Run = z.infer<typeof RunSchema>;
export type Artifact = z.infer<typeof ArtifactSchema>;
export type ExperimentStatus = z.infer<typeof ExperimentStatusSchema>;
export type Experiment = z.infer<typeof ExperimentSchema>;

export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = [
  'completed',
  'failed',
  'cancelled',
  'interrupted',
];

export function isTerminalRunStatus(status: RunStatus): boolean {
  return (TERMINAL_RUN_STATUSES as readonly string[]).includes(status);
}

export const RUN_MODE_LABELS: Record<RunMode, string> = {
  investigate: 'Investigate only',
  'investigate-repair': 'Investigate with repair',
};

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
  interrupted: 'Interrupted',
};

/** Default task text when the run form is submitted with a blank task. */
export const DEFAULT_RUN_TASK =
  'Broad investigation: explore the project and look for race conditions.';

export const DEFAULT_RUN_LIMITS: RunLimits = {
  durationMs: 10 * 60 * 1000,
  modelCalls: 30,
  experiments: 6,
};

/** Phase assigned to a freshly queued run. */
export const INITIAL_RUN_PHASE = 'queued';

/**
 * Run event kinds. Closed: every kind has a payload schema in `./events.js`
 * (parity is compile-checked), producers are type-checked at emit, and
 * stored rows are re-validated on read.
 */
export const KNOWN_RUN_EVENT_KINDS = {
  CREATED: 'run.created',
  STARTED: 'run.started',
  PHASE: 'run.phase',
  LOG: 'run.log',
  CANCEL_REQUESTED: 'run.cancel_requested',
  CANCELLED: 'run.cancelled',
  COMPLETED: 'run.completed',
  FAILED: 'run.failed',
  INTERRUPTED: 'run.interrupted',
  EXPERIMENT_STARTED: 'experiment.started',
  EXPERIMENT_COMPLETED: 'experiment.completed',
  TRIAL_STARTED: 'trial.started',
  TRIAL_COMPLETED: 'trial.completed',
  ACTION_PERFORMED: 'action.performed',
  REQUEST_STARTED: 'request.started',
  REQUEST_CAPTURED: 'request.captured',
  REQUEST_HELD: 'request.held',
  REQUEST_RELEASED: 'request.released',
  TRIGGER_SATISFIED: 'trigger.satisfied',
  SCREENSHOT_CAPTURED: 'screenshot.captured',
  VALUES_CAPTURED: 'values.captured',
  ASSERTION_EVALUATED: 'assertion.evaluated',
  FINDING_RECORDED: 'finding.recorded',
  EVIDENCE_SKIPPED: 'evidence.skipped',
} as const;

export type KnownRunEventKind =
  (typeof KNOWN_RUN_EVENT_KINDS)[keyof typeof KNOWN_RUN_EVENT_KINDS];

/** Apply shared defaults to a validated create-run payload. */
export function resolveRunInput(input: CreateRunInput): {
  task: string;
  mode: RunMode;
  limits: RunLimits;
} {
  const task = input.task.trim() === '' ? DEFAULT_RUN_TASK : input.task.trim();
  return {
    task,
    mode: input.mode,
    limits: { ...DEFAULT_RUN_LIMITS, ...input.limits },
  };
}
