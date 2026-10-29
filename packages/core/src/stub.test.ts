import { describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from './index.js';
import { StubExecutor } from './stub.js';

function makeContext(signal?: AbortSignal): ExecutionContext {
  const controller = new AbortController();
  return {
    run: {
      id: 'run-1',
      projectId: 'project-1',
      task: 'task',
      mode: 'investigate',
      status: 'running',
      phase: 'claimed',
      limits: { durationMs: 600_000, modelCalls: 30, experiments: 6 },
      cancelRequestedAt: null,
      createdAt: new Date(0).toISOString(),
      startedAt: new Date(0).toISOString(),
      finishedAt: null,
      errorCode: null,
      errorMessage: null,
    },
    project: {
      id: 'project-1',
      name: 'Shop',
      repositoryPath: '/tmp/shop',
      targetUrl: 'http://127.0.0.1:4100',
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    },
    limits: { durationMs: 600_000, modelCalls: 30, experiments: 6 },
    events: {
      appendEvent: vi.fn(async (runId: string) => ({
        id: `event-${runId}`,
        runId,
        sequence: 0,
        kind: 'run.log',
        payload: {},
        createdAt: new Date(0).toISOString(),
      })),
      setPhase: vi.fn(async () => {}),
    },
    artifacts: {
      saveArtifact: vi.fn(async (input: { runId: string }) => ({
        id: 'artifact-1',
        runId: input.runId,
        kind: 'trace',
        relativePath: 'trace.json',
        mimeType: 'application/json',
        sizeBytes: 0,
        sha256: '',
        createdAt: new Date(0).toISOString(),
      })),
    },
    signal: signal ?? controller.signal,
  };
}

describe('StubExecutor', () => {
  it('walks phases and completes', async () => {
    const executor = new StubExecutor();
    const ctx = makeContext();
    const outcome = await executor.execute(ctx);
    expect(outcome).toEqual({ status: 'completed' });
    expect(ctx.events.setPhase).toHaveBeenCalledTimes(4);
    expect(ctx.events.appendEvent).toHaveBeenCalledTimes(3);
  }, 10_000);

  it('stops promptly and reports interrupted when aborted', async () => {
    const executor = new StubExecutor();
    const controller = new AbortController();
    const ctx = makeContext(controller.signal);
    const pending = executor.execute(ctx);
    controller.abort();
    const outcome = await pending;
    expect(outcome.status).toBe('interrupted');
  }, 10_000);

  it('reports interrupted when the signal is already aborted', async () => {
    const executor = new StubExecutor();
    const controller = new AbortController();
    controller.abort();
    const outcome = await executor.execute(makeContext(controller.signal));
    expect(outcome.status).toBe('interrupted');
  });
});
