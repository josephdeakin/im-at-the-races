'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  isTerminalRunStatus,
  requestIdOf,
  trialIdOf,
  type Experiment,
  type RunEvent,
  type RunStatus,
  type Trial,
} from '@races/contracts';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { CodeBlock } from '@astryxdesign/core/CodeBlock';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Grid } from '@astryxdesign/core/Grid';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { List, ListItem } from '@astryxdesign/core/List';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Selector } from '@astryxdesign/core/Selector';
import { Slider } from '@astryxdesign/core/Slider';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { formatDateTime } from '@/lib/format';
import { buildTrialLanes, clockFraction, raceClockFitMax, type Lane } from '@/lib/timeline';
import { NetworkPanel } from './NetworkPanel';
import { explainTrial } from '@/lib/explain';
import { LaneTrack, toneBadge } from './TrialRail';

export interface ExperimentWithTrials extends Experiment {
  trials: Trial[];
}

interface EventsResponse {
  runId: string;
  status: RunStatus;
  phase: string;
  events: RunEvent[];
  nextAfter: number;
}

interface ExperimentsResponse {
  runId: string;
  experiments: ExperimentWithTrials[];
}

const POLL_INTERVAL_MS = 1500;

function trialLabel(experiment: Experiment, trial: Trial): string {
  const attempt = trial.attempt === 0 ? 'initial' : `confirm ${trial.attempt}`;
  return `${experiment.name} · ${trial.kind} ${attempt} · ${trial.outcome ?? 'running'}`;
}

function defaultTrialId(experiments: ExperimentWithTrials[]): string | null {
  for (const experiment of experiments) {
    const violation = experiment.trials.find((t) => t.outcome === 'violation');
    if (violation) return violation.id;
  }
  return experiments[0]?.trials[0]?.id ?? null;
}

function defaultSequence(events: RunEvent[]): number | null {
  if (events.length === 0) return null;
  const failed = events.find(
    (e) => e.kind === 'assertion.evaluated' && e.payload.passed === false,
  );
  return (failed ?? events[events.length - 1]).sequence;
}

