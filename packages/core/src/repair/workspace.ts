import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import { readTextFile } from '../agent/tools.js';

const execFileAsync = promisify(execFile);

/** Repair cannot proceed honestly; the orchestrator records a limitation. */
export class RepairUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RepairUnavailableError';
  }
}

async function git(repoPath: string, args: string[], timeoutMs = 30_000): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd: repoPath, timeout: timeoutMs });
    return stdout;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new RepairUnavailableError(`git ${args[0]} failed in ${repoPath}: ${message}`);
  }
}

function sha256File(absolute: string): string {
  return createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
}

export interface CarriedFile {
  /** Path relative to the target package directory. */
  relativePath: string;
  sha256: string;
}

export interface RepairWorkspace {
  repoRoot: string;
  /** Target package dir relative to the repo root ('.' when identical). */
  subpath: string;
  headSha: string;
  worktreePath: string;
  packageDir: string;
  carriedFiles: CarriedFile[];
  sourceIdentity: string;
}

/**
 * Snapshot the target package for isolated repair: a detached worktree at
 * HEAD plus hash-verified copies of untracked (non-ignored) files under the
 * target subpath. Refuses when tracked files under the subpath are modified
 * (cannot capture faithfully) or when the path is not in a git repository.
 * Files outside the target subpath are irrelevant and ignored.
 */
export async function createRepairWorkspace(
  repoPath: string,
  workspacePath: string,
): Promise<RepairWorkspace> {
  let repoRoot: string;
  try {
    repoRoot = (await git(repoPath, ['rev-parse', '--show-toplevel'])).trim();
  } catch {
    throw new RepairUnavailableError(
      `Repository path is not inside a git checkout: ${repoPath}`,
    );
  }
  const absoluteRepo = fs.realpathSync(path.resolve(repoPath));
  repoRoot = fs.realpathSync(repoRoot);
  const subpath = path.relative(repoRoot, absoluteRepo) || '.';
  if (subpath.startsWith('..')) {
    throw new RepairUnavailableError(`Repository path escapes its git root: ${repoPath}`);
  }
  const headSha = (await git(repoRoot, ['rev-parse', 'HEAD'])).trim();
  const scope = subpath === '.' ? [] : ['--', subpath];
  const status = await git(repoRoot, ['status', '--porcelain', ...scope]);
  const modified = status
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('??'));
  if (modified.length > 0) {
    throw new RepairUnavailableError(
      `Tracked files under ${subpath} are modified; commit or revert before repair: ${modified.slice(0, 5).join(', ')}`,
    );
  }
  const untrackedRaw = await git(repoRoot, ['ls-files', '--others', '--exclude-standard', ...scope]);
  const untracked = untrackedRaw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');

  if (fs.existsSync(workspacePath)) {
    fs.rmSync(workspacePath, { recursive: true, force: true });
    await git(repoRoot, ['worktree', 'prune']).catch(() => {});
  }
  fs.mkdirSync(path.dirname(workspacePath), { recursive: true });
  await git(repoRoot, ['worktree', 'add', '--detach', workspacePath, headSha]);

  const packageDir = subpath === '.' ? workspacePath : path.join(workspacePath, subpath);
  const carriedFiles: CarriedFile[] = [];
  for (const repoRelative of untracked) {
    // Dependencies are reinstalled, never carried: a foreign node_modules
    // tree would shadow the isolated install with unpinned binaries.
    if (repoRelative === 'node_modules' || repoRelative.startsWith('node_modules/')) continue;
    if (repoRelative.includes('/node_modules/')) continue;
    const source = path.join(repoRoot, repoRelative);
    const relativeToPackage =
      subpath === '.' ? repoRelative : path.relative(subpath, repoRelative);
    if (relativeToPackage.startsWith('..')) continue;
    const dest = path.join(packageDir, relativeToPackage);
    const stat = fs.statSync(source, { throwIfNoEntry: false });
    if (!stat || !stat.isFile()) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(source, dest);
    const before = sha256File(source);
    const after = sha256File(dest);
    if (before !== after) {
      throw new RepairUnavailableError(`Untracked file copy failed verification: ${repoRelative}`);
    }
    carriedFiles.push({ relativePath: relativeToPackage, sha256: before });
  }

  const sourceIdentity =
    carriedFiles.length === 0
      ? `git:${headSha}:subpath-clean`
      : `git:${headSha}:subpath-clean+${carriedFiles.length}-untracked`;
  return { repoRoot, subpath, headSha, worktreePath: workspacePath, packageDir, carriedFiles, sourceIdentity };
}

