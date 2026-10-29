import type { APIResponse, Browser, Page, Route } from 'playwright';
import {
  KNOWN_RUN_EVENT_KINDS,
  type ExperimentPlan,
  type PlanAssertion,
  type TrialAssertionResult,
  type TrialDetail,
  type TrialKind,
  type TrialOutcome,
  type TrialRequestRecord,
} from '@races/contracts';
import type { ArtifactStore, EventSink } from '../index.js';
import { RequestTracker } from './matchers.js';
import { redactExcerpt, redactUrl } from './redact.js';
import { AbortError, isAbortError, isCapacityError, pollFor, sleep } from './util.js';

export const RESPONSE_EXCERPT_MAX_BYTES = 64 * 1024;
const OBSERVED_TEXT_MAX_CHARS = 2000;
const VIEWPORT = { width: 1280, height: 800 };

export interface TrialStore {
  createTrial(experimentId: string, kind: TrialKind, attempt?: number): { id: string };
  finishTrial(trialId: string, outcome: TrialOutcome, detail: TrialDetail): void;
}

export interface TrialRequest {
  plan: ExperimentPlan;
  /** Baseline trials run the same actions/assertions with natural timing. */
  kind: TrialKind;
  /** Discovery pair is attempt 0; confirmation pairs are attempts 1..N. */
  attempt?: number;
  experimentId: string;
  runId: string;
  browser: Browser;
  signal: AbortSignal;
  events: EventSink;
  artifacts: ArtifactStore;
  trials: TrialStore;
}

export interface TrialResult {
  trialId: string;
  outcome: TrialOutcome;
  detail: TrialDetail;
}

interface BoundRecord {
  url: string;
  status: number | null;
  excerpt: string | null;
  truncated: boolean;
  held: boolean;
  released: boolean;
  autoReleased: boolean;
  completed: boolean;
  error: string | null;
}

interface HeldCapture {
  route: Route;
  response: APIResponse;
  timer: NodeJS.Timeout;
}

function newRecord(): BoundRecord {
  return {
    url: '',
    status: null,
    excerpt: null,
    truncated: false,
    held: false,
    released: false,
    autoReleased: false,
    completed: false,
    error: null,
  };
}

/** Internal control flow: the trial ends inconclusive with a saved reason. */
class Inconclusive extends Error {
  constructor(
    readonly reason: string,
    readonly detail: string | null = null,
  ) {
    super(detail ?? reason);
    this.name = 'Inconclusive';
  }
}

