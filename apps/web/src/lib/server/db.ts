import 'server-only';
import { getSharedDatabase, migrate, type RacesDatabase } from '@races/db';

let migrated = false;

/**
 * Request-scoped database handle. Migrations run once per server process;
 * the underlying better-sqlite3 connection is a per-process singleton.
 */
export function getDb(): RacesDatabase {
  const { db, sqlite } = getSharedDatabase();
  if (!migrated) {
    migrate(sqlite);
    migrated = true;
  }
  return db;
}
