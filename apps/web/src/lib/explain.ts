import type { RunEvent, Trial } from '@races/contracts';

export interface ExplanationLink {
  label: string;
  eventSequence: number;
}

export interface TrialExplanation {
  headline: string;
  detail: string | null;
  links: ExplanationLink[];
  /** Presentation hint; callers must pair color with icon/text, never color alone. */
  tone: 'bad' | 'good' | 'muted';
}

function payloadString(event: RunEvent, key: string): string | null {
  const value = event.payload[key];
  return typeof value === 'string' ? value : null;
}

function findEvent(
  events: RunEvent[],
  kind: string,
  requestId: string,
): RunEvent | undefined {
  return events.find((e) => e.kind === kind && payloadString(e, 'requestId') === requestId);
}

/**
 * One-paragraph, evidence-linked explanation of a trial outcome. Every claim
 * links to a recorded event sequence; uncertain causes say so instead of
 * inventing a story.
 */
export function explainTrial(trial: Trial, events: RunEvent[]): TrialExplanation {
  const detail = trial.detail;
  if (!trial.outcome || !detail) {
    return {
      headline: 'Trial still running: no outcome recorded yet.',
      detail: null,
      links: [],
      tone: 'muted',
    };
  }
  if (trial.outcome === 'pass') {
    const names = detail.assertions.map((a) => a.id).join(', ');
    return {
      headline: `All ${detail.assertions.length} check${detail.assertions.length === 1 ? '' : 's'} passed under the recorded delivery order.`,
      detail: names === '' ? null : `Passed: ${names}.`,
      links: [],
      tone: 'good',
    };
  }
  if (trial.outcome === 'inconclusive') {
    return {
      headline: `No conclusion: ${detail.reason ?? 'required evidence was not established'}.`,
      detail: detail.detail ?? 'The trial could not establish what it set out to check.',
      links: [],
      tone: 'muted',
    };
  }
  if (trial.outcome === 'runner-error') {
    return {
      headline: `Trial tooling failed (${detail.reason ?? 'runner-error'}); this says nothing about the app.`,
      detail: detail.detail,
      links: [],
      tone: 'muted',
    };
  }

  // Violation: link the late response, its trigger, and the failed check.
  const failed = detail.assertions.filter((a) => !a.passed);
  const held = detail.requests.find((r) => r.held && r.released) ?? null;
  const links: ExplanationLink[] = [];
  let headline: string;
  if (held) {
    const triggerEvent = findEvent(events, 'trigger.satisfied', held.id);
    const triggerId = triggerEvent ? payloadString(triggerEvent, 'afterResponse') : null;
    const releaseEvent = findEvent(events, 'request.released', held.id);
    if (releaseEvent) links.push({ label: `late response ${held.id}`, eventSequence: releaseEvent.sequence });
    if (triggerId) {
      const capturedEvent = findEvent(events, 'request.captured', triggerId);
      if (capturedEvent) {
        links.push({ label: `trigger ${triggerId}`, eventSequence: capturedEvent.sequence });
      }
    }
    headline =
      triggerId !== null
        ? `Response “${held.id}” arrived after “${triggerId}” completed and replaced the displayed results.`
        : `Held response “${held.id}” was released late and replaced the displayed results.`;
    if (!triggerEvent) {
      headline += ' The exact trigger was not recorded, so treat the ordering claim with care.';
    }
  } else {
    headline =
      'A check failed under the recorded delivery order, but no held response is on record: the cause is uncertain.';
  }
  const firstFailed = failed[0] ?? null;
  let detailText: string | null = null;
  if (firstFailed) {
    detailText = `Check “${firstFailed.id}”: expected ${JSON.stringify(firstFailed.expected)}, observed ${JSON.stringify(firstFailed.observed)}.`;
    const assertionEvent = events.find(
      (e) => e.kind === 'assertion.evaluated' && payloadString(e, 'assertionId') === firstFailed.id,
    );
    if (assertionEvent) {
      links.push({ label: `failed check ${firstFailed.id}`, eventSequence: assertionEvent.sequence });
    }
  }
  return { headline, detail: detailText, links, tone: 'bad' };
}

export interface ConfirmationTally {
  attempts: number;
  violations: number;
  text: string;
}

/**
 * Display tally mirroring the FI02 rule: confirmation attempts (numbered 1..N
 * past discovery) where the baseline passed and the intervention violated the
 * same check that discovery violated. The recorded finding status stays
 * authoritative; this only renders the count.
 */
export function tallyConfirmations(trials: Trial[]): ConfirmationTally {
  const empty: ConfirmationTally = { attempts: 0, violations: 0, text: 'unconfirmed' };
  const baseline = trials.find((t) => t.kind === 'baseline' && t.attempt === 0);
  const intervention = trials.find((t) => t.kind === 'intervention' && t.attempt === 0);
  if (!baseline || !intervention) return empty;
  if (baseline.outcome !== 'pass' || intervention.outcome !== 'violation') return empty;
  const passed = new Set(
    (baseline.detail?.assertions ?? []).filter((a) => a.passed).map((a) => a.id),
  );
  const candidates = new Set(
    (intervention.detail?.assertions ?? [])
      .filter((a) => !a.passed && passed.has(a.id))
      .map((a) => a.id),
  );
  if (candidates.size === 0) return empty;
  const byAttempt = new Map<number, { baseline?: Trial; intervention?: Trial }>();
  for (const trial of trials) {
    if (trial.attempt < 1 || !trial.outcome) continue;
    const group = byAttempt.get(trial.attempt) ?? {};
    if (trial.kind === 'baseline') group.baseline = trial;
    if (trial.kind === 'intervention') group.intervention = trial;
    byAttempt.set(trial.attempt, group);
  }
  let attempts = 0;
  let violations = 0;
  for (const group of byAttempt.values()) {
    if (!group.baseline?.outcome || !group.intervention?.outcome) continue;
    attempts += 1;
    if (group.baseline.outcome !== 'pass' || group.intervention.outcome !== 'violation') continue;
    const groupPassed = new Set(
      (group.baseline.detail?.assertions ?? []).filter((a) => a.passed).map((a) => a.id),
    );
    const same = (group.intervention.detail?.assertions ?? []).some(
      (a) => !a.passed && candidates.has(a.id) && groupPassed.has(a.id),
    );
    if (same) violations += 1;
  }
  if (attempts === 0) return empty;
  return { attempts, violations, text: `${violations} of ${attempts}` };
}
