import { describe, expect, it } from 'vitest';
import { DEFAULT_PLAN_TIMEOUTS } from '@races/contracts';
import type {
  ExperimentPlan,
  TrialOutcome,
  VerificationCheckDetail,
  VerificationCheckStatus,
} from '@races/contracts';
import type { AgentTrialRunner } from '../agent/tools.js';
import type { ExperimentResult } from '../runner/experiment.js';
import { compareProjectCheck, verifyPatchedApp, type VerificationInput } from './verify.js';

describe('compareProjectCheck (no-worse-than-baseline)', () => {
  it('passes when the patched check is green regardless of baseline', () => {
    expect(compareProjectCheck({ exitCode: 0, output: 'ok' }, undefined).status).toBe('pass');
    expect(
      compareProjectCheck({ exitCode: 0, output: 'ok' }, { exitCode: 1, output: 'boom' }).status,
    ).toBe('pass');
  });

  it('skips a byte-identical completed failure', () => {
    const compared = compareProjectCheck(
      { exitCode: 1, output: 'same failure' },
      { exitCode: 1, output: 'same failure' },
    );
    expect(compared.status).toBe('skipped');
    expect(compared.note).toContain('byte-identical');
  });

  it('fails when the patched failure differs or the baseline was green', () => {
    expect(
      compareProjectCheck({ exitCode: 1, output: 'new failure' }, { exitCode: 1, output: 'old' })
        .status,
    ).toBe('fail');
    expect(
      compareProjectCheck({ exitCode: 2, output: 'x' }, { exitCode: 0, output: 'ok' }).status,
    ).toBe('fail');
    expect(compareProjectCheck({ exitCode: 1, output: 'x' }, undefined).status).toBe('fail');
  });

  it('is incomplete when the patched check did not finish, however the baseline did', () => {
    // Both timed out: identical outputs prove nothing (review regression).
    expect(
      compareProjectCheck({ exitCode: null, output: '' }, { exitCode: null, output: '' }).status,
    ).toBe('incomplete');
    expect(
      compareProjectCheck({ exitCode: null, output: '' }, { exitCode: 0, output: 'ok' }).status,
    ).toBe('incomplete');
    expect(
      compareProjectCheck({ exitCode: null, output: '' }, undefined).status,
    ).toBe('incomplete');
  });
});

const PASS: { baseline: TrialOutcome; intervention: TrialOutcome } = {
  baseline: 'pass',
  intervention: 'pass',
};

function frozenPlan(schedule: ExperimentPlan['schedule']): ExperimentPlan {
  return {
    schemaVersion: 1,
    id: 'frozen-plan',
    hypothesis: 'Late responses overwrite newer results.',
    startUrl: 'http://127.0.0.1:9999/',
    actions: [{ id: 'a1', kind: 'fill', testId: 'search-input', value: 'alpha' }],
    requests: [
      {
        id: 'reqA',
        method: 'GET',
        urlPattern: '/api/search',
        query: { q: 'alpha' },
        occurrence: 1,
        afterAction: 'a1',
      },
    ],
    schedule,
    assertions: [
      {
        id: 'c1',
        description: 'Results reflect the latest query.',
        type: 'textContains',
        testId: 'results-for',
        expected: 'alpha',
      },
    ],
    timeouts: { ...DEFAULT_PLAN_TIMEOUTS },
    requiredCapabilities: [],
  };
}

function makeVerifyInput(
  pairs: { baseline: TrialOutcome; intervention: TrialOutcome | null }[],
  overrides: Partial<VerificationInput> = {},
): {
  input: VerificationInput;
  checks: { name: string; status: VerificationCheckStatus; detail: VerificationCheckDetail }[];
} {
  const checks: {
    name: string;
    status: VerificationCheckStatus;
    detail: VerificationCheckDetail;
  }[] = [];
  let call = 0;
  const trialRunner: AgentTrialRunner = {
    runExperiment: async (): Promise<ExperimentResult> => {
      const pair = pairs[Math.min(call, pairs.length - 1)];
      call += 1;
      const detail = (outcome: TrialOutcome) => ({
        outcome,
        reason: null,
        detail: null,
        assertions: [],
        requests: [],
      });
      return {
        experimentId: `exp-${call}`,
        baseline: { trialId: `b-${call}`, outcome: pair.baseline, detail: detail(pair.baseline) },
        intervention:
          pair.intervention === null
            ? null
            : {
                trialId: `i-${call}`,
                outcome: pair.intervention,
                detail: detail(pair.intervention),
              },
      };
    },
    executeTrial: async () => {
      throw new Error('verifyPatchedApp never executes single trials');
    },
  };
  const input: VerificationInput = {
    trialRunner,
    browser: {} as VerificationInput['browser'],
    runId: 'run-1',
    signal: new AbortController().signal,
    events: {} as VerificationInput['events'],
    artifacts: {} as VerificationInput['artifacts'],
    store: {} as VerificationInput['store'],
    frozenPlan: frozenPlan(null),
    checkId: 'check-1',
    patchedUrl: 'http://127.0.0.1:9999/',
    reproducerId: 'repro-1',
    repairAttemptId: 'attempt-1',
    repairStore: {
      createReproducer: () => ({ id: 'repro-1' }),
      createRepairAttempt: () => ({ id: 'attempt-1' }),
      finishRepairAttempt: () => {},
      createVerificationCheck: (row) => {
        checks.push({ name: row.name, status: row.status, detail: row.detail });
        return { id: `check-row-${checks.length}` };
      },
    },
    runCheck: async () => ({ exitCode: 0, output: 'ok' }),
    baselineChecks: new Map(),
    scriptsPresent: new Set(['typecheck', 'test']),
    ...overrides,
  };
  return { input, checks };
}

