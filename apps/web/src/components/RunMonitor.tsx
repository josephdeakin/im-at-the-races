'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { isTerminalRunStatus, type Run, type RunEvent, type RunStatus } from '@races/contracts';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { CodeBlock } from '@astryxdesign/core/CodeBlock';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { List, ListItem } from '@astryxdesign/core/List';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { formatDateTime, shortId } from '@/lib/format';
import { StatusBadge } from './StatusBadge';

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
    <VStack gap={4}>
      <Card>
        <HStack gap={3} justify="between" wrap="wrap">
          <HStack gap={3}>
            <StatusBadge status={run.status} />
            <Text>
              Phase <Text type="code">{run.phase}</Text>
            </Text>
          </HStack>
          {!terminal && (
            <HStack gap={3}>
              {cancelError && (
                <Text type="supporting">
                  <span role="alert">{cancelError}</span>
                </Text>
              )}
              <Button
                variant="destructive"
                label={cancelling ? 'Cancelling run' : 'Cancel run'}
                onClick={onCancel}
                isLoading={cancelling}
              />
            </HStack>
          )}
          {terminal && run.status === 'cancelled' && (
            <Text type="supporting">This run was cancelled.</Text>
          )}
        </HStack>
      </Card>

      {run.status === 'queued' && (
        <Banner
          status="info"
          title="Waiting for a worker to claim this run"
          description={
            <>
              If this persists, the worker process is not running. Start it with{' '}
              <Text type="code">pnpm dev:worker</Text> (or <Text type="code">pnpm dev</Text> for
              web and worker together).
            </>
          }
        />
      )}

      <VStack gap={2}>
        <Heading level={2}>Activity</Heading>
        {pollError && (
          <Text type="supporting">
            <span role="status">{pollError}</span>
          </Text>
        )}
        {events.length === 0 ? (
          <Card variant="muted">
            <Text type="supporting" justify="center">
              No activity recorded yet.
            </Text>
          </Card>
        ) : (
          <Card>
            <List hasDividers edge="bleed">
              {events.map((event) => (
                <ListItem
                  key={event.sequence}
                  label={
                    <HStack gap={2} justify="between" wrap="wrap">
                      <HStack gap={2}>
                        <Text type="code">
                          #{event.sequence} · {shortId(event.id)}
                        </Text>
                        <Text type="code" weight="medium">
                          {event.kind}
                        </Text>
                      </HStack>
                      <Text type="supporting">{formatDateTime(event.createdAt)}</Text>
                    </HStack>
                  }
                  description={
                    Object.keys(event.payload).length > 0 ? (
                      <Collapsible trigger={<Text type="supporting">Event details</Text>}>
                        <CodeBlock
                          code={JSON.stringify(event.payload, null, 2)}
                          language="json"
                        />
                      </Collapsible>
                    ) : undefined
                  }
                />
              ))}
            </List>
          </Card>
        )}
      </VStack>
    </VStack>
  );
}
