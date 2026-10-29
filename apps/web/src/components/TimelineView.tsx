'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Experiment, RunEvent, Trial } from '@races/contracts';
import { formatDateTime } from '@/lib/format';
import { buildTrialLanes, type Lane, type LaneMarker } from '@/lib/timeline';
import { explainTrial } from '@/lib/explain';

export interface ExperimentWithTrials extends Experiment {
  trials: Trial[];
}

interface EventsResponse {
  runId: string;
  status: string;
  phase: string;
  events: RunEvent[];
  nextAfter: number;
}

interface ExperimentsResponse {
  runId: string;
  experiments: ExperimentWithTrials[];
}

const POLL_INTERVAL_MS = 1500;

const TONE_CLASSES: Record<string, string> = {
  accent: 'bg-sky-700 text-white',
  bad: 'bg-red-700 text-white',
  good: 'bg-green-700 text-white',
  muted: 'bg-stone-200 text-stone-800',
};

function toneBadge(tone: string, glyph: string, label: string): React.ReactNode {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold ${TONE_CLASSES[tone] ?? TONE_CLASSES.muted}`}
    >
      <span aria-hidden="true">{glyph}</span> {label}
    </span>
  );
}

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
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  const seenRef = useRef<Set<string>>(new Set(initialEvents.map((e) => e.id)));
  const afterRef = useRef<number>(
    initialEvents.length > 0 ? initialEvents[initialEvents.length - 1].sequence : -1,
  );

  // Live runs keep the timeline fed without a reload.
  useEffect(() => {
    if (isTerminal) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      if (stopped) return;
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
        }
        if (experimentsRes.ok) {
          const data = (await experimentsRes.json()) as ExperimentsResponse;
          setExperiments(data.experiments);
        }
      } catch {
        // Transient: retry on the next tick.
      }
      if (!stopped) timer = setTimeout(poll, POLL_INTERVAL_MS);
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
      .filter((e) => (e.payload.trialId as string | undefined) === trial.id)
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

  const position = (at: number): number => {
    if (!timeBounds || timeBounds.max === timeBounds.min) return EDGE_CLAMP_PCT;
    const pct = ((at - timeBounds.min) / (timeBounds.max - timeBounds.min)) * 100;
    // Keep edge markers readable inside the track; interior positions exact.
    return Math.min(100 - EDGE_CLAMP_PCT, Math.max(EDGE_CLAMP_PCT, pct));
  };

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
    let best: RunEvent | null = null;
    for (const event of trialEvents) {
      if (event.kind !== 'screenshot.captured' || event.sequence > selectedSequence) continue;
      if (!best || event.sequence > best.sequence) best = event;
    }
    return best;
  }, [trialEvents, selectedSequence]);

  const valuesEvent = useMemo(() => {
    if (selectedSequence === null) return null;
    let best: RunEvent | null = null;
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
      <div className="rounded-lg border border-dashed border-stone-300 bg-white px-6 py-10 text-center">
        <p className="text-sm font-medium text-stone-900">No experiments recorded yet</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-stone-600">
          {isTerminal
            ? 'This run finished without executing an experiment. The activity tab shows what happened.'
            : 'Trials will appear here once the agent runs its first experiment.'}
        </p>
      </div>
    );
  }

  const selectTrial = (id: string) => {
    setTrialId(id);
    setSelectedSequence(null);
    setPlaying(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="trial-select" className="text-sm font-medium text-stone-800">
          Trial
        </label>
        <select
          id="trial-select"
          value={trialId ?? ''}
          onChange={(event) => selectTrial(event.target.value)}
          className="max-w-full rounded-md border border-stone-300 bg-white px-2 py-1.5 font-mono text-xs text-stone-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700"
        >
          {experiments.map((experiment) =>
            experiment.trials.map((t) => (
              <option key={t.id} value={t.id}>
                {trialLabel(experiment, t)}
              </option>
            )),
          )}
        </select>
        {!isTerminal && (
          <span className="text-xs text-stone-500" role="status">
            Updating live
          </span>
        )}
      </div>

      {trial && explanation && (
        <section
          aria-label="What happened"
          className="rounded-lg border border-stone-200 bg-white p-4"
        >
          <div className="flex items-start gap-2">
            <span aria-hidden="true" className="mt-0.5 text-sm">
              {explanation.tone === 'bad' ? '✗' : explanation.tone === 'good' ? '✓' : '○'}
            </span>
            <div>
              <p className="text-sm text-stone-900">{explanation.headline}</p>
              {explanation.detail && (
                <p className="mt-1 font-mono text-xs text-stone-600">{explanation.detail}</p>
              )}
              {explanation.links.length > 0 && (
                <p className="mt-2 flex flex-wrap gap-2">
                  {explanation.links.map((link) => (
                    <button
                      key={link.eventSequence}
                      type="button"
                      onClick={() => {
                        setSelectedSequence(link.eventSequence);
                        setPlaying(false);
                      }}
                      className="rounded border border-stone-300 bg-stone-50 px-2 py-1 font-mono text-xs text-sky-800 hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700"
                    >
                      Show: {link.label} →
                    </button>
                  ))}
                </p>
              )}
            </div>
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="space-y-4 xl:col-span-7">
          <section
            aria-label="Request timeline"
            className="rounded-lg border border-stone-200 bg-white p-4"
          >
            {lanes.length === 0 ? (
              <p className="text-sm text-stone-500">No timeline events for this trial yet.</p>
            ) : (
              <ol className="space-y-3">
                {lanes.map((lane) => (
                  <li key={lane.id}>
                    <div className="flex items-baseline gap-2">
                      <p className="w-36 shrink-0 truncate text-xs font-semibold text-stone-900">
                        {lane.label}
                      </p>
                      {lane.sublabel && (
                        <p className="truncate font-mono text-[11px] text-stone-500">{lane.sublabel}</p>
                      )}
                    </div>
                    <LaneTrack
                      lane={lane}
                      position={position}
                      selectedSequence={selectedSequence}
                      onSelect={(sequence) => {
                        setSelectedSequence(sequence);
                        setPlaying(false);
                      }}
                    />
                  </li>
                ))}
              </ol>
            )}
            {timeBounds && (
              <p className="mt-2 font-mono text-[11px] text-stone-500">
                {((timeBounds.max - timeBounds.min) / 1000).toFixed(1)}s of recorded events on a
                shared relative time scale. Markers at the extreme edges are nudged inward to
                stay readable.
              </p>
            )}
          </section>

          <section
            aria-label="Replay controls"
            className="flex flex-wrap items-center gap-2 rounded-lg border border-stone-200 bg-white p-3"
          >
            <button
              type="button"
              onClick={() => {
                setPlaying(false);
                if (selectedIndex > 0) setSelectedSequence(trialEvents[selectedIndex - 1].sequence);
              }}
              disabled={selectedIndex <= 0}
              aria-label="Previous event"
              className="rounded border border-stone-300 px-2 py-1 text-sm text-stone-800 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700"
            >
              ◀
            </button>
            <button
              type="button"
              onClick={() => {
                if (!playing && selectedIndex >= trialEvents.length - 1) {
                  setSelectedSequence(trialEvents[0]?.sequence ?? null);
                }
                setPlaying(!playing);
              }}
              disabled={trialEvents.length === 0}
              aria-label={playing ? 'Pause recorded replay' : 'Play recorded replay'}
              className="rounded border border-stone-300 px-3 py-1 text-sm font-medium text-stone-800 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700"
            >
              {playing ? '❚❚ Pause' : '▶ Play'}
            </button>
            <button
              type="button"
              onClick={() => {
                setPlaying(false);
                if (selectedIndex >= 0 && selectedIndex < trialEvents.length - 1) {
                  setSelectedSequence(trialEvents[selectedIndex + 1].sequence);
                }
              }}
              disabled={selectedIndex < 0 || selectedIndex >= trialEvents.length - 1}
              aria-label="Next event"
              className="rounded border border-stone-300 px-2 py-1 text-sm text-stone-800 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700"
            >
              ▶
            </button>
            <label className="flex items-center gap-1 text-xs text-stone-600">
              Speed
              <select
                value={speed}
                onChange={(event) => setSpeed(Number(event.target.value))}
                aria-label="Replay speed"
                className="rounded border border-stone-300 bg-white px-1 py-1 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700"
              >
                <option value={0.5}>0.5×</option>
                <option value={1}>1×</option>
                <option value={2}>2×</option>
              </select>
            </label>
            <input
              type="range"
              min={0}
              max={Math.max(0, trialEvents.length - 1)}
              value={selectedIndex < 0 ? 0 : selectedIndex}
              onChange={(event) => {
                setPlaying(false);
                const next = trialEvents[Number(event.target.value)];
                if (next) setSelectedSequence(next.sequence);
              }}
              aria-label="Scrub recorded events"
              className="min-w-24 flex-1 accent-sky-700"
            />
            <span className="font-mono text-xs text-stone-600" aria-live="polite">
              {trialEvents.length === 0
                ? '0 / 0'
                : `${selectedIndex + 1} / ${trialEvents.length}`}
            </span>
          </section>
          <p className="-mt-2 text-xs text-stone-500">
            Replay walks saved evidence only. Backwards movement never re-executes the trial.
          </p>

          <section aria-label="Trial events">
            <h3 className="text-sm font-semibold text-stone-900">Events</h3>
            <ol className="mt-2 divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white">
              {trialEvents.map((event) => (
                <li key={event.sequence}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedSequence(event.sequence);
                      setPlaying(false);
                    }}
                    aria-current={event.sequence === selectedSequence}
                    className={`flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-sky-700 ${
                      event.sequence === selectedSequence ? 'bg-sky-50' : 'hover:bg-stone-50'
                    }`}
                  >
                    <span className="font-mono text-xs text-stone-400">#{event.sequence}</span>
                    <span className="font-mono text-sm text-stone-900">{event.kind}</span>
                    <EventHint event={event} />
                    <span className="ml-auto text-xs text-stone-500">
                      {formatDateTime(event.createdAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <div className="space-y-4 xl:col-span-5">
          <SnapshotPanel selectedEvent={selectedEvent} screenshotEvent={screenshotEvent} />
          {trial && (
            <InspectorPanel trial={trial} selectedEvent={selectedEvent} valuesEvent={valuesEvent} />
          )}
        </div>
      </div>
    </div>
  );
}

const ROW_MIN_GAP_PCT = 9;
const ROW_HEIGHT_PX = 26;
const EDGE_CLAMP_PCT = 7;

function assignRows(markers: LaneMarker[], position: (at: number) => number): LaneMarker[][] {
  const rows: LaneMarker[][] = [];
  const ordered = [...markers].sort((a, b) => a.at - b.at || a.sequence - b.sequence);
  for (const marker of ordered) {
    const pct = position(marker.at);
    let placed = false;
    for (const row of rows) {
      const last = row[row.length - 1];
      if (pct - position(last.at) >= ROW_MIN_GAP_PCT) {
        row.push(marker);
        placed = true;
        break;
      }
    }
    if (!placed) rows.push([marker]);
  }
  return rows;
}

function LaneTrack({
  lane,
  position,
  selectedSequence,
  onSelect,
}: {
  lane: Lane;
  position: (at: number) => number;
  selectedSequence: number | null;
  onSelect: (sequence: number) => void;
}) {
  const rows = assignRows(lane.markers, position);
  return (
    <div
      className="relative ml-36 mt-1 rounded bg-stone-50"
      style={{ height: `${Math.max(1, rows.length) * ROW_HEIGHT_PX + 8}px` }}
    >
      {lane.spans.map((span) => (
        <Span key={`${span.fromSequence}-${span.toSequence ?? 'end'}`} lane={lane} span={span} position={position} />
      ))}
      {rows.map((row, rowIndex) =>
        row.map((marker) => (
          <button
            key={marker.sequence}
            type="button"
            title={`#${marker.sequence} ${marker.label}`}
            aria-label={`Select event #${marker.sequence}: ${marker.label}`}
            aria-current={marker.sequence === selectedSequence}
            onClick={() => onSelect(marker.sequence)}
            style={{ left: `${position(marker.at)}%`, top: `${4 + rowIndex * ROW_HEIGHT_PX}px` }}
            className={`absolute max-w-44 -translate-x-1/2 truncate rounded px-1 py-0.5 font-mono text-[11px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700 ${
              marker.sequence === selectedSequence ? 'ring-2 ring-sky-700 ring-offset-1' : ''
            } ${TONE_CLASSES[marker.tone] ?? TONE_CLASSES.muted}`}
          >
            <span aria-hidden="true">{marker.glyph}</span>{' '}
            <span className="hidden sm:inline">{marker.label}</span>
          </button>
        )),
      )}
    </div>
  );
}

