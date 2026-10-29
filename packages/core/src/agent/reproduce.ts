import type { TrialDetail } from '@races/contracts';
import type { StoredTrial } from '../runner/experiment.js';

export interface ReproduceVerdict {
  /** Assertion IDs that passed at baseline and failed under intervention. */
  candidateChecks: string[];
  /** Confirmation attempts (1..N) with both trials finished. */
  attempts: number;
  /** Attempts where baseline passed and the intervention violated a candidate check. */
  violations: number;
  reproduced: boolean;
}

function asDetail(detail: Record<string, unknown> | null): TrialDetail | null {
  if (!detail || typeof detail !== 'object') return null;
  if (!Array.isArray(detail.assertions)) return null;
  return detail as unknown as TrialDetail;
}

function passedIds(detail: TrialDetail | null): Set<string> {
  const ids = new Set<string>();
  if (!detail) return ids;
  for (const assertion of detail.assertions) {
    if (assertion.passed) ids.add(assertion.id);
  }
  return ids;
}

function failedIds(detail: TrialDetail | null): Set<string> {
  const ids = new Set<string>();
  if (!detail) return ids;
  for (const assertion of detail.assertions) {
    if (!assertion.passed) ids.add(assertion.id);
  }
  return ids;
}

/**
 * FI02 operating rule, computed by the orchestrator — never by the model.
 * A check is a candidate when the discovery pair (attempt 0) passes it at
 * baseline and violates it under intervention. A confirmation attempt counts
 * as a violation only when its baseline passes and its intervention violates
 * the same candidate check. Reproduced at 2 of 3 (or 2+ of any run of)
 * violating attempts; runner-errored attempts count toward neither side.
 */
export function computeReproduced(trials: StoredTrial[]): ReproduceVerdict {
  const empty: ReproduceVerdict = { candidateChecks: [], attempts: 0, violations: 0, reproduced: false };
  const discoveryBaseline = trials.find((t) => t.kind === 'baseline' && t.attempt === 0);
  const discoveryIntervention = trials.find((t) => t.kind === 'intervention' && t.attempt === 0);
  if (!discoveryBaseline || !discoveryIntervention) return empty;
  if (discoveryBaseline.outcome !== 'pass' || discoveryIntervention.outcome !== 'violation') {
    return empty;
  }
  const candidateChecks = [...failedIds(asDetail(discoveryIntervention.detail))].filter((id) =>
    passedIds(asDetail(discoveryBaseline.detail)).has(id),
  );
  if (candidateChecks.length === 0) return empty;
  const candidates = new Set(candidateChecks);

  const attempts = new Map<number, { baseline?: StoredTrial; intervention?: StoredTrial }>();
  for (const trial of trials) {
    if (trial.attempt < 1 || trial.outcome === null) continue;
    const group = attempts.get(trial.attempt) ?? {};
    if (trial.kind === 'baseline') group.baseline = trial;
    if (trial.kind === 'intervention') group.intervention = trial;
    attempts.set(trial.attempt, group);
  }
  let finished = 0;
  let violations = 0;
  for (const group of attempts.values()) {
    if (!group.baseline || !group.intervention) continue;
    if (group.baseline.outcome === null || group.intervention.outcome === null) continue;
    finished += 1;
    if (group.baseline.outcome !== 'pass') continue;
    if (group.intervention.outcome !== 'violation') continue;
    const violatesSame = [...failedIds(asDetail(group.intervention.detail))].some(
      (id) => candidates.has(id) && passedIds(asDetail(group.baseline!.detail)).has(id),
    );
    if (violatesSame) violations += 1;
  }
  return { candidateChecks, attempts: finished, violations, reproduced: violations >= 2 };
}
