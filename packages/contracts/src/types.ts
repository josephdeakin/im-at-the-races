import type { z } from 'zod';
import type {
  ArtifactSchema,
  CreateProjectSchema,
  CreateRunSchema,
  EventsQuerySchema,
  ProjectSchema,
  RunEventSchema,
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
export type RunEvent = z.infer<typeof RunEventSchema>;
export type Artifact = z.infer<typeof ArtifactSchema>;

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
  modelCalls: 50,
  experiments: 20,
};

/** Phase assigned to a freshly queued run. */
export const INITIAL_RUN_PHASE = 'queued';

/**
 * Known run event kinds. The `kind` column stays open-ended so the future
 * worker can append new kinds without a contract change; unknown kinds must
 * be rendered generically by the UI.
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
  ARTIFACT_ADDED: 'artifact.added',
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
