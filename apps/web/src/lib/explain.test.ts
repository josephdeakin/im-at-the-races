import { describe, expect, it } from 'vitest';
import {
  RunEventSchema,
  type RunEvent,
  type RunEventKind,
  type RunEventPayloadMap,
  type Trial,
} from '@races/contracts';
import { explainTrial, tallyConfirmations } from './explain';

function trial(overrides: Partial<Trial> = {}): Trial {
  return {
    id: 'trial-1',
    experimentId: 'exp-1',
    kind: 'intervention',
    attempt: 0,
    outcome: 'violation',
    detail: {
      outcome: 'violation',
      reason: null,
      detail: null,
      assertions: [{ id: 'final', passed: false, expected: 'beta', observed: 'alpha' }],
      requests: [
        {
          id: 'early',
          method: 'GET',
          url: 'http://x/api?q=a',
          matched: true,
          held: true,
          released: true,
          status: 200,
          responseExcerpt: '{}',
          responseTruncated: false,
        },
      ],
    },
    startedAt: new Date(0).toISOString(),
    finishedAt: new Date(1).toISOString(),
    ...overrides,
  };
}

const TRIAL_BASE = {
  experimentId: 'experiment-1',
  trialId: 'trial-1',
  trialKind: 'baseline' as const,
};

function event<K extends RunEventKind>(
  sequence: number,
  kind: K,
  payload: RunEventPayloadMap[K],
): RunEvent {
  return RunEventSchema.parse({
    id: `event-${sequence}`,
    runId: 'run-1',
    sequence,
    kind,
    payload,
    createdAt: new Date(sequence * 1000).toISOString(),
  });
}

describe('explainTrial', () => {
  it('links the late response, trigger, and failed check for a violation', () => {
    const explanation = explainTrial(
      trial(),
      [
        event(1, 'request.released', { ...TRIAL_BASE, requestId: 'early', reason: 'after-late' }),
        event(2, 'trigger.satisfied', { ...TRIAL_BASE, requestId: 'early', afterResponse: 'late' }),
        event(3, 'request.captured', { ...TRIAL_BASE, requestId: 'late', status: 200, held: false }),
        event(4, 'assertion.evaluated', { ...TRIAL_BASE, assertionId: 'final', passed: false, expected: 'beta', observed: 'alpha' }),
      ],
    );
    expect(explanation.tone).toBe('bad');
    expect(explanation.headline).toContain('“early” arrived after “late” completed');
    expect(explanation.detail).toContain('expected "beta", observed "alpha"');
    expect(explanation.links).toEqual([
      { label: 'late response early', eventSequence: 1 },
      { label: 'trigger late', eventSequence: 3 },
      { label: 'failed check final', eventSequence: 4 },
    ]);
  });

  it('says the cause is uncertain without a held response', () => {
    const t = trial({
      detail: {
        outcome: 'violation',
        reason: null,
        detail: null,
        assertions: [{ id: 'final', passed: false, expected: 'b', observed: 'a' }],
        requests: [],
      },
    });
    const explanation = explainTrial(t, []);
    expect(explanation.headline).toContain('cause is uncertain');
    expect(explanation.links).toEqual([]);
  });

  it('reports passes, inconclusive, errors, and running trials honestly', () => {
    const pass = explainTrial(
      trial({
        outcome: 'pass',
        detail: {
          outcome: 'pass',
          reason: null,
          detail: null,
          assertions: [{ id: 'final', passed: true, expected: 'b', observed: 'b' }],
          requests: [],
        },
      }),
      [],
    );
    expect(pass.tone).toBe('good');
    expect(pass.headline).toContain('1 check passed');

    const inconclusive = explainTrial(
      trial({ outcome: 'inconclusive', detail: { outcome: 'inconclusive', reason: 'action-failed', detail: 'missing selector', assertions: [], requests: [] } }),
      [],
    );
    expect(inconclusive.headline).toContain('action-failed');

    const crashed = explainTrial(
      trial({ outcome: 'runner-error', detail: { outcome: 'runner-error', reason: 'trial-crashed', detail: 'boom', assertions: [], requests: [] } }),
      [],
    );
    expect(crashed.headline).toContain('says nothing about the app');

    const running = explainTrial(trial({ outcome: null, detail: null }), []);
    expect(running.headline).toContain('still running');
  });
});

describe('tallyConfirmations', () => {
  function pair(attempt: number, baseline: 'pass' | 'inconclusive', intervention: 'violation' | 'pass'): Trial[] {
    const mk = (kind: 'baseline' | 'intervention', outcome: string, passed: boolean): Trial =>
      trial({
        id: `${kind}-${attempt}`,
        kind,
        attempt,
        outcome: outcome as Trial['outcome'],
        detail: {
          outcome: outcome as Trial['outcome'] as 'pass',
          reason: null,
          detail: null,
          assertions: [{ id: 'final', passed, expected: 'b', observed: passed ? 'b' : 'a' }],
          requests: [],
        },
      });
    return [
      mk('baseline', baseline, baseline === 'pass'),
      mk('intervention', intervention, intervention === 'pass'),
    ];
  }

  it('counts same-check violations across attempts', () => {
    const trials = [...pair(0, 'pass', 'violation'), ...pair(1, 'pass', 'violation'), ...pair(2, 'pass', 'pass')];
    expect(tallyConfirmations(trials)).toEqual({ attempts: 2, violations: 1, text: '1 of 2' });
  });

  it('reports unconfirmed without a discovery pair or attempts', () => {
    expect(tallyConfirmations(pair(0, 'pass', 'violation'))).toMatchObject({ text: 'unconfirmed' });
    expect(tallyConfirmations(pair(0, 'inconclusive', 'violation'))).toMatchObject({ text: 'unconfirmed' });
  });
});
