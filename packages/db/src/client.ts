import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { resolveDatabasePath } from './paths.js';
import * as schema from './schema.js';

export type RacesDatabase = ReturnType<typeof createDrizzle>;
export type RacesTransaction = Parameters<Parameters<RacesDatabase['transaction']>[0]>[0];
/** Query helpers accept either the root handle or a transaction handle. */
export type DbOrTx = RacesDatabase | RacesTransaction;

function createDrizzle(sqlite: Database.Database) {
  return drizzle(sqlite, { schema });
}

export interface OpenDatabaseResult {
  path: string;
  sqlite: Database.Database;
  db: RacesDatabase;
}

/**
 * Open the SQLite database with pragmas for local multi-process access:
 * WAL so readers never block the writer, a busy timeout so the web and
 * worker processes serialize writes instead of failing, and foreign keys on.
 */
export function openDatabase(dbPath?: string): OpenDatabaseResult {
  const resolved = dbPath ?? resolveDatabasePath();
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const sqlite = new Database(resolved);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('foreign_keys = ON');
  return { path: resolved, sqlite, db: createDrizzle(sqlite) };
}

let shared: OpenDatabaseResult | null = null;

/**
 * Run a unit of work that reads before it writes. IMMEDIATE takes the write
 * lock up front, so concurrent web/worker writers serialize instead of one
 * failing with SQLITE_BUSY_SNAPSHOT (which busy_timeout does not retry).
 */
export function writeTransaction<T>(db: RacesDatabase, work: (tx: RacesTransaction) => T): T {
  return db.transaction(work, { behavior: 'immediate' });
}

/** Per-process singleton for long-lived servers (Next.js, worker). */
export function getSharedDatabase(dbPath?: string): OpenDatabaseResult {
  const resolved = dbPath ?? resolveDatabasePath();
  if (shared && shared.path === resolved) return shared;
  closeSharedDatabase();
  shared = openDatabase(resolved);
  return shared;
}

export function closeSharedDatabase(): void {
  if (shared) {
    shared.sqlite.close();
    shared = null;
  }
}
