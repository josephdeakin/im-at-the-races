import { describe, expect, it } from 'vitest';
import type { Finding, RunEvent, Trial } from '@races/contracts';
import {
  deriveFeatureRace,
  hasFeatureCandidate,
  normalizePace,
  positionAtMarks,
  raceTitle,
  releaseTriggerLabel,
  runnerLabel,
  selectFeatureFinding,
  selectFeatureTrial,
} from './feature-race';

// Fixtures mirror the real demo run: reqAlpha held then released after
// reqBeta, assertions failing with observed "alpha".
const BASE_MS = Date.parse('2026-10-31T18:33:00.000Z');
const at = (offsetMs: number): string => new Date(BASE_MS + offsetMs).toISOString();

function requestEvent(
  sequence: number,
  kind: 'request.started' | 'request.held' | 'request.released' | 'request.captured',
  requestId: string,
  offsetMs: number,
  extra: Record<string, unknown> = {},
): RunEvent {
  return {
    id: `e${sequence}`,
    runId: 'run-1',
    sequence,
    kind,
    payload: {
      experimentId: 'exp-1',
      trialId: 'trial-v',
      trialKind: 'intervention',
      requestId,
      method: 'GET',
      url: `http://127.0.0.1:4110/api/search?q=${requestId === 'reqAlpha' ? 'alpha' : 'beta'}`,
      status: 200,
      held: true,
      maxHoldMs: 5000,
      reason: 'after-reqBeta',
      ...extra,
    },
    createdAt: at(offsetMs),
  } as RunEvent;
}

const EVENTS: RunEvent[] = [
  requestEvent(29, 'request.started', 'reqAlpha', 0),
  requestEvent(31, 'request.started', 'reqBeta', 10),
  requestEvent(32, 'request.captured', 'reqAlpha', 60),
  requestEvent(33, 'request.held', 'reqAlpha', 60),
  requestEvent(34, 'request.captured', 'reqBeta', 60),
  requestEvent(36, 'request.released', 'reqAlpha', 610),
];

function trial(overrides: Partial<Trial> = {}): Trial {
  return {
    id: 'trial-v',
    experimentId: 'exp-1',
    kind: 'intervention',
    attempt: 0,
    outcome: 'violation',
    detail: {
      outcome: 'violation',
      reason: null,
      detail: null,
      assertions: [
        { id: 'assert-latest', passed: false, expected: 'beta', observed: 'Showing results for “alpha”' },
      ],
      requests: [
        {
          id: 'reqAlpha',
          method: 'GET',
          url: 'http://127.0.0.1:4110/api/search?q=alpha&delay=50',
          matched: true,
          held: true,
          released: true,
          status: 200,
          responseExcerpt: 'results',
          responseTruncated: false,
        },
        {
          id: 'reqBeta',
          method: 'GET',
          url: 'http://127.0.0.1:4110/api/search?q=beta&delay=50',
          matched: true,
          held: false,
          released: false,
          status: 200,
          responseExcerpt: 'results',
          responseTruncated: false,
        },
      ],
    },
    startedAt: at(0),
    finishedAt: at(20000),
    ...overrides,
  };
}

const FINDING: Finding = {
  id: 'finding-1',
  runId: 'run-1',
  experimentId: 'exp-1',
  title: 'Stale search overwrite: late alpha overwrites beta',
  status: 'reproduced',
  expectationProvenance: 'probe',
  explanation: 'probe',
  implicatedCode: [],
  sourceIdentity: 'probe',
  createdAt: at(21000),
};

describe('selectFeatureTrial', () => {
  it('prefers the violation intervention trial', () => {
    const trials = [
      trial({ id: 't1', kind: 'baseline', outcome: 'pass' }),
      trial({ id: 't2', kind: 'intervention', outcome: 'violation' }),
    ];
    expect(selectFeatureTrial(trials)?.id).toBe('t2');
  });

  it('returns null without a violation', () => {
    expect(selectFeatureTrial([trial({ outcome: 'pass' })])).toBeNull();
  });
});

describe('selectFeatureFinding', () => {
  const experiments = [{ id: 'exp-1', trials: [trial()] }];

  it('returns the first finding with a raceable trial', () => {
    const selected = selectFeatureFinding([FINDING], experiments);
    expect(selected?.finding.id).toBe('finding-1');
    expect(selected?.trials).toHaveLength(1);
  });

  it('skips findings without raceable trials', () => {
    const selected = selectFeatureFinding(
      [
        { ...FINDING, id: 'f-other', experimentId: 'exp-2' },
        { ...FINDING, id: 'f-raceable' },
      ],
      experiments,
    );
    expect(selected?.finding.id).toBe('f-raceable');
  });

  it('returns null when nothing is raceable', () => {
    expect(selectFeatureFinding([FINDING], [])).toBeNull();
    expect(
      selectFeatureFinding([FINDING], [{ id: 'exp-1', trials: [trial({ outcome: 'pass' })] }]),
    ).toBeNull();
  });
});

