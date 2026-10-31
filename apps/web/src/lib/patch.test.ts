import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { storedDiffToPatch } from './patch';

function makeGitRepo(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'races-patch-test-'));
  const git = (...args: string[]): string =>
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
      cwd: dir,
      encoding: 'utf8',
    });
  git('init', '-q');
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
  git('add', '-A');
  git('commit', '-qm', 'base');
  return dir;
}

function applyCheckFails(dir: string, patch: string): string | null {
  const file = path.join(dir, 'probe.patch');
  fs.writeFileSync(file, patch);
  try {
    execFileSync('git', ['apply', '--check', '-v', file], { cwd: dir, encoding: 'utf8' });
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  } finally {
    fs.rmSync(file, { force: true });
  }
}

describe('storedDiffToPatch', () => {
  it('passes tracked git sections through and they apply', () => {
    const dir = makeGitRepo({ 'app.ts': 'const a = 1;\n' });
    try {
      const stored = [
        'diff --git a/app.ts b/app.ts',
        'index 257cc56..5716ca5 100644',
        '--- a/app.ts',
        '+++ b/app.ts',
        '@@ -1 +1 @@',
        '-const a = 1;',
        '+const a = 2;',
        '',
      ].join('\n');
      const result = storedDiffToPatch(stored);
      expect(result.ok).toBe(true);
      if (result.ok) expect(applyCheckFails(dir, result.patch)).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('relativizes carried --no-index sections via the common tail', () => {
    const dir = makeGitRepo({ 'src/app.ts': 'const a = 1;\n' });
    try {
      const stored = [
        'diff --git a//tmp/repo/src/app.ts b//tmp/wt-uuid/src/app.ts',
        'index 257cc56..5716ca5 100644',
        '--- a//tmp/repo/src/app.ts',
        '+++ b//tmp/wt-uuid/src/app.ts',
        '@@ -1 +1 @@',
        '-const a = 1;',
        '+const a = 2;',
        '',
      ].join('\n');
      const result = storedDiffToPatch(stored);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.patch).toContain('diff --git a/src/app.ts b/src/app.ts');
        expect(applyCheckFails(dir, result.patch)).toBeNull();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('synthesizes applyable new-file diffs', () => {
    const dir = makeGitRepo({ 'app.ts': 'const a = 1;\n' });
    try {
      const stored = ['new file: lib/new.ts', '+export const x = 1;', '+', ''].join('\n');
      const result = storedDiffToPatch(stored);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.patch).toContain('new file mode 100644');
        expect(applyCheckFails(dir, result.patch)).toBeNull();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('marks missing trailing newlines so the apply is faithful', () => {
    const dir = makeGitRepo({ 'app.ts': 'x\n' });
    try {
      const stored = ['new file: note.txt', '+no trailing newline', ''].join('\n');
      const result = storedDiffToPatch(stored);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.patch).toContain('\\ No newline at end of file');
        expect(applyCheckFails(dir, result.patch)).toBeNull();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses anything it cannot faithfully reconstruct', () => {
    expect(storedDiffToPatch('')).toMatchObject({ ok: false });
    expect(storedDiffToPatch('new file: big.ts\n+abc\n+... (truncated)\n')).toMatchObject({
      ok: false,
    });
    expect(storedDiffToPatch('new file: a.bin (binary or unreadable)\n')).toMatchObject({
      ok: false,
    });
    expect(storedDiffToPatch('deleted carried file: gone.ts\n')).toMatchObject({ ok: false });
    expect(storedDiffToPatch('new file: ../escape.ts\n+x\n')).toMatchObject({ ok: false });
  });
});
