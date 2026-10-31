import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Browser } from 'playwright';
import {
  DEFAULT_PLAN_TIMEOUTS,
  RUNNER_CAPABILITIES,
  RunEventSchema,
  type ExperimentPlan,
  type RunEvent,
  type RunEventKind,
  type RunEventPayloadMap,
  type TrialDetail,
  type TrialKind,
  type TrialOutcome,
} from '@races/contracts';
import type { ArtifactStore, EventSink } from '../index.js';
import { launchBrowser } from './browser.js';
import { runExperiment, type ExperimentStore } from './experiment.js';
import { AbortError } from './util.js';

const PAGE = `<!doctype html><html><body>
<input data-testid="search-input" type="text" />
<div data-testid="results-for">Type to search.</div>
<script>
  const input = document.querySelector('[data-testid="search-input"]');
  const out = document.querySelector('[data-testid="results-for"]');
  input.addEventListener('input', async () => {
    const res = await fetch('/api/search?q=' + encodeURIComponent(input.value));
    const body = await res.json();
    out.textContent = 'Showing results for ' + body.query;
  });
</script>
</body></html>`;

let server: Server;
let baseUrl = '';
let browser: Browser;

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE);
    } else if (url.pathname === '/api/search') {
      setTimeout(() => {
        res
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ query: url.searchParams.get('q') ?? '' }));
      }, 300);
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  baseUrl = `http://127.0.0.1:${address.port}`;
  browser = await launchBrowser();
}, 60_000);

afterAll(async () => {
  await browser?.close().catch(() => {});
  await new Promise<void>((resolve, reject) =>
    server?.close((err) => (err ? reject(err) : resolve())),
  );
});

interface StoredTrial {
  id: string;
  kind: TrialKind;
  outcome: TrialOutcome | null;
  detail: TrialDetail | null;
}

function makeStore() {
  const experiments = new Map<string, { status: string }>();
  const trials = new Map<string, StoredTrial>();
  let counter = 0;
  const store: ExperimentStore = {
    createExperiment: vi.fn(() => {
      const id = `exp-${(counter += 1)}`;
      experiments.set(id, { status: 'running' });
      return { id };
    }),
    finishExperiment: vi.fn((experimentId: string, status: 'completed' | 'failed' | 'interrupted') => {
      experiments.get(experimentId)!.status = status;
    }),
    createTrial: vi.fn((experimentId: string, kind: TrialKind) => {
      const id = `trial-${(counter += 1)}`;
      trials.set(id, { id, kind, outcome: null, detail: null });
      void experimentId;
      return { id };
    }),
    finishTrial: vi.fn((trialId: string, outcome: TrialOutcome, detail: TrialDetail) => {
      trials.get(trialId)!.outcome = outcome;
      trials.get(trialId)!.detail = detail;
    }),
    getExperiment: vi.fn(() => undefined),
    listTrials: vi.fn(() => []),
  };
  return { store, experiments, trials };
}

function makeSinks() {
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
      relativePath: `artifacts/${input.runId}/file`,
      mimeType: 'application/octet-stream',
      sizeBytes: 0,
      sha256: '',
      createdAt: new Date().toISOString(),
    })),
  };
  return { sink, artifacts, events };
}

function makeOutcomePlan(): ExperimentPlan {
  return {
    schemaVersion: 1,
    id: 'outcome-probe',
    hypothesis: 'A late stale response overwrites newer results.',
    startUrl: `${baseUrl}/`,
    actions: [
      { id: 'a1', kind: 'fill', testId: 'search-input', value: 'alpha' },
      { id: 'a2', kind: 'fill', testId: 'search-input', value: 'beta' },
    ],
    requests: [
      {
        id: 'reqA',
        method: 'GET',
        urlPattern: '/api/search',
        query: { q: 'alpha' },
        occurrence: 1,
        afterAction: 'a1',
      },
      {
        id: 'reqB',
        method: 'GET',
        urlPattern: '/api/search',
        query: { q: 'beta' },
        occurrence: 1,
        afterAction: 'a2',
      },
    ],
    schedule: {
      hold: ['reqA'],
      releases: [{ request: 'reqA', afterResponse: 'reqB', settleMs: 50, timeoutMs: 5000 }],
    },
    assertions: [
      {
        id: 'latest-wins',
        description: 'Results reflect the latest query.',
        type: 'textContains',
        testId: 'results-for',
        expected: 'Showing results for beta',
      },
    ],
    timeouts: { ...DEFAULT_PLAN_TIMEOUTS },
    requiredCapabilities: [RUNNER_CAPABILITIES.HTTP_HOLD_RELEASE],
  };
}

function makePlan(): ExperimentPlan {
  return {
    schemaVersion: 1,
    id: 'abort-probe',
    hypothesis: 'Abort leaves terminal records.',
    startUrl: `${baseUrl}/`,
    actions: [{ id: 'a1', kind: 'fill', testId: 'search-input', value: 'alpha' }],
    requests: [
      {
        id: 'reqA',
        method: 'GET',
        urlPattern: '/api/search',
        query: { q: 'alpha' },
        occurrence: 1,
        afterAction: 'a1',
      },
    ],
    schedule: null,
    assertions: [
      {
        id: 'never',
        description: 'Never satisfied: keeps the trial in assertion polling.',
        type: 'textContains',
        testId: 'results-for',
        expected: 'this-text-never-appears',
      },
    ],
    timeouts: { ...DEFAULT_PLAN_TIMEOUTS, observationMs: 8000 },
    requiredCapabilities: [RUNNER_CAPABILITIES.HTTP_HOLD_RELEASE],
  };
}

describe('experiment abort (live browser)', () => {
  it('aborting mid-trial finishes the trial and experiment instead of dangling', async () => {
    const { store, experiments, trials } = makeStore();
    const { sink, artifacts, events } = makeSinks();
    const controller = new AbortController();
    const pending = runExperiment({
      plan: makePlan(),
      runId: 'run-1',
      browser,
      signal: controller.signal,
      events: sink,
      artifacts,
      store,
    });
    // Land the abort inside assertion polling (8 s window).
    await new Promise((resolve) => setTimeout(resolve, 1500));
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(AbortError);

    expect(trials.size).toBe(1);
    const [trial] = [...trials.values()];
    expect(trial.kind).toBe('baseline');
    expect(trial.outcome).toBe('inconclusive');
    expect(trial.detail?.reason).toBe('trial-aborted');
    expect([...experiments.values()].map((e) => e.status)).toEqual(['interrupted']);
    expect(events.map((e) => e.kind)).toContain('trial.completed');
    expect(events.map((e) => e.kind)).toContain('experiment.completed');
  }, 60_000);
});

describe('experiment outcomes (live browser)', () => {
  it('passes the baseline and flags the held stale delivery as a violation', async () => {
    const { store, experiments, trials } = makeStore();
    const { sink, artifacts, events } = makeSinks();
    const result = await runExperiment({
      plan: makeOutcomePlan(),
      runId: 'run-1',
      browser,
      signal: new AbortController().signal,
      events: sink,
      artifacts,
      store,
    });

    expect(result.baseline.outcome).toBe('pass');
    expect(result.intervention?.outcome).toBe('violation');
    expect([...experiments.values()].map((e) => e.status)).toEqual(['completed']);
    expect([...trials.values()].map((t) => `${t.kind}:${t.outcome}`)).toEqual([
      'baseline:pass',
      'intervention:violation',
    ]);
    const failedAssertion = events.find(
      (e) => e.kind === 'assertion.evaluated' && e.payload.passed === false,
    );
    expect(failedAssertion).toBeDefined();
  }, 60_000);
});
