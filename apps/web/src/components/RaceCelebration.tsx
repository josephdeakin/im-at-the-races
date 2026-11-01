'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Finding, RunEvent } from '@races/contracts';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Table } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { playBell, playFanfare, type FanfareHandle } from '@/lib/fanfare';
import {
  callCrossed,
  callFinish,
  callHalfway,
  callHold,
  callInquiry,
  callLeadChange,
  callRelease,
  callResultBoard,
  callStart,
  callStretch,
  formFigures,
  formScore,
  observedRunner,
  raceDayOffer,
  shortName,
  startingPrices,
} from '@/lib/raceday';
import {
  deriveFeatureRace,
  normalizePace,
  positionAtMarks,
  releaseTriggerLabel,
  selectFeatureFinding,
  selectFeatureTrial,
  type FeatureRace as FeatureRaceModel,
  type PacedRunner,
} from '@/lib/feature-race';
import type { ExperimentWithTrials } from './TimelineView';

const HORSES = [
  { src: '/race/horse-red.png', silk: '#c03434', silkName: 'crimson' },
  { src: '/race/horse-blue.png', silk: '#2f5fd0', silkName: 'royal blue' },
  { src: '/race/horse-green.png', silk: '#2e8b57', silkName: 'emerald' },
  { src: '/race/horse-yellow.png', silk: '#d9a416', silkName: 'gold' },
];

const ROSSINI_SRC = '/race/william-tell-finale.mp3';
const MAX_RUNNERS = 4;
const RACE_SECONDS = 10;
const GATES_SECONDS = 1.6;

type Runner = {
  key: string;
  name: string;
  src: string;
  silk: string;
  silkName: string;
  form: string;
  odds: string;
};

interface TrialEventsResponse {
  runId: string;
  trialId: string;
  events: RunEvent[];
}

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function useRaceAudio(): {
  audioRef: React.RefObject<HTMLAudioElement | null>;
  muted: boolean;
  toggleMute: () => void;
  startAudio: (isMuted: boolean) => void;
  stopSound: () => void;
} {
  const [muted, setMuted] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fanfareRef = useRef<FanfareHandle | null>(null);
  const fallbackRef = useRef(false);

  const stopSound = (): void => {
    audioRef.current?.pause();
    fanfareRef.current?.stop();
    fanfareRef.current = null;
  };

  useEffect(() => stopSound, []);

  const startAudio = (isMuted: boolean): void => {
    stopSound();
    fallbackRef.current = false;
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    audio.muted = isMuted;
    audio.play().catch(() => {
      fallbackRef.current = true;
      if (!isMuted) {
        try {
          fanfareRef.current = playFanfare();
        } catch {
          fanfareRef.current = null;
        }
      }
    });
  };

  const toggleMute = (): void => {
    const next = !muted;
    setMuted(next);
    if (audioRef.current) audioRef.current.muted = next;
    if (next) {
      fanfareRef.current?.stop();
      fanfareRef.current = null;
    } else if (fallbackRef.current) {
      try {
        fanfareRef.current = playFanfare();
      } catch {
        fanfareRef.current = null;
      }
    }
  };

  return { audioRef, muted, toggleMute, startAudio, stopSound };
}

type RaceAudio = ReturnType<typeof useRaceAudio>;

function RaceFrame({
  title,
  audio,
  onClose,
  children,
}: {
  title: string;
  audio: RaceAudio;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      {/* Local file: the real Rossini finale, credited on the racecard. */}
      <audio ref={audio.audioRef} src={ROSSINI_SRC} preload="auto" />
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto">
        <Card>
          <VStack gap={4}>
            <img src="/race/course.jpg" alt="" className="h-28 w-full rounded-md object-cover" />
            <HStack gap={2} justify="between">
              <Heading level={2}>{title}</Heading>
              <HStack gap={2}>
                <Button
                  variant="secondary"
                  size="sm"
                  label={audio.muted ? 'Unmute' : 'Mute'}
                  onClick={audio.toggleMute}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  label="Close"
                  onClick={() => {
                    audio.stopSound();
                    onClose();
                  }}
                />
              </HStack>
            </HStack>
            {children}
          </VStack>
        </Card>
      </div>
    </div>
  );
}