describe('verifyPatchedApp (VF01 gate set)', () => {
  it('verifies when every pair passes and project checks are green', async () => {
    const { input, checks } = makeVerifyInput([PASS, PASS, PASS, PASS]);
    const result = await verifyPatchedApp(input);
    expect(result.verified).toBe(true);
    expect(checks.map((c) => `${c.name}:${c.status}`)).toEqual([
      'frozen-rep-1:pass',
      'frozen-rep-2:pass',
      'frozen-rep-3:pass',
      'normal-workflow:pass',
      'variation-early-delivery:skipped',
      'variation-late-delivery:skipped',
      'project-typecheck:pass',
      'project-test:pass',
    ]);
  });

  it('fails verification when a frozen repetition still violates', async () => {
    const { input, checks } = makeVerifyInput([
      PASS,
      { baseline: 'pass', intervention: 'violation' },
      PASS,
      PASS,
    ]);
    const result = await verifyPatchedApp(input);
    expect(result.verified).toBe(false);
    expect(checks.find((c) => c.name === 'frozen-rep-2')?.status).toBe('fail');
    expect(result.summary.join(' ')).toContain('frozen repetition 2');
  });

  it('records runner errors as incomplete, never as pass or fail', async () => {
    const { input, checks } = makeVerifyInput([
      { baseline: 'runner-error', intervention: null },
      PASS,
      PASS,
      PASS,
    ]);
    const result = await verifyPatchedApp(input);
    expect(result.verified).toBe(false);
    expect(checks.find((c) => c.name === 'frozen-rep-1')?.status).toBe('incomplete');
  });

  it('runs delivery variations for scheduled plans and skips missing scripts', async () => {
    const scheduled = {
      ...frozenPlan(null),
      requests: [
        ...frozenPlan(null).requests,
        {
          id: 'reqB',
          method: 'GET',
          urlPattern: '/api/search',
          query: { q: 'beta' },
          occurrence: 2,
          afterAction: 'a1',
        },
      ],
      schedule: {
        hold: ['reqA'],
        releases: [{ request: 'reqA', afterResponse: 'reqB', settleMs: 100, timeoutMs: 1000 }],
      },
    } satisfies ExperimentPlan;
    const { input, checks } = makeVerifyInput([PASS, PASS, PASS, PASS, PASS, PASS], {
      frozenPlan: scheduled,
      scriptsPresent: new Set(['test']),
      runCheck: async () => ({ exitCode: 1, output: 'pre-existing failure' }),
      baselineChecks: new Map([['test', { exitCode: 1, output: 'pre-existing failure' }]]),
    });
    const result = await verifyPatchedApp(input);
    expect(result.verified).toBe(true);
    expect(checks.find((c) => c.name === 'variation-early-delivery')?.status).toBe('pass');
    expect(checks.find((c) => c.name === 'variation-late-delivery')?.status).toBe('pass');
    expect(checks.find((c) => c.name === 'project-typecheck')?.status).toBe('skipped');
    // Byte-identical pre-existing failure is skipped, not a pass.
    expect(checks.find((c) => c.name === 'project-test')?.status).toBe('skipped');
  });

  it('fails when a project check regresses versus baseline', async () => {
    const { input, checks } = makeVerifyInput([PASS, PASS, PASS, PASS], {
      runCheck: async () => ({ exitCode: 2, output: 'new type error' }),
      baselineChecks: new Map([['typecheck', { exitCode: 0, output: 'ok' }]]),
    });
    const result = await verifyPatchedApp(input);
    expect(result.verified).toBe(false);
    expect(checks.find((c) => c.name === 'project-typecheck')?.status).toBe('fail');
  });
});
