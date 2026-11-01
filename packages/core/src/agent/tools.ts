import fs from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright';
import {
  ActArgsSchema,
  ExperimentPlanSchema,
  ListFilesArgsSchema,
  ObservePageArgsSchema,
  ReadEvidenceArgsSchema,
  ReadFileArgsSchema,
  RunExperimentArgsSchema,
  SearchCodeArgsSchema,
  type ExperimentPlan,
} from '@races/contracts';
import type { ArtifactStore, EventSink } from '../index.js';
import type { TrialRequest, TrialResult } from '../runner/trial.js';
import type {
  ExperimentRequest,
  ExperimentResult,
  ExperimentStore,
} from '../runner/experiment.js';
import { isAbortError, sleep } from '../runner/util.js';
import type { ModelToolDefinition } from './model.js';
import { computeReproduced } from './reproduce.js';

export interface EvidenceReader {
  readEvidence(artifactId: string): {
    kind: string;
    mimeType: string;
    sizeBytes: number;
    text: string | null;
    note: string;
  };
}

export interface AgentBudgets {
  plansUsed: number;
  planBudget: number;
}

export interface AgentTrialRunner {
  runExperiment(request: ExperimentRequest): Promise<ExperimentResult>;
  executeTrial(request: TrialRequest): Promise<TrialResult>;
}

export interface AgentToolDeps {
  runId: string;
  repoPath: string;
  targetUrl: string;
  browser: Browser;
  signal: AbortSignal;
  events: EventSink;
  artifacts: ArtifactStore;
  experiments: ExperimentStore;
  evidence: EvidenceReader;
  budgets: AgentBudgets;
  trialRunner: AgentTrialRunner;
}

export type ToolOutcome =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string };

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  '__pycache__',
  '.races',
  'vendor',
]);

const MAX_SCAN_ENTRIES = 3000;
const MAX_FILE_BYTES = 500_000;
const TEXT_SLICE = 4000;

function sliceText(value: string | null, max = TEXT_SLICE): string | null {
  if (value === null) return null;
  return value.length > max ? `${value.slice(0, max)}…(truncated)` : value;
}

/** Resolve a tool-provided relative path, confined to the repository. */
export function resolveRepoPath(repoPath: string, relative: string): string {
  const absolute = path.resolve(repoPath, relative === '.' ? '.' : relative);
  if (absolute !== repoPath && !absolute.startsWith(`${repoPath}${path.sep}`)) {
    throw new Error(`Path escapes the repository: ${JSON.stringify(relative)}`);
  }
  let real = absolute;
  try {
    real = fs.realpathSync(absolute);
  } catch {
    throw new Error(`Path does not exist: ${JSON.stringify(relative)}`);
  }
  const realRepo = fs.realpathSync(repoPath);
  if (real !== realRepo && !real.startsWith(`${realRepo}${path.sep}`)) {
    throw new Error(`Path escapes the repository: ${JSON.stringify(relative)}`);
  }
  return real;
}

interface WalkEntry {
  relative: string;
  absolute: string;
  isDirectory: boolean;
}

export function walkRepo(repoPath: string, startRelative: string): { entries: WalkEntry[]; capped: boolean } {
  const start = resolveRepoPath(repoPath, startRelative);
  const entries: WalkEntry[] = [];
  const queue: string[] = [start];
  let capped = false;
  while (queue.length > 0) {
    if (entries.length >= MAX_SCAN_ENTRIES) {
      capped = true;
      break;
    }
    const dir = queue.shift() as string;
    let children: fs.Dirent[];
    try {
      children = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const child of children) {
      if (child.name.startsWith('.') && child.isDirectory() && child.name !== '.') {
        if (SKIP_DIRS.has(child.name)) continue;
      }
      if (SKIP_DIRS.has(child.name)) continue;
      const absolute = path.join(dir, child.name);
      const relative = path.relative(repoPath, absolute);
      entries.push({ relative, absolute, isDirectory: child.isDirectory() });
      if (child.isDirectory()) queue.push(absolute);
      if (entries.length >= MAX_SCAN_ENTRIES) {
        capped = true;
        break;
      }
    }
  }
  return { entries, capped };
}

export function readTextFile(absolute: string): string | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(absolute);
  } catch {
    return null;
  }
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
  let buffer: Buffer;
  try {
    buffer = fs.readFileSync(absolute);
  } catch {
    return null;
  }
  if (buffer.subarray(0, 4096).includes(0)) return null;
  return buffer.toString('utf8');
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/** Persistent exploration page for observePage/act (separate from trials). */
export class ExplorationPage {
  private page: Page | null = null;
  private consoleErrors: string[] = [];
  private observations = 0;