function Calls({ lines }: { lines: string[] }) {
  const latest = lines[lines.length - 1] ?? null;
  if (!latest) return null;
  return (
    <Card variant="muted">
      <VStack gap={1}>
        <Text weight="medium" role="status">
          {latest}
        </Text>
        {lines.slice(0, -1).map((line) => (
          <Text key={line} type="supporting">
            {line}
          </Text>
        ))}
      </VStack>
    </Card>
  );
}

function HorseLane({
  label,
  sublabel,
  silk,
  src,
  alt,
  dataKey,
  position,
  bobSeed,
  racing,
  marks,
}: {
  label: string;
  sublabel: string | null;
  silk: string;
  src: string;
  alt: string;
  dataKey: string;
  position: number;
  bobSeed: number;
  racing: boolean;
  marks?: { pos: number; label: string }[];
}) {
  return (
    <VStack gap={1}>
      <span className="flex items-center gap-1">
        <span
          aria-hidden="true"
          className="inline-block h-3 w-3 shrink-0 rounded-full"
          style={{ backgroundColor: silk }}
        />
        <Text type="code">{label}</Text>
        {sublabel && <Text type="supporting">{sublabel}</Text>}
      </span>
      <div className="relative h-16 rounded-md bg-neutral-500/10">
        {marks?.map((mark) => (
          <span
            key={`${mark.pos}-${mark.label}`}
            title={mark.label}
            aria-hidden="true"
            className="absolute top-1 h-1.5 w-1.5 rounded-full bg-neutral-400"
            style={{ left: `calc(${(mark.pos * 100).toFixed(1)}% - 3px)` }}
          />
        ))}
        <img
          src={src}
          alt={alt}
          data-horse={dataKey}
          width={88}
          height={64}
          className="absolute top-0 h-16 w-[88px] rounded-md bg-white object-contain"
          style={{
            left: `calc(${(position * 100).toFixed(2)}% - ${(position * 96).toFixed(1)}px + 4px)`,
            transform: racing
              ? `translateY(${Math.sin(Date.now() / 90 + bobSeed * 2) * 2}px)`
              : undefined,
          }}
        />
      </div>
    </VStack>
  );
}

