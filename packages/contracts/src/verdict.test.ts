import { describe, expect, it } from 'vitest';
import { computeConfirmationVerdict, type VerdictTrial } from './verdict.js';

function detail(passed: Record<string, boolean>): VerdictTrial['detail'] {
  return {
    outcome: 'pass',
    reason: null,
    detail: null,
    assertions: Object.entries(passed).map(([id, ok]) => ({
      id,
      passed: ok,
      expected: 'x',
      observed: ok ? 'x' : 'y',
    })),
    requests: [],
  };
}

function trial(
  kind: string,
  attempt: number,
  outcome: string | null,
  passed: Record<string, boolean>,
): VerdictTrial {
  return { kind, attempt, outcome, detail: detail(passed) };
}

const discovery = [
  trial('baseline', 0, 'pass', { c1: true }),
  trial('intervention', 0, 'violation', { c1: false }),
];

describe('computeConfirmationVerdict (FI02)', () => {
  it('reproduces at two confirmation violations of the same check', () => {
    const verdict = computeConfirmationVerdict([
      ...discovery,
      trial('baseline', 1, 'pass', { c1: true }),
      trial('intervention', 1, 'violation', { c1: false }),
      trial('baseline', 2, 'pass', { c1: true }),
      trial('intervention', 2, 'violation', { c1: false }),
    ]);
    expect(verdict.candidateChecks).toEqual(['c1']);
    expect(verdict.violations).toBe(2);
    expect(verdict.reproduced).toBe(true);
  });

  it('does not reproduce on a single confirmation violation', () => {
    const verdict = computeConfirmationVerdict([
      ...discovery,
      trial('baseline', 1, 'pass', { c1: true }),
      trial('intervention', 1, 'violation', { c1: false }),
      trial('baseline', 2, 'pass', { c1: true }),
      trial('intervention', 2, 'pass', { c1: true }),
    ]);
    expect(verdict.violations).toBe(1);
    expect(verdict.reproduced).toBe(false);
  });

  it('requires the discovery baseline to pass and intervention to violate', () => {
    expect(
      computeConfirmationVerdict([
        trial('baseline', 0, 'violation', { c1: false }),
        trial('intervention', 0, 'violation', { c1: false }),
      ]).reproduced,
    ).toBe(false);
    expect(computeConfirmationVerdict([]).candidateChecks).toEqual([]);
  });

  it('counts only same-check violations with a passing baseline', () => {
    const verdict = computeConfirmationVerdict([
      ...discovery,
      // Different check violated: does not count.
      trial('baseline', 1, 'pass', { c1: true, c2: true }),
      trial('intervention', 1, 'violation', { c1: true, c2: false }),
      // Baseline failed: does not count even though intervention violates c1.
      trial('baseline', 2, 'violation', { c1: false }),
      trial('intervention', 2, 'violation', { c1: false }),
    ]);
    expect(verdict.violations).toBe(0);
    expect(verdict.reproduced).toBe(false);
  });

  it('ignores runner-error and unfinished attempts on both sides', () => {
    const verdict = computeConfirmationVerdict([
      ...discovery,
      trial('baseline', 1, 'runner-error', {}),
      trial('intervention', 1, 'runner-error', {}),
      trial('baseline', 2, 'pass', { c1: true }),
      trial('intervention', 2, null, { c1: false }),
    ]);
    expect(verdict.violations).toBe(0);
    expect(verdict.reproduced).toBe(false);
  });
});
