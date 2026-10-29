import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export type ReproRunStatus = 'failed-for-check' | 'passed' | 'incomplete';

export interface ReproRunResult {
  status: ReproRunStatus;
  checkId: string;
  exitCode: number | null;
  /** Combined output, tail-capped for the record. */
  output: string;
  durationMs: number;
}

function playwrightPaths(): { command: string; argsPrefix: string[]; nodePath: string } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pkgPath = require.resolve('playwright/package.json') as string;
  const pkgDir = path.dirname(pkgPath);
  // Run the bundled CLI through node: robust across npm/pnpm layouts,
  // where a sibling .bin entry may not exist.
  const cli = path.join(pkgDir, 'cli.js');
  if (!fs.existsSync(cli)) throw new Error('playwright cli.js missing');
  return {
    command: process.execPath,
    argsPrefix: [cli],
    nodePath: path.join(pkgDir, '..'),
  };
}

/**
 * Execute an exported regression spec in a fresh process against a target
 * URL. Semantics come from output markers, not just the exit code:
 * REPRO-CHECK-FAILED names the violated checks, REPRO-ERROR marks setup
 * trouble (incomplete, never a verdict about the app).
 */
export async function runReproSpec(
  specPath: string,
  targetUrl: string,
  checkId: string,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<ReproRunResult> {
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? 180_000;
  let command: string;
  let argsPrefix: string[];
  let nodePath: string;
  try {
    ({ command, argsPrefix, nodePath } = playwrightPaths());
  } catch {
    return {
      status: 'incomplete',
      checkId,
      exitCode: null,
      output: 'Playwright installation not found alongside @races/core.',
      durationMs: Date.now() - started,
    };
  }
  const cwd = path.dirname(specPath);
  if (options.signal?.aborted) {
    return {
      status: 'incomplete',
      checkId,
      exitCode: null,
      output: 'Aborted before the spec started.',
      durationMs: Date.now() - started,
    };
  }
  const output = await new Promise<{ exitCode: number | null; text: string }>((resolve) => {
    const child = spawn(
      command,
      [...argsPrefix, 'test', path.basename(specPath), '--reporter=line'],
      {
        cwd,
        env: {
          ...process.env,
          NODE_PATH: nodePath,
          REPRO_TARGET_URL: targetUrl,
          // Keep browser downloads out of the evidence dir; reuse the cache.
          PLAYWRIGHT_HTML_OPEN: 'never',
        },
      },
    );
    const chunks: Buffer[] = [];
    const collect = (data: Buffer): void => {
      chunks.push(data);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    let finished = false;
    const finish = (exitCode: number | null): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      resolve({ exitCode, text: Buffer.concat(chunks).toString('utf8') });
    };
    const onAbort = (): void => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000);
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(onAbort, timeoutMs);
    child.on('error', () => finish(null));
    child.on('close', (code) => finish(code));
  });

  const text = output.text;
  const marker = /REPRO-CHECK-FAILED ([^\s]+)/.exec(text);
  if (marker && marker[1].split(',').includes(checkId)) {
    return {
      status: 'failed-for-check',
      checkId,
      exitCode: output.exitCode,
      output: text.slice(-8000),
      durationMs: Date.now() - started,
    };
  }
  if (output.exitCode === 0 && !text.includes('REPRO-ERROR')) {
    return {
      status: 'passed',
      checkId,
      exitCode: 0,
      output: text.slice(-8000),
      durationMs: Date.now() - started,
    };
  }
  return {
    status: 'incomplete',
    checkId,
    exitCode: output.exitCode,
    output: text.slice(-8000),
    durationMs: Date.now() - started,
  };
}
