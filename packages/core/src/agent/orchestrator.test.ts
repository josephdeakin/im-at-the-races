import { createServer, type Server } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PLAN_TIMEOUTS,
  RunEventSchema,
  type ExperimentPlan,
  type FindingStatus,
  type RunEvent,
  type RunEventKind,
  type RunEventPayloadMap,
  type TrialDetail,
  type TrialKind,
  type TrialOutcome,
} from '@races/contracts';
import type { ArtifactStore, EventSink, ExecutionContext } from '../index.js';
import type { ExperimentRequest, StoredTrial } from '../runner/experiment.js';
import type { TrialRequest, TrialResult } from '../runner/trial.js';
import type { ModelClient, ModelMessage, ModelResponse, ModelToolDefinition } from './model.js';
import { AgentExecutor, UnavailableExecutor, type AgentStore } from './orchestrator.js';
import type { AgentTrialRunner } from './tools.js';

let server: Server;
let targetUrl = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  targetUrl = `http://127.0.0.1:${address.port}/`;
}, 30_000);

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server?.close((err) => (err ? reject(err) : resolve())),
  );
});

type Responder = (messages: ModelMessage[]) => ModelResponse;

class FakeModelClient implements ModelClient {
  calls = 0;
  constructor(private readonly responders: Responder[]) {}
  async complete(
    messages: ModelMessage[],
    _tools: ModelToolDefinition[],
    _system: string,
  ): Promise<ModelResponse> {
    const responder = this.responders[Math.min(this.calls, this.responders.length - 1)];
    this.calls += 1;
    return responder(messages);
  }
}

function toolCall(id: string, name: string, input: Record<string, unknown>): ModelResponse {
  return {
    text: '',
    toolCalls: [{ type: 'tool_use', id, name, input }],
    stopReason: 'tool_use',
    usage: { inputTokens: 10, outputTokens: 5 },
  };
}

interface StoredExperiment {
  id: string;
  runId: string;
  plan: Record<string, unknown>;
}

interface FindingInput {
  runId: string;
  experimentId: string;
  title: string;
  status: FindingStatus;
  expectationProvenance: string;
  explanation: string;
  implicatedCode: { path: string; excerpt: string | null; exists: boolean }[];
  sourceIdentity: string;
}

function makeStore() {
  const experiments = new Map<string, StoredExperiment>();
  const trials = new Map<string, StoredTrial & { detail: TrialDetail | null }>();
  const findings: (FindingInput & { id: string })[] = [];
  let counter = 0;
  const store: AgentStore = {
    createExperiment: vi.fn((runId: string, input: { name: string; hypothesis: string; plan: Record<string, unknown> }) => {
      const id = `exp-${(counter += 1)}`;
      experiments.set(id, { id, runId, plan: input.plan });
      return { id };
    }),
    finishExperiment: vi.fn(() => {}),
    getExperiment: vi.fn((experimentId: string) => experiments.get(experimentId)),
    listTrials: vi.fn((experimentId: string) =>
      [...trials.values()].filter((t) => t.id.startsWith(`${experimentId}:`)),
    ),
    createTrial: vi.fn((experimentId: string, kind: TrialKind, attempt = 0) => {
      const id = `${experimentId}:${kind}:${attempt}:${(counter += 1)}`;
      const row = { id, kind, attempt, outcome: null, detail: null };
      trials.set(id, row as StoredTrial & { detail: TrialDetail | null });
      return { id };
    }),
    finishTrial: vi.fn((trialId: string, outcome: TrialOutcome, detail: TrialDetail) => {
      const row = trials.get(trialId);
      if (!row) throw new Error(`unknown trial ${trialId}`);
      row.outcome = outcome;
      row.detail = detail;
    }),
    createFinding: vi.fn((input: FindingInput) => {
      const id = `finding-${findings.length + 1}`;
      findings.push({ ...input, id });
      return { id };
    }),
    createReproducer: vi.fn(() => ({ id: 'repro-1' })),
    createRepairAttempt: vi.fn(() => ({ id: 'attempt-1' })),
    finishRepairAttempt: vi.fn(() => {}),
    createVerificationCheck: vi.fn(() => ({ id: 'check-1' })),
  };
  return { store, experiments, trials, findings };
}

