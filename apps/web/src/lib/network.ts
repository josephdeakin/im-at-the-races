import type { RunEvent, TrialRequestRecord } from '@races/contracts';

export interface RequestTrafficRow {
  id: string;
  method: string;
  url: string;
  matched: boolean;
  held: boolean;
  released: boolean;
  status: number | null;
  excerpt: string | null;
  truncated: boolean;
  startedAt: number | null;
  capturedAt: number | null;
  heldAt: number | null;
  releasedAt: number | null;
}

/**
 * Join trial request records (what matched, response excerpts) with the
 * trial's request events (when each milestone fired). Callers pass events
 * already filtered to the trial; first occurrence per milestone wins.
 */
export function joinRequestTraffic(
  requests: TrialRequestRecord[],
  events: RunEvent[],
): RequestTrafficRow[] {
  const at = new Map<string, { started?: number; captured?: number; held?: number; released?: number }>();
  for (const event of events) {
    const payload = event.payload as { requestId?: unknown };
    if (typeof payload.requestId !== 'string') continue;
    const slot = event.kind === 'request.started'
      ? 'started'
      : event.kind === 'request.captured'
        ? 'captured'
        : event.kind === 'request.held'
          ? 'held'
          : event.kind === 'request.released'
            ? 'released'
            : null;
    if (slot === null) continue;
    const entry = at.get(payload.requestId) ?? {};
    entry[slot] ??= Date.parse(event.createdAt);
    at.set(payload.requestId, entry);
  }
  return requests.map((request) => {
    const timing = at.get(request.id) ?? {};
    return {
      id: request.id,
      method: request.method,
      url: request.url,
      matched: request.matched,
      held: request.held,
      released: request.released,
      status: request.status,
      excerpt: request.responseExcerpt,
      truncated: request.responseTruncated,
      startedAt: timing.started ?? null,
      capturedAt: timing.captured ?? null,
      heldAt: timing.held ?? null,
      releasedAt: timing.released ?? null,
    };
  });
}
