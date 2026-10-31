import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ExperimentPlan, TrialDetail } from '@races/contracts';
import { DEFAULT_PLAN_TIMEOUTS } from '@races/contracts';
import type { StoredTrial } from '../runner/experiment.js';
import type { AgentToolDeps } from './tools.js';
import { dispatchTool, ExplorationPage } from './tools.js';

function detailWith(passed: string[], failed: string[]): TrialDetail {
  return {
    outcome: failed.length > 0 ? 'violation' : 'pass',
    reason: null,
    detail: null,
    assertions: [
      ...passed.map((id) => ({ id, passed: true, expected: 'x', observed: 'x' })),
      ...failed.map((id) => ({ id, passed: false, expected: 'x', observed: 'y' })),
    ],
    requests: [],
  };
}

function makePlan(): ExperimentPlan {
  return {
    schemaVersion: 1,
    id: 'probe',
    hypothesis: 'Stale overwrite.',
    startUrl: 'http://127.0.0.1:9999/',
    actions: [{ id: 'a1', kind: 'fill', testId: 'search-input', value: 'alpha' }],
    requests: [],
    schedule: null,
    assertions: [
      {
        id: 'c1',
        description: 'Latest wins.',
        type: 'textContains',
        testId: 'results-for',
        expected: 'beta',
      },
    ],
    timeouts: { ...DEFAULT_PLAN_TIMEOUTS },
    requiredCapabilities: [],
  };
}

function makeDeps(overrides: Partial<AgentToolDeps> = {}): { deps: AgentToolDeps; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'races-tools-test-'));
  fs.writeFileSync(path.join(dir, 'app.ts'), 'const a = 1;\nconst b = 2;\n');
  const deps: AgentToolDeps = {
    runId: 'run-1',
    repoPath: dir,
    targetUrl: 'http://127.0.0.1:9999/',
    browser: {} as AgentToolDeps['browser'],
    signal: new AbortController().signal,
    events: {
      appendEvent: async () => {
        throw new Error('unused');
      },
      setPhase: async () => {},
    } as AgentToolDeps['events'],
    artifacts: {
      saveArtifact: async () => {
        throw new Error('unused');
      },
    } as AgentToolDeps['artifacts'],
    experiments: {
      createExperiment: () => ({ id: 'exp-1' }),
      finishExperiment: () => {},
      getExperiment: () => undefined,
      listTrials: () => [],
      createTrial: () => ({ id: 'trial-1' }),
      finishTrial: () => {},
    } as AgentToolDeps['experiments'],
    evidence: {
      readEvidence: () => {
        throw new Error('unused');
      },
    } as AgentToolDeps['evidence'],
    budgets: { plansUsed: 0, planBudget: 5 },
    trialRunner: {
      runExperiment: async () => {
        throw new Error('unused');
      },
      executeTrial: async () => {
        throw new Error('unused');
      },
    },
    ...overrides,
  };
  return { deps, dir };
}

const exploration = {} as ExplorationPage;

describe('dispatchTool readFile confinement', () => {
  it('reads files inside the repo and rejects escapes', async () => {
    const { deps, dir } = makeDeps();
    try {
      const inside = await dispatchTool('readFile', { path: 'app.ts' }, deps, exploration);
      expect(inside.ok).toBe(true);

      const parent = await dispatchTool('readFile', { path: '../escape.ts' }, deps, exploration);
      expect(parent.ok).toBe(false);

      const absolute = await dispatchTool('readFile', { path: '/etc/passwd' }, deps, exploration);
      expect(absolute.ok).toBe(false);

      const missing = await dispatchTool('readFile', { path: 'nope.ts' }, deps, exploration);
      expect(missing.ok).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects unknown tools by name', async () => {
    const { deps, dir } = makeDeps();
    try {
      const outcome = await dispatchTool('teleport', {}, deps, exploration);
      expect(outcome).toMatchObject({ ok: false, error: 'Unknown tool: teleport' });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('dispatchTool plan budgets', () => {
  it('refuses explore when the plan budget is exhausted', async () => {
    const { deps, dir } = makeDeps({ budgets: { plansUsed: 5, planBudget: 5 } });
    try {
      const outcome = await dispatchTool(
        'runExperiment',
        { mode: 'explore', plan: makePlan() },
        deps,
        exploration,
      );
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.error).toContain('Plan budget exhausted');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('counts a confirmation against the plan budget', async () => {
    const trials: StoredTrial[] = [
      {
        id: 't0b',
        kind: 'baseline',
        attempt: 0,
        outcome: 'pass',
        detail: detailWith(['c1'], []) as unknown as Record<string, unknown>,
      },
      {
        id: 't0i',
        kind: 'intervention',
        attempt: 0,
        outcome: 'violation',
        detail: detailWith([], ['c1']) as unknown as Record<string, unknown>,
      },
    ];
    const budgets = { plansUsed: 1, planBudget: 5 };
    const { deps, dir } = makeDeps({
      budgets,
      experiments: {
        createExperiment: () => ({ id: 'exp-1' }),
        finishExperiment: () => {},
        getExperiment: () => ({ id: 'exp-1', runId: 'run-1', plan: makePlan() }),
        listTrials: () => trials,
        createTrial: () => ({ id: 'trial-x' }),
        finishTrial: () => {},
      } as AgentToolDeps['experiments'],
      trialRunner: {
        runExperiment: async () => {
          throw new Error('unused');
        },
        executeTrial: async (request) => {
          const outcome = request.kind === 'baseline' ? 'pass' : 'violation';
          trials.push({
            id: `t-${trials.length}`,
            kind: request.kind,
            attempt: request.attempt ?? 0,
            outcome,
            detail: detailWith(
              request.kind === 'baseline' ? ['c1'] : [],
              request.kind === 'baseline' ? [] : ['c1'],
            ) as unknown as Record<string, unknown>,
          });
          return {
            trialId: `t-${trials.length}`,
            outcome,
            detail: detailWith([], []),
          };
        },
      },
    });
    try {
      const outcome = await dispatchTool(
        'runExperiment',
        { mode: 'confirm', experimentId: 'exp-1', attempts: 2 },
        deps,
        exploration,
      );
      expect(outcome.ok).toBe(true);
      expect(budgets.plansUsed).toBe(2);
      if (outcome.ok) expect(outcome.data.reproduced).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses confirm when the plan budget is exhausted', async () => {
    const { deps, dir } = makeDeps({ budgets: { plansUsed: 5, planBudget: 5 } });
    try {
      const outcome = await dispatchTool(
        'runExperiment',
        { mode: 'confirm', experimentId: 'exp-1', attempts: 3 },
        deps,
        exploration,
      );
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.error).toContain('Plan budget exhausted');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