function cannedDetail(kind: TrialKind): TrialDetail {
  const passed = kind === 'baseline';
  return {
    outcome: passed ? 'pass' : 'violation',
    reason: null,
    detail: null,
    assertions: [{ id: 'check', passed, expected: 'latest', observed: passed ? 'latest' : 'stale' }],
    requests: [],
  };
}

function makeFakeRunner(): AgentTrialRunner {
  return {
    runExperiment: async (request: ExperimentRequest) => {
      const experimentId = request.store.createExperiment(request.runId, {
        name: request.plan.id,
        hypothesis: request.plan.hypothesis,
        plan: request.plan as unknown as Record<string, unknown>,
      }).id;
      const baselineId = request.store.createTrial(experimentId, 'baseline', 0).id;
      const baselineDetail = cannedDetail('baseline');
      request.store.finishTrial(baselineId, 'pass', baselineDetail);
      const interventionId = request.store.createTrial(experimentId, 'intervention', 0).id;
      const interventionDetail = cannedDetail('intervention');
      request.store.finishTrial(interventionId, 'violation', interventionDetail);
      request.store.finishExperiment(experimentId, 'completed');
      return {
        experimentId,
        baseline: { trialId: baselineId, outcome: 'pass', detail: baselineDetail },
        intervention: { trialId: interventionId, outcome: 'violation', detail: interventionDetail },
      };
    },
    executeTrial: async (request: TrialRequest): Promise<TrialResult> => {
      const trialId = request.trials.createTrial(
        request.experimentId,
        request.kind,
        request.attempt ?? 0,
      ).id;
      const detail = cannedDetail(request.kind);
      const outcome = request.kind === 'baseline' ? 'pass' : 'violation';
      request.trials.finishTrial(trialId, outcome, detail);
      return { trialId, outcome, detail };
    },
  };
}

function makeContext(overrides: Partial<ExecutionContext> = {}): {
  ctx: ExecutionContext;
  events: { kind: string; payload: Record<string, unknown> }[];
} {
  const events: { kind: string; payload: Record<string, unknown> }[] = [];
  const sink: EventSink = {
    appendEvent: vi.fn(
      async <K extends RunEventKind>(
        runId: string,
        kind: K,
        payload: RunEventPayloadMap[K],
      ): Promise<RunEvent> => {
        const event = RunEventSchema.parse({
          id: `event-${events.length}`,
          runId,
          sequence: events.length,
          kind,
          payload,
          createdAt: new Date().toISOString(),
        });
        events.push({ kind: event.kind, payload: event.payload });
        return event;
      },
    ),
    setPhase: vi.fn(async () => {}),
  };
  const artifacts: ArtifactStore = {
    saveArtifact: vi.fn(async (input: { runId: string; kind: string }) => ({
      id: `artifact-${input.kind}`,
      runId: input.runId,
      kind: input.kind,
      relativePath: 'x',
      mimeType: 'application/octet-stream',
      sizeBytes: 0,
      sha256: '',
      createdAt: new Date().toISOString(),
    })),
  };
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'races-agent-test-'));
  fs.mkdirSync(path.join(repoPath, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repoPath, 'src', 'app.ts'), 'export const x = 1;\n');
  const ctx: ExecutionContext = {
    run: {
      id: 'run-1',
      projectId: 'project-1',
      task: 'Find timing bugs.',
      mode: 'investigate',
      status: 'running',
      phase: 'inspecting',
      limits: { durationMs: 60_000, modelCalls: 30, experiments: 6 },
      cancelRequestedAt: null,
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      finishedAt: null,
      errorCode: null,
      errorMessage: null,
    },
    project: {
      id: 'project-1',
      name: 'Shop',
      repositoryPath: repoPath,
      targetUrl,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    limits: { durationMs: 60_000, modelCalls: 30, experiments: 6 },
    events: sink,
    artifacts,
    signal: new AbortController().signal,
    ...overrides,
  };
  return { ctx, events };
}

