import { requestIdOf, type RunEvent, type TrialDetail } from '@races/contracts';

export interface LaneMarker {
  sequence: number;
  at: number;
  label: string;
  glyph: string;
  tone: 'accent' | 'bad' | 'good' | 'muted';
}

export interface LaneSpan {
  fromSequence: number;
  toSequence: number | null;
  label: string;
}

export interface Lane {
  id: string;
  label: string;
  sublabel: string | null;
  markers: LaneMarker[];
  spans: LaneSpan[];
}

function at(event: RunEvent): number {
  const ms = Date.parse(event.createdAt);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Group trial events into display lanes: one per logical request (in plan
 * order when the trial detail is available), plus action, check, and
 * evidence lanes. Pure: the component only positions markers on a time scale.
 */
export function buildTrialLanes(events: RunEvent[], detail: TrialDetail | null): Lane[] {
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
  const lanes: Lane[] = [];

  const requestIds: string[] = [];
  if (detail) {
    for (const record of detail.requests) {
      if (!requestIds.includes(record.id)) requestIds.push(record.id);
    }
  }
  for (const event of ordered) {
    if (!event.kind.startsWith('request.')) continue;
    const id = requestIdOf(event);
    if (id && !requestIds.includes(id)) requestIds.push(id);
  }
  const records = new Map((detail?.requests ?? []).map((r) => [r.id, r]));
  for (const id of requestIds) {
    const markers: LaneMarker[] = [];
    const spans: LaneSpan[] = [];
    let holdStart: number | null = null;
    for (const event of ordered) {
      if (requestIdOf(event) !== id) continue;
      switch (event.kind) {
        case 'request.started':
          markers.push({ sequence: event.sequence, at: at(event), label: 'started', glyph: '○', tone: 'muted' });
          break;
        case 'request.captured':
          markers.push({
            sequence: event.sequence,
            at: at(event),
            label: `captured ${event.payload.status}`,
            glyph: '●',
            tone: 'muted',
          });
          break;
        case 'request.held':
          holdStart = event.sequence;
          markers.push({ sequence: event.sequence, at: at(event), label: 'held', glyph: '▮', tone: 'accent' });
          break;
        case 'request.released':
          markers.push({
            sequence: event.sequence,
            at: at(event),
            label: `released (${event.payload.reason})`,
            glyph: '▶',
            tone: 'accent',
          });
          if (holdStart !== null) {
            spans.push({ fromSequence: holdStart, toSequence: event.sequence, label: 'held' });
            holdStart = null;
          }
          break;
        default:
          break;
      }
      if (event.kind === 'trigger.satisfied' && event.payload.requestId === id) {
        markers.push({ sequence: event.sequence, at: at(event), label: 'trigger satisfied', glyph: '◆', tone: 'accent' });
      }
    }
    if (holdStart !== null) {
      spans.push({ fromSequence: holdStart, toSequence: null, label: 'held (no release recorded)' });
    }
    const record = records.get(id);
    lanes.push({
      id: `request:${id}`,
      label: `Request ${id}`,
      sublabel: record ? `${record.method} ${record.url}`.slice(0, 120) : null,
      markers,
      spans,
    });
  }

  const actions: LaneMarker[] = [];
  for (const event of ordered) {
    if (event.kind !== 'action.performed') continue;
    actions.push({
      sequence: event.sequence,
      at: at(event),
      label: event.payload.actionId,
      glyph: '⬔',
      tone: 'muted',
    });
  }
  if (actions.length > 0) {
    lanes.push({ id: 'actions', label: 'Actions', sublabel: null, markers: actions, spans: [] });
  }

  const checks: LaneMarker[] = [];
  for (const event of ordered) {
    if (event.kind !== 'assertion.evaluated') continue;
    const passed = event.payload.passed;
    checks.push({
      sequence: event.sequence,
      at: at(event),
      label: `${passed ? '✓' : '✗'} ${event.payload.assertionId}`,
      glyph: passed ? '✓' : '✗',
      tone: passed ? 'good' : 'bad',
    });
  }
  if (checks.length > 0) {
    lanes.push({ id: 'checks', label: 'Checks', sublabel: null, markers: checks, spans: [] });
  }

  const evidence: LaneMarker[] = [];
  for (const event of ordered) {
    if (event.kind === 'screenshot.captured') {
      evidence.push({
        sequence: event.sequence,
        at: at(event),
        label: `image: ${event.payload.label}`,
        glyph: '▣',
        tone: 'muted',
      });
    } else if (event.kind === 'values.captured') {
      evidence.push({
        sequence: event.sequence,
        at: at(event),
        label: 'recorded values',
        glyph: '≣',
        tone: 'muted',
      });
    }
  }
  if (evidence.length > 0) {
    lanes.push({ id: 'evidence', label: 'Evidence', sublabel: null, markers: evidence, spans: [] });
  }

  return lanes;
}
