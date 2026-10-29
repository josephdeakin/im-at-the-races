import { index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';
import type { RunLimits } from '@races/contracts';

/**
 * Timestamps are Unix milliseconds (UTC). The web layer serializes them to
 * ISO-8601 strings at the API boundary (see @races/contracts response
 * schemas). JSON columns use drizzle's json mode (TEXT storage).
 */

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  repositoryPath: text('repository_path').notNull(),
  targetUrl: text('target_url').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const runs = sqliteTable(
  'runs',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    task: text('task').notNull(),
    mode: text('mode').notNull(),
    status: text('status').notNull(),
    phase: text('phase').notNull(),
    limits: text('limits', { mode: 'json' }).$type<RunLimits>().notNull(),
    cancelRequestedAt: integer('cancel_requested_at'),
    createdAt: integer('created_at').notNull(),
    startedAt: integer('started_at'),
    finishedAt: integer('finished_at'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
  },
  (t) => [index('runs_project_id_idx').on(t.projectId)],
);

export const runEvents = sqliteTable(
  'run_events',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
    kind: text('kind').notNull(),
    payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    unique('run_events_run_sequence_unique').on(t.runId, t.sequence),
    index('run_events_run_seq_idx').on(t.runId, t.sequence),
  ],
);

export const artifacts = sqliteTable(
  'artifacts',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    relativePath: text('relative_path').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: text('sha256').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('artifacts_run_id_idx').on(t.runId)],
);

export const experiments = sqliteTable(
  'experiments',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    hypothesis: text('hypothesis').notNull(),
    plan: text('plan', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    status: text('status').notNull(),
    createdAt: integer('created_at').notNull(),
    finishedAt: integer('finished_at'),
  },
  (t) => [index('experiments_run_id_idx').on(t.runId)],
);

export const trials = sqliteTable(
  'trials',
  {
    id: text('id').primaryKey(),
    experimentId: text('experiment_id')
      .notNull()
      .references(() => experiments.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    outcome: text('outcome'),
    detail: text('detail', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    attempt: integer('attempt').notNull().default(0),
    startedAt: integer('started_at').notNull(),
    finishedAt: integer('finished_at'),
  },
  (t) => [index('trials_experiment_id_idx').on(t.experimentId)],
);

export const findings = sqliteTable(
  'findings',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    experimentId: text('experiment_id')
      .notNull()
      .references(() => experiments.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    status: text('status').notNull(),
    expectationProvenance: text('expectation_provenance').notNull(),
    explanation: text('explanation').notNull(),
    implicatedCode: text('implicated_code', { mode: 'json' })
      .$type<{ path: string; excerpt: string | null; exists: boolean }[]>()
      .notNull(),
    sourceIdentity: text('source_identity').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('findings_run_id_idx').on(t.runId)],
);

export const reproducers = sqliteTable(
  'reproducers',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    findingId: text('finding_id')
      .notNull()
      .references(() => findings.id, { onDelete: 'cascade' }),
    experimentId: text('experiment_id')
      .notNull()
      .references(() => experiments.id, { onDelete: 'cascade' }),
    bundlePath: text('bundle_path').notNull(),
    testHash: text('test_hash').notNull(),
    planHash: text('plan_hash').notNull(),
    checkHash: text('check_hash').notNull(),
    checkId: text('check_id').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('reproducers_run_id_idx').on(t.runId)],
);

export const repairAttempts = sqliteTable(
  'repair_attempts',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    reproducerId: text('reproducer_id')
      .notNull()
      .references(() => reproducers.id, { onDelete: 'cascade' }),
    attempt: integer('attempt').notNull(),
    workspacePath: text('workspace_path').notNull(),
    sourceIdentity: text('source_identity').notNull(),
    diff: text('diff').notNull(),
    status: text('status').notNull(),
    createdAt: integer('created_at').notNull(),
    finishedAt: integer('finished_at'),
  },
  (t) => [index('repair_attempts_run_id_idx').on(t.runId)],
);

export const verificationChecks = sqliteTable(
  'verification_checks',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    reproducerId: text('reproducer_id')
      .notNull()
      .references(() => reproducers.id, { onDelete: 'cascade' }),
    repairAttemptId: text('repair_attempt_id').references(() => repairAttempts.id, {
      onDelete: 'cascade',
    }),
    name: text('name').notNull(),
    status: text('status').notNull(),
    detail: text('detail', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('verification_checks_run_id_idx').on(t.runId)],
);

export type ProjectRow = typeof projects.$inferSelect;
export type RunRow = typeof runs.$inferSelect;
export type RunEventRow = typeof runEvents.$inferSelect;
export type ArtifactRow = typeof artifacts.$inferSelect;
export type ExperimentRow = typeof experiments.$inferSelect;
export type TrialRow = typeof trials.$inferSelect;
export type FindingRow = typeof findings.$inferSelect;
export type ReproducerRow = typeof reproducers.$inferSelect;
export type RepairAttemptRow = typeof repairAttempts.$inferSelect;
export type VerificationCheckRow = typeof verificationChecks.$inferSelect;