  constructor(
    private readonly browser: Browser,
    private readonly defaultUrl: string,
  ) {}

  async observe(url: string): Promise<{
    url: string;
    title: string;
    testIds: string[];
    visibleText: string | null;
    consoleErrors: string[];
  }> {
    if (!this.page) {
      const context = await this.browser.newContext({ viewport: { width: 1280, height: 800 } });
      this.page = await context.newPage();
      this.page.on('console', (message) => {
        if (message.type() === 'error') {
          this.consoleErrors.push(message.text().slice(0, 500));
        }
      });
      this.page.on('pageerror', (err) => {
        this.consoleErrors.push(String(err).slice(0, 500));
      });
    }
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    return this.snapshot();
  }

  async act(kind: 'fill' | 'click', testId: string, value: string | undefined): Promise<void> {
    if (!this.page) throw new Error('No page loaded. Call observePage first.');
    const locator = this.page.locator(`[data-testid="${testId.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`);
    if (kind === 'fill') {
      await locator.fill(value ?? '', { timeout: 10_000 });
    } else {
      await locator.click({ timeout: 10_000 });
    }
  }

  async snapshot(): Promise<{
    url: string;
    title: string;
    testIds: string[];
    visibleText: string | null;
    consoleErrors: string[];
  }> {
    if (!this.page) throw new Error('No page loaded. Call observePage first.');
    const url = this.page.url();
    const title = await this.page.title().catch(() => '');
    const testIds = await this.page
      .locator('[data-testid]')
      .evaluateAll((elements) =>
        elements
          .map((el) => el.getAttribute('data-testid'))
          .filter((id): id is string => id !== null)
          .slice(0, 200),
      )
      .catch(() => [] as string[]);
    const visibleText = await this.page
      .locator('body')
      .first()
      .innerText({ timeout: 5000 })
      .catch(() => null);
    const consoleErrors = this.consoleErrors.splice(0, this.consoleErrors.length);
    return { url, title, testIds, visibleText, consoleErrors };
  }

  async screenshot(): Promise<Uint8Array> {
    if (!this.page) throw new Error('No page loaded. Call observePage first.');
    this.observations += 1;
    return this.page.screenshot({ type: 'png' });
  }

  observationCount(): number {
    return this.observations;
  }

  async close(): Promise<void> {
    await this.page?.context().close().catch(() => {});
    this.page = null;
  }
}

function slimTrial(trial: TrialResult): Record<string, unknown> {
  return {
    outcome: trial.outcome,
    reason: trial.detail.reason,
    detail: sliceText(trial.detail.detail, 500),
    assertions: trial.detail.assertions.map((a) => ({
      id: a.id,
      passed: a.passed,
      expected: sliceText(a.expected, 300),
      observed: sliceText(a.observed, 300),
    })),
    requests: trial.detail.requests.map((r) => ({
      id: r.id,
      matched: r.matched,
      held: r.held,
      released: r.released,
      status: r.status,
      excerpt: sliceText(r.responseExcerpt, 300),
    })),
  };
}

async function executeExplorePlan(
  plan: ExperimentPlan,
  deps: AgentToolDeps,
  exploration: ExplorationPage,
): Promise<ToolOutcome> {
  void exploration;
  if (deps.budgets.plansUsed >= deps.budgets.planBudget) {
    return {
      ok: false,
      error: `Plan budget exhausted (${deps.budgets.plansUsed}/${deps.budgets.planBudget} used). Finish with the evidence already gathered.`,
    };
  }
  if (!sameOrigin(plan.startUrl, deps.targetUrl)) {
    return {
      ok: false,
      error: `startUrl origin must match the project target origin (${deps.targetUrl}).`,
    };
  }
  deps.budgets.plansUsed += 1;
  await deps.events.setPhase(deps.runId, 'experimenting');
  const result = await deps.trialRunner.runExperiment({
    plan,
    runId: deps.runId,
    browser: deps.browser,
    signal: deps.signal,
    events: deps.events,
    artifacts: deps.artifacts,
    store: deps.experiments,
  });
  const candidateViolation =
    result.baseline.outcome === 'pass' && result.intervention?.outcome === 'violation';
  return {
    ok: true,
    data: {
      experimentId: result.experimentId,
      baseline: slimTrial(result.baseline),
      intervention: result.intervention ? slimTrial(result.intervention) : null,
      candidateViolation,
      plansRemaining: deps.budgets.planBudget - deps.budgets.plansUsed,
      ...(candidateViolation
        ? { next: 'Baseline passed and the intervention violated the same check. Run mode=confirm on this experimentId (3 attempts) to confirm.' }
        : {}),
    },
  };
}