function Span({
  lane,
  span,
  position,
}: {
  lane: Lane;
  span: { fromSequence: number; toSequence: number | null; label: string };
  position: (at: number) => number;
}) {
  const fromMarker = lane.markers.find((m) => m.sequence === span.fromSequence);
  const toMarker =
    span.toSequence === null ? null : lane.markers.find((m) => m.sequence === span.toSequence);
  if (!fromMarker) return null;
  const fromPct = position(fromMarker.at);
  const toPct = toMarker ? position(toMarker.at) : 100;
  return (
    <div
      aria-hidden="true"
      title={span.label}
      style={{ left: `${fromPct}%`, width: `${Math.max(1, toPct - fromPct)}%` }}
      className="absolute inset-y-1 rounded bg-sky-200/70"
    />
  );
}

function EventHint({ event }: { event: RunEvent }) {
  const requestId = event.payload.requestId;
  const actionId = event.payload.actionId;
  const assertionId = event.payload.assertionId;
  const label = event.payload.label;
  const outcome = event.payload.outcome;
  const hint =
    typeof requestId === 'string'
      ? requestId
      : typeof actionId === 'string'
        ? actionId
        : typeof assertionId === 'string'
          ? `${assertionId} ${event.payload.passed === true ? '✓' : event.payload.passed === false ? '✗' : ''}`
          : typeof label === 'string'
            ? label
            : typeof outcome === 'string'
              ? outcome
              : null;
  if (!hint) return null;
  return <span className="font-mono text-xs text-stone-500">{hint}</span>;
}

