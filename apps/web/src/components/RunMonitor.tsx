'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { isTerminalRunStatus, type Run, type RunEvent, type RunStatus } from '@races/contracts';
import { Card } from '@astryxdesign/core/Card';
import { CodeBlock } from '@astryxdesign/core/CodeBlock';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { List, ListItem } from '@astryxdesign/core/List';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { formatDateTime, shortId } from '@/lib/format';

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
  const [events, setEvents] = useState<RunEvent[]>(initialEvents);
  const [pollError, setPollError] = useState<string | null>(null);

  const seenRef = useRef<Set<number>>(new Set(initialEvents.map((e) => e.sequence)));
  const afterRef = useRef<number>(initialNextAfter);
  const inFlightRef = useRef(false);
  const statusRef = useRef<RunStatus>(initialRun.status);

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
    statusRef.current = data.status;
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

  return (
    <VStack gap={4}>
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