async function executeConfirmExperiment(
  experimentId: string,
  attempts: number,
  deps: AgentToolDeps,
): Promise<ToolOutcome> {
  if (deps.budgets.plansUsed >= deps.budgets.planBudget) {
    return {
      ok: false,
      error: `Plan budget exhausted (${deps.budgets.plansUsed}/${deps.budgets.planBudget} used). Finish with the evidence already gathered.`,
    };
  }
  const stored = deps.experiments.getExperiment(experimentId);
  if (!stored || stored.runId !== deps.runId) {
    return { ok: false, error: `Unknown experiment for this run: ${experimentId}` };
  }
  deps.budgets.plansUsed += 1;
  const parsed = ExperimentPlanSchema.safeParse(stored.plan);
  if (!parsed.success) {
    return { ok: false, error: `Stored plan for ${experimentId} no longer validates.` };
  }
  const plan = parsed.data;
  const existing = deps.experiments.listTrials(experimentId);
  let nextAttempt = 0;
  for (const trial of existing) nextAttempt = Math.max(nextAttempt, trial.attempt + 1);
  const trialBase = {
    plan,
    experimentId,
    runId: deps.runId,
    browser: deps.browser,
    signal: deps.signal,
    events: deps.events,
    artifacts: deps.artifacts,
    trials: deps.experiments,
  };
  for (let i = 0; i < attempts; i += 1) {
    const attempt = nextAttempt + i;
    await deps.trialRunner.executeTrial({ ...trialBase, kind: 'baseline', attempt });
    await deps.trialRunner.executeTrial({ ...trialBase, kind: 'intervention', attempt });
  }
  const verdict = computeReproduced(deps.experiments.listTrials(experimentId));
  return {
    ok: true,
    data: {
      experimentId,
      candidateChecks: verdict.candidateChecks,
      attempts: verdict.attempts,
      violations: verdict.violations,
      count: `${verdict.violations} of ${verdict.attempts}`,
      reproduced: verdict.reproduced,
    },
  };
}

