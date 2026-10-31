'use client';

import { useEffect, useMemo, useState } from 'react';
import type {
  RepairAttempt,
  RunEvent,
  Trial,
  TrialAssertionResult,
} from '@races/contracts';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Grid } from '@astryxdesign/core/Grid';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Table } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { buildTrialLanes, type Lane } from '@/lib/timeline';
import type { CompareSide } from '@/lib/evidence-compare';
import { LaneTrack } from './TrialRail';

interface TrialEventsResponse {
  runId: string;
  trialId: string;
  events: RunEvent[];
}

function latestScreenshot(events: RunEvent[]): Extract<RunEvent, { kind: 'screenshot.captured' }> | null {
  let best: Extract<RunEvent, { kind: 'screenshot.captured' }> | null = null;
  for (const event of events) {
    if (event.kind !== 'screenshot.captured') continue;
    if (!best || event.sequence > best.sequence) best = event;
  }
  return best;
}

function CompareShot({ label, event }: {
  label: string;
  event: Extract<RunEvent, { kind: 'screenshot.captured' }> | null;
}) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [event?.id]);
  return (
    <VStack gap={1}>
      <Text weight="medium">{label}</Text>
      {event && !broken ? (
        <a href={`/api/artifacts/${event.payload.artifactId}`} target="_blank" rel="noreferrer">
          <img
            src={`/api/artifacts/${event.payload.artifactId}`}
            alt={`Recorded browser screenshot, ${label} (${event.payload.label})`}
            onError={() => setBroken(true)}
            className="aspect-video w-full rounded-md object-cover object-top"
          />
        </a>
      ) : (
        <Card variant="muted">
          <Text type="supporting" justify="center">
            {event ? 'Screenshot file is missing from local evidence.' : 'No screenshot recorded.'}
          </Text>
        </Card>
      )}
    </VStack>
  );
}

function AssertionCell({ result }: { result: TrialAssertionResult | null }) {
  if (!result) return <Text type="supporting">not recorded</Text>;
  return (
    <VStack gap={1}>
      <Badge variant={result.passed ? 'success' : 'error'} label={result.passed ? 'Passed' : 'Failed'} />
      <Text type="code">
        {result.observed ?? '—'} <Text type="supporting">(expected {result.expected})</Text>
      </Text>
    </VStack>
  );
}

function storyLanes(events: RunEvent[], trial: Trial): Lane[] {
  return buildTrialLanes(events, trial.detail).filter(
    (lane) => lane.id === 'checks' || lane.id.startsWith('request:'),
  );
}

