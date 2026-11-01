import {
  requestIdOf,
  trialIdOf,
  type Finding,
  type RunEvent,
  type Trial,
  type TrialRequestRecord,
} from '@races/contracts';

// The feature race dramatizes a finding with its own evidence: each recorded
// request runs as a horse, paced by its real event timestamps, and the
// recorded assertion verdict decides the result. Every function here is pure;
// the component owns animation and audio.

export type RaceMilestone = {
  /** Milliseconds since the first start, shared across runners. */
  at: number;
  kind: 'started' | 'held' | 'released' | 'captured';
  label: string;
};

export type FeatureRunner = {
  requestId: string;
  label: string;
  method: string;
  url: string;
  held: boolean;
  released: boolean;
  status: number | null;
  milestones: RaceMilestone[];
  /** Last milestone time: the line for this runner. */
  endAt: number;
};

export type FeatureRace = {
  findingId: string;
  experimentId: string;
  trialId: string;
  title: string;
  runners: FeatureRunner[];
  /** Failing assertion behind the inquiry verdict, when recorded. */
  observed: string | null;
  expected: string | null;
  checkId: string | null;
};

export type PacedMark = {
  /** Race-clock seconds. */
  at: number;
  /** Track fraction 0..1. */
  pos: number;
  kind: RaceMilestone['kind'];
  label: string;
};

export type PacedRunner = FeatureRunner & {
  marks: PacedMark[];
  finishAt: number;
};

function eventMs(event: RunEvent): number {
  const ms = Date.parse(event.createdAt);
  return Number.isFinite(ms) ? ms : 0;
}

/** First violation intervention trial, else any violation trial, else null. */
export function selectFeatureTrial(trials: Trial[]): Trial | null {
  const violations = trials.filter((trial) => trial.outcome === 'violation');
  return (
    violations.find((trial) => trial.kind === 'intervention') ?? violations[0] ?? null
  );
}

/** Runner label from the request query (`q=alpha` -> "Alpha"), else the id. */
export function runnerLabel(record: Pick<TrialRequestRecord, 'id' | 'url'>): string {
  const query = /[?&]q=([^&#]*)/.exec(record.url)?.[1] ?? '';
  const word = decodeURIComponent(query).trim();
  if (word) return word.charAt(0).toUpperCase() + word.slice(1);
  return record.id;
}

/** "Stale search overwrite: late alpha..." -> "The Stale Search Overwrite Stakes". */
export function raceTitle(findingTitle: string): string {
  const head = findingTitle.split(':')[0].trim() || findingTitle.trim();
  const words = head
    .split(/\s+/)
    .slice(0, 5)
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : word));
  return `The ${words.join(' ')} Stakes`;
}

function milestoneLabel(kind: RaceMilestone['kind'], event: RunEvent): string {
  if (kind === 'released' && event.kind === 'request.released') {
    return `released (${event.payload.reason})`;
  }
  if (kind === 'captured' && event.kind === 'request.captured') {
    return event.payload.status === null ? 'captured frame' : `captured ${event.payload.status}`;
  }
  return kind;
}

/**
 * Derive the race from a finding, its experiment's trials, and the trial's
 * events. Returns null when the story cannot be told: no violation trial,
 * fewer than two requests with started+captured coverage, or no timeline.
 */