export async function dispatchTool(
  name: string,
  input: Record<string, unknown>,
  deps: AgentToolDeps,
  exploration: ExplorationPage,
): Promise<ToolOutcome> {
  try {
    switch (name) {
      case 'listFiles': {
        const parsed = ListFilesArgsSchema.safeParse(input);
        if (!parsed.success) return { ok: false, error: `Invalid listFiles args: ${parsed.error.message}` };
        const { entries, capped } = walkRepo(deps.repoPath, parsed.data.path);
        const pattern = parsed.data.pattern;
        const filtered = (pattern ? entries.filter((e) => e.relative.includes(pattern)) : entries)
          .sort((a, b) => (a.relative < b.relative ? -1 : 1))
          .slice(0, parsed.data.limit);
        return {
          ok: true,
          data: {
            root: deps.repoPath,
            entries: filtered.map((e) => (e.isDirectory ? `${e.relative}/` : e.relative)),
            truncated: capped || filtered.length < entries.length,
          },
        };
      }
      case 'searchCode': {
        const parsed = SearchCodeArgsSchema.safeParse(input);
        if (!parsed.success) return { ok: false, error: `Invalid searchCode args: ${parsed.error.message}` };
        const { entries, capped } = walkRepo(deps.repoPath, parsed.data.path);
        const matches: { path: string; line: number; text: string }[] = [];
        let scanned = 0;
        for (const entry of entries) {
          if (entry.isDirectory || matches.length >= parsed.data.limit) continue;
          const text = readTextFile(entry.absolute);
          if (text === null) continue;
          scanned += 1;
          const lines = text.split('\n');
          for (let i = 0; i < lines.length && matches.length < parsed.data.limit; i += 1) {
            if (lines[i].includes(parsed.data.query)) {
              matches.push({ path: entry.relative, line: i + 1, text: lines[i].slice(0, 200) });
            }
          }
        }
        return {
          ok: true,
          data: { matches, filesScanned: scanned, truncated: capped || matches.length >= parsed.data.limit },
        };
      }
      case 'readFile': {
        const parsed = ReadFileArgsSchema.safeParse(input);
        if (!parsed.success) return { ok: false, error: `Invalid readFile args: ${parsed.error.message}` };
        let absolute: string;
        try {
          absolute = resolveRepoPath(deps.repoPath, parsed.data.path);
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
        const text = readTextFile(absolute);
        if (text === null) {
          return { ok: false, error: `Cannot read as text (missing, binary, or oversized): ${parsed.data.path}` };
        }
        const lines = text.split('\n');
        const start = Math.min(parsed.data.offset, lines.length + 1);
        const selected = lines.slice(start - 1, start - 1 + parsed.data.limit);
        return {
          ok: true,
          data: {
            path: parsed.data.path,
            totalLines: lines.length,
            offset: start,
            lines: selected,
            truncated: start - 1 + selected.length < lines.length,
          },
        };
      }
      case 'observePage': {
        const parsed = ObservePageArgsSchema.safeParse(input);
        if (!parsed.success) return { ok: false, error: `Invalid observePage args: ${parsed.error.message}` };
        const url = parsed.data.url ?? deps.targetUrl;
        if (!sameOrigin(url, deps.targetUrl)) {
          return { ok: false, error: `Navigation outside the project target origin is not allowed: ${url}` };
        }
        const snapshot = await exploration.observe(url);
        const png = await exploration.screenshot();
        const count = exploration.observationCount();
        const artifact = await deps.artifacts.saveArtifact({
          runId: deps.runId,
          kind: 'observation',
          filename: `observation-${count}.png`,
          mimeType: 'image/png',
          data: png,
        });
        return {
          ok: true,
          data: {
            url: snapshot.url,
            title: snapshot.title,
            testIds: snapshot.testIds,
            visibleText: sliceText(snapshot.visibleText),
            consoleErrors: snapshot.consoleErrors,
            screenshotArtifactId: artifact.id,
          },
        };
      }
      case 'act': {
        const parsed = ActArgsSchema.safeParse(input);
        if (!parsed.success) return { ok: false, error: `Invalid act args: ${parsed.error.message}` };
        try {
          await exploration.act(parsed.data.kind, parsed.data.testId, parsed.data.value);
        } catch (err) {
          deps.signal.throwIfAborted();
          return { ok: false, error: `Action failed: ${err instanceof Error ? err.message : String(err)}` };
        }
        await sleep(500, deps.signal);
        const snapshot = await exploration.snapshot();
        return {
          ok: true,
          data: {
            visibleText: sliceText(snapshot.visibleText, 2000),
            consoleErrors: snapshot.consoleErrors,
          },
        };
      }
      case 'readEvidence': {
        const parsed = ReadEvidenceArgsSchema.safeParse(input);
        if (!parsed.success) return { ok: false, error: `Invalid readEvidence args: ${parsed.error.message}` };
        try {
          const found = deps.evidence.readEvidence(parsed.data.artifactId);
          return {
            ok: true,
            data: {
              kind: found.kind,
              mimeType: found.mimeType,
              sizeBytes: found.sizeBytes,
              text: found.text === null ? null : sliceText(found.text, 8000),
              note: found.note,
            },
          };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }
      case 'runExperiment': {
        const parsed = RunExperimentArgsSchema.safeParse(input);
        if (!parsed.success) return { ok: false, error: `Invalid runExperiment args: ${parsed.error.message}` };
        if (parsed.data.mode === 'confirm') {
          return executeConfirmExperiment(parsed.data.experimentId, parsed.data.attempts, deps);
        }
        return executeExplorePlan(parsed.data.plan, deps, exploration);
      }
      default:
        return { ok: false, error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    if (isAbortError(err) || deps.signal.aborted) throw err;
    return { ok: false, error: `Tool ${name} failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export const AGENT_TOOL_DEFINITIONS: ModelToolDefinition[] = [
  {
    name: 'listFiles',
    description:
      'List files and directories under the repository root (recursive). Use pattern to filter paths. Skips dependencies, build output, and VCS metadata.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory relative to the repo root. Default "."' },
        pattern: { type: 'string', description: 'Substring filter on paths.' },
        limit: { type: 'integer', description: 'Max entries. Default 100.' },
      },
    },
  },
  {
    name: 'searchCode',
    description:
      'Literal substring search across repository text files. Returns path, line number, and matching line. Good for finding fetch calls, handlers, and state updates.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Literal substring to find.' },
        path: { type: 'string', description: 'Directory relative to the repo root. Default "."' },
        limit: { type: 'integer', description: 'Max matches. Default 30.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'readFile',
    description: 'Read a bounded excerpt of a repository text file by line range.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to the repo root.' },
        offset: { type: 'integer', description: '1-based first line. Default 1.' },
        limit: { type: 'integer', description: 'Max lines (1-300). Default 80.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'observePage',
    description:
      'Load a page on the project target origin in the exploration browser. Returns the URL, title, available data-testid selectors, visible text, console errors, and a screenshot artifact ID. Call this before act.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Page URL. Defaults to the project target URL.' },
      },
    },
  },
  {
    name: 'act',
    description:
      'Perform one interaction (fill or click by data-testid) on the exploration page. Returns the resulting visible text and console errors. Exploration only: it proves nothing about timing.',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['fill', 'click'] },
        testId: { type: 'string', description: 'data-testid value from observePage.' },
        value: { type: 'string', description: 'Required for fill; forbidden for click.' },
      },
      required: ['kind', 'testId'],
    },
  },
  {
    name: 'readEvidence',
    description:
      'Read a recorded artifact by ID. Values/JSON artifacts return their text; screenshots return metadata only (images are for the human reviewer).',
    input_schema: {
      type: 'object',
      properties: {
        artifactId: { type: 'string', description: 'Artifact ID from an earlier result.' },
      },
      required: ['artifactId'],
    },
  },
  {
    name: 'runExperiment',
    description: [
      'Execute a timing experiment: baseline trial (natural delivery) plus intervention trial (held/reordered delivery) with identical actions and assertions.',
      'Explore mode runs a full plan {schemaVersion: 1, id, hypothesis, startUrl, actions, requests, schedule, assertions, timeouts, requiredCapabilities}.',
      'Actions: [{id, kind: fill|click, testId, value?}] using data-testid selectors discovered via observePage. Use distinct input values per action so requests are distinguishable.',
      'Requests: [{id, method, urlPattern (regex on full URL), query?: {param: substring}, bodyContains?, occurrence (1-based), afterAction?}]. Match with method plus URL/query/body predicates, never a bare URL when calls share an endpoint. For races over a socket use method WS: it matches server-to-client WebSocket frames on sockets whose URL matches urlPattern, with bodyContains against the frame text; holds delay frame delivery to the page.',
      'Schedule (intervention): {hold: [requestId], releases: [{request, afterResponse: otherRequestId, settleMs, timeoutMs}]}. The earlier response is held until the later response completes, then released.',
      'Assertions: [{id, description, type: textContains|textEquals, testId, expected}]. Each is polled until it passes or the observation window elapses; state what the final UI must show for the LATEST input.',
      'Timeouts default to {actionMs: 10000, observationMs: 10000, trialMs: 120000, maxHoldMs: 15000}; requiredCapabilities is ["http-hold-release"], or ["ws-hold-release"] when every request uses method WS.',
      'Confirm mode re-runs a recorded experiment plan N more baseline+intervention pairs and reports X-of-Y reproduced status: {mode: "confirm", experimentId, attempts? default 3}.',
    ].join(' '),
    input_schema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['explore', 'confirm'], description: 'Default explore.' },
        plan: { type: 'object', description: 'Full experiment plan (explore mode).' },
        experimentId: { type: 'string', description: 'Recorded experiment (confirm mode).' },
        attempts: { type: 'integer', description: 'Confirmation pairs, 1-3. Default 3.' },
      },
    },
  },
  {
    name: 'finish',
    description:
      'End the investigation with a summary, coverage record, unresolved suspicions, limitations, and finding drafts. Each finding references a recorded experimentId; reproduced/candidate status is computed from confirmation evidence, not from your verdict. Call this exactly once when done or when budgets are nearly exhausted.',
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        coverage: {
          type: 'object',
          properties: {
            pagesVisited: { type: 'array', items: { type: 'string' } },
            workflowsTested: { type: 'array', items: { type: 'string' } },
            experimentsRun: { type: 'integer' },
          },
          required: ['experimentsRun'],
        },
        unresolvedSuspicions: { type: 'array', items: { type: 'string' } },
        limitations: { type: 'array', items: { type: 'string' } },
        findings: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              experimentId: { type: 'string' },
              title: { type: 'string' },
              expectationProvenance: {
                type: 'string',
                description:
                  'Why the expectation is justified: user requirement, source behaviour, existing test, observed normal behaviour, or inference (name which).',
              },
              explanation: { type: 'string' },
              implicatedCode: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    path: { type: 'string' },
                    excerpt: {
                      type: 'string',
                      description:
                        'Verbatim lines (3-8) showing the defect: the state write that applies a response plus the missing guard around it. Quote the assignment, not just the function signature.',
                    },
                  },
                  required: ['path'],
                },
              },
            },
            required: ['experimentId', 'title', 'expectationProvenance', 'explanation'],
          },
        },
      },
      required: ['summary', 'coverage'],
    },
  },
];
