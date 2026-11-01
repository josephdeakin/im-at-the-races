import { describe, expect, it } from 'vitest';
import type { RunEvent } from '@races/contracts';
import { RunEventSchema } from '@races/contracts';
import { joinRequestTraffic } from './network';

let sequence = 0;

function event(
  atMs: number,
  kind: 'request.started' | 'request.captured' | 'request.held' | 'request.released',
  payload: Record<string, unknown>,
): RunEvent {
  sequence += 1;
  return RunEventSchema.parse({
    id: `event-${sequence}`,
    runId: 'run-1',
    sequence,
    kind,
    payload: { experimentId: 'exp-1', trialId: 'trial-1', trialKind: 'intervention', ...payload },
    warnings: [],
    createdAt: new Date(atMs).toISOString(),
  }) as RunEvent;
}

const REQUESTS = [
  {
    id: 'early', method: 'POST', url: 'http://x/api/transfer', matched: true,
    held: true, released: true, status: 200,
    responseExcerpt: '{"balanceCents":7000}', responseTruncated: false,
  },
  {
    id: 'later', method: 'POST', url: 'http://x/api/transfer', matched: true,
    held: false, released: false, status: 200,
    responseExcerpt: null, responseTruncated: false,
  },
];

describe('joinRequestTraffic', () => {
  it('joins record metadata with event timing per request', () => {
    const rows = joinRequestTraffic(REQUESTS, [
      event(1000, 'request.started', { requestId: 'early', method: 'POST', url: 'http://x/api/transfer' }),
      event(1100, 'request.started', { requestId: 'later', method: 'POST', url: 'http://x/api/transfer' }),
      event(1400, 'request.captured', { requestId: 'early', status: 200, held: true }),
      event(1500, 'request.captured', { requestId: 'later', status: 200, held: false }),
      event(1410, 'request.held', { requestId: 'early', status: 200, maxHoldMs: 15000 }),
      event(2000, 'request.released', { requestId: 'early', reason: 'after-later' }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: 'early', method: 'POST', status: 200, held: true, released: true,
      excerpt: '{"balanceCents":7000}',
      startedAt: 1000, capturedAt: 1400, heldAt: 1410, releasedAt: 2000,
    });
    expect(rows[1]).toMatchObject({
      id: 'later', startedAt: 1100, capturedAt: 1500, heldAt: null, releasedAt: null,
    });
  });

  it('tolerates missing events and unmatched records', () => {
    const rows = joinRequestTraffic(
      [{ ...REQUESTS[0], matched: false, status: null }],
      [],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ startedAt: null, capturedAt: null, status: null });
  });
});