function explorePlan(): ExperimentPlan {
  return {
    schemaVersion: 1,
    id: 'plan-1',
    hypothesis: 'Stale overwrite.',
    startUrl: targetUrl,
    actions: [{ id: 'a1', kind: 'click', testId: 'go' }],
    requests: [],
    schedule: null,
    assertions: [
      { id: 'check', description: 'Latest shown.', type: 'textContains', testId: 'out', expected: 'latest' },
    ],
    timeouts: { ...DEFAULT_PLAN_TIMEOUTS },
    requiredCapabilities: [],
  };
}

describe('AgentExecutor', () => {
  it('runs explore, confirm, and finish, persisting a reproduced finding', async () => {
    const { store, findings } = makeStore();
    const { ctx, events } = makeContext();
    const model = new FakeModelClient([
      () => toolCall('c1', 'listFiles', { path: '.' }),
      () => toolCall('c2', 'runExperiment', { mode: 'explore', plan: explorePlan() }),
      () => toolCall('c3', 'runExperiment', { mode: 'confirm', experimentId: 'exp-1', attempts: 3 }),
      () =>
        toolCall('c4', 'finish', {
          summary: 'Found a stale overwrite.',
          coverage: { pagesVisited: [targetUrl], workflowsTested: ['search'], experimentsRun: 1 },
          unresolvedSuspicions: [],
          limitations: [],
          findings: [
            {
              experimentId: 'exp-1',
              title: 'Stale overwrite',
              expectationProvenance: 'observed normal behaviour',
              explanation: 'Late response overwrote newer results.',
              implicatedCode: [{ path: 'src/app.ts' }],
            },
          ],
        }),
    ]);
    const executor = new AgentExecutor({
      model,
      modelId: 'fake-model',
      store,
      evidence: { readEvidence: () => { throw new Error('no evidence in this test'); } },
      trialRunner: makeFakeRunner(),
      racesDir: os.tmpdir(),
    });
    const outcome = await executor.execute(ctx);
    expect(outcome).toEqual({ status: 'completed' });
    expect(model.calls).toBe(4);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      experimentId: 'exp-1',
      status: 'reproduced',
      expectationProvenance: 'observed normal behaviour',
    });
    expect(findings[0].implicatedCode).toEqual([{ path: 'src/app.ts', excerpt: null, exists: true }]);
    expect(events.map((e) => e.kind)).toContain('finding.recorded');
    fs.rmSync(ctx.project.repositoryPath, { recursive: true, force: true });
  }, 60_000);

  it('degrades to investigation-only when repair cannot isolate the repository', async () => {
    const { store, findings } = makeStore();
    const { ctx, events } = makeContext();
    ctx.run = { ...ctx.run, mode: 'investigate-repair' };
    const model = new FakeModelClient([
      () => toolCall('c1', 'runExperiment', { mode: 'explore', plan: explorePlan() }),
      () => toolCall('c2', 'runExperiment', { mode: 'confirm', experimentId: 'exp-1', attempts: 3 }),
      () =>
        toolCall('c3', 'finish', {
          summary: 'Found a stale overwrite.',
          coverage: { pagesVisited: [targetUrl], workflowsTested: ['search'], experimentsRun: 1 },
          unresolvedSuspicions: [],
          limitations: [],
          findings: [
            {
              experimentId: 'exp-1',
              title: 'Stale overwrite',
              expectationProvenance: 'observed normal behaviour',
              explanation: 'Late response overwrote newer results.',
              implicatedCode: [{ path: 'src/app.ts' }],
            },
          ],
        }),
    ]);
    const executor = new AgentExecutor({
      model,
      modelId: 'fake-model',
      store,
      evidence: { readEvidence: () => { throw new Error('no evidence in this test'); } },
      trialRunner: makeFakeRunner(),
      racesDir: os.tmpdir(),
    });
    const outcome = await executor.execute(ctx);
    expect(outcome).toEqual({ status: 'completed' });
    expect(findings).toHaveLength(1);
    expect(findings[0].status).toBe('reproduced');
    const messages = events.map((e) => String(e.payload.message ?? ''));
    expect(messages.some((m) => m.startsWith('Repair limitation:'))).toBe(true);
    expect(messages.some((m) => m.includes('result stays investigation-only'))).toBe(true);
    fs.rmSync(ctx.project.repositoryPath, { recursive: true, force: true });
  }, 60_000);

  it('ends completed with an explicit limitation when the model-call budget runs out', async () => {
    const { store, findings } = makeStore();
    const { ctx } = makeContext({
      limits: { durationMs: 60_000, modelCalls: 2, experiments: 6 },
    });
    const model = new FakeModelClient([() => toolCall('c1', 'listFiles', { path: '.' })]);
    const executor = new AgentExecutor({
      model,
      modelId: 'fake-model',
      store,
      evidence: { readEvidence: () => { throw new Error('no evidence in this test'); } },
      trialRunner: makeFakeRunner(),
      racesDir: os.tmpdir(),
    })
    const outcome = await executor.execute(ctx);
    expect(outcome).toEqual({ status: 'completed' });
    expect(model.calls).toBe(2);
    expect(findings).toHaveLength(0);
    fs.rmSync(ctx.project.repositoryPath, { recursive: true, force: true });
  }, 60_000);

  it('rejects findings that reference unknown experiments, then accepts a correction', async () => {
    const { store, findings } = makeStore();
    const { ctx } = makeContext();
    const badFinish = {
      summary: 'Nothing confirmed.',
      coverage: { pagesVisited: [], workflowsTested: [], experimentsRun: 0 },
      unresolvedSuspicions: [],
      limitations: [],
      findings: [
        {
          experimentId: 'exp-404',
          title: 'Ghost',
          expectationProvenance: 'inference',
          explanation: 'No evidence.',
        },
      ],
    };
    const goodFinish = { ...badFinish, findings: [] };
    const model = new FakeModelClient([
      () => toolCall('c1', 'finish', badFinish),
      () => toolCall('c2', 'finish', goodFinish),
    ]);
    const executor = new AgentExecutor({
      model,
      modelId: 'fake-model',
      store,
      evidence: { readEvidence: () => { throw new Error('no evidence in this test'); } },
      trialRunner: makeFakeRunner(),
      racesDir: os.tmpdir(),
    })
    const outcome = await executor.execute(ctx);
    expect(outcome).toEqual({ status: 'completed' });
    expect(model.calls).toBe(2);
    expect(findings).toHaveLength(0);
    fs.rmSync(ctx.project.repositoryPath, { recursive: true, force: true });
  }, 60_000);

  it('fails fast when the repository is unreadable', async () => {
    const { store } = makeStore();
    const { ctx } = makeContext();
    const broken = {
      ...ctx,
      project: { ...ctx.project, repositoryPath: path.join(ctx.project.repositoryPath, 'missing') },
    };
    const executor = new AgentExecutor({
      model: new FakeModelClient([]),
      modelId: 'fake-model',
      store,
      evidence: { readEvidence: () => { throw new Error('no evidence in this test'); } },
      trialRunner: makeFakeRunner(),
      racesDir: os.tmpdir(),
    })
    const outcome = await executor.execute(broken);
    expect(outcome).toMatchObject({ status: 'failed', errorCode: 'REPO_UNREADABLE' });
    fs.rmSync(ctx.project.repositoryPath, { recursive: true, force: true });
  });

  it('UnavailableExecutor fails with MODEL_UNAVAILABLE', async () => {
    const { ctx } = makeContext();
    const outcome = await new UnavailableExecutor().execute(ctx);
    expect(outcome).toMatchObject({ status: 'failed', errorCode: 'MODEL_UNAVAILABLE' });
    fs.rmSync(ctx.project.repositoryPath, { recursive: true, force: true });
  });
});
