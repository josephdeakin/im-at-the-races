import type {
  RepairAttempt,
  Reproducer,
  Trial,
  TrialOutcome,
  VerificationCheck,
} from '@races/contracts';

export interface TrialGroup {
  id: string;
  name: string;
  trials: Trial[];
}

export interface CompareSide {
  experimentId: string;
  experimentName: string;
  trial: Trial;
}

export interface ComparePair {
  before: CompareSide | null;
  after: (CompareSide & { checkName: string }) | null;
  attempt: RepairAttempt;
}

function pickTrial(trials: Trial[], preferredOutcome: TrialOutcome): Trial | null {
  if (trials.length === 0) return null;
  const interventions = trials.filter((trial) => trial.kind === 'intervention');
  const pool = interventions.length > 0 ? interventions : trials;
  return pool.find((trial) => trial.outcome === preferredOutcome) ?? pool[0];
}

function checkRank(name: string): number {
  const rep = /^frozen-rep-(\d+)$/.exec(name);
  if (rep) return Number(rep[1]);
  if (name === 'normal-workflow') return 10;
  if (name.startsWith('variation-')) return 20;
  return 30;
}

/** Latest attempt with verification trials behind it, if any. */
export function selectCompareAttempt(
  attempts: RepairAttempt[],
  checks: VerificationCheck[],
): RepairAttempt | null {
  const withEvidence = attempts.filter((attempt) =>
    checks.some(
      (check) =>
        check.repairAttemptId === attempt.id && check.detail.experimentId !== undefined,
    ),
  );
  if (withEvidence.length === 0) return null;
  return withEvidence.sort((a, b) => b.attempt - a.attempt)[0];
}

/**
 * Before/after pair for one attempt. Before is the finding's source
 * experiment (preferring its failing intervention trial); after is the
 * attempt's earliest verification experiment, preferring frozen-rep-1.
 * Either side is null when its evidence has not been recorded yet.
 */
export function selectComparisonPair(
  attempt: RepairAttempt,
  reproducer: Reproducer,
  checks: VerificationCheck[],
  groups: TrialGroup[],
): Omit<ComparePair, 'attempt'> {
  const source = groups.find((group) => group.id === reproducer.experimentId) ?? null;
  const beforeTrial = source ? pickTrial(source.trials, 'violation') : null;
  const before: CompareSide | null =
    source && beforeTrial
      ? { experimentId: source.id, experimentName: source.name, trial: beforeTrial }
      : null;

  const candidates = checks
    .filter(
      (check) =>
        check.repairAttemptId === attempt.id && check.detail.experimentId !== undefined,
    )
    .sort((a, b) => checkRank(a.name) - checkRank(b.name));
  let after: ComparePair['after'] = null;
  for (const check of candidates) {
    const group = groups.find((candidate) => candidate.id === check.detail.experimentId);
    const trial = group ? pickTrial(group.trials, 'pass') : null;
    if (group && trial) {
      after = {
        experimentId: group.id,
        experimentName: group.name,
        trial,
        checkName: check.name,
      };
      break;
    }
  }
  return { before, after };
}
