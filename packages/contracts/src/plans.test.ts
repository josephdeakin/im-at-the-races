import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLAN_TIMEOUTS,
  ExperimentPlanSchema,
  RepairAttemptSchema,
  ReproducerSchema,
  VerificationCheckSchema,
  type ExperimentPlan,
} from './index.js';

function validPlan(): ExperimentPlan {
  return {
    schemaVersion: 1,
    id: 'stale-search-v1',
    hypothesis: 'A slow earlier response overwrites newer results.',
    startUrl: 'http://127.0.0.1:4100/',
    actions: [
      { id: 'a1', kind: 'fill', testId: 'search-input', value: 'alpha' },
      { id: 'a2', kind: 'fill', testId: 'search-input', value: 'beta' },
    ],
    requests: [
      {
        id: 'reqA',
        method: 'GET',
        urlPattern: '/api/search',
        query: { q: 'alpha' },
        occurrence: 1,
        afterAction: 'a1',
      },
      {
        id: 'reqB',
        method: 'GET',
        urlPattern: '/api/search',
        query: { q: 'beta' },
        occurrence: 1,
        afterAction: 'a2',
      },
    ],
    schedule: {
      hold: ['reqA'],
      releases: [{ request: 'reqA', afterResponse: 'reqB', settleMs: 500, timeoutMs: 10_000 }],
    },
    assertions: [
      {
        id: 'final-matches-query',
        description: 'Displayed results belong to the current query.',
        type: 'textContains',
        testId: 'results-for',
        expected: 'beta',
      },
    ],
    timeouts: { ...DEFAULT_PLAN_TIMEOUTS },
    requiredCapabilities: ['http-hold-release'],
  };
}

describe('ExperimentPlanSchema', () => {
  it('accepts a complete hold-and-release plan', () => {
    expect(ExperimentPlanSchema.safeParse(validPlan()).success).toBe(true);
  });

  it('accepts a baseline plan with no schedule', () => {
    const plan = validPlan();
    plan.schedule = null;
    expect(ExperimentPlanSchema.safeParse(plan).success).toBe(true);
  });

  it('rejects unknown schema versions and bad URLs', () => {
    expect(
      ExperimentPlanSchema.safeParse({ ...validPlan(), schemaVersion: 2 }).success,
    ).toBe(false);
    expect(ExperimentPlanSchema.safeParse({ ...validPlan(), startUrl: 'not-a-url' }).success).toBe(
      false,
    );
  });

  it('rejects uncompilable URL patterns', () => {
    const plan = validPlan();
    plan.requests[0].urlPattern = '([';
    expect(ExperimentPlanSchema.safeParse(plan).success).toBe(false);
  });

  it('enforces fill-value and click-no-value rules', () => {
    const missing = validPlan();
    delete (missing.actions[0] as { value?: string }).value;
    expect(ExperimentPlanSchema.safeParse(missing).success).toBe(false);

    const clicky = validPlan();
    clicky.actions[0] = { id: 'a1', kind: 'click', testId: 'search-input', value: 'x' };
    expect(ExperimentPlanSchema.safeParse(clicky).success).toBe(false);
  });

  it('rejects duplicate ids and dangling references', () => {
    const dup = validPlan();
    dup.actions[1].id = 'a1';
    expect(ExperimentPlanSchema.safeParse(dup).success).toBe(false);

    const danglingAction = validPlan();
    danglingAction.requests[0].afterAction = 'nope';
    expect(ExperimentPlanSchema.safeParse(danglingAction).success).toBe(false);

    const danglingHold = validPlan();
    danglingHold.schedule = {
      hold: ['nope'],
      releases: [{ request: 'nope', afterResponse: 'reqB', settleMs: 0, timeoutMs: 1000 }],
    };
    expect(ExperimentPlanSchema.safeParse(danglingHold).success).toBe(false);
  });

  it('rejects releases without a hold and self-triggered releases', () => {
    const unheld = validPlan();
    unheld.schedule = {
      hold: ['reqB'],
      releases: [{ request: 'reqA', afterResponse: 'reqB', settleMs: 0, timeoutMs: 1000 }],
    };
    expect(ExperimentPlanSchema.safeParse(unheld).success).toBe(false);

    const selfTrigger = validPlan();
    selfTrigger.schedule = {
      hold: ['reqA'],
      releases: [{ request: 'reqA', afterResponse: 'reqA', settleMs: 0, timeoutMs: 1000 }],
    };
    expect(ExperimentPlanSchema.safeParse(selfTrigger).success).toBe(false);
  });
});

describe('repair DTOs', () => {
  it('validates reproducer, attempt, and check records', () => {
    expect(
      ReproducerSchema.safeParse({
        id: 'r1',
        runId: 'run-1',
        findingId: 'f1',
        experimentId: 'e1',
        bundlePath: 'artifacts/repro',
        testHash: 'sha256:t',
        planHash: 'sha256:p',
        checkHash: 'sha256:c',
        checkId: 'final',
        createdAt: new Date(0).toISOString(),
      }).success,
    ).toBe(true);
    expect(
      RepairAttemptSchema.safeParse({
        id: 'a1',
        runId: 'run-1',
        reproducerId: 'r1',
        attempt: 1,
        workspacePath: '/tmp/ws',
        sourceIdentity: 'git:abc:clean',
        diff: '',
        status: 'completed',
        createdAt: new Date(0).toISOString(),
        finishedAt: null,
      }).success,
    ).toBe(true);
    expect(
      VerificationCheckSchema.safeParse({
        id: 'c1',
        runId: 'run-1',
        reproducerId: 'r1',
        repairAttemptId: null,
        name: 'reproducer-fails-on-original',
        status: 'pass',
        detail: {},
        createdAt: new Date(0).toISOString(),
      }).success,
    ).toBe(true);
    expect(
      VerificationCheckSchema.safeParse({
        id: 'c1',
        runId: 'run-1',
        reproducerId: 'r1',
        repairAttemptId: null,
        name: 'x',
        status: 'bogus',
        detail: {},
        createdAt: new Date(0).toISOString(),
      }).success,
    ).toBe(false);
  });
});