function SnapshotPanel({
  selectedEvent,
  screenshotEvent,
}: {
  selectedEvent: RunEvent | null;
  screenshotEvent: RunEvent | null;
}) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [screenshotEvent?.id]);
  const artifactId =
    screenshotEvent && typeof screenshotEvent.payload.artifactId === 'string'
      ? screenshotEvent.payload.artifactId
      : null;
  return (
    <section aria-label="Browser snapshot" className="rounded-lg border border-stone-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-stone-900">Snapshot</h3>
      <dl className="mt-2 space-y-1 font-mono text-xs text-stone-600">
        <div className="flex gap-2">
          <dt className="shrink-0 text-stone-500">Selected event</dt>
          <dd>{selectedEvent ? `#${selectedEvent.sequence} · ${formatDateTime(selectedEvent.createdAt)}` : 'none'}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 text-stone-500">Image captured</dt>
          <dd>
            {screenshotEvent
              ? `#${screenshotEvent.sequence} · ${formatDateTime(screenshotEvent.createdAt)}`
              : 'no screenshot recorded before this event'}
          </dd>
        </div>
      </dl>
      {screenshotEvent && artifactId && !broken ? (
        <a
          href={`/api/artifacts/${artifactId}`}
          target="_blank"
          rel="noreferrer"
          className="mt-3 block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700"
        >
          <img
            src={`/api/artifacts/${artifactId}`}
            alt={`Recorded browser screenshot (${String(screenshotEvent.payload.label ?? 'screenshot')})`}
            onError={() => setBroken(true)}
            className="aspect-video w-full rounded border border-stone-200 object-cover object-top"
          />
        </a>
      ) : (
        <p className="mt-3 rounded border border-dashed border-stone-300 px-4 py-8 text-center text-sm text-stone-500">
          {screenshotEvent && broken
            ? 'Screenshot file is missing from local evidence.'
            : 'No screenshot recorded before this event.'}
        </p>
      )}
      <p className="mt-2 text-xs text-stone-500">
        Nearest recorded image at or before the selected event. Nothing between captures is shown.
      </p>
    </section>
  );
}

