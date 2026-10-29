import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_RUN_LIMITS } from '@races/contracts';
import {
  appendEvent,
  cancelRun,
  claimNextQueuedRun,
  createArtifact,
  createProject,
  completeCancellation,
  createExperiment,
  createFinding,
  createRepairAttempt,
  createReproducer,
  createRun,
  createTrial,
  createVerificationCheck,
  finishExperiment,
  finishRepairAttempt,
  finishRun,
  finishTrial,
  getProject,
  getRun,
  getRunStatusCounts,
  listEvents,
  listExperimentsByRun,
  listFindingsByRun,
  listProjects,
  listReproducersByRun,
  listRunsByProject,
  listTrialsByExperiment,
  listVerificationChecksByRun,
  markAbandonedRunningInterrupted,
  migrate,
  NotFoundError,
  openDatabase,
  runEvents,
  setRunPhase,
  sumArtifactBytesByRun,
  type OpenDatabaseResult,
  type RunRow,
} from './index.js';

let tmpDirs: string[] = [];
let handles: OpenDatabaseResult[] = [];

function openIsolatedDb(): OpenDatabaseResult {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'races-db-test-'));
  tmpDirs.push(dir);
  const handle = openDatabase(path.join(dir, 'test.db'));
  handles.push(handle);
  migrate(handle.sqlite);
  return handle;
}

afterEach(() => {
  for (const handle of handles) handle.sqlite.close();
  handles = [];
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
  tmpDirs = [];
});

function seedProject(db: OpenDatabaseResult['db']) {
  return createProject(db, {
    name: 'Shop',
    repositoryPath: '/tmp/shop',
    targetUrl: 'http://127.0.0.1:3000',
  });
}

function seedRun(db: OpenDatabaseResult['db'], projectId: string): RunRow {
  return createRun(db, {
    projectId,
    task: 'Find races',
    mode: 'investigate',
    limits: { ...DEFAULT_RUN_LIMITS },
  }).run;
}

describe('projects', () => {
  it('round-trips create/get/list', () => {
    const { db } = openIsolatedDb();
    expect(listProjects(db)).toEqual([]);
    const created = seedProject(db);
    expect(getProject(db, created.id)).toMatchObject({ name: 'Shop' });
    expect(getProject(db, 'missing')).toBeUndefined();
    expect(listProjects(db).map((p) => p.id)).toEqual([created.id]);
  });
});

describe('createRun', () => {
  it('atomically persists a queued run and its initial event', () => {
    const { db } = openIsolatedDb();
    const project = seedProject(db);
    const { run, event } = createRun(db, {
      projectId: project.id,
      task: 'Check checkout',
      mode: 'investigate-repair',
      limits: { ...DEFAULT_RUN_LIMITS, modelCalls: 7 },
    });
    expect(run).toMatchObject({
      projectId: project.id,
      task: 'Check checkout',
      mode: 'investigate-repair',
      status: 'queued',
      phase: 'queued',
      startedAt: null,
      finishedAt: null,
    });
    expect(run.limits).toEqual({ ...DEFAULT_RUN_LIMITS, modelCalls: 7 });
    expect(event).toMatchObject({ runId: run.id, sequence: 0, kind: 'run.created' });
    expect(listEvents(db, run.id, -1)).toHaveLength(1);
  });

  it('persists nothing when the project does not exist', () => {
    const { db } = openIsolatedDb();
    expect(() =>
      createRun(db, {
        projectId: 'missing',
        task: 'x',
        mode: 'investigate',
        limits: { ...DEFAULT_RUN_LIMITS },
      }),
    ).toThrow(NotFoundError);
    expect(listRunsByProject(db, 'missing')).toEqual([]);
    expect(getRunStatusCounts(db)).toMatchObject({ queued: 0 });
  });
});