export function TimelineView({
  runId,
  initialExperiments,
  initialEvents,
  isTerminal,
  initialTrialId,
  focusRequest,
}: {
  runId: string;
  initialExperiments: ExperimentWithTrials[];
  initialEvents: RunEvent[];
  isTerminal: boolean;
  initialTrialId: string | null;
  focusRequest: { trialId: string; nonce: number } | null;
}) {
  const [experiments, setExperiments] = useState(initialExperiments);
  const [events, setEvents] = useState<RunEvent[]>(initialEvents);
  const [trialId, setTrialId] = useState<string | null>(() => {
    if (initialTrialId && initialExperiments.some((e) => e.trials.some((t) => t.id === initialTrialId))) {
      return initialTrialId;
    }
    return defaultTrialId(initialExperiments);
  });
  const [selectedSequence, setSelectedSequence] = useState<number | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  const seenRef = useRef<Set<string>>(new Set(initialEvents.map((e) => e.id)));
  const afterRef = useRef<number>(
    initialEvents.length > 0 ? initialEvents[initialEvents.length - 1].sequence : -1,
  );
  const experimentsJsonRef = useRef<string>(JSON.stringify(initialExperiments));

  // Live runs keep the timeline fed without a reload. A timeline opened
  // after completion still fetches once: the load-time snapshot may predate
  // every trial. Polling stops at the terminal tick instead of forever.
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      if (stopped) return;
      let terminal = isTerminal;
      try {
        const [eventsRes, experimentsRes] = await Promise.all([
          fetch(`/api/runs/${runId}/events?after=${afterRef.current}`, { cache: 'no-store' }),
          fetch(`/api/runs/${runId}/experiments`, { cache: 'no-store' }),
        ]);
        if (eventsRes.ok) {
          const data = (await eventsRes.json()) as EventsResponse;
          const fresh = data.events.filter((event) => {
            if (seenRef.current.has(event.id)) return false;
            seenRef.current.add(event.id);
            return true;
          });
          if (fresh.length > 0) {
            setEvents((prev) =>
              [...prev, ...fresh].sort((a, b) => a.sequence - b.sequence),
            );
          }
          afterRef.current = data.nextAfter;
          terminal = terminal || isTerminalRunStatus(data.status);
        }
        if (experimentsRes.ok) {
          const data = (await experimentsRes.json()) as ExperimentsResponse;
          const serialized = JSON.stringify(data.experiments);
          if (serialized !== experimentsJsonRef.current) {
            experimentsJsonRef.current = serialized;
            setExperiments(data.experiments);
          }
        }
        if (!stopped) {
          setPollError(
            eventsRes.ok && experimentsRes.ok
              ? null
              : 'Live updates paused: server error. Retrying…',
          );
        }
      } catch {
        if (!stopped) {
          setPollError('Live updates paused: could not reach the server. Retrying…');
        }
      }
      if (!stopped && !terminal) timer = setTimeout(poll, POLL_INTERVAL_MS);
    };
    timer = setTimeout(poll, POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId, isTerminal]);

  // Finding evidence links drive the selected trial.
  useEffect(() => {
    if (!focusRequest) return;
    setTrialId(focusRequest.trialId);
    setSelectedSequence(null);
    setPlaying(false);
  }, [focusRequest]);

  // Trials that arrive after mount (late-opened timeline on a live run)
  // still need a default selection; never override an explicit choice.
  useEffect(() => {
    if (trialId !== null) return;
    const fallback = defaultTrialId(experiments);
    if (fallback) setTrialId(fallback);
  }, [experiments, trialId]);

  const trial = useMemo(() => {
    for (const experiment of experiments) {
      const found = experiment.trials.find((t) => t.id === trialId);
      if (found) return found;
    }
    return null;
  }, [experiments, trialId]);

  const trialEvents = useMemo(() => {
    if (!trial) return [];
    return events
      .filter((e) => trialIdOf(e) === trial.id)
      .sort((a, b) => a.sequence - b.sequence);
  }, [events, trial]);

  useEffect(() => {
    setSelectedSequence((current) => {
      if (current !== null && trialEvents.some((e) => e.sequence === current)) return current;
      return defaultSequence(trialEvents);
    });
  }, [trialEvents]);

  const selectedIndex = trialEvents.findIndex((e) => e.sequence === selectedSequence);
  const selectedEvent = selectedIndex >= 0 ? trialEvents[selectedIndex] : null;

  const lanes: Lane[] = useMemo(
    () => buildTrialLanes(trialEvents, trial?.detail ?? null),
    [trialEvents, trial],
  );

  const timeBounds = useMemo(() => {
    const times: number[] = [];
    for (const lane of lanes) {
      for (const marker of lane.markers) times.push(marker.at);
    }
    if (times.length === 0) return null;
    return { min: Math.min(...times), max: Math.max(...times) };
  }, [lanes]);

  // Race clock: the rail fits the race; later checks pin at the end with
  // true offsets instead of crushing the race flat.
  const fitMax = useMemo(() => {
    if (!timeBounds) return null;
    return raceClockFitMax(lanes) ?? timeBounds.max;
  }, [lanes, timeBounds]);

  const fraction = (at: number): number => {
    if (!timeBounds || fitMax === null) return 0.5;
    return clockFraction(at, timeBounds.min, fitMax);
  };

  const pinnedCount = useMemo(() => {
    if (fitMax === null) return 0;
    let count = 0;
    for (const lane of lanes) {
      for (const marker of lane.markers) {
        if (marker.at > fitMax) count += 1;
      }
    }
    return count;
  }, [lanes, fitMax]);

  // Recorded playback: selection walks saved evidence, never re-executes.
  useEffect(() => {
    if (!playing) return;
    if (selectedIndex < 0 || selectedIndex >= trialEvents.length - 1) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(
      () => setSelectedSequence(trialEvents[selectedIndex + 1].sequence),
      1000 / speed,
    );
    return () => clearTimeout(timer);
  }, [playing, selectedIndex, trialEvents, speed]);

  const screenshotEvent = useMemo(() => {
    if (selectedSequence === null) return null;
    let best: Extract<RunEvent, { kind: 'screenshot.captured' }> | null = null;
    for (const event of trialEvents) {
      if (event.kind !== 'screenshot.captured' || event.sequence > selectedSequence) continue;
      if (!best || event.sequence > best.sequence) best = event;
    }
    return best;
  }, [trialEvents, selectedSequence]);

  const valuesEvent = useMemo(() => {
    if (selectedSequence === null) return null;
    let best: Extract<RunEvent, { kind: 'values.captured' }> | null = null;
    for (const event of trialEvents) {
      if (event.kind !== 'values.captured' || event.sequence > selectedSequence) continue;
      if (!best || event.sequence > best.sequence) best = event;
    }
    return best;
  }, [trialEvents, selectedSequence]);

  const explanation = useMemo(
    () => (trial ? explainTrial(trial, trialEvents) : null),
    [trial, trialEvents],
  );

  if (experiments.length === 0) {
    return (
      <EmptyState
        title="No experiments recorded yet"
        description={
          isTerminal
            ? 'This run finished without executing an experiment. The activity tab shows what happened.'
            : 'Trials will appear here once the agent runs its first experiment.'
        }
      />
    );
  }

  const selectTrial = (id: string) => {
    setTrialId(id);
    setSelectedSequence(null);
    setPlaying(false);
  };

  return (
    <VStack gap={4}>
      <HStack gap={3}>
        <Selector
          label="Trial"
          value={trialId ?? ''}
          onChange={selectTrial}
          options={experiments.map((experiment) => ({
            type: 'section' as const,
            title: experiment.name,
            options: experiment.trials.map((t) => ({
              value: t.id,
              label: trialLabel(experiment, t),
            })),
          }))}
        />
        {!isTerminal && (
          <Text type="supporting">
            <span role="status">{pollError ?? 'Updating live'}</span>
          </Text>
        )}
      </HStack>

      {trial && explanation && (
        <Banner
          status={explanation.tone === 'bad' ? 'error' : explanation.tone === 'good' ? 'success' : 'info'}
          title={explanation.headline}
          description={
            <VStack gap={2}>
              {explanation.detail && <Text type="code">{explanation.detail}</Text>}
              {explanation.links.length > 0 && (
                <HStack gap={2}>
                  {explanation.links.map((link) => (
                    <Button
                      key={link.eventSequence}
                      variant="secondary"
                      size="sm"
                      label={`Show: ${link.label}`}
                      onClick={() => {
                        setSelectedSequence(link.eventSequence);
                        setPlaying(false);
                      }}
                    />
                  ))}
                </HStack>
              )}
            </VStack>
          }
        />
      )}

      <Grid columns={{ minWidth: 300, max: 2 }} gap={4}>
        <VStack gap={4}>
          <ReplayControls
            playing={playing}
            setPlaying={setPlaying}
            selectedIndex={selectedIndex}
            trialEvents={trialEvents}
            setSelectedSequence={setSelectedSequence}
            speed={speed}
            setSpeed={setSpeed}
          />
          <Card>
            <VStack gap={3}>
              <Heading level={3}>Request timeline</Heading>
              {lanes.length === 0 ? (
                <Text type="supporting">No timeline events for this trial yet.</Text>
              ) : (
                <VStack gap={3} as="ol">
                  {lanes.map((lane) => (
                    <VStack gap={1} key={lane.id} as="li">
                      <HStack gap={2}>
                        <Text weight="medium">{lane.label}</Text>
                        {lane.sublabel && <Text type="code">{lane.sublabel}</Text>}
                      </HStack>
                      <LaneTrack
                        lane={lane}
                        fraction={fraction}
                        t0={timeBounds?.min ?? null}
                        fitMax={fitMax}
                        selectedSequence={selectedSequence}
                        onSelect={(sequence) => {
                          setSelectedSequence(sequence);
                          setPlaying(false);
                        }}
                      />
                    </VStack>
                  ))}
                </VStack>
              )}
              {timeBounds && fitMax !== null && (
                <Text type="supporting">
                  {pinnedCount > 0 ? (
                    <>
                      Race clock fits the race (
                      {((fitMax - timeBounds.min) / 1000).toFixed(1)}s window);{' '}
                      {pinnedCount} later marker{pinnedCount === 1 ? '' : 's'} → pinned hollow
                      at right with true offsets. Rows read top to bottom in time order; click
                      any row to inspect.
                    </>
                  ) : (
                    <>
                      {((timeBounds.max - timeBounds.min) / 1000).toFixed(1)}s of recorded
                      events on a shared relative time scale. Rows read top to bottom in time
                      order; click any row to inspect.
                    </>
                  )}
                </Text>
              )}
            </VStack>
          </Card>

          {trial !== null && (
            <NetworkPanel
              requests={trial.detail?.requests ?? []}
              events={trialEvents}
              t0={timeBounds?.min ?? null}
            />
          )}

          <VStack gap={2}>
            <Heading level={3}>Events</Heading>
            <Card>
              <List hasDividers edge="bleed">
                {trialEvents.map((event) => (
                  <ListItem
                    key={event.sequence}
                    label={
                      <HStack gap={2}>
                        <Text type="code">#{event.sequence}</Text>
                        <Text type="code" weight="medium">
                          {event.kind}
                        </Text>
                        <EventHint event={event} />
                      </HStack>
                    }
                    description={formatDateTime(event.createdAt)}
                    onSelect={() => {
                      setSelectedSequence(event.sequence);
                      setPlaying(false);
                    }}
                    isSelected={event.sequence === selectedSequence}
                  />
                ))}
              </List>
            </Card>
          </VStack>
        </VStack>

        <VStack gap={4}>
          <SnapshotPanel selectedEvent={selectedEvent} screenshotEvent={screenshotEvent} />
          {trial && (
            <InspectorPanel trial={trial} selectedEvent={selectedEvent} valuesEvent={valuesEvent} />
          )}
        </VStack>
      </Grid>
    </VStack>
  );
}

