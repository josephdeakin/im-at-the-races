import { describe, expect, it } from 'vitest';
import {
  RunEventSchema,
  type RunEvent,
  type RunEventKind,
  type RunEventPayloadMap,
  type TrialDetail,
} from '@races/contracts';
import { buildTrialLanes, clockFraction, raceClockFitMax } from './timeline';

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

const detail: TrialDetail = {
  outcome: 'violation',
  reason: null,
  detail: null,
  assertions: [{ id: 'final', passed: false, expected: 'b', observed: 'a' }],
  requests: [
    { id: 'early', method: 'GET', url: 'http://x/a', matched: true, held: true, released: true, status: 200, responseExcerpt: '{}', responseTruncated: false },
    { id: 'late', method: 'GET', url: 'http://x/b', matched: true, held: false, released: false, status: 200, responseExcerpt: '{}', responseTruncated: false },
  ],
};

describe('buildTrialLanes', () => {
  it('builds request lanes with a held span in plan order', () => {
    const lanes = buildTrialLanes(
      [
        event(1, 'request.started', { ...TRIAL_BASE, requestId: 'early', method: 'GET', url: 'http://x/a' }),
        event(2, 'request.captured', { ...TRIAL_BASE, requestId: 'early', status: 200, held: false }),
        event(3, 'request.held', { ...TRIAL_BASE, requestId: 'early', status: 200, maxHoldMs: 1000 }),
        event(4, 'request.captured', { ...TRIAL_BASE, requestId: 'late', status: 200, held: false }),
        event(5, 'trigger.satisfied', { ...TRIAL_BASE, requestId: 'early', afterResponse: 'late' }),
        event(6, 'request.released', { ...TRIAL_BASE, requestId: 'early', reason: 'after-late' }),
      ],
      detail,
    );
    expect(lanes.map((lane) => lane.id)).toEqual(['request:early', 'request:late']);
    const early = lanes[0];
    expect(early.markers.map((m) => m.label)).toEqual([
      'started',
      'captured 200',
      'held',
      'trigger satisfied',
      'released ← late',
    ]);
    expect(early.spans).toEqual([{ fromSequence: 3, toSequence: 6, label: 'held' }]);
    expect(lanes[1].markers.map((m) => m.label)).toEqual(['captured 200']);
  });

  it('labels a captured WebSocket frame without a status', () => {
    const lanes = buildTrialLanes(
      [event(1, 'request.captured', { ...TRIAL_BASE, requestId: 'push', status: null, held: false })],
      null,
    );
    expect(lanes[0].markers.map((m) => m.label)).toEqual(['captured frame']);
  });

  it('marks an unreleased hold and groups actions, checks, and evidence', () => {
    const lanes = buildTrialLanes(
      [
        event(1, 'action.performed', { ...TRIAL_BASE, actionId: 'a1', kind: 'click', testId: 'go' }),
        event(2, 'request.held', { ...TRIAL_BASE, requestId: 'early', status: 200, maxHoldMs: 1000 }),
        event(3, 'assertion.evaluated', { ...TRIAL_BASE, assertionId: 'final', passed: false, expected: 'b', observed: 'a' }),
        event(4, 'screenshot.captured', { ...TRIAL_BASE, artifactId: 'artifact-1', filename: 'shot.png', label: 'post-release' }),
      ],
      detail,
    );
    expect(lanes.map((lane) => lane.id)).toEqual([
      'request:early',
      'request:late',
      'actions',
      'checks',
      'evidence',
    ]);
    expect(lanes[0].spans).toEqual([
      { fromSequence: 2, toSequence: null, label: 'held (no release recorded)' },
    ]);
    expect(lanes[3].markers[0]).toMatchObject({ tone: 'bad', glyph: '✗' });
    expect(lanes[4].markers[0].label).toBe('image: post-release');
    expect(lanes[2].markers[0].label).toBe('a1 click');
  });

  it('keeps non-after release reasons explicit', () => {
    const lanes = buildTrialLanes(
      [
        event(1, 'request.held', { ...TRIAL_BASE, requestId: 'early', status: 200, maxHoldMs: 1000 }),
        event(2, 'request.released', { ...TRIAL_BASE, requestId: 'early', reason: 'max-hold-exceeded' }),
      ],
      detail,
    );
    expect(lanes[0].markers.map((m) => m.label)).toEqual([
      'held',
      'released (max-hold-exceeded)',
    ]);
  });
});

describe('race clock', () => {
  const lanes = buildTrialLanes(
    [
      event(1, 'request.started', { ...TRIAL_BASE, requestId: 'early', method: 'GET', url: 'http://x/a' }),
      event(2, 'request.released', { ...TRIAL_BASE, requestId: 'early', reason: 'after-late' }),
      event(16, 'assertion.evaluated', { ...TRIAL_BASE, assertionId: 'final', passed: false, expected: 'b', observed: 'a' }),
    ],
    detail,
  );

  it('fits the scale to requests and actions, not the long-tail check', () => {
    // Marker times are sequence seconds: race ends at 2s, check at 16s.
    expect(raceClockFitMax(lanes)).toBe(2000);
  });

  it('keeps immediate evidence in the window but not the failure image', () => {
    const withEvidence = buildTrialLanes(
      [
        event(1, 'request.started', { ...TRIAL_BASE, requestId: 'early', method: 'GET', url: 'http://x/a' }),
        event(2, 'screenshot.captured', { ...TRIAL_BASE, artifactId: 'a1', filename: 'post.png', label: 'post-release' }),
        event(3, 'screenshot.captured', { ...TRIAL_BASE, artifactId: 'a2', filename: 'fail.png', label: 'assertion-failed' }),
      ],
      detail,
    );
    expect(raceClockFitMax(withEvidence)).toBe(2000);
  });

  it('clamps late markers to the rail end', () => {
    expect(clockFraction(1000, 1000, 2000)).toBe(0);
    expect(clockFraction(1500, 1000, 2000)).toBe(0.5);
    expect(clockFraction(2000, 1000, 2000)).toBe(1);
    expect(clockFraction(16000, 1000, 2000)).toBe(1);
  });

  it('centers a single instant and tolerates an empty race', () => {
    expect(clockFraction(1000, 1000, 1000)).toBe(0.5);
    expect(raceClockFitMax([])).toBeNull();
  });
});
