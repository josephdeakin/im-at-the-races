import 'server-only';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 30_000;

export interface PatchApplyResult {
  branch: string;
  baseBranch: string;
  baseSha: string;
  files: string[];
}

export class PatchApplyError extends Error {
  readonly code: 'NOT_A_REPO' | 'DIRTY_TREE' | 'CONFLICT' | 'GIT_ERROR';
  readonly detail: string | null;

  constructor(code: PatchApplyError['code'], message: string, detail: string | null = null) {
    super(message);
    this.name = 'PatchApplyError';
    this.code = code;
    this.detail = detail;
  }
}

async function git(repoPath: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd: repoPath,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });
    return stdout;
  } catch (err) {
    const message =
      err instanceof Error ? (err as { stderr?: unknown }).stderr ?? err.message : String(err);
    throw new PatchApplyError(
      'GIT_ERROR',
      `git ${args[0]} failed: ${String(message).slice(0, 500)}`,
    );
  }
}

/**
 * Apply a unified patch to the target repo on a fresh branch, leaving the
 * user's current branch untouched. Refuses dirty trees and anything that
 * does not pass `git apply --check` first; the branch is removed again if
 * the apply itself fails. Changes are left uncommitted for review.
 */
export async function applyPatchToRepo(
  repoPath: string,
  patch: string,
  branchBase: string,
): Promise<PatchApplyResult> {
  for (const line of patch.split('\n')) {
    if (
      (line.startsWith('--- a/') || line.startsWith('+++ b/')) &&
      (line.includes('..') || /^(--- a|\+\+\+ b)\/\//.test(line))
    ) {
      throw new PatchApplyError('CONFLICT', 'Patch contains absolute or escaping paths.');
    }
  }
  try {
    await execFileAsync('git', ['--version'], { timeout: GIT_TIMEOUT_MS });
  } catch {
    throw new PatchApplyError('GIT_ERROR', 'git is not available on this machine.');
  }
  try {
    await git(repoPath, ['rev-parse', '--git-dir']);
  } catch {
    throw new PatchApplyError('NOT_A_REPO', `Not a git repository: ${repoPath}`);
  }
  const baseSha = (await git(repoPath, ['rev-parse', 'HEAD'])).trim();
  const baseBranch = (await git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  const status = (await git(repoPath, ['status', '--porcelain'])).trim();
  if (status !== '') {
    throw new PatchApplyError(
      'DIRTY_TREE',
      'The repository has uncommitted changes. Commit or stash them first so the patch applies onto a known state.',
    );
  }

  let branch = branchBase;
  for (let suffix = 2; suffix < 50; suffix += 1) {
    try {
      await git(repoPath, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
      branch = `${branchBase}-${suffix}`;
    } catch {
      break;
    }
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'races-apply-'));
  const patchFile = path.join(tmpDir, 'patch.diff');
  try {
    fs.writeFileSync(patchFile, patch);
    try {
      await git(repoPath, ['apply', '--check', '-v', patchFile]);
    } catch (err) {
      throw new PatchApplyError(
        'CONFLICT',
        'The patch does not apply cleanly to the current checkout (it may predate local changes). Nothing was changed.',
        err instanceof PatchApplyError ? err.message : null,
      );
    }
    await git(repoPath, ['checkout', '-b', branch]);
    try {
      await git(repoPath, ['apply', patchFile]);
    } catch (err) {
      await git(repoPath, ['checkout', baseBranch === 'HEAD' ? baseSha : baseBranch]).catch(
        () => {},
      );
      await git(repoPath, ['branch', '-D', branch]).catch(() => {});
      throw new PatchApplyError(
        'GIT_ERROR',
        `Apply failed after the branch was created; restored ${baseBranch} and removed ${branch}.`,
        err instanceof Error ? err.message : null,
      );
    }
    const after = await git(repoPath, ['status', '--porcelain']);
    const files = after
      .split('\n')
      .map((l) => l.slice(3).trim())
      .filter((l) => l !== '');
    return { branch, baseBranch, baseSha, files };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
