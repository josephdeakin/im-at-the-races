'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { isTerminalRunStatus, type Run, type RunEvent, type RunStatus } from '@races/contracts';
import { formatDateTime, shortId } from '@/lib/format';
import { StatusBadge } from './StatusBadge';
import { dangerButtonClassName } from './form';

const POLL_INTERVAL_MS = 1500;

interface EventsResponse {
  runId: string;
  status: RunStatus;
  phase: string;
  events: RunEvent[];
  nextAfter: number;
}

/**
 * Live run view: polls the cursor endpoint for persisted events.
 * - never overlaps requests (in-flight guard)
 * - deduplicates by sequence number
 * - stops polling once the run reaches a terminal status
 */
export function RunMonitor({
  initialRun,
  initialEvents,
  initialNextAfter,
}: {
  initialRun: Run;
  initialEvents: RunEvent[];
  initialNextAfter: number;
}) {
  const [run, setRun] = useState(initialRun);
  const [events, setEvents] = useState<RunEvent[]>(initialEvents);
  const [pollError, setPollError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const seenRef = useRef<Set<number>>(new Set(initialEvents.map((e) => e.sequence)));
  const afterRef = useRef<number>(initialNextAfter);
  const inFlightRef = useRef(false);
  const statusRef = useRef<RunStatus>(initialRun.status);
  statusRef.current = run.status;

  const fetchPage = useCallback(async (): Promise<boolean> => {
    const res = await fetch(`/api/runs/${initialRun.id}/events?after=${afterRef.current}`, {
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`events request failed (${res.status})`);
    const data = (await res.json()) as EventsResponse;
    const fresh = data.events.filter((event) => {
      if (seenRef.current.has(event.sequence)) return false;
      seenRef.current.add(event.sequence);
      return true;
    });
    if (fresh.length > 0) {
      setEvents((prev) =>
        [...prev, ...fresh].sort((a, b) => a.sequence - b.sequence),
      );
    }
    afterRef.current = data.nextAfter;
    setRun((prev) =>
      prev.status === data.status && prev.phase === data.phase
        ? prev
        : { ...prev, status: data.status, phase: data.phase },
    );
    return isTerminalRunStatus(data.status);
  }, [initialRun.id]);

  useEffect(() => {
    if (isTerminalRunStatus(statusRef.current)) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      if (stopped || inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const terminal = await fetchPage();
        setPollError(null);
        if (!terminal && !stopped) timer = setTimeout(poll, POLL_INTERVAL_MS);
      } catch {
        if (!stopped) {
          setPollError('Live updates paused: could not reach the server. Retrying…');
          timer = setTimeout(poll, POLL_INTERVAL_MS);
        }
      } finally {
        inFlightRef.current = false;
      }
    };
    timer = setTimeout(poll, POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [fetchPage]);

  async function onCancel() {
    setCancelling(true);
    setCancelError(null);
    try {
      const res = await fetch(`/api/runs/${initialRun.id}/cancel`, { method: 'POST' });
      const body = (await res.json().catch(() => null)) as { run?: Run } | null;
      if (!res.ok || !body?.run) {
        setCancelError('Cancellation failed. Please try again.');
        return;
      }
      setRun(body.run);
      try {
        await fetchPage();
      } catch {
        // Non-fatal: the next poll (or reload) picks the event up.
      }
    } catch {
      setCancelError('Could not reach the server.');
    } finally {
      setCancelling(false);
    }
  }

  const terminal = isTerminalRunStatus(run.status);

  return (
    <div className="space-y-6">
      <section
        aria-label="Run status"
        className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-stone-200 bg-white p-4"
      >
        <StatusBadge status={run.status} />
        <p className="text-sm text-stone-600">
          Phase <span className="font-mono text-stone-900">{run.phase}</span>
        </p>
        {!terminal && (
          <div className="ml-auto flex items-center gap-3">
            {cancelError && (
              <p role="alert" className="text-sm text-red-700">
                {cancelError}
              </p>
            )}
            <button
              type="button"
              onClick={onCancel}
              disabled={cancelling}
              className={dangerButtonClassName}
            >
              {cancelling ? 'Cancelling…' : 'Cancel run'}
            </button>
          </div>
        )}
        {terminal && run.status === 'cancelled' && (
          <p className="ml-auto text-sm text-stone-500">This run was cancelled.</p>
        )}
      </section>

      {run.status === 'queued' && (
        <section
          aria-label="Executor notice"
          className="rounded-lg border border-stone-200 bg-white p-4 text-sm text-stone-600"
        >
          <p className="font-medium text-stone-900">Execution engine not connected yet</p>
          <p className="mt-1">
            This run will remain queued. Once the experiment engine is integrated, a worker will
            claim it and stream progress into the activity feed below.
          </p>
        </section>
      )}

      <section aria-label="Activity">
        <h2 className="text-sm font-semibold text-stone-900">Activity</h2>
        {pollError && (
          <p role="status" className="mt-2 text-sm text-amber-700">
            {pollError}
          </p>
        )}
        {events.length === 0 ? (
          <p className="mt-2 rounded-lg border border-dashed border-stone-300 bg-white px-4 py-6 text-center text-sm text-stone-500">
            No activity recorded yet.
          </p>
        ) : (
          <ol className="mt-2 divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white">
            {events.map((event) => (
              <li key={event.sequence} className="px-4 py-3">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-mono text-xs text-stone-400">
                    #{event.sequence} · {shortId(event.id)}
                  </span>
                  <span className="font-mono text-sm font-medium text-stone-900">{event.kind}</span>
                  <span className="ml-auto text-xs text-stone-500">
                    {formatDateTime(event.createdAt)}
                  </span>
                </div>
                {Object.keys(event.payload).length > 0 && (
                  <details className="mt-1.5">
                    <summary className="cursor-pointer text-xs text-sky-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700">
                      Event details
                    </summary>
                    <pre className="mt-1.5 overflow-x-auto rounded-md bg-stone-50 p-3 font-mono text-xs text-stone-700">
                      {JSON.stringify(event.payload, null, 2)}
                    </pre>
                  </details>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