function ReplayControls({
  playing,
  setPlaying,
  selectedIndex,
  trialEvents,
  setSelectedSequence,
  speed,
  setSpeed,
}: {
  playing: boolean;
  setPlaying: (playing: boolean) => void;
  selectedIndex: number;
  trialEvents: RunEvent[];
  setSelectedSequence: (sequence: number | null) => void;
  speed: number;
  setSpeed: (speed: number) => void;
}) {
  return (
    <Card>
      <VStack gap={2}>
        <Heading level={3}>Replay controls</Heading>
        <HStack gap={2} align="end">
          <IconButton
            label="Previous event"
            icon={<Icon icon="chevronLeft" />}
            onClick={() => {
              setPlaying(false);
              if (selectedIndex > 0) setSelectedSequence(trialEvents[selectedIndex - 1].sequence);
            }}
            isDisabled={selectedIndex <= 0}
          />
          <Button
            variant="secondary"
            label={playing ? 'Pause' : 'Play'}
            onClick={() => {
              if (!playing && selectedIndex >= trialEvents.length - 1) {
                setSelectedSequence(trialEvents[0]?.sequence ?? null);
              }
              setPlaying(!playing);
            }}
            isDisabled={trialEvents.length === 0}
          />
          <IconButton
            label="Next event"
            icon={<Icon icon="chevronRight" />}
            onClick={() => {
              setPlaying(false);
              if (selectedIndex >= 0 && selectedIndex < trialEvents.length - 1) {
                setSelectedSequence(trialEvents[selectedIndex + 1].sequence);
              }
            }}
            isDisabled={selectedIndex < 0 || selectedIndex >= trialEvents.length - 1}
          />
          <Selector
            label="Replay speed"
            value={String(speed)}
            onChange={(value) => setSpeed(Number(value))}
            options={[
              { value: '0.5', label: '0.5×' },
              { value: '1', label: '1×' },
              { value: '2', label: '2×' },
            ]}
          />
        </HStack>
        <HStack gap={2} align="end">
          <Slider
            label="Scrub recorded events"
            min={0}
            max={Math.max(0, trialEvents.length - 1)}
            step={1}
            value={selectedIndex < 0 ? 0 : selectedIndex}
            onChange={(value: number) => {
              setPlaying(false);
              const next = trialEvents[value];
              if (next) setSelectedSequence(next.sequence);
            }}
            valueDisplay="none"
          />
          <Text type="code">
            <span aria-live="polite">
              {trialEvents.length === 0 ? '0 / 0' : `${selectedIndex + 1} / ${trialEvents.length}`}
            </span>
          </Text>
        </HStack>
        <Text type="supporting">
          Replay walks saved evidence only. Backwards movement never re-executes the trial.
        </Text>
      </VStack>
    </Card>
  );
}

