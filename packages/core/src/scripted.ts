import {
  ExperimentPlanSchema,
  KNOWN_RUN_EVENT_KINDS,
  type ExperimentPlan,
} from '@races/contracts';
import {
  INVESTIGATION_PHASES,
  type ExecutionContext,
  type ExecutionOutcome,
  type Executor,
} from './index.js';
import { STALE_SEARCH_PLAN_TEMPLATE } from './plans/stale-search.js';
import { launchBrowser } from './runner/browser.js';
import { runExperiment, type ExperimentStore } from './runner/experiment.js';
import { isAbortError } from './runner/util.js';

/**
 * M2 executor: runs the checked-in scripted experiment against the run's
 * project target URL. No model calls, no generated plans — the scripted plan
 * proves the execution path (hold/release, evidence, assertions) that M3's
 * agent loop will drive. Replaced by the agent executor in M3.
 */
export class ScriptedExecutor implements Executor {
  readonly name = 'scripted';

  constructor(private readonly store: ExperimentStore) {}

  async execute(ctx: ExecutionContext): Promise<ExecutionOutcome> {
    let plan: ExperimentPlan;
    try {
      plan = ExperimentPlanSchema.parse({
        ...STALE_SEARCH_PLAN_TEMPLATE,
        startUrl: ctx.project.targetUrl,
      });
    } catch (err) {
      return {
        status: 'failed',
        errorCode: 'INVALID_PLAN',
        errorMessage: `Scripted plan failed validation: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    await ctx.events.setPhase(ctx.run.id, INVESTIGATION_PHASES.EXPERIMENTING);
    const browser = await launchBrowser().catch((err: unknown) => {
      throw new Error(err instanceof Error ? err.message : String(err));
    });
    try {
      await ctx.events.appendEvent(ctx.run.id, KNOWN_RUN_EVENT_KINDS.LOG, {
        message: `Scripted experiment ${plan.id} targeting ${plan.startUrl}.`,
      });
      const result = await runExperiment({
        plan,
        runId: ctx.run.id,
        browser,
        signal: ctx.signal,
        events: ctx.events,
        artifacts: ctx.artifacts,
        store: this.store,
      });
      await ctx.events.setPhase(ctx.run.id, INVESTIGATION_PHASES.DONE);
      await ctx.events.appendEvent(ctx.run.id, KNOWN_RUN_EVENT_KINDS.LOG, {
        message:
          `Scripted experiment finished: baseline ${result.baseline.outcome}, ` +
          `intervention ${result.intervention?.outcome ?? 'skipped'}.`,
      });
      const failed = [result.baseline, result.intervention].some(
        (trial) => trial?.outcome === 'runner-error',
      );
      return failed
        ? {
            status: 'failed',
            errorCode: 'TRIAL_RUNNER_ERROR',
            errorMessage: 'A trial failed with a runner error; see trial evidence.',
          }
        : { status: 'completed' };
    } catch (err) {
      if (isAbortError(err) || ctx.signal.aborted) {
        return { status: 'interrupted', errorMessage: 'Run aborted.' };
      }
      throw err;
    } finally {
      await browser.close().catch(() => {});
    }
  }
}
