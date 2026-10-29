import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ensureRacesDir, findRepoRoot, resolveDatabasePath, resolveRacesDir } from './paths.js';

describe('paths', () => {
  it('honours the RACES_DIR override', () => {
    expect(resolveRacesDir({ ...process.env, RACES_DIR: '/tmp/custom-races' })).toBe(
      '/tmp/custom-races',
    );
    expect(resolveDatabasePath({ ...process.env, RACES_DIR: '/tmp/custom-races' })).toBe(
      path.join('/tmp/custom-races', 'races.db'),
    );
  });

  it('resolves the default dir from the workspace root regardless of cwd', () => {
    const dir = resolveRacesDir({ ...process.env, RACES_DIR: '' });
    expect(dir.endsWith(`${path.sep}.races`)).toBe(true);
    expect(fs.existsSync(path.join(path.dirname(dir), 'pnpm-workspace.yaml'))).toBe(true);
  });

  it('finds the repo root from a nested directory', () => {
    const root = findRepoRoot(path.join(process.cwd(), 'src', 'queries'));
    expect(fs.existsSync(path.join(root, 'pnpm-workspace.yaml'))).toBe(true);
  });

  it('creates the override dir on demand', () => {
    const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'races-path-')), 'nested');
    try {
      const created = ensureRacesDir({ ...process.env, RACES_DIR: target });
      expect(fs.existsSync(created)).toBe(true);
    } finally {
      fs.rmSync(path.dirname(target), { recursive: true, force: true });
    }
  });
});