function requestPath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`.slice(0, 48);
  } catch {
    return url.slice(0, 48);
  }
}

function FinishStrip() {
  return (
    <div
      aria-hidden="true"
      title="Finish line"
      className="absolute top-0 right-0 bottom-0 w-3 rounded-r-md"
      style={{
        background: 'repeating-conic-gradient(#111 0% 25%, #fff 0% 50%) 0 0 / 12px 12px',
      }}
    />
  );
}

function UndercardOverlay({ runners, onClose }: { runners: Runner[]; onClose: () => void }) {
  const audio = useRaceAudio();
  const [phase, setPhase] = useState<'card' | 'gates' | 'racing' | 'finished'>('card');
  const [positions, setPositions] = useState<number[]>(runners.map(() => 0));
  const [order, setOrder] = useState<Runner[]>(runners);
  const [photo, setPhoto] = useState(false);
  const [calls, setCalls] = useState<string[]>([]);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);

  const stopRace = (): void => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    audio.stopSound();
  };

  useEffect(() => stopRace, []);

  const say = (line: string): void => {
    setCalls((prev) => (prev[prev.length - 1] === line ? prev : [...prev.slice(-5), line]));
  };

  const start = (): void => {
    stopRace();
    const finishOrder = shuffled(runners);
    setOrder(finishOrder);
    setCalls([]);
    setPhoto(false);
    setPositions(runners.map(() => 0));
    setPhase('gates');
    audio.startAudio(audio.muted);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setPositions(runners.map(() => 1));
      setPhase('finished');
      say(callFinish(finishOrder.map((r) => shortName(r.name)), false));
      return;
    }
    const pace = new Map<string, { finishAt: number; wobble: number }>();
    const photoFinish = runners.length > 1 && Math.random() < 0.25;
    finishOrder.forEach((runner, place) => {
      pace.set(runner.key, {
        finishAt:
          place === 1 && photoFinish
            ? (pace.get(finishOrder[0].key)?.finishAt ?? 8) + 0.06 + Math.random() * 0.08
            : 8 + place * 0.5 + Math.random() * 0.25,
        wobble: Math.random() * Math.PI * 2,
      });
    });
    timerRef.current = window.setTimeout(() => {
      setPhase('racing');
      if (!audio.muted) playBell();
      say(callStart(shortName(finishOrder[0].name)));
      const startedAt = performance.now();
      let leader = '';
      let lastCallAt = 0;
      let halfwayCalled = false;
      let stretchCalled = false;
      const tick = (now: number): void => {
        const elapsed = (now - startedAt) / 1000;
        const next = runners.map((runner) => {
          const { finishAt, wobble } = pace.get(runner.key) ?? {
            finishAt: RACE_SECONDS,
            wobble: 0,
          };
          const base = Math.min(1, elapsed / finishAt);
          const wob = Math.sin(elapsed * 2.2 + wobble) * 0.05 * (1 - base);
          return Math.max(0, Math.min(1, base + wob));
        });
        setPositions(next);
        const running = runners
          .map((runner, index) => ({ runner, position: next[index] }))
          .sort((a, b) => b.position - a.position);
        const names = running.map((entry) => shortName(entry.runner.name));
        const gap = running[0].position - (running[1]?.position ?? 0);
        if (names[0] !== leader && (leader === '' || gap > 0.015)) {
          const first = leader === '';
          leader = names[0];
          if (!first && now - lastCallAt > 2000) {
            lastCallAt = now;
            say(callLeadChange(leader));
          }
        }
        if (!halfwayCalled && running[0].position >= 0.5) {
          halfwayCalled = true;
          say(callHalfway(names));
        }
        if (!stretchCalled && running[0].position >= 0.8) {
          stretchCalled = true;
          say(callStretch(names, running[0].position - (running[1]?.position ?? 0)));
        }
        if (elapsed >= RACE_SECONDS) {
          const gapAtLine = Math.abs(
            (pace.get(finishOrder[0].key)?.finishAt ?? 0) -
              (pace.get(finishOrder[1]?.key ?? '')?.finishAt ?? 0),
          );
          const isPhoto = photoFinish && finishOrder.length > 1 && gapAtLine < 0.2;
          setPositions(runners.map(() => 1));
          setOrder(finishOrder);
          setPhoto(isPhoto);
          setPhase('finished');
          say(callFinish(finishOrder.map((r) => shortName(r.name)), isPhoto));
          rafRef.current = null;
          return;
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    }, GATES_SECONDS * 1000);
  };

  const winner = order[0];

  return (
    <RaceFrame title="The Races: results" audio={audio} onClose={onClose}>
      {phase === 'card' ? (
        <VStack gap={3}>
          <Text>
            {runners.length} experiment{runners.length === 1 ? '' : 's'} finished. Study the
            form and race them home to Rossini.
          </Text>
          <Table
            data={runners}
            columns={[
              {
                key: 'runner',
                header: 'Runner',
                renderCell: (runner) => (
                  <HStack gap={2}>
                    <img
                      src={runner.src}
                      alt=""
                      width={64}
                      height={48}
                      className="rounded-md bg-white object-contain"
                    />
                    <VStack gap={0}>
                      <Text weight="medium">{shortName(runner.name)}</Text>
                      <Text type="supporting">{runner.silkName} silks</Text>
                    </VStack>
                  </HStack>
                ),
              },
              {
                key: 'form',
                header: 'Form',
                renderCell: (runner) => <Text type="code">{runner.form}</Text>,
              },
              {
                key: 'odds',
                header: 'Odds',
                renderCell: (runner) => <Text weight="medium">{runner.odds}</Text>,
              },
            ]}
          />
          <HStack gap={2}>
            <Button variant="primary" label="Start the race" onClick={start} />
          </HStack>
          <Text type="supporting">
            Music: Rossini, William Tell Overture finale (March of the Swiss Soldiers), U.S.
            Marine Band, public domain. Finishing order is ceremonial.
          </Text>
        </VStack>
      ) : (
        <VStack gap={3}>
          {phase === 'gates' && (
            <Text weight="medium" role="status">
              Under starter&apos;s orders…
            </Text>
          )}
          <div className="relative">
            <VStack gap={2}>
              {runners.map((runner, index) => (
                <HorseLane
                  key={runner.key}
                  label={shortName(runner.name)}
                  sublabel={null}
                  silk={runner.silk}
                  src={runner.src}
                  alt={`${runner.name} (${runner.silkName} silks)`}
                  dataKey={runner.key}
                  position={positions[index]}
                  bobSeed={index}
                  racing={phase === 'racing'}
                />
              ))}
            </VStack>
            <FinishStrip />
          </div>
          <Calls lines={calls} />
          {phase === 'finished' && winner && (
            <VStack gap={2}>
              <HStack gap={3}>
                <img
                  src="/race/trophy.png"
                  alt=""
                  width={72}
                  height={72}
                  className="rounded-md bg-white object-contain"
                />
                <VStack gap={1}>
                  <HStack gap={2}>
                    <Badge variant="success" label="Winner" />
                    {photo && <Badge variant="warning" label="Photo finish" />}
                  </HStack>
                  <Text weight="medium">
                    {winner.name} takes it at {winner.odds}
                    {runners.length > 1 &&
                      `, with ${order
                        .slice(1)
                        .map((r) => shortName(r.name))
                        .join(', ')} behind`}
                    !
                  </Text>
                </VStack>
              </HStack>
              <HStack gap={2}>
                <Button variant="primary" label="Race again" onClick={start} />
              </HStack>
            </VStack>
          )}
        </VStack>
      )}
    </RaceFrame>
  );
}

function FeatureOverlay({
  runId,
  finding,
  trials,
  onClose,
}: {
  runId: string;
  finding: Finding;
  trials: ExperimentWithTrials['trials'];
  onClose: () => void;
}) {
  const audio = useRaceAudio();
  const [phase, setPhase] = useState<'card' | 'gates' | 'racing' | 'finished'>('card');
  const [paced, setPaced] = useState<PacedRunner[] | null>(null);
  const [race, setRace] = useState<FeatureRaceModel | null>(null);
  const [failed, setFailed] = useState(false);
  const [positions, setPositions] = useState<number[]>([]);
  const [calls, setCalls] = useState<string[]>([]);
  const [photo, setPhoto] = useState(false);
  const [flash, setFlash] = useState(false);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);

  const trial = useMemo(() => selectFeatureTrial(trials), [trials]);

  useEffect(() => {
    if (!trial) {
      setFailed(true);
      return;
    }
    let stopped = false;
    fetch(`/api/runs/${runId}/trials/${trial.id}/events`, { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error(`events: ${res.status}`);
        return res.json() as Promise<TrialEventsResponse>;
      })
      .then((data) => {
        if (stopped) return;
        const derived = deriveFeatureRace(finding, trials, data.events);
        if (!derived) {
          setFailed(true);
          return;
        }
        setRace(derived);
        setPaced(normalizePace(derived, RACE_SECONDS));
        setPositions(derived.runners.map(() => 0));
      })
      .catch(() => {
        if (!stopped) setFailed(true);
      });
    return () => {
      stopped = true;
    };
  }, [runId, trial, finding, trials]);

  const stopRace = (): void => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    audio.stopSound();
  };

  useEffect(() => stopRace, []);

  const say = (line: string): void => {
    setCalls((prev) => (prev[prev.length - 1] === line ? prev : [...prev.slice(-5), line]));
  };

  const start = (): void => {
    if (!paced || !race) return;
    stopRace();
    setCalls([]);
    setPhoto(false);
    setFlash(false);
    setPositions(paced.map(() => 0));
    setPhase('gates');
    audio.startAudio(audio.muted);
    const order = [...paced].sort((a, b) => a.finishAt - b.finishAt);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setPositions(paced.map(() => 1));
      setPhase('finished');
      say(callStart(order[0].label));
      order.forEach((runner, index) => say(callCrossed(runner.label, index + 1)));
      say(callFinish(order.map((r) => r.label), false));
      say(callResultBoard(race.observed));
      say(callInquiry(observedRunner(race.observed, paced)));
      return;
    }
    timerRef.current = window.setTimeout(() => {
      setPhase('racing');
      if (!audio.muted) playBell();
      say(callStart(order[0].label));
      const maxFinish = Math.max(...paced.map((r) => r.finishAt));
      const slowmoAt = maxFinish * 0.85;
      const fired = new Set<string>();
      const crossed: string[] = [];
      const startedWall = performance.now();
      let raceTime = 0;
      let lastWall = startedWall;
      const tick = (now: number): void => {
        const wallElapsed = (now - startedWall) / 1000;
        raceTime += ((now - lastWall) / 1000) * (raceTime >= slowmoAt ? 0.45 : 1);
        lastWall = now;
        setPositions(paced.map((runner) => positionAtMarks(runner.marks, raceTime)));
        for (const runner of paced) {
          runner.marks.forEach((mark, index) => {
            const key = `${runner.requestId}:${index}`;
            if (raceTime < mark.at || fired.has(key)) return;
            fired.add(key);
            if (mark.kind === 'held') say(callHold(runner.label));
            else if (mark.kind === 'released') {
              say(callRelease(runner.label, releaseTriggerLabel(mark.label, paced)));
            } else if (index === runner.marks.length - 1) {
              crossed.push(runner.label);
              say(callCrossed(runner.label, crossed.length));
            }
          });
        }
        if (raceTime >= maxFinish + 0.9 || wallElapsed > 40) {
          const gap =
            order.length > 1 ? Math.abs(order[0].finishAt - order[1].finishAt) : 1;
          const isPhoto = order.length > 1 && gap < 0.25;
          setPositions(paced.map(() => 1));
          setPhoto(isPhoto);
          setPhase('finished');
          say(callFinish(order.map((r) => r.label), isPhoto));
          say(callResultBoard(race.observed));
          say(callInquiry(observedRunner(race.observed, paced)));
          setFlash(true);
          window.setTimeout(() => setFlash(false), 450);
          rafRef.current = null;
          return;
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    }, GATES_SECONDS * 1000);
  };

  if (failed || !trial) {
    return (
      <RaceFrame title="Feature race" audio={audio} onClose={onClose}>
        <VStack gap={2}>
          <Text>This finding has no raceable requests — the timestamps didn&apos;t survive.</Text>
          <Text type="supporting">The undercard on the results page still runs.</Text>
        </VStack>
      </RaceFrame>
    );
  }

  if (!paced || !race) {
    return (
      <RaceFrame title="Feature race" audio={audio} onClose={onClose}>
        <Text type="supporting">Saddling up — fetching the recorded timeline…</Text>
      </RaceFrame>
    );
  }

  const lineOrder = [...paced].sort((a, b) => a.finishAt - b.finishAt);
  const staleLabel = observedRunner(race.observed, paced);

  return (
    <RaceFrame title={race.title} audio={audio} onClose={onClose}>
      {phase === 'card' ? (
        <VStack gap={3}>
          <Text>
            A reenactment of <Text type="code">{finding.title}</Text> — every stride paced by
            the recorded evidence, every call quoting it.
          </Text>
          <Table
            data={paced}
            columns={[
              {
                key: 'runner',
                header: 'Runner',
                renderCell: (runner) => (
                  <HStack gap={2}>
                    <img
                      src={HORSES[paced.indexOf(runner) % HORSES.length].src}
                      alt=""
                      width={64}
                      height={48}
                      className="rounded-md bg-white object-contain"
                    />
                    <VStack gap={0}>
                      <Text weight="medium">{runner.label}</Text>
                      <Text type="supporting">
                        {runner.method} · {runner.status ?? '—'}
                      </Text>
                    </VStack>
                  </HStack>
                ),
              },
              {
                key: 'story',
                header: 'Recorded running',
                renderCell: (runner) => (
                  <HStack gap={2}>
                    {runner.held && <Badge variant="info" label="Held" />}
                    {runner.released && <Badge variant="neutral" label="Released" />}
                    {!runner.held && !runner.released && (
                      <Text type="supporting">ran free</Text>
                    )}
                  </HStack>
                ),
              },
            ]}
          />
          <HStack gap={2}>
            <Button variant="primary" label="Start the feature race" onClick={start} />
          </HStack>
          <Text type="supporting">
            Music: Rossini, William Tell Overture finale (March of the Swiss Soldiers), U.S.
            Marine Band, public domain.
          </Text>
        </VStack>
      ) : (
        <VStack gap={3}>
          {phase === 'gates' && (
            <Text weight="medium" role="status">
              Under starter&apos;s orders…
            </Text>
          )}
          <div className="relative">
            <VStack gap={2}>
              {paced.map((runner, index) => (
                <HorseLane
                  key={runner.requestId}
                  label={runner.label}
                  sublabel={`${runner.method} · ${requestPath(runner.url)}`}
                  silk={HORSES[index % HORSES.length].silk}
                  src={HORSES[index % HORSES.length].src}
                  alt={`${runner.label} (${HORSES[index % HORSES.length].silkName} silks)`}
                  dataKey={runner.requestId}
                  position={positions[index] ?? 0}
                  bobSeed={index}
                  racing={phase === 'racing'}
                  marks={runner.marks.map((mark) => ({ pos: mark.pos, label: mark.label }))}
                />
              ))}
            </VStack>
            <FinishStrip />
            {flash && (
              <div
                aria-hidden="true"
                className="absolute inset-0 rounded-md bg-white transition-opacity duration-300"
                style={{ opacity: 0.75 }}
              />
            )}
          </div>
          <Calls lines={calls} />
          {phase === 'finished' && (
            <VStack gap={2}>
              <Card variant="muted">
                <VStack gap={1}>
                  <HStack gap={2}>
                    <Heading level={4}>Result</Heading>
                    {photo && <Badge variant="warning" label="Photo finish" />}
                  </HStack>
                  <Text type="code">
                    {race.observed ?? 'no recorded verdict'}
                    {race.expected ? ` (expected ${race.expected})` : ''}
                  </Text>
                  <Text>
                    {lineOrder[0].label} crossed first
                    {lineOrder.length > 1 && `, ${lineOrder[1].label} second`} — but the board
                    shows {staleLabel ?? 'a disputed result'}.
                  </Text>
                </VStack>
              </Card>
              <HStack gap={3}>
                <img
                  src="/race/trophy.png"
                  alt=""
                  width={72}
                  height={72}
                  className="rounded-md bg-white object-contain"
                />
                <VStack gap={1}>
                  <Badge variant="success" label="Stewards' inquiry" />
                  <Text weight="medium">
                    {staleLabel
                      ? `Awarded to the stale response: ${staleLabel} takes it!`
                      : 'The result stands — controversial!'}
                  </Text>
                </VStack>
              </HStack>
              <HStack gap={2}>
                <Button variant="primary" label="Race again" onClick={start} />
              </HStack>
            </VStack>
          )}
        </VStack>
      )}
    </RaceFrame>
  );
}

export function RaceCelebration({
  runId,
  experiments,
  findings,
}: {
  runId: string;
  experiments: ExperimentWithTrials[];
  findings: Finding[];
}) {
  const [dismissed, setDismissed] = useState(false);
  const [mode, setMode] = useState<null | 'undercard' | 'feature'>(null);

  const runners: Runner[] = useMemo(() => {
    const group = experiments.slice(0, MAX_RUNNERS);
    const prices = startingPrices(group.map((e) => formScore(e.trials)));
    return group.map((experiment, index) => ({
      key: experiment.id,
      name: experiment.name,
      src: HORSES[index % HORSES.length].src,
      silk: HORSES[index % HORSES.length].silk,
      silkName: HORSES[index % HORSES.length].silkName,
      form: formFigures(experiment.trials),
      odds: prices[index],
    }));
  }, [experiments]);

  const feature = useMemo(
    () => selectFeatureFinding(findings, experiments),
    [findings, experiments],
  );

  const offer = raceDayOffer(experiments, feature !== null);
  if (!offer.showCard || dismissed) return null;

  return (
    <>
      <Card>
        <HStack gap={3}>
          <img
            src={HORSES[0].src}
            alt=""
            width={88}
            height={64}
            className="shrink-0 rounded-md bg-white object-contain"
          />
          <VStack gap={1}>
            <Heading level={3}>Race day</Heading>
            <Text type="supporting">
              {feature
                ? `A feature race reenacts “${shortName(feature.finding.title)}” from the evidence.`
                : `All ${experiments.length} experiment${experiments.length === 1 ? '' : 's'} finished — race them home to Rossini.`}
            </Text>
            <HStack gap={2} wrap="wrap">
              {feature && (
                <Button
                  variant="primary"
                  label="Watch the feature race"
                  onClick={() => setMode('feature')}
                />
              )}
              {offer.showUndercard && (
                <Button
                  variant={feature ? 'secondary' : 'primary'}
                  label="Race the results"
                  onClick={() => setMode('undercard')}
                />
              )}
              <Button variant="secondary" label="Not now" onClick={() => setDismissed(true)} />
            </HStack>
          </VStack>
        </HStack>
      </Card>
      {mode === 'undercard' && offer.showUndercard && (
        <UndercardOverlay runners={runners} onClose={() => setMode(null)} />
      )}
      {mode === 'feature' && feature && (
        <FeatureOverlay
          runId={runId}
          finding={feature.finding}
          trials={feature.trials}
          onClose={() => setMode(null)}
        />
      )}
    </>
  );
}