function EventHint({ event }: { event: RunEvent }) {
  switch (event.kind) {
    case 'request.started':
    case 'request.captured':
    case 'request.held':
    case 'request.released':
    case 'trigger.satisfied':
      return <Text type="code">{event.payload.requestId}</Text>;
    case 'action.performed':
      return <Text type="code">{event.payload.actionId}</Text>;
    case 'assertion.evaluated':
      return (
        <Text type="code">{`${event.payload.assertionId} ${event.payload.passed ? '✓' : '✗'}`}</Text>
      );
    case 'screenshot.captured':
    case 'evidence.skipped':
      return <Text type="code">{event.payload.label}</Text>;
    case 'trial.completed':
      return <Text type="code">{event.payload.outcome}</Text>;
    default:
      return null;
  }
}

function SnapshotPanel({
  selectedEvent,
  screenshotEvent,
}: {
  selectedEvent: RunEvent | null;
  screenshotEvent: Extract<RunEvent, { kind: 'screenshot.captured' }> | null;
}) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [screenshotEvent?.id]);
  const artifactId = screenshotEvent?.payload.artifactId ?? null;
  return (
    <Card>
      <VStack gap={2}>
        <Heading level={3}>Snapshot</Heading>
        <MetadataList>
          <MetadataListItem label="Selected event">
            <Text type="code">
              {selectedEvent ? `#${selectedEvent.sequence} · ${formatDateTime(selectedEvent.createdAt)}` : 'none'}
            </Text>
          </MetadataListItem>
          <MetadataListItem label="Image captured">
            <Text type="code">
              {screenshotEvent
                ? `#${screenshotEvent.sequence} · ${formatDateTime(screenshotEvent.createdAt)}`
                : 'no screenshot recorded before this event'}
            </Text>
          </MetadataListItem>
        </MetadataList>
        {screenshotEvent && artifactId && !broken ? (
          <a href={`/api/artifacts/${artifactId}`} target="_blank" rel="noreferrer">
            <img
              src={`/api/artifacts/${artifactId}`}
              alt={`Recorded browser screenshot (${screenshotEvent.payload.label})`}
              onError={() => setBroken(true)}
              className="aspect-video w-full rounded-md object-cover object-top"
            />
          </a>
        ) : (
          <Card variant="muted">
            <Text type="supporting" justify="center">
              {screenshotEvent && broken
                ? 'Screenshot file is missing from local evidence.'
                : 'No screenshot recorded before this event.'}
            </Text>
          </Card>
        )}
        <Text type="supporting">
          Nearest recorded image at or before the selected event. Nothing between captures is shown.
        </Text>
      </VStack>
    </Card>
  );
}