export function deriveFeatureRace(
  finding: Finding,
  trials: Trial[],
  events: RunEvent[],
): FeatureRace | null {
  const trial = selectFeatureTrial(trials);
  const records = trial?.detail?.requests ?? [];
  if (!trial || records.length < 2) return null;

  const trialEvents = events.filter((event) => trialIdOf(event) === trial.id);
  const starts = trialEvents
    .filter((event) => event.kind === 'request.started')
    .map(eventMs);
  if (starts.length === 0) return null;
  const t0 = Math.min(...starts);

  const runners: FeatureRunner[] = [];
  for (const record of records) {
    const mine = trialEvents.filter((event) => requestIdOf(event) === record.id);
    const first = (kind: RunEvent['kind']): RunEvent | undefined =>
      mine
        .filter((event) => event.kind === kind)
        .sort((a, b) => a.sequence - b.sequence)[0];
    const started = first('request.started');
    const captured = first('request.captured');
    if (!started || !captured) continue;
    const ordered: { kind: RaceMilestone['kind']; event: RunEvent | undefined }[] = [
      { kind: 'started', event: started },
      { kind: 'held', event: first('request.held') },
      { kind: 'released', event: first('request.released') },
      { kind: 'captured', event: captured },
    ];
    const milestones = ordered
      .filter((entry) => entry.event !== undefined)
      .map((entry) => {
        const event = entry.event as RunEvent;
        return {
          at: Math.max(0, eventMs(event) - t0),
          kind: entry.kind,
          label: milestoneLabel(entry.kind, event),
        };
      })
      .sort((a, b) => a.at - b.at);
    runners.push({
      requestId: record.id,
      label: runnerLabel(record),
      method: record.method,
      url: record.url,
      held: record.held,
      released: record.released,
      status: record.status,
      milestones,
      endAt: milestones[milestones.length - 1].at,
    });
  }
  if (runners.length < 2) return null;

  const failing = trial.detail?.assertions.find((assertion) => !assertion.passed) ?? null;
  return {
    findingId: finding.id,
    experimentId: finding.experimentId,
    trialId: trial.id,
    title: raceTitle(finding.title),
    runners,
    observed: failing?.observed ?? null,
    expected: failing?.expected ?? null,
    checkId: failing?.id ?? null,
  };
}

/** True when the trial record alone promises a raceable story (pre-fetch). */
export function hasFeatureCandidate(trials: Trial[]): boolean {
  const trial = selectFeatureTrial(trials);
  return (trial?.detail?.requests.length ?? 0) >= 2;
}

export type FeatureSelection = {
  finding: Finding;
  trials: Trial[];
};

/** First finding whose experiment has a raceable violation trial, if any. */
export function selectFeatureFinding(
  findings: Finding[],
  experiments: { id: string; trials: Trial[] }[],
): FeatureSelection | null {
  for (const finding of findings) {
    const trials = experiments.find((e) => e.id === finding.experimentId)?.trials ?? [];
    if (hasFeatureCandidate(trials)) return { finding, trials };
  }
  return null;
}

/** Piecewise-linear track position at race-clock time t. */
export function positionAtMarks(marks: PacedMark[], t: number): number {
  if (marks.length === 0) return 0;
  if (t <= marks[0].at) return 0;
  for (let i = 0; i < marks.length - 1; i += 1) {
    const from = marks[i];
    const to = marks[i + 1];
    if (t < to.at) {
      const span = to.at - from.at;
      if (span <= 0) return to.pos;
      return from.pos + ((t - from.at) / span) * (to.pos - from.pos);
    }
  }
  return 1;
}

/** "released (after-reqBeta)" -> the released-after runner's label, if known. */
export function releaseTriggerLabel(
  markLabel: string,
  runners: { requestId: string; label: string }[],
): string | null {
  const match = /^released \(after-(.+)\)$/.exec(markLabel);
  if (!match) return null;
  return runners.find((runner) => runner.requestId === match[1])?.label ?? match[1];
}

const MIN_MARK_GAP_SECONDS = 0.35 + 1e-6;
const START_PAD_SECONDS = 0.5;

/**
 * Map milestone wall-times onto the race clock, preserving order with a
 * minimum gap so pile-ups stay readable. Each runner interpolates its own
 * marks, so a held request visibly waits mid-track.
 */
export function normalizePace(race: FeatureRace, targetSeconds: number): PacedRunner[] {
  const span = Math.max(1, ...race.runners.map((runner) => runner.endAt));
  return race.runners.map((runner) => {
    const marks: PacedMark[] = [];
    const count = runner.milestones.length;
    runner.milestones.forEach((milestone, index) => {
      const scaled =
        START_PAD_SECONDS + (milestone.at / span) * (targetSeconds - START_PAD_SECONDS);
      const at =
        marks.length === 0
          ? scaled
          : Math.max(scaled, marks[marks.length - 1].at + MIN_MARK_GAP_SECONDS);
      // Even journey with a flat hold: released reuses held's position
      // unless it is itself the line.
      const last = index === count - 1;
      const pos =
        milestone.kind === 'released' && !last
          ? (marks[marks.length - 1]?.pos ?? 0)
          : count <= 1
            ? 1
            : index / (count - 1);
      marks.push({ at, pos: last ? 1 : pos, kind: milestone.kind, label: milestone.label });
    });
    return { ...runner, marks, finishAt: marks[marks.length - 1].at };
  });
}
