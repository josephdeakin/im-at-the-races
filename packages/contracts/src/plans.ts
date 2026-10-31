import { z } from 'zod';

/**
 * Versioned experiment plan contract. A plan is data: producers (the model or
 * a checked-in script) emit it, the runner validates it before launching
 * anything. Plans may contain app-specific selectors; the engine must not.
 */

export const PLAN_SCHEMA_VERSION = 1 as const;

export const PlanActionKindSchema = z.enum(['fill', 'click']);

export const PlanActionSchema = z.object({
  id: z.string().trim().min(1).max(100),
  kind: PlanActionKindSchema,
  /** Stable selector: data-testid attribute value. */
  testId: z.string().trim().min(1).max(300),
  /** Required for fill; forbidden for click. */
  value: z.string().max(2000).optional(),
  timeoutMs: z.number().int().min(100).max(60_000).optional(),
});

export const PlanRequestMatcherSchema = z.object({
  id: z.string().trim().min(1).max(100),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  /** Regex source matched against the full request URL. */
  urlPattern: z
    .string()
    .min(1)
    .max(2000)
    .refine(
      (pattern) => {
        try {
          new RegExp(pattern);
          return true;
        } catch {
          return false;
        }
      },
      { message: 'urlPattern must be a compilable regex' },
    ),
  /** Substring matches against decoded query parameters. */
  query: z.record(z.string().trim().min(1), z.string().max(2000)).optional(),
  /** Substring match against the request body, when present. */
  bodyContains: z.string().max(4000).optional(),
  /** 1-based: which matching request (in start order) this logical ID binds. */
  occurrence: z.number().int().min(1).max(1000),
  /** Only match requests that started after this action completed. */
  afterAction: z.string().trim().min(1).max(100).optional(),
});

export const PlanReleaseStepSchema = z.object({
  request: z.string().trim().min(1).max(100),
  /** Release once this other logical request's response has completed. */
  afterResponse: z.string().trim().min(1).max(100),
  /** Extra settle time after the trigger before releasing. */
  settleMs: z.number().int().min(0).max(15_000),
  timeoutMs: z.number().int().min(100).max(120_000),
});

export const PlanScheduleSchema = z.object({
  /** Logical request IDs whose responses are held on capture. */
  hold: z.array(z.string().trim().min(1).max(100)).min(1).max(20),
  releases: z.array(PlanReleaseStepSchema).min(1).max(20),
});

export const PlanAssertionSchema = z.object({
  id: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(1000),
  type: z.enum(['textContains', 'textEquals']),
  testId: z.string().trim().min(1).max(300),
  expected: z.string().max(4000),
});

export const PlanTimeoutsSchema = z.object({
  actionMs: z.number().int().min(100).max(60_000),
  observationMs: z.number().int().min(100).max(120_000),
  trialMs: z.number().int().min(1000).max(600_000),
  maxHoldMs: z.number().int().min(100).max(15_000),
});

export const DEFAULT_PLAN_TIMEOUTS = {
  actionMs: 10_000,
  observationMs: 10_000,
  trialMs: 120_000,
  maxHoldMs: 15_000,
} as const;

export const RUNNER_CAPABILITIES = {
  HTTP_HOLD_RELEASE: 'http-hold-release',
} as const;

export const ExperimentPlanSchema = z
  .object({
    schemaVersion: z.literal(PLAN_SCHEMA_VERSION),
    id: z.string().trim().min(1).max(100),
    hypothesis: z.string().trim().min(1).max(4000),
    startUrl: z
      .string()
      .trim()
      .min(1)
      .max(2000)
      .refine(
        (value) => {
          try {
            const parsed = new URL(value);
            return parsed.protocol === 'http:' || parsed.protocol === 'https:';
          } catch {
            return false;
          }
        },
        { message: 'startUrl must be an absolute http(s) URL' },
      ),
    actions: z.array(PlanActionSchema).min(1).max(50),
    requests: z.array(PlanRequestMatcherSchema).max(20),
    /** Null means natural timing (baseline); otherwise the intervention. */
    schedule: PlanScheduleSchema.nullable(),
    assertions: z.array(PlanAssertionSchema).min(1).max(50),
    timeouts: PlanTimeoutsSchema,
    requiredCapabilities: z.array(z.string().trim().min(1).max(100)).max(20),
  })
  .superRefine((plan, ctx) => {
    const actionIds = new Set(plan.actions.map((a) => a.id));
    if (actionIds.size !== plan.actions.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'action ids must be unique' });
    }
    const requestIds = new Set(plan.requests.map((r) => r.id));
    if (requestIds.size !== plan.requests.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'request ids must be unique' });
    }
    const assertionIds = new Set(plan.assertions.map((a) => a.id));
    if (assertionIds.size !== plan.assertions.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'assertion ids must be unique' });
    }
    for (const action of plan.actions) {
      if (action.kind === 'fill' && action.value === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `fill action ${JSON.stringify(action.id)} requires a value`,
        });
      }
      if (action.kind === 'click' && action.value !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `click action ${JSON.stringify(action.id)} must not carry a value`,
        });
      }
    }
    for (const matcher of plan.requests) {
      if (matcher.afterAction !== undefined && !actionIds.has(matcher.afterAction)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `request ${JSON.stringify(matcher.id)} references unknown action ${JSON.stringify(matcher.afterAction)}`,
        });
      }
    }
    if (plan.schedule) {
      const held = new Set(plan.schedule.hold);
      for (const id of plan.schedule.hold) {
        if (!requestIds.has(id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `schedule holds unknown request ${JSON.stringify(id)}`,
          });
        }
      }
      for (const step of plan.schedule.releases) {
        if (!held.has(step.request)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `release of ${JSON.stringify(step.request)} has no matching hold`,
          });
        }
        if (!requestIds.has(step.afterResponse)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `release trigger references unknown request ${JSON.stringify(step.afterResponse)}`,
          });
        }
        if (step.request === step.afterResponse) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `request ${JSON.stringify(step.request)} cannot trigger its own release`,
          });
        }
      }
    }
  });

