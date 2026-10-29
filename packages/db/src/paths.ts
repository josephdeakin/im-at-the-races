import fs from 'node:fs';
import path from 'node:path';

export const RACES_DIR_NAME = '.races';
export const RACES_DB_FILENAME = 'races.db';
const WORKSPACE_MARKER = 'pnpm-workspace.yaml';

/**
 * Walk up from `startDir` to the monorepo root (the directory containing
 * pnpm-workspace.yaml). Falls back to the start directory when no marker is
 * found, e.g. in isolated tests that always pass RACES_DIR.
 */
export function findRepoRoot(startDir: string = process.cwd()): string {
  let dir = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, WORKSPACE_MARKER))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(startDir);
    dir = parent;
  }
}

/**
 * Absolute path of the runtime data directory. Default is `<repo>/.races`,
 * resolved from the workspace root regardless of process cwd. The RACES_DIR
 * environment variable overrides it (relative values resolve from cwd).
 */
export function resolveRacesDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.RACES_DIR?.trim();
  if (override) return path.resolve(override);
  return path.join(findRepoRoot(), RACES_DIR_NAME);
}

export function resolveDatabasePath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveRacesDir(env), RACES_DB_FILENAME);
}

/** Create the runtime directory if needed and return its absolute path. */
export function ensureRacesDir(env: NodeJS.ProcessEnv = process.env): string {
  const dir = resolveRacesDir(env);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