describe('cancelRun', () => {
  it('transitions a queued run to cancelled immediately, idempotently', () => {
    const { db } = openIsolatedDb();
    const run = seedRun(db, seedProject(db).id);

    const first = cancelRun(db, run.id);
    expect(first.changed).toBe(true);
    expect(first.run).toMatchObject({ status: 'cancelled', phase: 'cancelled' });
    expect(first.run.finishedAt).toEqual(expect.any(Number));
    expect(listEvents(db, run.id, -1).map((e) => e.kind)).toEqual([
      'run.created',
      'run.cancelled',
    ]);

    const second = cancelRun(db, run.id);
    expect(second.changed).toBe(false);
    expect(second.run.status).toBe('cancelled');
    expect(listEvents(db, run.id, -1)).toHaveLength(2);
  });

  it('records a cancellation request for a running run, once', () => {
    const { db } = openIsolatedDb();
    const run = seedRun(db, seedProject(db).id);
    const claimed = claimNextQueuedRun(db, 'worker-1');
    expect(claimed?.status).toBe('running');

    const first = cancelRun(db, run.id);
    expect(first.changed).toBe(true);
    expect(first.run.status).toBe('running');
    expect(first.run.cancelRequestedAt).toEqual(expect.any(Number));
    expect(listEvents(db, run.id, -1).map((e) => e.kind)).toEqual([
      'run.created',
      'run.started',
      'run.cancel_requested',
    ]);

    const second = cancelRun(db, run.id);
    expect(second.changed).toBe(false);
    expect(listEvents(db, run.id, -1)).toHaveLength(3);
  });

  it('never rewrites completed runs', () => {
    const { db } = openIsolatedDb();
    const run = seedRun(db, seedProject(db).id);
    claimNextQueuedRun(db, 'worker-1');
    finishRun(db, run.id, { status: 'completed' });

    const before = getRun(db, run.id);
    const result = cancelRun(db, run.id);
    expect(result.changed).toBe(false);
    expect(getRun(db, run.id)).toEqual(before);
    expect(
      listEvents(db, run.id, -1).map((e) => e.kind),
    ).not.toContain('run.cancelled');
  });

  it('throws for unknown runs', () => {
    const { db } = openIsolatedDb();
    expect(() => cancelRun(db, 'missing')).toThrow(NotFoundError);
  });
});

