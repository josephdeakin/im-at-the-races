import { describe, expect, it } from 'vitest';
import type { StoredTrial } from '../runner/experiment.js';
import { computeReproduced } from './reproduce.js';

function trial(
  kind: string,
  attempt: number,
  outcome: string | null,
  assertions: { id: string; passed: boolean }[] = [],
): StoredTrial {
  return {
    id: `${kind}-${attempt}`,
    kind,
    attempt,
    outcome,
    detail: {
      outcome: outcome ?? 'inconclusive',
      reason: null,
      detail: null,
      assertions: assertions.map((a) => ({ ...a, expected: 'e', observed: 'o' })),
      requests: [],
    },
  };
}

const PASS = [{ id: 'check', passed: true }];
const FAIL = [{ id: 'check', passed: false }];

describe('computeReproduced', () => {
  it('labels 2-of-3 same-check violations reproduced', () => {
    const trials = [
      trial('baseline', 0, 'pass', PASS),
      trial('intervention', 0, 'violation', FAIL),
      trial('baseline', 1, 'pass', PASS),
      trial('intervention', 1, 'violation', FAIL),
      trial('baseline', 2, 'pass', PASS),
      trial('intervention', 2, 'pass', PASS),
      trial('baseline', 3, 'pass', PASS),
      trial('intervention', 3, 'violation', FAIL),
    ];
    expect(computeReproduced(trials)).toMatchObject({
      candidateChecks: ['check'],
      attempts: 3,
      violations: 2,
      reproduced: true,
    });
  });

  it('requires the same check and a passing baseline', () => {
    const trials = [
      trial('baseline', 0, 'pass', PASS),
      trial('intervention', 0, 'violation', FAIL),
      trial('baseline', 1, 'pass', PASS),
      trial('intervention', 1, 'violation', [{ id: 'other', passed: false }]),
      trial('baseline', 2, 'inconclusive', []),
      trial('intervention', 2, 'violation', FAIL),
    ];
    const verdict = computeReproduced(trials);
    expect(verdict.attempts).toBe(2);
    expect(verdict.violations).toBe(0);
    expect(verdict.reproduced).toBe(false);
  });

  it('stays candidate without confirmations or without a discovery pair', () => {
    expect(
      computeReproduced([
        trial('baseline', 0, 'pass', PASS),
        trial('intervention', 0, 'violation', FAIL),
      ]).reproduced,
    ).toBe(false);
    expect(
      computeReproduced([
        trial('baseline', 0, 'inconclusive', []),
        trial('intervention', 0, 'violation', FAIL),
      ]).candidateChecks,
    ).toEqual([]);
  });

  it('ignores runner-errored attempts on both sides', () => {
    const trials = [
      trial('baseline', 0, 'pass', PASS),
      trial('intervention', 0, 'violation', FAIL),
      trial('baseline', 1, 'runner-error', []),
      trial('intervention', 1, 'violation', FAIL),
      trial('baseline', 2, 'pass', PASS),
      trial('intervention', 2, 'violation', FAIL),
      trial('baseline', 3, 'pass', PASS),
      trial('intervention', 3, 'violation', FAIL),
    ];
    expect(computeReproduced(trials)).toMatchObject({
      attempts: 3,
      violations: 2,
      reproduced: true,
    });
  });
});