describe('labels', () => {
  it('names runners from the query param', () => {
    expect(runnerLabel({ id: 'reqAlpha', url: 'http://x/search?q=alpha' })).toBe('Alpha');
    expect(runnerLabel({ id: 'req1', url: 'http://x/other' })).toBe('req1');
  });

  it('titles the race from the finding headline', () => {
    expect(raceTitle(FINDING.title)).toBe('The Stale Search Overwrite Stakes');
  });

  it('resolves release triggers to runner labels', () => {
    const runners = [
      { requestId: 'reqAlpha', label: 'Alpha' },
      { requestId: 'reqBeta', label: 'Beta' },
    ];
    expect(releaseTriggerLabel('released (after-reqBeta)', runners)).toBe('Beta');
    expect(releaseTriggerLabel('released (after-reqGamma)', runners)).toBe('reqGamma');
    expect(releaseTriggerLabel('released (timer)', runners)).toBeNull();
    expect(releaseTriggerLabel('held', runners)).toBeNull();
  });
});

describe('deriveFeatureRace', () => {
  it('derives milestones and verdict from real-shaped evidence', () => {
    const race = deriveFeatureRace(FINDING, [trial()], EVENTS);
    expect(race?.title).toBe('The Stale Search Overwrite Stakes');
    expect(race?.runners.map((r) => r.label)).toEqual(['Alpha', 'Beta']);
    const alpha = race?.runners.find((r) => r.label === 'Alpha');
    // Time order: the response is captured, then held, then released.
    expect(alpha?.milestones.map((m) => m.kind)).toEqual([
      'started',
      'held',
      'captured',
      'released',
    ]);
    expect(alpha?.milestones.find((m) => m.kind === 'released')?.label).toContain(
      'after-reqBeta',
    );
    expect(race?.runners.find((r) => r.label === 'Beta')?.milestones.map((m) => m.kind)).toEqual([
      'started',
      'captured',
    ]);
    expect(race?.observed).toContain('alpha');
    expect(race?.expected).toBe('beta');
  });

  it('returns null when the story cannot be told', () => {
    expect(deriveFeatureRace(FINDING, [trial({ outcome: 'pass' })], EVENTS)).toBeNull();
    expect(deriveFeatureRace(FINDING, [trial()], [])).toBeNull();
    const solo = trial({
      detail: { ...trial().detail!, requests: [trial().detail!.requests[0]] },
    });
    expect(deriveFeatureRace(FINDING, [solo], EVENTS)).toBeNull();
  });

  it('pre-screens candidates from trial records alone', () => {
    expect(hasFeatureCandidate([trial()])).toBe(true);
    expect(hasFeatureCandidate([trial({ outcome: 'pass' })])).toBe(false);
  });
});

describe('normalizePace', () => {
  it('orders marks in time with readable gaps', () => {
    const race = deriveFeatureRace(FINDING, [trial()], EVENTS);
    const paced = normalizePace(race!, 10);
    for (const runner of paced) {
      const times = runner.marks.map((m) => m.at);
      for (let i = 1; i < times.length; i += 1) {
        expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(0.35);
      }
      const positions = runner.marks.map((m) => m.pos);
      for (let i = 1; i < positions.length; i += 1) {
        expect(positions[i]).toBeGreaterThanOrEqual(positions[i - 1]);
      }
      expect(runner.marks[0].pos).toBe(0);
      expect(runner.marks[runner.marks.length - 1].pos).toBe(1);
      expect(runner.finishAt).toBeLessThanOrEqual(11);
    }
    // Beta's journey ended first in wall time, so it finishes first on clock.
    const alpha = paced.find((r) => r.label === 'Alpha')!;
    const beta = paced.find((r) => r.label === 'Beta')!;
    expect(beta.finishAt).toBeLessThan(alpha.finishAt);
  });

  it('interpolates positions through marks', () => {
    const marks = [
      { at: 1, pos: 0, kind: 'started', label: 'started' },
      { at: 3, pos: 0.5, kind: 'held', label: 'held' },
      { at: 5, pos: 1, kind: 'captured', label: 'captured' },
    ] as const;
    expect(positionAtMarks([...marks], 0)).toBe(0);
    expect(positionAtMarks([...marks], 2)).toBeCloseTo(0.25, 5);
    expect(positionAtMarks([...marks], 3)).toBeCloseTo(0.5, 5);
    expect(positionAtMarks([...marks], 99)).toBe(1);
    expect(positionAtMarks([], 2)).toBe(0);
  });
});