function escapeTestId(testId: string): string {
  return testId.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function truncateText(value: string | null): string | null {
  if (value === null) return null;
  return value.length > OBSERVED_TEXT_MAX_CHARS
    ? `${value.slice(0, OBSERVED_TEXT_MAX_CHARS)}…(truncated)`
    : value;
}

export async function executeTrial(request: TrialRequest): Promise<TrialResult> {
  const { plan, kind, experimentId, runId, browser, signal } = request;
  const attempt = request.attempt ?? 0;
  const trialId = request.trials.createTrial(experimentId, kind, attempt).id;
  const shortId = trialId.slice(0, 8);

  const emit = async (eventKind: string, payload: Record<string, unknown>): Promise<void> => {
    await request.events.appendEvent(runId, eventKind, {
      experimentId,
      trialId,
      trialKind: kind,
      ...payload,
    });
  };

  // Trial deadline independent of the parent signal: a trial timeout is an
  // inconclusive outcome with partial evidence, not an interruption.
  const trialAbort = new AbortController();
  let timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    trialAbort.abort();
  }, plan.timeouts.trialMs);
  const onParentAbort = () => trialAbort.abort();
  if (signal.aborted) trialAbort.abort();
  else signal.addEventListener('abort', onParentAbort, { once: true });
  const trialSignal = trialAbort.signal;

  const tracker = new RequestTracker(plan.requests);
  const heldIds = new Set(kind === 'intervention' ? (plan.schedule?.hold ?? []) : []);
  const records = new Map<string, BoundRecord>();
  const heldCaptures = new Map<string, HeldCapture>();
  for (const matcher of plan.requests) records.set(matcher.id, newRecord());

  const releaseHeld = async (logicalId: string, reason: string): Promise<void> => {
    const capture = heldCaptures.get(logicalId);
    const record = records.get(logicalId);
    if (!capture || !record || record.released) return;
    clearTimeout(capture.timer);
    heldCaptures.delete(logicalId);
    record.released = true;
    record.completed = true;
    if (reason === 'max-hold-exceeded') record.autoReleased = true;
    try {
      await capture.route.fulfill({ response: capture.response });
    } catch {
      // Page already gone (abort/cleanup path); the record stands.
    }
    await emit(KNOWN_RUN_EVENT_KINDS.REQUEST_RELEASED, {
      requestId: logicalId,
      reason,
    });
  };

  let context: Awaited<ReturnType<Browser['newContext']>> | null = null;
  try {
    context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();

    await page.route('**/*', async (route: Route) => {
      const candidate = {
        method: route.request().method(),
        url: route.request().url(),
        body: route.request().postData() ?? null,
      };
      const logicalId = tracker.observe(candidate);
      if (!logicalId) {
        await route.continue().catch(() => {});
        return;
      }
      const record = records.get(logicalId);
      if (!record) {
        await route.continue().catch(() => {});
        return;
      }
      record.url = candidate.url;
      await emit(KNOWN_RUN_EVENT_KINDS.REQUEST_STARTED, {
        requestId: logicalId,
        method: candidate.method,
        url: redactUrl(candidate.url),
      });
      let fetched: Awaited<ReturnType<Route['fetch']>>;
      try {
        fetched = await route.fetch();
      } catch (err) {
        record.error = err instanceof Error ? err.message : String(err);
        record.completed = true;
        await route.continue().catch(() => {});
        return;
      }
      const status = fetched.status();
      record.status = status;
      try {
        const body = await fetched.body();
        record.truncated = body.length > RESPONSE_EXCERPT_MAX_BYTES;
        record.excerpt = body.subarray(0, RESPONSE_EXCERPT_MAX_BYTES).toString('utf8');
      } catch {
        record.excerpt = null;
      }
      await emit(KNOWN_RUN_EVENT_KINDS.REQUEST_CAPTURED, {
        requestId: logicalId,
        status,
        held: heldIds.has(logicalId),
      });
      if (!heldIds.has(logicalId)) {
        record.completed = true;
        await route.fulfill({ response: fetched }).catch(() => {});
        return;
      }
      record.held = true;
      const timer = setTimeout(() => {
        void releaseHeld(logicalId, 'max-hold-exceeded');
      }, plan.timeouts.maxHoldMs);
      heldCaptures.set(logicalId, { route, response: fetched, timer });
      await emit(KNOWN_RUN_EVENT_KINDS.REQUEST_HELD, {
        requestId: logicalId,
        status,
        maxHoldMs: plan.timeouts.maxHoldMs,
      });
    });

    await emit(KNOWN_RUN_EVENT_KINDS.TRIAL_STARTED, {
      planId: plan.id,
      startUrl: plan.startUrl,
      attempt,
    });

    try {
      await page.goto(plan.startUrl, {
        waitUntil: 'domcontentloaded',
        timeout: plan.timeouts.actionMs,
      });
    } catch (err) {
      trialSignal.throwIfAborted();
      throw new Inconclusive(
        'navigation-failed',
        `Could not load ${plan.startUrl}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    await runActions(page, request, tracker, emit, trialSignal);

    // Late-starting requests: give declared traffic a bounded window to bind
    // before calling the trial inconclusive.
    await pollFor(
      () => (tracker.unmatched().length === 0 ? true : null),
      plan.timeouts.observationMs,
      trialSignal,
    );
    const missing = tracker.unmatched();
    if (missing.length > 0) {
      throw new Inconclusive(
        'requests-not-matched',
        `Declared requests never matched traffic: ${missing.join(', ')}.`,
      );
    }

    if (kind === 'intervention' && plan.schedule) {
      await runReleaseProgram(plan, releaseHeld, records, emit, trialSignal);
    }

    const label = kind === 'intervention' ? 'post-release' : 'after-actions';
    await captureEvidence('screenshot', () => captureScreenshot(request, page, shortId, kind, label, emit), label, emit);
    await captureEvidence('values', () => captureValues(request, page, plan, trialId, shortId, kind, emit), label, emit);

    const assertionResults = await evaluateAssertions(page, plan, emit, trialSignal);
    const failed = assertionResults.filter((result) => !result.passed);
    if (failed.length > 0) {
      await captureEvidence(
        'screenshot',
        () => captureScreenshot(request, page, shortId, kind, 'assertion-failed', emit),
        'assertion-failed',
        emit,
      );
    }
    const outcome: TrialOutcome = failed.length === 0 ? 'pass' : 'violation';
    const detail = buildDetail(outcome, null, null, plan, assertionResults, records);
    request.trials.finishTrial(trialId, outcome, detail);
    await emit(KNOWN_RUN_EVENT_KINDS.TRIAL_COMPLETED, { outcome });
    return { trialId, outcome, detail };
  } catch (err) {
    if (timedOut && !signal.aborted) {
      const detail = buildDetail(
        'inconclusive',
        'trial-timeout',
        `Trial exceeded ${plan.timeouts.trialMs} ms with partial evidence.`,
        plan,
        [],
        records,
      );
      request.trials.finishTrial(trialId, 'inconclusive', detail);
      await emit(KNOWN_RUN_EVENT_KINDS.TRIAL_COMPLETED, {
        outcome: 'inconclusive',
        reason: 'trial-timeout',
      }).catch(() => {});
      return { trialId, outcome: 'inconclusive', detail };
    }
    if (isAbortError(err) || signal.aborted) {
      // The run is being cancelled or the worker is shutting down: leave a
      // terminal trial record behind instead of a dangling NULL outcome.
      const detail = buildDetail(
        'inconclusive',
        'trial-aborted',
        'Trial aborted before completion (run cancellation or worker shutdown).',
        plan,
        [],
        records,
      );
      try {
        request.trials.finishTrial(trialId, 'inconclusive', detail);
      } catch {
        // Store already gone; the run-level record is authoritative.
      }
      await emit(KNOWN_RUN_EVENT_KINDS.TRIAL_COMPLETED, {
        outcome: 'inconclusive',
        reason: 'trial-aborted',
      }).catch(() => {});
      throw new AbortError();
    }
    if (err instanceof Inconclusive) {
      const detail = buildDetail('inconclusive', err.reason, err.detail, plan, [], records);
      request.trials.finishTrial(trialId, 'inconclusive', detail);
      await emit(KNOWN_RUN_EVENT_KINDS.TRIAL_COMPLETED, {
        outcome: 'inconclusive',
        reason: err.reason,
      }).catch(() => {});
      return { trialId, outcome: 'inconclusive', detail };
    }
    const message = err instanceof Error ? err.message : String(err);
    const detail = buildDetail('runner-error', 'trial-crashed', message, plan, [], records);
    request.trials.finishTrial(trialId, 'runner-error', detail);
    await emit(KNOWN_RUN_EVENT_KINDS.TRIAL_COMPLETED, {
      outcome: 'runner-error',
      reason: 'trial-crashed',
    }).catch(() => {});
    return { trialId, outcome: 'runner-error', detail };
  } finally {
    clearTimeout(deadline);
    signal.removeEventListener('abort', onParentAbort);
    for (const [logicalId] of heldCaptures) {
      const capture = heldCaptures.get(logicalId);
      if (capture) clearTimeout(capture.timer);
    }
    // Resolve held traffic safely before closing: fulfill what we captured so
    // the page never hangs on an open route.
    for (const [logicalId, capture] of [...heldCaptures]) {
      heldCaptures.delete(logicalId);
      const record = records.get(logicalId);
      if (record) {
        record.released = true;
        record.completed = true;
      }
      await capture.route.fulfill({ response: capture.response }).catch(() => {});
    }
    await context?.close().catch(() => {});
  }
}

async function runActions(
  page: Page,
  request: TrialRequest,
  tracker: RequestTracker,
  emit: (kind: string, payload: Record<string, unknown>) => Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  const { plan } = request;
  for (const action of plan.actions) {
    signal.throwIfAborted();
    const locator = page.locator(`[data-testid="${escapeTestId(action.testId)}"]`);
    const timeout = action.timeoutMs ?? plan.timeouts.actionMs;
    try {
      if (action.kind === 'fill') {
        await locator.fill(action.value ?? '', { timeout });
      } else {
        await locator.click({ timeout });
      }
    } catch (err) {
      signal.throwIfAborted();
      throw new Inconclusive(
        'action-failed',
        `Action ${action.id} (${action.kind} [data-testid="${action.testId}"]) failed: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
    tracker.noteActionComplete(action.id);
    await emit(KNOWN_RUN_EVENT_KINDS.ACTION_PERFORMED, {
      actionId: action.id,
      kind: action.kind,
      testId: action.testId,
    });
  }
}

async function runReleaseProgram(
  plan: ExperimentPlan,
  releaseHeld: (logicalId: string, reason: string) => Promise<void>,
  records: Map<string, BoundRecord>,
  emit: (kind: string, payload: Record<string, unknown>) => Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  const schedule = plan.schedule;
  if (!schedule) return;
  for (const step of schedule.releases) {
    signal.throwIfAborted();
    const trigger = await pollFor(
      () => (records.get(step.afterResponse)?.completed ? true : null),
      step.timeoutMs,
      signal,
    );
    if (!trigger) {
      throw new Inconclusive(
        'release-trigger-timeout',
        `Release of ${step.request} timed out waiting for ${step.afterResponse} to complete.`,
      );
    }
    await emit(KNOWN_RUN_EVENT_KINDS.TRIGGER_SATISFIED, {
      requestId: step.request,
      afterResponse: step.afterResponse,
    });
    if (step.settleMs > 0) await sleep(step.settleMs, signal);
    const record = records.get(step.request);
    if (!record?.held) {
      throw new Inconclusive(
        'held-request-not-captured',
        `Release of ${step.request} found no held response (it never arrived or fetch failed).`,
      );
    }
    if (record.autoReleased) {
      throw new Inconclusive(
        'hold-exceeded-before-trigger',
        `Held response ${step.request} hit the ${plan.timeouts.maxHoldMs} ms hold cap before its release step; the planned timing was not applied.`,
      );
    }
    await releaseHeld(step.request, `after-${step.afterResponse}`);
  }
}

/**
 * Best-effort evidence capture: capacity exhaustion stops additional capture
 * and labels the gap with an event instead of crashing the trial. Any other
 * capture failure still surfaces as a runner error.
 */
async function captureEvidence(
  kind: 'screenshot' | 'values',
  save: () => Promise<void>,
  label: string,
  emit: (eventKind: string, payload: Record<string, unknown>) => Promise<void>,
): Promise<void> {
  try {
    await save();
  } catch (err) {
    if (!isCapacityError(err)) throw err;
    await emit(KNOWN_RUN_EVENT_KINDS.EVIDENCE_SKIPPED, {
      kind,
      label,
      reason: 'capacity-exhausted',
      message: `Evidence capture (${kind}, ${label}) skipped: the run exceeded its artifact byte budget. Earlier evidence is preserved.`,
    });
  }
}

async function captureScreenshot(
  request: TrialRequest,
  page: Page,
  shortId: string,
  kind: TrialKind,
  label: string,
  emit: (eventKind: string, payload: Record<string, unknown>) => Promise<void>,
): Promise<void> {
  const png = await page.screenshot({ type: 'png' });
  const filename = `trial-${kind}-${shortId}-${label}.png`;
  const artifact = await request.artifacts.saveArtifact({
    runId: request.runId,
    kind: 'screenshot',
    filename,
    mimeType: 'image/png',
    data: png,
  });
  await emit(KNOWN_RUN_EVENT_KINDS.SCREENSHOT_CAPTURED, {
    artifactId: artifact.id,
    filename,
    label,
  });
}

async function captureValues(
  request: TrialRequest,
  page: Page,
  plan: ExperimentPlan,
  trialId: string,
  shortId: string,
  kind: TrialKind,
  emit: (eventKind: string, payload: Record<string, unknown>) => Promise<void>,
): Promise<void> {
  const testIds = new Set<string>();
  for (const assertion of plan.assertions) testIds.add(assertion.testId);
  const values: Record<string, string | null> = {};
  for (const testId of testIds) {
    values[testId] = await page
      .locator(`[data-testid="${escapeTestId(testId)}"]`)
      .first()
      .textContent({ timeout: 2000 })
      .then((text) => truncateText(text?.trim() ?? null))
      .catch(() => null);
  }
  const filename = `trial-${kind}-${shortId}-values.json`;
  const artifact = await request.artifacts.saveArtifact({
    runId: request.runId,
    kind: 'values',
    filename,
    mimeType: 'application/json',
    data: new TextEncoder().encode(
      JSON.stringify({ trialId, kind, capturedAt: new Date().toISOString(), values }, null, 2),
    ),
  });
  await emit(KNOWN_RUN_EVENT_KINDS.VALUES_CAPTURED, {
    artifactId: artifact.id,
    filename,
    values,
  });
}

async function readTestIdText(page: Page, testId: string): Promise<string | null> {
  return page
    .locator(`[data-testid="${escapeTestId(testId)}"]`)
    .first()
    .textContent({ timeout: 1000 })
    .then((text) => truncateText(text?.trim() ?? null))
    .catch(() => null);
}

function assertionMatches(assertion: PlanAssertion, observed: string | null): boolean {
  if (observed === null) return false;
  return assertion.type === 'textEquals'
    ? observed === assertion.expected
    : observed.includes(assertion.expected);
}

async function evaluateAssertions(
  page: Page,
  plan: ExperimentPlan,
  emit: (kind: string, payload: Record<string, unknown>) => Promise<void>,
  signal: AbortSignal,
): Promise<TrialAssertionResult[]> {
  const results: TrialAssertionResult[] = [];
  for (const assertion of plan.assertions) {
    const deadline = Date.now() + plan.timeouts.observationMs;
    let observed: string | null = null;
    let passed = false;
    for (;;) {
      signal.throwIfAborted();
      observed = await readTestIdText(page, assertion.testId);
      if (assertionMatches(assertion, observed)) {
        passed = true;
        break;
      }
      if (Date.now() >= deadline) break;
      await sleep(200, signal);
    }
    const result: TrialAssertionResult = {
      id: assertion.id,
      passed,
      expected: assertion.expected,
      observed,
    };
    results.push(result);
    await emit(KNOWN_RUN_EVENT_KINDS.ASSERTION_EVALUATED, {
      assertionId: assertion.id,
      passed,
      expected: assertion.expected,
      observed,
    });
  }
  return results;
}

function buildDetail(
  outcome: TrialOutcome,
  reason: string | null,
  detail: string | null,
  plan: ExperimentPlan,
  assertions: TrialAssertionResult[],
  records: Map<string, BoundRecord>,
): TrialDetail {
  const requests: TrialRequestRecord[] = plan.requests.map((matcher) => {
    const record = records.get(matcher.id);
    return {
      id: matcher.id,
      method: matcher.method,
      url: record ? redactUrl(record.url) : '',
      matched: (record?.url ?? '') !== '',
      held: record?.held ?? false,
      released: record?.released ?? false,
      status: record?.status ?? null,
      responseExcerpt: record?.excerpt ? redactExcerpt(record.excerpt) : null,
      responseTruncated: record?.truncated ?? false,
    };
  });
  return { outcome, reason, detail, assertions, requests };
}