/**
 * Combined diff of the workspace: tracked changes vs HEAD, carried-file
 * changes vs the main checkout, and agent-created files. Empty string means
 * no changes were made.
 */
export async function diffWorkspace(workspace: RepairWorkspace): Promise<string> {
  const sections: string[] = [];
  const tracked = await git(workspace.worktreePath, ['diff', 'HEAD', '--', '.']).catch(() => '');
  if (tracked.trim() !== '') sections.push(tracked.trimEnd());
  for (const carried of workspace.carriedFiles) {
    const original = path.join(
      workspace.repoRoot,
      workspace.subpath === '.' ? carried.relativePath : path.join(workspace.subpath, carried.relativePath),
    );
    const current = path.join(workspace.packageDir, carried.relativePath);
    if (!fs.existsSync(current)) {
      sections.push(`deleted carried file: ${carried.relativePath}`);
      continue;
    }
    if (sha256File(current) === carried.sha256) continue;
    const { stdout } = await execFileAsync('git', [
      'diff',
      '--no-index',
      '--',
      original,
      current,
    ]).catch((err: { stdout?: string }) => ({ stdout: err.stdout ?? '' }));
    sections.push((stdout as string).trimEnd() || `modified carried file: ${carried.relativePath}`);
  }
  const fresh = await git(workspace.worktreePath, ['ls-files', '--others', '--exclude-standard']).catch(
    () => '',
  );
  const carriedSet = new Set(
    workspace.carriedFiles.map((c) =>
      workspace.subpath === '.' ? c.relativePath : path.join(workspace.subpath, c.relativePath),
    ),
  );
  for (const line of fresh.split('\n').map((l) => l.trim()).filter((l) => l !== '')) {
    if (carriedSet.has(line)) continue;
    if (line === '.git') continue;
    const text = readTextFile(path.join(workspace.worktreePath, line));
    if (text === null) {
      sections.push(`new file: ${line} (binary or unreadable)`);
    } else {
      const body = text.length > 20_000 ? `${text.slice(0, 20_000)}\n... (truncated)` : text;
      sections.push([`new file: ${line}`, ...body.split('\n').map((l) => `+${l}`)].join('\n'));
    }
  }
  return sections.join('\n\n');
}

export async function removeRepairWorkspace(workspace: RepairWorkspace): Promise<void> {
  await git(workspace.repoRoot, ['worktree', 'remove', '--force', workspace.worktreePath]).catch(
    () => {},
  );
  fs.rmSync(workspace.worktreePath, { recursive: true, force: true });
  await git(workspace.repoRoot, ['worktree', 'prune']).catch(() => {});
}

export interface CommandResult {
  exitCode: number | null;
  output: string;
  durationMs: number;
}

function killProcessTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // No process group (or already gone): fall through to the child.
    }
  }
  try {
    child.kill(signal);
  } catch {
    // Already gone.
  }
}

async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string | undefined>,
  timeoutMs: number,
): Promise<CommandResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      detached: true,
      env: { ...process.env, ...env },
    });
    const chunks: Buffer[] = [];
    const cap = 64 * 1024;
    const collect = (data: Buffer): void => {
      if (Buffer.concat(chunks).length < cap) chunks.push(data);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    let finished = false;
    let timedOut = false;
    const finish = (exitCode: number | null): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({
        exitCode,
        output: Buffer.concat(chunks).toString('utf8').slice(-8000),
        durationMs: Date.now() - started,
      });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child, 'SIGTERM');
      setTimeout(() => {
        killProcessTree(child, 'SIGKILL');
        setTimeout(() => finish(null), 2000);
      }, 5000);
    }, timeoutMs);
    child.on('error', () => finish(null));
    child.on('close', (code) => finish(timedOut ? null : code));
  });
}