function InspectorPanel({
  trial,
  selectedEvent,
  valuesEvent,
}: {
  trial: Trial;
  selectedEvent: RunEvent | null;
  valuesEvent: RunEvent | null;
}) {
  return (
    <section aria-label="Inspector" className="rounded-lg border border-stone-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-stone-900">Inspector</h3>
      {!selectedEvent ? (
        <p className="mt-2 text-sm text-stone-500">Select an event to inspect its evidence.</p>
      ) : (
        <div className="mt-2 space-y-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-mono text-xs text-stone-400">#{selectedEvent.sequence}</span>
            <span className="font-mono text-sm font-medium text-stone-900">{selectedEvent.kind}</span>
            <span className="ml-auto text-xs text-stone-500">
              {formatDateTime(selectedEvent.createdAt)}
            </span>
          </div>
          <EventDetails trial={trial} event={selectedEvent} />
          <ValuesDetails valuesEvent={valuesEvent} />
          <details>
            <summary className="cursor-pointer text-xs text-sky-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700">
              Raw event payload
            </summary>
            <pre className="mt-1.5 overflow-x-auto rounded-md bg-stone-50 p-3 font-mono text-xs text-stone-700">
              {JSON.stringify(selectedEvent.payload, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </section>
  );
}

function EventDetails({ trial, event }: { trial: Trial; event: RunEvent }) {
  const requestId = event.payload.requestId;
  if (typeof requestId === 'string' && event.kind.startsWith('request.')) {
    const record = trial.detail?.requests.find((r) => r.id === requestId) ?? null;
    return (
      <div className="space-y-2 text-sm">
        <p className="font-medium text-stone-900">Request {requestId}</p>
        {record ? (
          <dl className="space-y-1 font-mono text-xs text-stone-700">
            <div className="flex gap-2"><dt className="text-stone-500">Method</dt><dd>{record.method}</dd></div>
            <div className="flex gap-2"><dt className="text-stone-500">URL</dt><dd className="break-all">{record.url}</dd></div>
            <div className="flex gap-2"><dt className="text-stone-500">Status</dt><dd>{record.status ?? '—'}</dd></div>
            <div className="flex gap-2">
              <dt className="text-stone-500">Held / released</dt>
              <dd>{record.held ? 'yes' : 'no'} / {record.released ? 'yes' : 'no'}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-xs text-stone-500">No request record stored for this ID.</p>
        )}
        {record?.responseExcerpt != null && (
          <details>
            <summary className="cursor-pointer text-xs text-sky-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700">
              Response excerpt{record.responseTruncated ? ' (truncated)' : ''}
            </summary>
            <pre className="mt-1.5 max-h-48 overflow-auto rounded-md bg-stone-50 p-3 font-mono text-xs text-stone-700">
              {record.responseExcerpt}
            </pre>
          </details>
        )}
        <p className="text-xs text-stone-500">
          Release marks delivery to the browser; it does not prove the app consumed it.
        </p>
      </div>
    );
  }
  if (event.kind === 'assertion.evaluated') {
    const passed = event.payload.passed === true;
    const expected = event.payload.expected;
    const observed = event.payload.observed;
    return (
      <div className="space-y-2 text-sm">
        <div className="flex items-center gap-2">
          {toneBadge(passed ? 'good' : 'bad', passed ? '✓' : '✗', passed ? 'Passed' : 'Failed')}
          <span className="font-mono text-xs text-stone-600">
            {typeof event.payload.assertionId === 'string' ? event.payload.assertionId : 'check'}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="rounded border border-stone-200 p-2">
            <p className="text-xs font-medium text-stone-500">Expected</p>
            <p className="mt-1 break-words font-mono text-xs text-stone-900">
              {typeof expected === 'string' ? expected : '—'}
            </p>
          </div>
          <div className="rounded border border-stone-200 p-2">
            <p className="text-xs font-medium text-stone-500">Observed</p>
            <p className="mt-1 break-words font-mono text-xs text-stone-900">
              {typeof observed === 'string' ? observed : '—'}
            </p>
          </div>
        </div>
      </div>
    );
  }
  if (event.kind === 'action.performed') {
    return (
      <dl className="space-y-1 font-mono text-xs text-stone-700">
        <div className="flex gap-2"><dt className="text-stone-500">Action</dt><dd>{String(event.payload.actionId ?? '—')}</dd></div>
        <div className="flex gap-2"><dt className="text-stone-500">Kind</dt><dd>{String(event.payload.kind ?? '—')}</dd></div>
        <div className="flex gap-2"><dt className="text-stone-500">Target</dt><dd>{String(event.payload.testId ?? '—')}</dd></div>
      </dl>
    );
  }
  if (event.kind === 'trigger.satisfied') {
    return (
      <p className="text-sm text-stone-700">
        Release of <span className="font-mono">{String(event.payload.requestId ?? '?')}</span>{' '}
        was triggered by completion of{' '}
        <span className="font-mono">{String(event.payload.afterResponse ?? '?')}</span>. This
        ordering was applied by the runner; it is recorded, not inferred.
      </p>
    );
  }
  if (event.kind === 'trial.completed') {
    return (
      <div className="flex items-center gap-2 text-sm">
        {toneBadge(
          event.payload.outcome === 'pass' ? 'good' : event.payload.outcome === 'violation' ? 'bad' : 'muted',
          event.payload.outcome === 'pass' ? '✓' : event.payload.outcome === 'violation' ? '✗' : '○',
          `Trial ${String(event.payload.outcome ?? 'finished')}`,
        )}
        {typeof event.payload.reason === 'string' && (
          <span className="font-mono text-xs text-stone-600">{event.payload.reason}</span>
        )}
      </div>
    );
  }
  return <p className="text-sm text-stone-500">See the raw payload below for details.</p>;
}

function ValuesDetails({ valuesEvent }: { valuesEvent: RunEvent | null }) {
  if (!valuesEvent) {
    return <p className="text-sm text-stone-500">No recorded values at or before this event.</p>;
  }
  const values = valuesEvent.payload.values as Record<string, unknown> | undefined;
  if (!values || typeof values !== 'object') {
    return <p className="text-sm text-stone-500">Values record has no readable entries.</p>;
  }
  return (
    <div>
      <p className="text-xs font-medium text-stone-500">
        Recorded values (captured #{valuesEvent.sequence} · {formatDateTime(valuesEvent.createdAt)})
      </p>
      <dl className="mt-1 space-y-1">
        {Object.entries(values).map(([testId, value]) => (
          <div key={testId} className="rounded border border-stone-200 p-2">
            <dt className="font-mono text-xs text-stone-500">{testId}</dt>
            <dd className="mt-0.5 break-words font-mono text-xs text-stone-900">
              {typeof value === 'string' ? value : '—'}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
