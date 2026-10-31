import { KNOWN_RUN_EVENT_KINDS } from '@races/contracts';
import {
  INVESTIGATION_PHASES,
  type ExecutionContext,
  type ExecutionOutcome,
  type Executor,
} from './index.js';
import { isAbortError, sleep } from './runner/util.js';

export { AbortError, sleep } from './runner/util.js';

const STEPS: { phase: string; message: string; delayMs: number }[] = [
  {
    phase: INVESTIGATION_PHASES.INSPECTING,
    message: 'Stub executor: inspecting project (no real investigation yet).',
    delayMs: 750,
  },
  {
    phase: INVESTIGATION_PHASES.EXPERIMENTING,
    message: 'Stub executor: experimenting (no browser attached yet).',
    delayMs: 750,
  },
  {
    phase: INVESTIGATION_PHASES.VERIFYING,
    message: 'Stub executor: verifying (nothing to verify yet).',
    delayMs: 750,
  },
];

/**
 * Deterministic executor for tests: walks the phase vocabulary and completes
 * without a browser or model. Abort-aware: stops immediately and reports
 * interrupted when the context signal fires.
 */
export class StubExecutor implements Executor {
  readonly name = 'stub';

  async execute(ctx: ExecutionContext): Promise<ExecutionOutcome> {
    try {
      for (const step of STEPS) {
        ctx.signal.throwIfAborted();
        await ctx.events.setPhase(ctx.run.id, step.phase);
        await ctx.events.appendEvent(ctx.run.id, KNOWN_RUN_EVENT_KINDS.LOG, {
          message: step.message,
        });
        await sleep(step.delayMs, ctx.signal);
      }
      await ctx.events.setPhase(ctx.run.id, INVESTIGATION_PHASES.DONE);
      return { status: 'completed' };
    } catch (err) {
      if (isAbortError(err)) {
        return { status: 'interrupted', errorMessage: 'Run aborted.' };
      }
      throw err;
    }
  }
}
