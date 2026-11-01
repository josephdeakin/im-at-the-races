import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { dispatchRepairTool } from './agent.js';
import type { RepairWorkspace } from './workspace.js';

function makeWorkspace(): { workspace: RepairWorkspace; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'races-repair-tool-test-'));
  fs.writeFileSync(path.join(dir, 'app.ts'), 'const a = 1;\nconst b = 2;\nconst a2 = a;\n');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 't', scripts: { test: 'node -e "1"' } }));
  const workspace: RepairWorkspace = {
    repoRoot: dir,
    subpath: '.',
    headSha: 'abc',
    worktreePath: dir,
    packageDir: dir,
    carriedFiles: [],
    lockfiles: [],
    sourceIdentity: 'test',
  };
  return { workspace, dir };
}

describe('dispatchRepairTool editFile', () => {
  it('replaces exactly one match', async () => {
    const { workspace, dir } = makeWorkspace();
    try {
      const result = await dispatchRepairTool(
        'editFile',
        { path: 'app.ts', find: 'const b = 2;', replace: 'const b = 3;' },
        workspace,
      );
      expect(result).toMatchObject({ ok: true });
      expect(fs.readFileSync(path.join(dir, 'app.ts'), 'utf8')).toContain('const b = 3;');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects missing and ambiguous matches plus escape paths', async () => {
    const { workspace, dir } = makeWorkspace();
    try {
      expect(
        await dispatchRepairTool('editFile', { path: 'app.ts', find: 'nope', replace: 'x' }, workspace),
      ).toMatchObject({ ok: false });
      expect(
        await dispatchRepairTool('editFile', { path: 'app.ts', find: 'const', replace: 'x' }, workspace),
      ).toMatchObject({ ok: false });
      expect(
        await dispatchRepairTool('editFile', { path: '../escape.ts', find: 'a', replace: 'b' }, workspace),
      ).toMatchObject({ ok: false });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('dispatchRepairTool editFile replacement text', () => {
  it('keeps $ sequences in the replacement literal', async () => {
    const { workspace, dir } = makeWorkspace();
    try {
      const result = await dispatchRepairTool(
        'editFile',
        { path: 'app.ts', find: 'const b = 2;', replace: 'const b = "$&-$1-$$";' },
        workspace,
      );
      expect(result).toMatchObject({ ok: true });
      expect(fs.readFileSync(path.join(dir, 'app.ts'), 'utf8')).toContain('const b = "$&-$1-$$";');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('dispatchRepairTool createFile', () => {
  it('creates nested files and refuses overwrite and escapes', async () => {
    const { workspace, dir } = makeWorkspace();
    try {
      const created = await dispatchRepairTool(
        'createFile',
        { path: 'lib/new.ts', content: 'export const x = 1;\n' },
        workspace,
      );
      expect(created).toMatchObject({ ok: true });
      expect(fs.readFileSync(path.join(dir, 'lib/new.ts'), 'utf8')).toBe('export const x = 1;\n');
      expect(
        await dispatchRepairTool('createFile', { path: 'app.ts', content: 'x' }, workspace),
      ).toMatchObject({ ok: false });
      expect(
        await dispatchRepairTool('createFile', { path: '../escape.ts', content: 'x' }, workspace),
      ).toMatchObject({ ok: false });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('dispatchRepairTool runCheck', () => {
  it('runs the named package script and reports its exit code', async () => {
    const { workspace, dir } = makeWorkspace();
    try {
      const result = await dispatchRepairTool('runCheck', { name: 'test' }, workspace);
      expect(result).toMatchObject({ ok: true, data: { name: 'test', exitCode: 0 } });
      expect(
        await dispatchRepairTool('runCheck', { name: 'deploy' }, workspace),
      ).toMatchObject({ ok: false });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
