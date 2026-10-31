import {
  computeConfirmationVerdict,
  requestIdOf,
  type RunEvent,
  type Trial,
} from '@races/contracts';

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

function findEvent<K extends 'trigger.satisfied' | 'request.released' | 'request.captured'>(
  events: RunEvent[],
  kind: K,
  requestId: string,
): Extract<RunEvent, { kind: K }> | undefined {
  return events.find(
    (e): e is Extract<RunEvent, { kind: K }> => e.kind === kind && requestIdOf(e) === requestId,
  );
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
    const triggerId = triggerEvent ? triggerEvent.payload.afterResponse : null;
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
      (e) => e.kind === 'assertion.evaluated' && e.payload.assertionId === firstFailed.id,
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
 * Display tally for the FI02 rule (single implementation:
 * computeConfirmationVerdict in @races/contracts). The recorded finding
 * status stays authoritative; this only renders the count.
 */
export function tallyConfirmations(trials: Trial[]): ConfirmationTally {
  const verdict = computeConfirmationVerdict(trials);
  if (verdict.attempts === 0) return { attempts: 0, violations: 0, text: 'unconfirmed' };
  return {
    attempts: verdict.attempts,
    violations: verdict.violations,
    text: `${verdict.violations} of ${verdict.attempts}`,
  };
}