function FullCompare({
  runId,
  attempt,
  before,
  after,
  onOpenTrial,
}: {
  runId: string;
  attempt: RepairAttempt;
  before: CompareSide;
  after: CompareSide & { checkName: string };
  onOpenTrial: (trialId: string) => void;
}) {
  const [events, setEvents] = useState<{ before: RunEvent[]; after: RunEvent[] } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let stopped = false;
    setEvents(null);
    setFailed(false);
    const load = async (trialId: string): Promise<RunEvent[]> => {
      const res = await fetch(`/api/runs/${runId}/trials/${trialId}/events`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`events for ${trialId}: ${res.status}`);
      return ((await res.json()) as TrialEventsResponse).events;
    };
    Promise.all([load(before.trial.id), load(after.trial.id)])
      .then(([beforeEvents, afterEvents]) => {
        if (!stopped) setEvents({ before: beforeEvents, after: afterEvents });
      })
      .catch(() => {
        if (!stopped) setFailed(true);
      });
    return () => {
      stopped = true;
    };
  }, [runId, before.trial.id, after.trial.id]);

  const assertionRows = useMemo(() => {
    const ids: string[] = [];
    for (const result of before.trial.detail?.assertions ?? []) {
      if (!ids.includes(result.id)) ids.push(result.id);
    }
    for (const result of after.trial.detail?.assertions ?? []) {
      if (!ids.includes(result.id)) ids.push(result.id);
    }
    const find = (trial: Trial, id: string): TrialAssertionResult | null =>
      trial.detail?.assertions.find((result) => result.id === id) ?? null;
    return ids.map((id) => ({ id, before: find(before.trial, id), after: find(after.trial, id) }));
  }, [before.trial, after.trial]);

  // One scale for both sides: each trial starts at its own first event and
  // the rail spans the longer of the two durations.
  const scales = useMemo(() => {
    if (!events) return null;
    const beforeLanes = storyLanes(events.before, before.trial);
    const afterLanes = storyLanes(events.after, after.trial);
    const times = (lanes: Lane[]): number[] =>
      lanes.flatMap((lane) => lane.markers.map((marker) => marker.at));
    const beforeTimes = times(beforeLanes);
    const afterTimes = times(afterLanes);
    if (beforeTimes.length === 0 || afterTimes.length === 0) {
      return { beforeLanes, afterLanes, spanMs: 0, beforeMin: 0, afterMin: 0 };
    }
    const beforeMin = Math.min(...beforeTimes);
    const afterMin = Math.min(...afterTimes);
    const spanMs = Math.max(
      1,
      Math.max(...beforeTimes) - beforeMin,
      Math.max(...afterTimes) - afterMin,
    );
    return { beforeLanes, afterLanes, spanMs, beforeMin, afterMin };
  }, [events, before.trial, after.trial]);

  return (
    <VStack gap={3}>
      <VStack gap={1}>
        <Text type="supporting">
          Attempt {attempt.attempt}: {before.experimentName} (original app) vs {after.checkName}{' '}
          on {after.experimentName} (patched app).
        </Text>
      </VStack>

      <VStack gap={1}>
        <Heading level={4}>Assertions</Heading>
        {assertionRows.length === 0 ? (
          <Text type="supporting">Neither trial recorded assertion results.</Text>
        ) : (
          <Table
            data={assertionRows}
            columns={[
              {
                key: 'check',
                header: 'Check',
                renderCell: (row) => <Text type="code">{row.id}</Text>,
              },
              {
                key: 'before',
                header: `Before · ${before.trial.outcome ?? 'running'}`,
                renderCell: (row) => <AssertionCell result={row.before} />,
              },
              {
                key: 'after',
                header: `After · ${after.trial.outcome ?? 'running'}`,
                renderCell: (row) => <AssertionCell result={row.after} />,
              },
            ]}
          />
        )}
      </VStack>

      <VStack gap={1}>
        <Heading level={4}>Request timelines</Heading>
        {failed ? (
          <Text type="supporting">Could not load trial events for comparison.</Text>
        ) : !scales ? (
          <Text type="supporting">Loading trial events…</Text>
        ) : scales.spanMs === 0 ? (
          <Text type="supporting">One side has no timeline events yet.</Text>
        ) : (
          <VStack gap={3}>
            <Text type="supporting">
              One shared scale ({(scales.spanMs / 1000).toFixed(1)}s across the full rail);
              each side starts at its own first event. Select a row to open it in the timeline.
            </Text>
            {(
              [
                { side: before, lanes: scales.beforeLanes, t0: scales.beforeMin, title: 'Before' },
                { side: after, lanes: scales.afterLanes, t0: scales.afterMin, title: 'After' },
              ] as const
            ).map(({ side, lanes, t0, title }) => (
              <VStack gap={2} key={side.trial.id}>
                <HStack gap={2}>
                  <Heading level={5}>{title}</Heading>
                  <Button
                    variant="secondary"
                    size="sm"
                    label="Open full timeline"
                    onClick={() => onOpenTrial(side.trial.id)}
                  />
                </HStack>
                {lanes.length === 0 ? (
                  <Text type="supporting">No request or check events.</Text>
                ) : (
                  <VStack gap={2} as="ol">
                    {lanes.map((lane) => (
                      <VStack gap={1} key={lane.id} as="li">
                        <HStack gap={2}>
                          <Text weight="medium">{lane.label}</Text>
                          {lane.sublabel && <Text type="code">{lane.sublabel}</Text>}
                        </HStack>
                        <LaneTrack
                          lane={lane}
                          fraction={(at) => (at - t0) / scales.spanMs}
                          t0={t0}
                          selectedSequence={null}
                          onSelect={() => onOpenTrial(side.trial.id)}
                          actionLabel="Open in timeline"
                        />
                      </VStack>
                    ))}
                  </VStack>
                )}
              </VStack>
            ))}
          </VStack>
        )}
      </VStack>

      <VStack gap={1}>
        <Heading level={4}>Screenshots</Heading>
        {!events ? (
          <Text type="supporting">Loading trial events…</Text>
        ) : (
          <Grid columns={{ minWidth: 300, max: 2 }} gap={4}>
            <CompareShot label="Before" event={latestScreenshot(events.before)} />
            <CompareShot label="After" event={latestScreenshot(events.after)} />
          </Grid>
        )}
      </VStack>
    </VStack>
  );
}

export function EvidenceCompare({
  runId,
  attempt,
  before,
  after,
  onOpenTrial,
}: {
  runId: string;
  attempt: RepairAttempt;
  before: CompareSide | null;
  after: (CompareSide & { checkName: string }) | null;
  onOpenTrial: (trialId: string) => void;
}) {
  return (
    <Card>
      <VStack gap={3}>
        <Heading level={3}>Before / after</Heading>
        {!before || !after ? (
          <Text type="supporting">
            {!before && !after
              ? 'No before/after trials recorded yet.'
              : !before
                ? 'The finding’s source trial is not available; the patched side is ready below.'
                : 'Verification has not run a trial on the patched app yet.'}
          </Text>
        ) : (
          <FullCompare
            runId={runId}
            attempt={attempt}
            before={before}
            after={after}
            onOpenTrial={onOpenTrial}
          />
        )}
      </VStack>
    </Card>
  );
}
