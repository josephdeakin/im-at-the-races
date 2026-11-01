import { describe, expect, it } from 'vitest';
import { RunEventSchema, type RunEvent } from '@races/contracts';
import { modelBadgeFromEvents, visionNotesFromEvents } from './model-badge';

let sequence = 0;
function logEvent(message: string): RunEvent {
  sequence += 1;
  return RunEventSchema.parse({
    id: `event-${sequence}`,
    runId: 'run-1',
    sequence,
    kind: 'run.log',
    payload: { message },
    warnings: [],
    createdAt: new Date().toISOString(),
  }) as RunEvent;
}

describe('modelBadgeFromEvents', () => {
  it('labels Muse Spark and surfaces recorded usage', () => {
    const info = modelBadgeFromEvents([
      logEvent('Agent investigation started (model muse-spark-1.3-contributor, source git:abc:clean).'),
      logEvent('Agent run finished. Repair: verified. Usage: 14 model calls, 1200 input / 340 output tokens.'),
    ]);
    expect(info.label).toBe('Muse Spark · muse-spark-1.3-contributor');
    expect(info.usageLine).toBe('14 model calls · 1200 in / 340 out tokens');
  });

  it('extracts labelled vision notes and gaps', () => {
    expect(
      visionNotesFromEvents([
        logEvent('Vision (Muse Spark model explanation, not evidence): Balance shows $70.00.'),
        logEvent('something else'),
        logEvent('Vision: unavailable (boom). Findings stand on recorded values and assertions.'),
      ]),
    ).toHaveLength(2);
  });

  it('falls back honestly when no model was recorded', () => {
    expect(modelBadgeFromEvents([])).toEqual({
      modelId: null,
      label: 'Model not recorded',
      usageLine: null,
    });
  });
});
