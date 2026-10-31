import { describe, expect, it } from 'vitest';
import type {
  RepairAttempt,
  Reproducer,
  Trial,
  VerificationCheck,
} from '@races/contracts';
import {
  selectCompareAttempt,
  selectComparisonPair,
  type TrialGroup,
} from './evidence-compare';

function trial(overrides: Partial<Trial> & { id: string }): Trial {
  return {
    experimentId: 'exp-source',
    kind: 'intervention',
    attempt: 0,
    outcome: null,
    detail: null,
    startedAt: '2026-10-31T18:00:00.000Z',
    finishedAt: null,
    ...overrides,
  };
}

function check(overrides: Partial<VerificationCheck> & { id: string; name: string }): VerificationCheck {
  return {
    runId: 'run-1',
    reproducerId: 'repro-1',
    repairAttemptId: 'attempt-1',
    status: 'pass',
    detail: {},
    createdAt: '2026-10-31T18:00:00.000Z',
    ...overrides,
  };
}

function attempt(overrides: Partial<RepairAttempt> & { id: string }): RepairAttempt {
  return {
    runId: 'run-1',
    reproducerId: 'repro-1',
    attempt: 1,
    workspacePath: 'ws',
    sourceIdentity: 'test',
    diff: '',
    status: 'completed',
    createdAt: '2026-10-31T18:00:00.000Z',
    finishedAt: null,
    ...overrides,
  };
}

const REPRODUCER: Reproducer = {
  id: 'repro-1',
  runId: 'run-1',
  findingId: 'finding-1',
  experimentId: 'exp-source',
  bundlePath: 'bundle',
  testHash: 't',
  planHash: 'p',
  checkHash: 'c',
  checkId: 'c1',
  createdAt: '2026-10-31T18:00:00.000Z',
};

describe('selectCompareAttempt', () => {
  it('returns null when no attempt has verification trials', () => {
    const attempts = [attempt({ id: 'attempt-1' })];
    expect(selectCompareAttempt(attempts, [check({ id: 'c1', name: 'patch-nonempty' })])).toBeNull();
  });

  it('prefers the latest attempt with trial evidence', () => {
    const attempts = [attempt({ id: 'attempt-1', attempt: 1 }), attempt({ id: 'attempt-2', attempt: 2 })];
    const checks = [
      check({ id: 'c1', name: 'frozen-rep-1', repairAttemptId: 'attempt-1', detail: { experimentId: 'exp-a' } }),
      check({ id: 'c2', name: 'frozen-rep-1', repairAttemptId: 'attempt-2', detail: { experimentId: 'exp-b' } }),
    ];
    expect(selectCompareAttempt(attempts, checks)?.id).toBe('attempt-2');
  });
});

describe('selectComparisonPair', () => {
  const groups: TrialGroup[] = [
    {
      id: 'exp-source',
      name: 'source',
      trials: [
        trial({ id: 't-base', kind: 'baseline', outcome: 'pass' }),
        trial({ id: 't-bad', outcome: 'violation' }),
      ],
    },
    {
      id: 'exp-verify',
      name: 'verify',
      trials: [trial({ id: 't-fixed', experimentId: 'exp-verify', outcome: 'pass' })],
    },
  ];

  it('pairs the failing source trial with the first verification rep', () => {
    const pair = selectComparisonPair(
      attempt({ id: 'attempt-1' }),
      REPRODUCER,
      [
        check({ id: 'c1', name: 'normal-workflow', detail: { experimentId: 'exp-other' } }),
        check({ id: 'c2', name: 'frozen-rep-1', detail: { experimentId: 'exp-verify' } }),
      ],
      groups,
    );
    expect(pair.before?.trial.id).toBe('t-bad');
    expect(pair.after?.trial.id).toBe('t-fixed');
    expect(pair.after?.checkName).toBe('frozen-rep-1');
  });

  it('skips verification experiments missing from the run', () => {
    const pair = selectComparisonPair(
      attempt({ id: 'attempt-1' }),
      REPRODUCER,
      [check({ id: 'c1', name: 'frozen-rep-1', detail: { experimentId: 'exp-missing' } })],
      groups,
    );
    expect(pair.before?.trial.id).toBe('t-bad');
    expect(pair.after).toBeNull();
  });

  it('falls back to the first trial when kinds do not match', () => {
    const baselineOnly: TrialGroup[] = [
      { id: 'exp-source', name: 'source', trials: [trial({ id: 't-only', kind: 'baseline', outcome: 'pass' })] },
    ];
    const pair = selectComparisonPair(attempt({ id: 'attempt-1' }), REPRODUCER, [], baselineOnly);
    expect(pair.before?.trial.id).toBe('t-only');
    expect(pair.after).toBeNull();
  });
});
