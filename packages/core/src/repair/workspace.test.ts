import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  allocatePort,
  createRepairWorkspace,
  diffWorkspace,
  isPortFree,
  removeRepairWorkspace,
  RepairUnavailableError,
  runPackageScript,
  servePackage,
} from './workspace.js';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function makeRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'races-ws-test-'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  fs.mkdirSync(path.join(dir, 'pkg'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'pkg', 'tracked.ts'), 'export const v = 1;\n');
  fs.writeFileSync(path.join(dir, 'other.txt'), 'other\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'init');
  return dir;
}

describe('createRepairWorkspace', () => {
  it('snapshots a clean subpath and carries untracked files with verification', async () => {
    const repo = makeRepo();
    try {
      fs.writeFileSync(path.join(repo, 'pkg', 'new.ts'), 'export const w = 2;\n');
      fs.writeFileSync(path.join(repo, 'other.txt'), 'modified outside subpath\n');
      const ws = await createRepairWorkspace(
        path.join(repo, 'pkg'),
        path.join(repo, '.ws', 'run-1'),
      );
      expect(ws.subpath).toBe('pkg');
      expect(ws.sourceIdentity).toMatch(/^git:[0-9a-f]{40}:subpath-clean\+1-untracked$/);
      expect(fs.readFileSync(path.join(ws.packageDir, 'new.ts'), 'utf8')).toBe(
        'export const w = 2;\n',
      );
      expect(fs.readFileSync(path.join(ws.packageDir, 'tracked.ts'), 'utf8')).toBe(
        'export const v = 1;\n',
      );

      // Edits in the worktree show up in the combined diff.
      fs.writeFileSync(path.join(ws.packageDir, 'tracked.ts'), 'export const v = 42;\n');
      fs.writeFileSync(path.join(ws.packageDir, 'new.ts'), 'export const w = 3;\n');
      const diff = await diffWorkspace(ws);
      expect(diff).toContain('export const v = 42;');
      expect(diff).toContain('export const w = 3;');

      await removeRepairWorkspace(ws);
      expect(fs.existsSync(path.join(repo, '.ws', 'run-1'))).toBe(false);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('never carries node_modules trees into the worktree', async () => {
    const repo = makeRepo();
    try {
      fs.mkdirSync(path.join(repo, 'pkg', 'node_modules', 'fake'), { recursive: true });
      fs.writeFileSync(path.join(repo, 'pkg', 'node_modules', 'fake', 'index.js'), 'x\n');
      fs.writeFileSync(path.join(repo, 'pkg', 'new.ts'), 'export const w = 2;\n');
      const ws = await createRepairWorkspace(
        path.join(repo, 'pkg'),
        path.join(repo, '.ws', 'run-1'),
      );
      expect(ws.carriedFiles.map((f) => f.relativePath)).toEqual(['new.ts']);
      expect(fs.existsSync(path.join(ws.packageDir, 'node_modules'))).toBe(false);
      await removeRepairWorkspace(ws);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('refuses modified tracked files under the subpath and non-git paths', async () => {
    const repo = makeRepo();
    try {
      fs.writeFileSync(path.join(repo, 'pkg', 'tracked.ts'), 'dirty\n');
      await expect(
        createRepairWorkspace(path.join(repo, 'pkg'), path.join(repo, '.ws', 'x')),
      ).rejects.toBeInstanceOf(RepairUnavailableError);

      const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'races-ws-plain-'));
      try {
        await expect(
          createRepairWorkspace(plain, path.join(plain, 'ws')),
        ).rejects.toBeInstanceOf(RepairUnavailableError);
      } finally {
        fs.rmSync(plain, { recursive: true, force: true });
      }
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe('ports and serving', () => {
  it('allocates a free port', async () => {
    const port = await allocatePort(4230);
    expect(await isPortFree(port)).toBe(true);
  });

  it('serves a package and stops it without strays', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'races-serve-test-'));
    try {
      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ name: 'srv', scripts: { start: 'node server.js' } }),
      );
      fs.writeFileSync(
        path.join(dir, 'server.js'),
        "require('http').createServer((_, res) => res.end('hi')).listen(process.env.PORT, '127.0.0.1');",
      );
      const port = await allocatePort(4240);
      const app = await servePackage(dir, port);
      expect(app.port).toBe(port);
      expect(app.url).toBe(`http://127.0.0.1:${port}/`);
      const body = await fetch(app.url).then((r) => r.text());
      expect(body).toBe('hi');
      await app.stop();
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(await isPortFree(port)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runs package scripts and reports exit codes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'races-script-test-'));
    try {
      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ name: 's', scripts: { ok: 'node -e "1"', bad: 'node -e "process.exit(3)"' } }),
      );
      const ok = await runPackageScript(dir, 'ok');
      expect(ok.exitCode).toBe(0);
      const bad = await runPackageScript(dir, 'bad');
      expect(bad.exitCode).toBe(3);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