describe('events', () => {
  it('returns chronological pages by exclusive cursor without duplicates', () => {
    const { db } = openIsolatedDb();
    const run = seedRun(db, seedProject(db).id);
    const kinds = ['run.phase', 'run.log', 'run.log', 'run.phase', 'run.log'];
    for (const kind of kinds) appendEvent(db, run.id, kind, { kind });

    const all = listEvents(db, run.id, -1);
    expect(all.map((e) => e.sequence)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(all.map((e) => e.kind)).toEqual(['run.created', ...kinds]);

    // Cursor paging like the UI poller: page, then resume after the last seq.
    const page1 = listEvents(db, run.id, -1).slice(0, 3);
    const page2 = listEvents(db, run.id, page1[page1.length - 1].sequence);
    expect(page2.map((e) => e.sequence)).toEqual([3, 4, 5]);
    const merged = new Map<number, (typeof all)[number]>();
    for (const event of [...page1, ...page2, ...page2]) merged.set(event.sequence, event);
    expect([...merged.keys()]).toEqual([0, 1, 2, 3, 4, 5]);

    expect(listEvents(db, run.id, 5)).toEqual([]);
  });

  it('enforces unique sequence numbers per run', () => {
    const { db } = openIsolatedDb();
    const run = seedRun(db, seedProject(db).id);
    expect(() =>
      db
        .insert(runEvents)
        .values({
          id: 'dup',
          runId: run.id,
          sequence: 0,
          kind: 'run.log',
          payload: {},
          createdAt: Date.now(),
        })
        .run(),
    ).toThrow();
  });

  it('rejects events for unknown runs', () => {
    const { db } = openIsolatedDb();
    expect(() => appendEvent(db, 'missing', 'run.log', {})).toThrow(NotFoundError);
  });
});

describe('worker lifecycle: claim, phase, cancel, finish, recovery', () => {
  it('claims the oldest queued run and finishes it with events', () => {
    const { db } = openIsolatedDb();
    const projectId = seedProject(db).id;
    const first = seedRun(db, projectId);
    const second = seedRun(db, projectId);

    expect(claimNextQueuedRun(db, 'worker-1')?.id).toBe(first.id);
    expect(claimNextQueuedRun(db, 'worker-1')?.id).toBe(second.id);
    expect(claimNextQueuedRun(db, 'worker-1')).toBeNull();

    const finished = finishRun(db, first.id, { status: 'failed', errorMessage: 'boom' });
    expect(finished.changed).toBe(true);
    expect(finished.run).toMatchObject({ status: 'failed', errorMessage: 'boom' });
    expect(listEvents(db, first.id, -1).map((e) => e.kind)).toEqual([
      'run.created',
      'run.started',
      'run.failed',
    ]);

    expect(finishRun(db, first.id, { status: 'completed' }).changed).toBe(false);
    expect(getRun(db, first.id)?.status).toBe('failed');
  });

  it('sets phase with an event, and leaves terminal phases untouched', () => {
    const { db } = openIsolatedDb();
    const run = seedRun(db, seedProject(db).id);
    claimNextQueuedRun(db, 'worker-1');

    const moved = setRunPhase(db, run.id, 'experimenting');
    expect(moved.changed).toBe(true);
    expect(moved.run.phase).toBe('experimenting');
    expect(listEvents(db, run.id, -1).map((e) => e.kind)).toEqual([
      'run.created',
      'run.started',
      'run.phase',
    ]);

    finishRun(db, run.id, { status: 'completed' });
    const frozen = setRunPhase(db, run.id, 'experimenting');
    expect(frozen.changed).toBe(false);
    expect(getRun(db, run.id)?.phase).toBe('completed');
  });

  it('completes a running cancellation exactly once', () => {
    const { db } = openIsolatedDb();
    const run = seedRun(db, seedProject(db).id);
    claimNextQueuedRun(db, 'worker-1');
    cancelRun(db, run.id);

    const first = completeCancellation(db, run.id);
    expect(first.changed).toBe(true);
    expect(first.run).toMatchObject({ status: 'cancelled', phase: 'cancelled' });
    expect(first.run.finishedAt).not.toBeNull();
    expect(listEvents(db, run.id, -1).map((e) => e.kind)).toEqual([
      'run.created',
      'run.started',
      'run.cancel_requested',
      'run.cancelled',
    ]);

    expect(completeCancellation(db, run.id).changed).toBe(false);
  });

  it('marks abandoned running runs interrupted on recovery, preserving the rest', () => {
    const { db } = openIsolatedDb();
    const projectId = seedProject(db).id;
    const abandoned = seedRun(db, projectId);
    claimNextQueuedRun(db, 'dead-worker');
    const done = seedRun(db, projectId);
    claimNextQueuedRun(db, 'dead-worker');
    finishRun(db, done.id, { status: 'completed' });
    const queued = seedRun(db, projectId);

    const { runIds } = markAbandonedRunningInterrupted(db, 'worker-2');
    expect(runIds).toEqual([abandoned.id]);
    expect(getRun(db, abandoned.id)).toMatchObject({
      status: 'interrupted',
      phase: 'interrupted',
    });
    expect(listEvents(db, abandoned.id, -1).map((e) => e.kind)).toEqual([
      'run.created',
      'run.started',
      'run.interrupted',
    ]);
    expect(getRun(db, queued.id)?.status).toBe('queued');
    expect(getRun(db, done.id)?.status).toBe('completed');
  });
});

describe('experiments and trials', () => {
  it('records an experiment with ordered trials and details', () => {
    const { db } = openIsolatedDb();
    const run = seedRun(db, seedProject(db).id);
    const experiment = createExperiment(db, {
      runId: run.id,
      name: 'stale-search-v1',
      hypothesis: 'Late responses overwrite newer results.',
      plan: { schemaVersion: 1 },
    });
    expect(experiment).toMatchObject({ runId: run.id, status: 'running' });

    const baseline = createTrial(db, experiment.id, 'baseline');
    const intervention = createTrial(db, experiment.id, 'intervention');
    finishTrial(db, baseline.id, 'pass', { outcome: 'pass' });
    finishTrial(db, intervention.id, 'violation', { outcome: 'violation' });
    const done = finishExperiment(db, experiment.id, 'completed');

    expect(done).toMatchObject({ status: 'completed' });
    expect(done.finishedAt).not.toBeNull();
    expect(listExperimentsByRun(db, run.id).map((e) => e.id)).toEqual([experiment.id]);
    expect(listTrialsByExperiment(db, experiment.id).map((t) => t.outcome)).toEqual([
      'pass',
      'violation',
    ]);

    const abandoned = createExperiment(db, {
      runId: run.id,
      name: 'aborted',
      hypothesis: 'h',
      plan: {},
    });
    expect(finishExperiment(db, abandoned.id, 'interrupted').status).toBe('interrupted');
  });

  it('numbers confirmation attempts on the same experiment', () => {
    const { db } = openIsolatedDb();
    const run = seedRun(db, seedProject(db).id);
    const experiment = createExperiment(db, {
      runId: run.id,
      name: 'plan',
      hypothesis: 'h',
      plan: {},
    });
    createTrial(db, experiment.id, 'baseline', 0);
    createTrial(db, experiment.id, 'intervention', 0);
    createTrial(db, experiment.id, 'baseline', 1);
    createTrial(db, experiment.id, 'intervention', 1);
    expect(listTrialsByExperiment(db, experiment.id).map((t) => [t.kind, t.attempt])).toEqual([
      ['baseline', 0],
      ['intervention', 0],
      ['baseline', 1],
      ['intervention', 1],
    ]);
  });

  it('rejects experiments for unknown runs and trials for unknown experiments', () => {
    const { db } = openIsolatedDb();
    expect(() =>
      createExperiment(db, { runId: 'missing', name: 'x', hypothesis: 'y', plan: {} }),
    ).toThrow(NotFoundError);
    expect(() => createTrial(db, 'missing', 'baseline')).toThrow(NotFoundError);
    expect(() => finishTrial(db, 'missing', 'pass', {})).toThrow(NotFoundError);
  });
});

describe('findings', () => {
  it('records a finding against an experiment and lists it by run', () => {
    const { db } = openIsolatedDb();
    const run = seedRun(db, seedProject(db).id);
    const experiment = createExperiment(db, {
      runId: run.id,
      name: 'plan',
      hypothesis: 'h',
      plan: {},
    });
    const finding = createFinding(db, {
      runId: run.id,
      experimentId: experiment.id,
      title: 'Stale overwrite',
      status: 'reproduced',
      expectationProvenance: 'observed normal behaviour',
      explanation: 'Late alpha overwrote beta results.',
      implicatedCode: [{ path: 'src/SearchBox.tsx', excerpt: 'setResults', exists: true }],
      sourceIdentity: 'git:abc123:clean',
    });
    expect(finding).toMatchObject({ runId: run.id, status: 'reproduced' });
    expect(listFindingsByRun(db, run.id).map((f) => f.id)).toEqual([finding.id]);
    expect(() =>
      createFinding(db, {
        runId: run.id,
        experimentId: 'missing',
        title: 't',
        status: 'candidate',
        expectationProvenance: 'p',
        explanation: 'e',
        implicatedCode: [],
        sourceIdentity: 's',
      }),
    ).toThrow(NotFoundError);
  });
});

describe('repair records', () => {
  it('records a reproducer, attempts, and checks in order', () => {
    const { db } = openIsolatedDb();
    const run = seedRun(db, seedProject(db).id);
    const experiment = createExperiment(db, {
      runId: run.id,
      name: 'plan',
      hypothesis: 'h',
      plan: {},
    });
    const finding = createFinding(db, {
      runId: run.id,
      experimentId: experiment.id,
      title: 't',
      status: 'reproduced',
      expectationProvenance: 'p',
      explanation: 'e',
      implicatedCode: [],
      sourceIdentity: 's',
    });
    const reproducer = createReproducer(db, {
      runId: run.id,
      findingId: finding.id,
      experimentId: experiment.id,
      bundlePath: 'artifacts/repro',
      testHash: 'sha256:test',
      planHash: 'sha256:plan',
      checkHash: 'sha256:check',
      checkId: 'final',
    });
    expect(listReproducersByRun(db, run.id).map((r) => r.id)).toEqual([reproducer.id]);

    const attempt = createRepairAttempt(db, {
      runId: run.id,
      reproducerId: reproducer.id,
      attempt: 1,
      workspacePath: '/tmp/ws',
      sourceIdentity: 'git:abc:clean',
    });
    expect(attempt).toMatchObject({ status: 'running', diff: '' });
    const finished = finishRepairAttempt(db, attempt.id, { diff: 'diff --git', status: 'completed' });
    expect(finished).toMatchObject({ status: 'completed', diff: 'diff --git' });

    createVerificationCheck(db, {
      runId: run.id,
      reproducerId: reproducer.id,
      repairAttemptId: null,
      name: 'reproducer-fails-on-original',
      status: 'pass',
      detail: { exitCode: 1 },
    });
    createVerificationCheck(db, {
      runId: run.id,
      reproducerId: reproducer.id,
      repairAttemptId: attempt.id,
      name: 'frozen-rep-1',
      status: 'fail',
      detail: { exitCode: 1 },
    });
    expect(listVerificationChecksByRun(db, run.id).map((c) => [c.name, c.status])).toEqual([
      ['reproducer-fails-on-original', 'pass'],
      ['frozen-rep-1', 'fail'],
    ]);
    expect(() =>
      createRepairAttempt(db, {
        runId: run.id,
        reproducerId: 'missing',
        attempt: 1,
        workspacePath: 'w',
        sourceIdentity: 's',
      }),
    ).toThrow(NotFoundError);
  });
});

describe('artifacts', () => {
  it('records size and hash and sums bytes per run', () => {
    const { db } = openIsolatedDb();
    const project = seedProject(db);
    const run = seedRun(db, project.id);
    expect(sumArtifactBytesByRun(db, run.id)).toBe(0);
    const first = createArtifact(db, {
      runId: run.id,
      kind: 'screenshot',
      relativePath: 'artifacts/a.png',
      mimeType: 'image/png',
      sizeBytes: 100,
      sha256: 'sha256:aaa',
    });
    expect(first).toMatchObject({ sizeBytes: 100, sha256: 'sha256:aaa' });
    createArtifact(db, {
      runId: run.id,
      kind: 'values',
      relativePath: 'artifacts/a.json',
      mimeType: 'application/json',
      sizeBytes: 50,
      sha256: 'sha256:bbb',
    });
    expect(sumArtifactBytesByRun(db, run.id)).toBe(150);
  });
});

describe('migrate', () => {
  it('is idempotent', () => {
    const handle = openIsolatedDb();
    expect(migrate(handle.sqlite)).toEqual({ applied: [] });
  });

  it('runs with WAL mode for multi-process access', () => {
    const handle = openIsolatedDb();
    const row = handle.sqlite.pragma('journal_mode') as { journal_mode: string }[];
    expect(row[0]?.journal_mode?.toLowerCase()).toBe('wal');
  });
});
