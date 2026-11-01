export interface OddsSnapshot {
  version: number;
  price: string | null;
}

export interface OddsMessage {
  type: 'odds';
  requestId: number | string | null;
  version: number;
  price: string;
  delayMs: number;
  servedAt: string;
}

async function parseError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (typeof body.error === 'string' && body.error !== '') return body.error;
  } catch {
    // Fall through to the status-based message.
  }
  return `request failed: ${res.status}`;
}

export async function resetRequest(signal?: AbortSignal): Promise<OddsSnapshot> {
  const res = await fetch('/api/reset', { method: 'POST', signal });
  if (!res.ok) throw new Error(await parseError(res));
  return (await res.json()) as OddsSnapshot;
}

export async function oddsSnapshotRequest(signal?: AbortSignal): Promise<OddsSnapshot> {
  const res = await fetch('/api/odds', { signal });
  if (!res.ok) throw new Error(await parseError(res));
  return (await res.json()) as OddsSnapshot;
}

export function oddsSocketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${window.location.host}/api/odds`;
}

export function sendSubscribe(socket: WebSocket, requestId: number, delayMs: number): void {
  socket.send(JSON.stringify({ type: 'subscribe', requestId, delay: delayMs }));
}

/** Parse an inbound socket frame; null when it is not an odds update. */
export function parseOddsMessage(data: unknown): OddsMessage | null {
  if (typeof data !== 'string') return null;
  let body: { type?: unknown; requestId?: unknown; version?: unknown; price?: unknown };
  try {
    body = JSON.parse(data) as typeof body;
  } catch {
    return null;
  }
  if (body.type !== 'odds') return null;
  if (typeof body.version !== 'number' || typeof body.price !== 'string') return null;
  return body as OddsMessage;
}
