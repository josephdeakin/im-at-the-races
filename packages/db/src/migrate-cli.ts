/** CLI for `pnpm db:migrate`. Run via tsx; safe to re-run (idempotent). */
import { migrate } from './migrations.js';
import { openDatabase } from './client.js';
import { ensureRacesDir, resolveDatabasePath } from './paths.js';

const dir = ensureRacesDir();
const dbPath = resolveDatabasePath();
const { sqlite } = openDatabase(dbPath);
try {
  const { applied } = migrate(sqlite);
  console.log(`Races dir: ${dir}`);
  console.log(`Database:  ${dbPath}`);
  console.log(
    applied.length === 0 ? 'Already up to date.' : `Applied migrations: ${applied.join(', ')}`,
  );
} finally {
  sqlite.close();
}
