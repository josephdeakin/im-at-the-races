/** Client-safe repair verdict helpers (no server imports). */

import type { RepairAttempt, VerificationCheck } from '@races/contracts';

export type AttemptVerdict = 'verified' | 'failed' | 'incomplete' | 'no-checks';

export interface AttemptSummary {
  verdict: AttemptVerdict;
  passed: number;
  failed: number;
  incomplete: number;
  skipped: number;
  /** Names of the failing or incomplete checks, for one-line explanations. */
  problems: string[];
}

/** Verdict for one attempt's gate set: any fail fails, else any incomplete
 * leaves it incomplete, otherwise it verified for the tested cases. Skipped
 * gates are reported separately and never imply a pass. */
export function summarizeAttemptChecks(checks: VerificationCheck[]): AttemptSummary {
  const summary: AttemptSummary = {
    verdict: 'no-checks',
    passed: 0,
    failed: 0,
    incomplete: 0,
    skipped: 0,
    problems: [],
  };
  if (checks.length === 0) return summary;
  for (const check of checks) {
    if (check.status === 'pass') summary.passed += 1;
    else if (check.status === 'fail') {
      summary.failed += 1;
      summary.problems.push(check.name);
    } else if (check.status === 'incomplete') {
      summary.incomplete += 1;
      summary.problems.push(check.name);
    } else {
      summary.skipped += 1;
    }
  }
  summary.verdict = summary.failed > 0 ? 'failed' : summary.incomplete > 0 ? 'incomplete' : 'verified';
  return summary;
}

export interface RepairSummary {
  verdict: 'verified' | 'unverified' | 'none';
  /** Attempt number of the latest verified patch, if any. */
  verifiedAttempt: number | null;
  attempts: number;
}

/** Overall repair verdict: the latest verified attempt wins; anything else
 * leaves the run investigation-only. */
export function summarizeRepair(
  attempts: RepairAttempt[],
  checks: VerificationCheck[],
): RepairSummary {
  if (attempts.length === 0) return { verdict: 'none', verifiedAttempt: null, attempts: 0 };
  const ordered = [...attempts].sort((a, b) => a.attempt - b.attempt);
  let verifiedAttempt: number | null = null;
  for (const attempt of ordered) {
    const attemptChecks = checks.filter((c) => c.repairAttemptId === attempt.id);
    if (summarizeAttemptChecks(attemptChecks).verdict === 'verified') {
      verifiedAttempt = attempt.attempt;
    }
  }
  return {
    verdict: verifiedAttempt !== null ? 'verified' : 'unverified',
    verifiedAttempt,
    attempts: ordered.length,
  };
}

const CHECK_LABELS: Record<string, string> = {
  'reproducer-fails-on-original': 'Reproducer fails on original app',
  'original-build': 'Original build (pristine baseline)',
  'original-typecheck': 'Original typecheck (pristine baseline)',
  'original-test': 'Original test (pristine baseline)',
  'patch-nonempty': 'Patch is non-empty',
  'reproducer-intact': 'Reproducer unchanged by repair',
  'project-build': 'Patched build',
  'project-typecheck': 'Patched typecheck',
  'project-test': 'Patched test',
  'patched-app-serves': 'Patched app serves',
  'normal-workflow': 'Natural workflow on patched app',
  'variation-early-delivery': 'Early-delivery variation',
  'variation-late-delivery': 'Late-delivery variation',
};

export function checkLabel(name: string): string {
  const known = CHECK_LABELS[name];
  if (known) return known;
  const rep = /^frozen-rep-(\d+)$/.exec(name);
  if (rep) return `Frozen reproducer, repetition ${rep[1]} of 3`;
  return name.replace(/-/g, ' ');
}

/** One human line from a check's detail payload for the matrix row. */
export function checkOneLiner(check: VerificationCheck): string | null {
  const detail = check.detail;
  if (detail.note) return detail.note;
  if (detail.reason) return detail.reason;
  if (detail.error) return detail.error.slice(0, 200);
  if (detail.baseline && detail.intervention) {
    return `baseline ${detail.baseline} · intervention ${detail.intervention}`;
  }
  if (typeof detail.exitCode === 'number') {
    const suffix =
      typeof detail.baselineExitCode === 'number' ? ` (baseline ${detail.baselineExitCode})` : '';
    return `exit ${detail.exitCode}${suffix}`;
  }
  if (detail.url) return detail.url;
  return null;
}
