import { describe, expect, it } from 'vitest';
import type { RunEvent, TrialDetail } from '@races/contracts';
import { buildTrialLanes } from './timeline';

function event(sequence: number, kind: string, payload: Record<string, unknown> = {}): RunEvent {
  return {
    id: `event-${sequence}`,
    runId: 'run-1',
    sequence,
    kind,
    payload: { trialId: 'trial-1', ...payload },
    createdAt: new Date(sequence * 1000).toISOString(),
  };
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
        event(1, 'request.started', { requestId: 'early' }),
        event(2, 'request.captured', { requestId: 'early', status: 200 }),
        event(3, 'request.held', { requestId: 'early' }),
        event(4, 'request.captured', { requestId: 'late', status: 200 }),
        event(5, 'trigger.satisfied', { requestId: 'early', afterResponse: 'late' }),
        event(6, 'request.released', { requestId: 'early', reason: 'after-late' }),
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
      'released (after-late)',
    ]);
    expect(early.spans).toEqual([{ fromSequence: 3, toSequence: 6, label: 'held' }]);
    expect(lanes[1].markers.map((m) => m.label)).toEqual(['captured 200']);
  });

  it('marks an unreleased hold and groups actions, checks, and evidence', () => {
    const lanes = buildTrialLanes(
      [
        event(1, 'action.performed', { actionId: 'a1' }),
        event(2, 'request.held', { requestId: 'early' }),
        event(3, 'assertion.evaluated', { assertionId: 'final', passed: false }),
        event(4, 'screenshot.captured', { label: 'post-release' }),
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
  });
});