/**
 * Install worktree dependencies from a clean slate, preferring the offline
 * package store. Any pre-existing node_modules is removed first so the
 * isolated install is deterministic; the path is always our own worktree.
 */
export async function installWorkspace(workspacePath: string): Promise<CommandResult> {
  fs.rmSync(path.join(workspacePath, 'node_modules'), { recursive: true, force: true });
  const offline = await runCommand('pnpm', ['install', '--offline'], workspacePath, {}, 300_000);
  if (offline.exitCode === 0) return offline;
  return runCommand('pnpm', ['install'], workspacePath, {}, 300_000);
}

export function packageScriptNames(packageDir: string): string[] {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    return Object.keys(pkg.scripts ?? {});
  } catch {
    return [];
  }
}

export async function runPackageScript(
  packageDir: string,
  name: string,
  timeoutMs = 180_000,
  remainingMs?: number,
): Promise<CommandResult> {
  const effective =
    remainingMs !== undefined ? Math.max(1000, Math.min(timeoutMs, remainingMs)) : timeoutMs;
  return runCommand('pnpm', ['--dir', packageDir, name], packageDir, {}, effective);
}

export async function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true));
    });
  });
}

/** Default 4200 (documented for isolated copies), scanning upward on conflict. */
export const DEFAULT_ISOLATED_PORT = 4200;

export async function allocatePort(preferred = DEFAULT_ISOLATED_PORT): Promise<number> {
  for (let port = preferred; port < preferred + 20; port += 1) {
    if (await isPortFree(port)) return port;
  }
  for (let i = 0; i < 20; i += 1) {
    const port = 30_000 + Math.floor(Math.random() * 20_000);
    if (await isPortFree(port)) return port;
  }
  throw new RepairUnavailableError('No free port found for the isolated app.');
}

export interface ServedApp {
  pid: number;
  port: number;
  cwd: string;
  command: string[];
  url: string;
  stop: () => Promise<void>;
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'unknown';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.status < 500) return;
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new RepairUnavailableError(`Isolated app never became ready at ${url}: ${lastError}`);
}

/**
 * Start the workspace package's `start` script on the given port. The child
 * runs detached in its own process group so stop() reliably kills the whole
 * tree (pnpm forwards to the script, the group kill catches strays).
 */
export async function servePackage(
  packageDir: string,
  port: number,
  readyTimeoutMs = 30_000,
): Promise<ServedApp> {
  const command = ['pnpm', '--dir', packageDir, 'start'];
  const child: ChildProcess = spawn('pnpm', ['--dir', packageDir, 'start'], {
    cwd: packageDir,
    env: { ...process.env, PORT: String(port) },
    detached: true,
    stdio: 'ignore',
  });
  if (!child.pid) {
    throw new RepairUnavailableError('Failed to spawn the isolated app.');
  }
  child.unref();
  // Identity guard: if our process died (e.g. the port was already bound),
  // whatever answers on the port is a foreign process and must not be
  // mistaken for the patched app.
  let exitCode: number | null | undefined;
  child.on('exit', (code) => {
    exitCode = code;
  });
  const url = `http://127.0.0.1:${port}/`;
  const stopChild = (): void => {
    try {
      process.kill(-(child.pid as number), 'SIGKILL');
    } catch {
      // Already gone.
    }
  };
  try {
    await waitForHttp(url, readyTimeoutMs);
  } catch (err) {
    stopChild();
    throw err;
  }
  if (exitCode !== undefined) {
    stopChild();
    throw new RepairUnavailableError(
      `Isolated app exited (code ${exitCode ?? 'unknown'}) before serving; refusing to verify against whatever owns port ${port}.`,
    );
  }
  const pid = child.pid;
  return {
    pid,
    port,
    cwd: packageDir,
    command,
    url,
    stop: async () => {
      try {
        process.kill(-pid, 'SIGTERM');
      } catch {
        return;
      }
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        try {
          process.kill(pid, 0);
        } catch {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        // Gone.
      }
    },
  };
}
