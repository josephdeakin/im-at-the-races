import { describe, expect, it, vi } from 'vitest';
import type { RunEventRow } from '@races/db';
import { toRunEventJson, toRunEventJsonSafe } from './serializers';

vi.mock('server-only', () => ({}));

function row(overrides: Record<string, unknown> = {}): RunEventRow {
  return {
    id: 'evt-1',
    runId: 'run-1',
    sequence: 7,
    kind: 'run.log',
    payload: { message: 'hello' },
    createdAt: 1_760_000_000_000,
    ...overrides,
  } as RunEventRow;
}

describe('toRunEventJsonSafe', () => {
  it('passes well-formed rows through the strict serializer', () => {
    expect(toRunEventJsonSafe(row())).toMatchObject({
      kind: 'run.log',
      payload: { message: 'hello' },
      sequence: 7,
    });
  });

  it('degrades a corrupt payload in place, keeping the cursor sequence', () => {
    const safe = toRunEventJsonSafe(row({ payload: { message: 42 } }));
    expect(safe.sequence).toBe(7);
    expect(safe.kind).toBe('run.log');
    if (safe.kind === 'run.log') {
      expect(safe.payload.message).toContain('could not be parsed');
    }
  });

  it('degrades an unknown stored kind instead of throwing', () => {
    const safe = toRunEventJsonSafe(row({ kind: 'run.exploded', payload: {} }));
    expect(safe.kind).toBe('run.log');
    expect(() => toRunEventJson(row({ kind: 'run.exploded', payload: {} }))).toThrow();
  });
});
