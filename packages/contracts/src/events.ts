import { z } from 'zod';
import { IsoDateTimeSchema, RunLimitsSchema, RunModeSchema } from './schemas.js';
import { PlanActionKindSchema, TrialKindSchema, TrialOutcomeSchema } from './plans.js';
import { FindingStatusSchema } from './agent.js';
import type { KnownRunEventKind } from './types.js';

/**
 * Payload schemas per event kind. Producers are type-checked against these;
 * stored rows are re-validated on read, so UI consumers can narrow on `kind`
 * instead of probing untyped fields.
 */
const trialBase = {
  experimentId: z.string().min(1),
  trialId: z.string().min(1),
  trialKind: TrialKindSchema,
};

const payloadSchemas = {
  'run.created': z.object({
    task: z.string(),
    mode: RunModeSchema,
    limits: RunLimitsSchema,
  }),
  'run.started': z.object({ workerId: z.string().min(1) }),
  'run.phase': z.object({ phase: z.string().min(1) }),
  'run.log': z.object({ message: z.string(), rerunOf: z.string().optional() }),
  'run.cancel_requested': z.object({}),
  'run.cancelled': z.object({ reason: z.string().min(1) }),
  'run.completed': z.object({
    errorCode: z.string().optional(),
    errorMessage: z.string().optional(),
  }),
  'run.failed': z.object({
    errorCode: z.string().optional(),
    errorMessage: z.string().optional(),
  }),
  // Two producers: finishRun (error fields) and boot recovery (reason + workerId).
  'run.interrupted': z.object({
    errorCode: z.string().optional(),
    errorMessage: z.string().optional(),
    reason: z.string().optional(),
    workerId: z.string().optional(),
  }),
  'experiment.started': z.object({
    experimentId: z.string().min(1),
    planId: z.string().min(1),
    hypothesis: z.string(),
  }),
  'experiment.completed': z.object({
    experimentId: z.string().min(1),
    planId: z.string().min(1),
    status: z.enum(['completed', 'failed', 'interrupted']),
    baseline: TrialOutcomeSchema.optional(),
    intervention: TrialOutcomeSchema.nullable().optional(),
  }),
  'trial.started': z.object({
    ...trialBase,
    planId: z.string().min(1),
    startUrl: z.string(),
    attempt: z.number().int().min(0),
  }),
  'trial.completed': z.object({
    ...trialBase,
    outcome: TrialOutcomeSchema,
    reason: z.string().optional(),
  }),
  'action.performed': z.object({
    ...trialBase,
    actionId: z.string().min(1),
    kind: PlanActionKindSchema,
    testId: z.string().min(1),
  }),
  'request.started': z.object({
    ...trialBase,
    requestId: z.string().min(1),
    method: z.string().min(1),
    url: z.string(),
  }),
  'request.captured': z.object({
    ...trialBase,
    requestId: z.string().min(1),
    /** HTTP status; null for WebSocket frames, which have none. */
    status: z.number().int().nullable(),
    held: z.boolean(),
  }),
  'request.held': z.object({
    ...trialBase,
    requestId: z.string().min(1),
    /** HTTP status; null for WebSocket frames, which have none. */
    status: z.number().int().nullable(),
    maxHoldMs: z.number().int().min(0),
  }),
  'request.released': z.object({
    ...trialBase,
    requestId: z.string().min(1),
    reason: z.string().min(1),
  }),
  'trigger.satisfied': z.object({
    ...trialBase,
    requestId: z.string().min(1),
    afterResponse: z.string().min(1),
  }),
  'screenshot.captured': z.object({
    ...trialBase,
    artifactId: z.string().min(1),
    filename: z.string().min(1),
    label: z.string(),
  }),
  'values.captured': z.object({
    ...trialBase,
    artifactId: z.string().min(1),
    filename: z.string().min(1),
    values: z.record(z.string(), z.string().nullable()),
  }),
  'assertion.evaluated': z.object({
    ...trialBase,
    assertionId: z.string().min(1),
    passed: z.boolean(),
    expected: z.string(),
    observed: z.string().nullable(),
  }),
  'finding.recorded': z.object({
    findingId: z.string().min(1),
    experimentId: z.string().min(1),
    title: z.string(),
    status: FindingStatusSchema,
    count: z.string(),
  }),
  'evidence.skipped': z.object({
    ...trialBase,
    kind: z.string().min(1),
    label: z.string(),
    reason: z.string().min(1),
    message: z.string(),
  }),
} as const;

export type RunEventPayloadMap = {
  [K in keyof typeof payloadSchemas]: z.output<(typeof payloadSchemas)[K]>;
};

export type RunEventKind = keyof RunEventPayloadMap;

