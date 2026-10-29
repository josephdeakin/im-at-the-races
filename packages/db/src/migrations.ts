import type Database from 'better-sqlite3';

export interface Migration {
  id: string;
  name: string;
  sql: string;
}

/**
 * Ordered migrations. Add new entries at the end; never edit an applied one.
 * Each migration runs inside a transaction and is recorded in _migrations,
 * so concurrent web/worker processes converge safely (one wins, the other
 * sees the recorded row).
 */
export const MIGRATIONS: Migration[] = [
  {
    id: '0001',
    name: 'initial schema: projects, runs, run_events, artifacts',
    sql: `
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  repository_path TEXT NOT NULL,
  target_url TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  phase TEXT NOT NULL,
  limits TEXT NOT NULL,
  cancel_requested_at INTEGER,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  error_code TEXT,
  error_message TEXT
);
CREATE INDEX runs_project_id_idx ON runs(project_id);
CREATE TABLE run_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(run_id, sequence)
);
CREATE INDEX run_events_run_seq_idx ON run_events(run_id, sequence);
CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX artifacts_run_id_idx ON artifacts(run_id);
`.trim(),
  },
];

/** Apply pending migrations. Idempotent; safe to call on every boot. */
export function migrate(sqlite: Database.Database): { applied: string[] } {
  sqlite.exec(
    `CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )`,
  );
  const rows = sqlite.prepare('SELECT id FROM _migrations').all() as { id: string }[];
  const done = new Set(rows.map((row) => row.id));
  const applied: string[] = [];
  const apply = sqlite.transaction((migration: Migration) => {
    sqlite.exec(migration.sql);
    sqlite
      .prepare('INSERT INTO _migrations (id, name, applied_at) VALUES (?, ?, ?)')
      .run(migration.id, migration.name, Date.now());
  });
  for (const migration of MIGRATIONS) {
    if (done.has(migration.id)) continue;
    apply(migration);
    applied.push(migration.id);
  }
  return { applied };
}