function InspectorPanel({
  trial,
  selectedEvent,
  valuesEvent,
}: {
  trial: Trial;
  selectedEvent: RunEvent | null;
  valuesEvent: Extract<RunEvent, { kind: 'values.captured' }> | null;
}) {
  return (
    <Card>
      <VStack gap={2}>
        <Heading level={3}>Inspector</Heading>
        {!selectedEvent ? (
          <Text type="supporting">Select an event to inspect its evidence.</Text>
        ) : (
          <VStack gap={3}>
            <HStack gap={2} justify="between" wrap="wrap">
              <HStack gap={2}>
                <Text type="code">#{selectedEvent.sequence}</Text>
                <Text type="code" weight="medium">
                  {selectedEvent.kind}
                </Text>
              </HStack>
              <Text type="supporting">{formatDateTime(selectedEvent.createdAt)}</Text>
            </HStack>
            <EventDetails trial={trial} event={selectedEvent} />
            <ValuesDetails valuesEvent={valuesEvent} />
            <details>
              <summary>
                <Text type="supporting">Raw event payload</Text>
              </summary>
              <CodeBlock code={JSON.stringify(selectedEvent.payload, null, 2)} language="json" />
            </details>
          </VStack>
        )}
      </VStack>
    </Card>
  );
}

function EventDetails({ trial, event }: { trial: Trial; event: RunEvent }) {
  const requestId = requestIdOf(event);
  if (requestId !== null && event.kind.startsWith('request.')) {
    const record = trial.detail?.requests.find((r) => r.id === requestId) ?? null;
    return (
      <VStack gap={2}>
        <Text weight="medium">Request {requestId}</Text>
        {record ? (
          <MetadataList>
            <MetadataListItem label="Method">
              <Text type="code">{record.method}</Text>
            </MetadataListItem>
            <MetadataListItem label="URL">
              <Text type="code">{record.url}</Text>
            </MetadataListItem>
            <MetadataListItem label="Status">
              <Text type="code">{record.status ?? '—'}</Text>
            </MetadataListItem>
            <MetadataListItem label="Held / released">
              <Text type="code">
                {record.held ? 'yes' : 'no'} / {record.released ? 'yes' : 'no'}
              </Text>
            </MetadataListItem>
          </MetadataList>
        ) : (
          <Text type="supporting">No request record stored for this ID.</Text>
        )}
        {record?.responseExcerpt != null && (
          <details>
            <summary>
              <Text type="supporting">
                Response excerpt{record.responseTruncated ? ' (truncated)' : ''}
              </Text>
            </summary>
            <CodeBlock code={record.responseExcerpt} language="json" />
          </details>
        )}
        <Text type="supporting">
          Release marks delivery to the browser; it does not prove the app consumed it.
        </Text>
      </VStack>
    );
  }
  if (event.kind === 'assertion.evaluated') {
    const passed = event.payload.passed;
    return (
      <VStack gap={2}>
        <HStack gap={2}>
          {toneBadge(passed ? 'good' : 'bad', passed ? '✓' : '✗', passed ? 'Passed' : 'Failed')}
          <Text type="code">{event.payload.assertionId}</Text>
        </HStack>
        <Grid columns={{ minWidth: 200, max: 2 }} gap={2}>
          <Card variant="muted">
            <VStack gap={1}>
              <Text type="supporting" weight="medium">
                Expected
              </Text>
              <Text type="code">{event.payload.expected}</Text>
            </VStack>
          </Card>
          <Card variant="muted">
            <VStack gap={1}>
              <Text type="supporting" weight="medium">
                Observed
              </Text>
              <Text type="code">{event.payload.observed ?? '—'}</Text>
            </VStack>
          </Card>
        </Grid>
      </VStack>
    );
  }
  if (event.kind === 'action.performed') {
    return (
      <MetadataList>
        <MetadataListItem label="Action">
          <Text type="code">{event.payload.actionId}</Text>
        </MetadataListItem>
        <MetadataListItem label="Kind">
          <Text type="code">{event.payload.kind}</Text>
        </MetadataListItem>
        <MetadataListItem label="Target">
          <Text type="code">{event.payload.testId}</Text>
        </MetadataListItem>
      </MetadataList>
    );
  }
  if (event.kind === 'trigger.satisfied') {
    return (
      <Text>
        Release of <Text type="code">{event.payload.requestId}</Text> was triggered by
        completion of <Text type="code">{event.payload.afterResponse}</Text>. This ordering
        was applied by the runner; it is recorded, not inferred.
      </Text>
    );
  }
  if (event.kind === 'trial.completed') {
    const outcome = event.payload.outcome;
    return (
      <HStack gap={2}>
        {toneBadge(
          outcome === 'pass' ? 'good' : outcome === 'violation' ? 'bad' : 'muted',
          outcome === 'pass' ? '✓' : outcome === 'violation' ? '✗' : '○',
          `Trial ${outcome}`,
        )}
        {event.payload.reason && <Text type="code">{event.payload.reason}</Text>}
      </HStack>
    );
  }
  return <Text type="supporting">See the raw payload below for details.</Text>;
}

function ValuesDetails({
  valuesEvent,
}: {
  valuesEvent: Extract<RunEvent, { kind: 'values.captured' }> | null;
}) {
  if (!valuesEvent) {
    return <Text type="supporting">No recorded values at or before this event.</Text>;
  }
  const values = valuesEvent.payload.values;
  return (
    <VStack gap={1}>
      <Text type="supporting" weight="medium">
        Recorded values (captured #{valuesEvent.sequence} · {formatDateTime(valuesEvent.createdAt)})
      </Text>
      <MetadataList>
        {Object.entries(values).map(([testId, value]) => (
          <MetadataListItem key={testId} label={testId}>
            <Text type="code">{typeof value === 'string' ? value : '—'}</Text>
          </MetadataListItem>
        ))}
      </MetadataList>
    </VStack>
  );
}
