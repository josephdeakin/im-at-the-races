import { z } from 'zod';

/**
 * Run lifecycle status. Kept separate from the investigation phase: status
 * answers "is this run alive?" while phase answers "what is it doing?".
 */
export const RunStatusSchema = z.enum([
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
  'interrupted',
]);

export const RunModeSchema = z.enum(['investigate', 'investigate-repair']);

/** Investigation phase is a free-form string so the future worker can add phases. */
export const RunPhaseSchema = z.string().trim().min(1).max(100);

export const RunLimitsSchema = z.object({
  durationMs: z.number().int().min(1000).max(86_400_000),
  modelCalls: z.number().int().min(0).max(100_000),
  experiments: z.number().int().min(0).max(1000),
});

export const PartialRunLimitsSchema = RunLimitsSchema.partial();

const MAX_NAME_LENGTH = 200;
const MAX_PATH_LENGTH = 2000;
const MAX_URL_LENGTH = 2000;
const MAX_TASK_LENGTH = 4000;

/** Absolute POSIX path, Windows drive path, or UNC path. */
const ABSOLUTE_PATH_PATTERN = /^(?:\/|\\\\|[A-Za-z]:[\\/])/;

export function isAbsolutePathLike(value: string): boolean {
  return ABSOLUTE_PATH_PATTERN.test(value);
}

export function isHttpUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:';
}

export const CreateProjectSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(MAX_NAME_LENGTH),
  repositoryPath: z
    .string()
    .trim()
    .min(1, 'Repository path is required')
    .max(MAX_PATH_LENGTH)
    .refine(isAbsolutePathLike, {
      message: 'Repository path must be an absolute path',
    }),
  targetUrl: z
    .string()
    .trim()
    .min(1, 'Target URL is required')
    .max(MAX_URL_LENGTH)
    .refine(isHttpUrl, {
      message: 'Target URL must be an absolute http(s) URL',
    }),
});

export const CreateRunSchema = z.object({
  /** Optional free text. Blank resolves to DEFAULT_RUN_TASK (see types.ts). */
  task: z.string().trim().max(MAX_TASK_LENGTH).optional().default(''),
  mode: RunModeSchema.optional().default('investigate'),
  limits: PartialRunLimitsSchema.optional().default({}),
});

export const EventsQuerySchema = z.object({
  /** Exclusive cursor: returns events with sequence > after. */
  after: z.coerce.number().int().min(-1).max(Number.MAX_SAFE_INTEGER).optional().default(-1),
});

const IsoDateTimeSchema = z.string().min(1).max(100);

export const ProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  repositoryPath: z.string(),
  targetUrl: z.string(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export const RunSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  task: z.string(),
  mode: RunModeSchema,
  status: RunStatusSchema,
  phase: z.string(),
  limits: RunLimitsSchema,
  cancelRequestedAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  startedAt: IsoDateTimeSchema.nullable(),
  finishedAt: IsoDateTimeSchema.nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
});

export const RunEventSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  sequence: z.number().int().min(0),
  kind: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  createdAt: IsoDateTimeSchema,
});

export const ArtifactSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  kind: z.string().min(1),
  relativePath: z.string().min(1),
  mimeType: z.string().min(1),
  createdAt: IsoDateTimeSchema,
});
