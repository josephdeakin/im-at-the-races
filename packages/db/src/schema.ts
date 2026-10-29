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
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('artifacts_run_id_idx').on(t.runId)],
);

export type ProjectRow = typeof projects.$inferSelect;
export type RunRow = typeof runs.$inferSelect;
export type RunEventRow = typeof runEvents.$inferSelect;
export type ArtifactRow = typeof artifacts.$inferSelect;