export type PlanAction = z.infer<typeof PlanActionSchema>;
export type PlanRequestMatcher = z.infer<typeof PlanRequestMatcherSchema>;
export type PlanReleaseStep = z.infer<typeof PlanReleaseStepSchema>;
export type PlanSchedule = z.infer<typeof PlanScheduleSchema>;
export type PlanAssertion = z.infer<typeof PlanAssertionSchema>;
export type PlanTimeouts = z.infer<typeof PlanTimeoutsSchema>;
export type ExperimentPlan = z.infer<typeof ExperimentPlanSchema>;

export const TrialKindSchema = z.enum(['baseline', 'intervention']);
export type TrialKind = z.infer<typeof TrialKindSchema>;

export const TrialOutcomeSchema = z.enum(['pass', 'violation', 'inconclusive', 'runner-error']);
export type TrialOutcome = z.infer<typeof TrialOutcomeSchema>;

/** Persisted per-trial record: what was checked, seen, and decided. */
export const TrialAssertionResultSchema = z.object({
  id: z.string().min(1),
  passed: z.boolean(),
  expected: z.string(),
  observed: z.string().nullable(),
});

export const TrialRequestRecordSchema = z.object({
  id: z.string().min(1),
  method: z.string().min(1),
  url: z.string(),
  matched: z.boolean(),
  held: z.boolean(),
  released: z.boolean(),
  status: z.number().int().nullable(),
  responseExcerpt: z.string().nullable(),
  responseTruncated: z.boolean(),
});

export const TrialDetailSchema = z.object({
  outcome: TrialOutcomeSchema,
  /** Machine-readable reason for inconclusive/runner-error outcomes. */
  reason: z.string().max(500).nullable(),
  detail: z.string().max(2000).nullable(),
  assertions: z.array(TrialAssertionResultSchema),
  requests: z.array(TrialRequestRecordSchema),
});

export type TrialAssertionResult = z.infer<typeof TrialAssertionResultSchema>;
export type TrialRequestRecord = z.infer<typeof TrialRequestRecordSchema>;
export type TrialDetail = z.infer<typeof TrialDetailSchema>;

export const TrialSchema = z.object({
  id: z.string().min(1),
  experimentId: z.string().min(1),
  kind: TrialKindSchema,
  attempt: z.number().int().min(0),
  outcome: TrialOutcomeSchema.nullable(),
  detail: TrialDetailSchema.nullable(),
  startedAt: z.string().min(1),
  finishedAt: z.string().min(1).nullable(),
});

export type Trial = z.infer<typeof TrialSchema>;

/** Frozen reproducer: exported regression test pinned by content hashes. */
export const ReproducerSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  findingId: z.string().min(1),
  experimentId: z.string().min(1),
  bundlePath: z.string().min(1),
  testHash: z.string().min(1),
  planHash: z.string().min(1),
  checkHash: z.string().min(1),
  checkId: z.string().min(1),
  createdAt: z.string().min(1),
});

export type Reproducer = z.infer<typeof ReproducerSchema>;

export const RepairAttemptStatusSchema = z.enum(['running', 'completed', 'failed']);
export type RepairAttemptStatus = z.infer<typeof RepairAttemptStatusSchema>;

export const RepairAttemptSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  reproducerId: z.string().min(1),
  attempt: z.number().int().min(1),
  workspacePath: z.string().min(1),
  sourceIdentity: z.string().min(1),
  diff: z.string(),
  status: RepairAttemptStatusSchema,
  createdAt: z.string().min(1),
  finishedAt: z.string().min(1).nullable(),
});

export type RepairAttempt = z.infer<typeof RepairAttemptSchema>;

export const VerificationCheckStatusSchema = z.enum(['pass', 'fail', 'incomplete', 'skipped']);
export type VerificationCheckStatus = z.infer<typeof VerificationCheckStatusSchema>;

/** Closed detail shape: every field below has at least one writer. */
export const VerificationCheckDetailSchema = z.object({
  note: z.string().optional(),
  reason: z.string().optional(),
  error: z.string().optional(),
  baseline: TrialOutcomeSchema.optional(),
  intervention: TrialOutcomeSchema.optional(),
  experimentId: z.string().optional(),
  targetUrl: z.string().optional(),
  url: z.string().optional(),
  exitCode: z.number().int().nullable().optional(),
  baselineExitCode: z.number().int().nullable().optional(),
  outputTail: z.string().optional(),
  durationMs: z.number().optional(),
  reproStatus: z.string().optional(),
  testHash: z.string().optional(),
  planHash: z.string().optional(),
  pid: z.number().int().optional(),
  port: z.number().int().optional(),
  cwd: z.string().optional(),
  command: z.array(z.string()).optional(),
});

export type VerificationCheckDetail = z.infer<typeof VerificationCheckDetailSchema>;

export const VerificationCheckSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  reproducerId: z.string().min(1),
  repairAttemptId: z.string().min(1).nullable(),
  name: z.string().min(1),
  status: VerificationCheckStatusSchema,
  detail: VerificationCheckDetailSchema,
  createdAt: z.string().min(1),
});

export type VerificationCheck = z.infer<typeof VerificationCheckSchema>;