/** Every known kind has a payload schema, and vice versa. */
type KindParity =
  | Exclude<KnownRunEventKind, RunEventKind>
  | Exclude<RunEventKind, KnownRunEventKind>;
const kindParity: KindParity extends never ? true : never = true;
void kindParity;

const eventBase = {
  id: z.string().min(1),
  runId: z.string().min(1),
  sequence: z.number().int().min(0),
  createdAt: IsoDateTimeSchema,
};

export const RunEventSchema = z.discriminatedUnion('kind', [
  z.object({ ...eventBase, kind: z.literal('run.created'), payload: payloadSchemas['run.created'] }),
  z.object({ ...eventBase, kind: z.literal('run.started'), payload: payloadSchemas['run.started'] }),
  z.object({ ...eventBase, kind: z.literal('run.phase'), payload: payloadSchemas['run.phase'] }),
  z.object({ ...eventBase, kind: z.literal('run.log'), payload: payloadSchemas['run.log'] }),
  z.object({
    ...eventBase,
    kind: z.literal('run.cancel_requested'),
    payload: payloadSchemas['run.cancel_requested'],
  }),
  z.object({
    ...eventBase,
    kind: z.literal('run.cancelled'),
    payload: payloadSchemas['run.cancelled'],
  }),
  z.object({
    ...eventBase,
    kind: z.literal('run.completed'),
    payload: payloadSchemas['run.completed'],
  }),
  z.object({ ...eventBase, kind: z.literal('run.failed'), payload: payloadSchemas['run.failed'] }),
  z.object({
    ...eventBase,
    kind: z.literal('run.interrupted'),
    payload: payloadSchemas['run.interrupted'],
  }),
  z.object({
    ...eventBase,
    kind: z.literal('experiment.started'),
    payload: payloadSchemas['experiment.started'],
  }),
  z.object({
    ...eventBase,
    kind: z.literal('experiment.completed'),
    payload: payloadSchemas['experiment.completed'],
  }),
  z.object({
    ...eventBase,
    kind: z.literal('trial.started'),
    payload: payloadSchemas['trial.started'],
  }),
  z.object({
    ...eventBase,
    kind: z.literal('trial.completed'),
    payload: payloadSchemas['trial.completed'],
  }),
  z.object({
    ...eventBase,
    kind: z.literal('action.performed'),
    payload: payloadSchemas['action.performed'],
  }),
  z.object({
    ...eventBase,
    kind: z.literal('request.started'),
    payload: payloadSchemas['request.started'],
  }),
  z.object({
    ...eventBase,
    kind: z.literal('request.captured'),
    payload: payloadSchemas['request.captured'],
  }),
  z.object({
    ...eventBase,
    kind: z.literal('request.held'),
    payload: payloadSchemas['request.held'],
  }),
  z.object({
    ...eventBase,
    kind: z.literal('request.released'),
    payload: payloadSchemas['request.released'],
  }),
  z.object({
    ...eventBase,
    kind: z.literal('trigger.satisfied'),
    payload: payloadSchemas['trigger.satisfied'],
  }),
  z.object({
    ...eventBase,
    kind: z.literal('screenshot.captured'),
    payload: payloadSchemas['screenshot.captured'],
  }),
  z.object({
    ...eventBase,
    kind: z.literal('values.captured'),
    payload: payloadSchemas['values.captured'],
  }),
  z.object({
    ...eventBase,
    kind: z.literal('assertion.evaluated'),
    payload: payloadSchemas['assertion.evaluated'],
  }),
  z.object({
    ...eventBase,
    kind: z.literal('finding.recorded'),
    payload: payloadSchemas['finding.recorded'],
  }),
  z.object({
    ...eventBase,
    kind: z.literal('evidence.skipped'),
    payload: payloadSchemas['evidence.skipped'],
  }),
]);

export type RunEvent = z.output<typeof RunEventSchema>;

/** Logical request ID on request-lifecycle and trigger events; null otherwise. */
export function requestIdOf(event: RunEvent): string | null {
  switch (event.kind) {
    case 'request.started':
    case 'request.captured':
    case 'request.held':
    case 'request.released':
    case 'trigger.satisfied':
      return event.payload.requestId;
    default:
      return null;
  }
}

/** Trial ID on events emitted from inside a trial; null otherwise. */
export function trialIdOf(event: RunEvent): string | null {
  switch (event.kind) {
    case 'trial.started':
    case 'trial.completed':
    case 'action.performed':
    case 'request.started':
    case 'request.captured':
    case 'request.held':
    case 'request.released':
    case 'trigger.satisfied':
    case 'screenshot.captured':
    case 'values.captured':
    case 'assertion.evaluated':
    case 'evidence.skipped':
      return event.payload.trialId;
    default:
      return null;
  }
}
