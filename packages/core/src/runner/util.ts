export class AbortError extends Error {
  constructor(message = 'aborted') {
    super(message);
    this.name = 'AbortError';
  }
}

export function isAbortError(err: unknown): boolean {
  return (
    err instanceof AbortError || (err instanceof Error && err.name === 'AbortError')
  );
}

/** Thrown by artifact stores when a run exceeds its evidence byte budget. */
export class CapacityError extends Error {
  constructor(message = 'artifact capacity exhausted') {
    super(message);
    this.name = 'CapacityError';
  }
}

export function isCapacityError(err: unknown): boolean {
  return err instanceof CapacityError || (err instanceof Error && err.name === 'CapacityError');
}

/** Sleep that rejects with AbortError when the signal fires first. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new AbortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AbortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Poll `check` every `intervalMs` until it returns non-null, the timeout
 * elapses (returns null), or the signal aborts (rejects AbortError).
 */
export async function pollFor<T>(
  check: () => T | null | Promise<T | null>,
  timeoutMs: number,
  signal: AbortSignal,
  intervalMs = 100,
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    signal.throwIfAborted();
    const result = await check();
    if (result !== null) return result;
    if (Date.now() >= deadline) return null;
    await sleep(Math.min(intervalMs, Math.max(0, deadline - Date.now())), signal);
  }
}
