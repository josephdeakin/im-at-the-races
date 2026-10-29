import { describe, expect, it } from 'vitest';
import type { RepairAttempt, VerificationCheck } from '@races/contracts';
import {
  checkLabel,
  checkOneLiner,
  summarizeAttemptChecks,
  summarizeRepair,
} from './repair';

function check(name: string, status: VerificationCheck['status'], attemptId: string | null = 'att-1'): VerificationCheck {
  return {
    id: `check-${name}`,
    runId: 'run-1',
    reproducerId: 'repro-1',
    repairAttemptId: attemptId,
    name,
    status,
    detail: {},
    createdAt: new Date().toISOString(),
  };
}

function attempt(attempt: number, id = `att-${attempt}`): RepairAttempt {
  return {
    id,
    runId: 'run-1',
    reproducerId: 'repro-1',
    attempt,
    workspacePath: '/tmp/ws',
    sourceIdentity: 'git:abc:subpath-clean',
    diff: 'diff',
    status: 'completed',
    createdAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
  };
}

describe('summarizeAttemptChecks', () => {
  it('fails on any fail, reports incompletes, and never lets skips imply a pass', () => {
    expect(summarizeAttemptChecks([]).verdict).toBe('no-checks');
    expect(
      summarizeAttemptChecks([check('a', 'pass'), check('b', 'skipped')]).verdict,
    ).toBe('verified');
    const failed = summarizeAttemptChecks([check('a', 'pass'), check('b', 'fail')]);
    expect(failed.verdict).toBe('failed');
    expect(failed.problems).toEqual(['b']);
    expect(summarizeAttemptChecks([check('a', 'incomplete')]).verdict).toBe('incomplete');
  });
});

describe('summarizeRepair', () => {
  it('picks the latest verified attempt and degrades otherwise', () => {
    expect(summarizeRepair([], [])).toEqual({ verdict: 'none', verifiedAttempt: null, attempts: 0 });
    const first = attempt(1);
    const second = attempt(2);
    expect(
      summarizeRepair([first, second], [check('a', 'pass', first.id), check('b', 'fail', second.id)]),
    ).toEqual({ verdict: 'verified', verifiedAttempt: 1, attempts: 2 });
    expect(
      summarizeRepair([first], [check('a', 'fail', first.id)]).verdict,
    ).toBe('unverified');
  });
});

describe('checkLabel', () => {
  it('names frozen repetitions and falls back to de-dashed names', () => {
    expect(checkLabel('frozen-rep-2')).toBe('Frozen reproducer, repetition 2 of 3');
    expect(checkLabel('patched-app-serves')).toBe('Patched app serves');
    expect(checkLabel('some-future-gate')).toBe('some future gate');
  });
});

describe('checkOneLiner', () => {
  it('prefers notes, then outcomes, then exit codes and urls', () => {
    expect(checkOneLiner({ ...check('a', 'skipped'), detail: { note: 'no test script' } })).toBe(
      'no test script',
    );
    expect(
      checkOneLiner({ ...check('b', 'pass'), detail: { baseline: 'pass', intervention: 'pass' } }),
    ).toBe('baseline pass · intervention pass');
    expect(
      checkOneLiner({ ...check('c', 'pass'), detail: { exitCode: 0, baselineExitCode: 0 } }),
    ).toBe('exit 0 (baseline 0)');
    expect(
      checkOneLiner({ ...check('d', 'pass'), detail: { url: 'http://127.0.0.1:4200/' } }),
    ).toBe('http://127.0.0.1:4200/');
    expect(checkOneLiner(check('e', 'pass'))).toBeNull();
  });
});
