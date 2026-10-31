import type { Browser } from 'playwright';
import {
  KNOWN_RUN_EVENT_KINDS,
  RUNNER_CAPABILITIES,
  type ExperimentPlan,
} from '@races/contracts';
import type { ArtifactStore, EventSink } from '../index.js';
import { executeTrial, type TrialResult, type TrialStore } from './trial.js';
import { asJsonRecord, isAbortError } from './util.js';

export interface StoredExperiment {
  id: string;
  runId: string;
  plan: Record<string, unknown>;
}

export interface StoredTrial {
  id: string;
  kind: string;
  attempt: number;
  outcome: string | null;
  detail: Record<string, unknown> | null;
}

export interface ExperimentStore extends TrialStore {
  createExperiment(
    runId: string,
    input: { name: string; hypothesis: string; plan: Record<string, unknown> },
  ): { id: string };
  finishExperiment(experimentId: string, status: 'completed' | 'failed' | 'interrupted'): void;
  getExperiment(experimentId: string): StoredExperiment | undefined;
  listTrials(experimentId: string): StoredTrial[];
}

export interface ExperimentRequest {
  plan: ExperimentPlan;
  runId: string;
  browser: Browser;
  signal: AbortSignal;
  events: EventSink;
  artifacts: ArtifactStore;
  store: ExperimentStore;
}

export interface ExperimentResult {
  experimentId: string;
  baseline: TrialResult;
  /** Null when the baseline runner-errored and the intervention was skipped. */
  intervention: TrialResult | null;
}

const SUPPORTED_CAPABILITIES: ReadonlySet<string> = new Set([
  RUNNER_CAPABILITIES.HTTP_HOLD_RELEASE,
]);

/**
 * Run one plan as a baseline trial (natural timing) plus an intervention
 * trial (held/reordered delivery). Both use equivalent actions, inputs, and
 * assertions; only the delivery schedule differs. Abort propagates to the
 * caller; a baseline runner-error skips the intervention.
 */
export async function runExperiment(request: ExperimentRequest): Promise<ExperimentResult> {
  const { plan, runId, browser, signal, events, artifacts, store } = request;
  const unsupported = plan.requiredCapabilities.filter((cap) => !SUPPORTED_CAPABILITIES.has(cap));
  if (unsupported.length > 0) {
    throw new Error(`Unsupported runner capabilities: ${unsupported.join(', ')}.`);
  }

  const experimentId = store.createExperiment(runId, {
    name: plan.id,
    hypothesis: plan.hypothesis,
    plan: asJsonRecord(plan),
  }).id;
  await events.appendEvent(runId, KNOWN_RUN_EVENT_KINDS.EXPERIMENT_STARTED, {
    experimentId,
    planId: plan.id,
    hypothesis: plan.hypothesis,
  });

  const trialBase = { experimentId, runId, browser, signal, events, artifacts, trials: store };
  try {
    const baseline = await executeTrial({ ...trialBase, plan, kind: 'baseline' });

    let intervention: TrialResult | null = null;
    if (baseline.outcome !== 'runner-error') {
      intervention = await executeTrial({ ...trialBase, plan, kind: 'intervention' });
    }

    const failed = [baseline, intervention].some((trial) => trial?.outcome === 'runner-error');
    store.finishExperiment(experimentId, failed ? 'failed' : 'completed');
    await events.appendEvent(runId, KNOWN_RUN_EVENT_KINDS.EXPERIMENT_COMPLETED, {
      experimentId,
      planId: plan.id,
      status: failed ? 'failed' : 'completed',
      baseline: baseline.outcome,
      intervention: intervention?.outcome ?? null,
    });
    return { experimentId, baseline, intervention };
  } catch (err) {
    // Abort or unexpected crash: never leave the experiment stuck `running`.
    const status = isAbortError(err) || signal.aborted ? 'interrupted' : 'failed';
    try {
      store.finishExperiment(experimentId, status);
    } catch {
      // Store already gone; the run-level record is authoritative.
    }
    await Promise.resolve(
      events.appendEvent(runId, KNOWN_RUN_EVENT_KINDS.EXPERIMENT_COMPLETED, {
        experimentId,
        planId: plan.id,
        status,
      }),
    ).catch(() => {});
    throw err;
  }
}
