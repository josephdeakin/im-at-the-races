import type { TrialOutcome } from '@races/contracts';

// Pure race-day logic: form figures and starting prices from trial outcomes,
// plus the racecaller's lines. The component owns animation and audio.

export function shortName(name: string): string {
  if (name.length <= 28) return name;
  // Siblings share long prefixes (plan id + qualifier); keep the tail so
  // labels stay distinguishable.
  const tail = 13;
  return `${name.slice(0, 28 - 1 - tail)}…${name.slice(name.length - tail)}`;
}

function figure(outcome: TrialOutcome | null): string {
  switch (outcome) {
    case 'violation':
      return '1';
    case 'pass':
      return '2';
    case 'inconclusive':
      return '4';
    case 'runner-error':
      return 'R';
    default:
      return '-';
  }
}

/** Racecard form from the last three trials, e.g. "1-2-1". */
export function formFigures(
  trials: { outcome: TrialOutcome | null }[],
  take = 3,
): string {
  const recent = trials.slice(-take);
  if (recent.length === 0) return '—';
  return recent.map((trial) => figure(trial.outcome)).join('-');
}

/** Higher means better form: violations win, runner errors embarrass. */
export function formScore(trials: { outcome: TrialOutcome | null }[]): number {
  let score = 0;
  for (const trial of trials) {
    if (trial.outcome === 'violation') score += 3;
    else if (trial.outcome === 'pass') score += 1;
    else if (trial.outcome === 'runner-error') score -= 2;
  }
  return score;
}

const ODDS_LADDER = ['6/4', '5/2', '4/1', '8/1', '10/1', '16/1'];

export type RaceDayOffer = {
  showCard: boolean;
  showUndercard: boolean;
};

/**
 * Which races to offer. The undercard needs at least two finished
 * experiments — a single runner "walking it alone" is no race. The feature
 * race is decided by the evidence (see selectFeatureFinding) and can stand
 * alone.
 */
export function raceDayOffer(
  experiments: { status: string }[],
  hasFeature: boolean,
): RaceDayOffer {
  const finished =
    experiments.length > 0 && experiments.every((e) => e.status !== 'running');
  const showUndercard = finished && experiments.length >= 2;
  return { showCard: showUndercard || hasFeature, showUndercard };
}

/** Starting prices by form rank: best form takes the shortest odds. */
export function startingPrices(scores: number[]): string[] {
  const ranked = scores
    .map((score, index) => ({ score, index }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const prices = new Array<string>(scores.length);
  ranked.forEach(({ index }, rank) => {
    prices[index] = ODDS_LADDER[Math.min(rank, ODDS_LADDER.length - 1)];
  });
  return prices;
}

export function ordinal(place: number): string {
  if (place === 1) return '1st';
  if (place === 2) return '2nd';
  if (place === 3) return '3rd';
  return `${place}th`;
}

export function lengthsBehind(gap: number): string {
  if (gap < 0.012) return 'a nose';
  if (gap < 0.03) return 'a neck';
  if (gap < 0.06) return 'half a length';
  if (gap < 0.14) return 'a length';
  return `${Math.max(2, Math.round(gap * 10))} lengths`;
}

export function callStart(first: string): string {
  return `And they're off! ${first} breaks smartly.`;
}

export function callLeadChange(name: string): string {
  return `${name} hits the front!`;
}

export function callHalfway(order: string[]): string {
  if (order.length < 2) return `${order[0]} is clear at halfway.`;
  return `At halfway it's ${order[0]} from ${order[1]}.`;
}

export function callStretch(order: string[], gap: number): string {
  if (order.length < 2) return `${order[0]} is home alone.`;
  return `Into the stretch: ${order[0]} leads ${order[1]} by ${lengthsBehind(gap)}.`;
}

export function callFinish(order: string[], photo: boolean): string {
  if (order.length < 2) return `${order[0]} walks it alone!`;
  if (photo) return `Photo finish! ${order[0]} gets the nod over ${order[1]}!`;
  return `${order[0]} wins it, ${order[1]} second!`;
}

export function callHold(label: string): string {
  return `${label} is held at the start!`;
}

export function callRelease(label: string, trigger: string | null): string {
  if (trigger) return `${label} is released after ${trigger}...`;
  return `${label} is finally released...`;
}

export function callCrossed(label: string, place: number): string {
  return `${label} crosses the line ${ordinal(place)}!`;
}

export function callResultBoard(observed: string | null): string {
  if (!observed) return 'The result is under review...';
  return `But the result shows "${observed}"!`;
}

export function callInquiry(staleLabel: string | null): string {
  if (!staleLabel) return "Stewards' inquiry! The result stands — controversial!";
  return `Stewards' inquiry! ${staleLabel}'s stale result stands — the wrong horse won!`;
}

/** Which recorded request the observed value names, by query match. */
export function observedRunner(
  observed: string | null,
  runners: { label: string }[],
): string | null {
  if (!observed) return null;
  const lowered = observed.toLowerCase();
  return runners.find((runner) => lowered.includes(runner.label.toLowerCase()))?.label ?? null;
}
