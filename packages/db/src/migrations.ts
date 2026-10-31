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
  {
    id: '0002',
    name: 'experiments and trials for M2 scripted runner',
    sql: `
CREATE TABLE experiments (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  hypothesis TEXT NOT NULL,
  plan TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX experiments_run_id_idx ON experiments(run_id);
CREATE TABLE trials (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  outcome TEXT,
  detail TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX trials_experiment_id_idx ON trials(experiment_id);
`.trim(),
  },
  {
    id: '0003',
    name: 'findings table and trial attempt numbers for M3 confirmations',
    sql: `
CREATE TABLE findings (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  experiment_id TEXT NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  expectation_provenance TEXT NOT NULL,
  explanation TEXT NOT NULL,
  implicated_code TEXT NOT NULL,
  source_identity TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX findings_run_id_idx ON findings(run_id);
ALTER TABLE trials ADD COLUMN attempt INTEGER NOT NULL DEFAULT 0;
`.trim(),
  },
  {
    id: '0004',
    name: 'reproducers, repair attempts, and verification checks for M5',
    sql: `
CREATE TABLE reproducers (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  finding_id TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  experiment_id TEXT NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  bundle_path TEXT NOT NULL,
  test_hash TEXT NOT NULL,
  plan_hash TEXT NOT NULL,
  check_hash TEXT NOT NULL,
  check_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX reproducers_run_id_idx ON reproducers(run_id);
CREATE TABLE repair_attempts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  reproducer_id TEXT NOT NULL REFERENCES reproducers(id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL,
  workspace_path TEXT NOT NULL,
  source_identity TEXT NOT NULL,
  diff TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX repair_attempts_run_id_idx ON repair_attempts(run_id);
CREATE TABLE verification_checks (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  reproducer_id TEXT NOT NULL REFERENCES reproducers(id) ON DELETE CASCADE,
  repair_attempt_id TEXT REFERENCES repair_attempts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX verification_checks_run_id_idx ON verification_checks(run_id);
`.trim(),
  },
  {
    id: '0005',
    name: 'artifact size and content hash for M6 capacity accounting',
    sql: `
ALTER TABLE artifacts ADD COLUMN size_bytes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE artifacts ADD COLUMN sha256 TEXT NOT NULL DEFAULT '';
`.trim(),
  },
  {
    id: '0006',
    name: 'index runs by status for claim polling',
    sql: `
CREATE INDEX runs_status_created_idx ON runs(status, created_at);
`.trim(),
  },
];

/**
 * Apply pending migrations in one immediate transaction: the done-set is
 * re-read inside the transaction, so two processes booting together
 * converge on the lock instead of colliding on DDL. Idempotent; safe to
 * call on every boot.
 */
export function migrate(sqlite: Database.Database): { applied: string[] } {
  const applied: string[] = [];
  sqlite
    .transaction(() => {
      sqlite.exec(
        `CREATE TABLE IF NOT EXISTS _migrations (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at INTEGER NOT NULL
        )`,
      );
      const rows = sqlite.prepare('SELECT id FROM _migrations').all() as { id: string }[];
      const done = new Set(rows.map((row) => row.id));
      for (const migration of MIGRATIONS) {
        if (done.has(migration.id)) continue;
        sqlite.exec(migration.sql);
        sqlite
          .prepare('INSERT INTO _migrations (id, name, applied_at) VALUES (?, ?, ?)')
          .run(migration.id, migration.name, Date.now());
        applied.push(migration.id);
      }
    })
    .immediate();
  return { applied };
}
