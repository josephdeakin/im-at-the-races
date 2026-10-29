import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_RUN_LIMITS } from '@races/contracts';
import {
  appendEvent,
  cancelRun,
  claimNextQueuedRun,
  createProject,
  createRun,
  finishRun,
  getProject,
  getRun,
  getRunStatusCounts,
  listEvents,
  listProjects,
  listRunsByProject,
  migrate,
  NotFoundError,
  openDatabase,
  runEvents,
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

describe('claim + finish (future worker interface)', () => {
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
