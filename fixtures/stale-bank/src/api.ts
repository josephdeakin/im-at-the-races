export interface BalanceResponse {
  balanceCents: number;
}

export interface TransferResponse {
  transferId: number;
  to: string;
  amountCents: number;
  delayMs: number;
  balanceCents: number;
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

export async function balanceRequest(signal?: AbortSignal): Promise<BalanceResponse> {
  const res = await fetch('/api/balance', { signal });
  if (!res.ok) throw new Error(await parseError(res));
  return (await res.json()) as BalanceResponse;
}

export async function resetRequest(signal?: AbortSignal): Promise<BalanceResponse> {
  const res = await fetch('/api/reset', { method: 'POST', signal });
  if (!res.ok) throw new Error(await parseError(res));
  return (await res.json()) as BalanceResponse;
}

export async function transferRequest(
  amountCents: number,
  to: string,
  delayMs: number,
  signal?: AbortSignal,
): Promise<TransferResponse> {
  const res = await fetch('/api/transfer', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ amountCents, to, delay: delayMs }),
    signal,
  });
  if (!res.ok) throw new Error(await parseError(res));
  return (await res.json()) as TransferResponse;
}
