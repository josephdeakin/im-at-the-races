import fs from 'node:fs';
import path from 'node:path';
import type { Browser } from 'playwright';
import {
  ExperimentPlanSchema,
  type ExperimentPlan,
  type RepairAttemptStatus,
  type TrialOutcome,
  type VerificationCheckDetail,
  type VerificationCheckStatus,
} from '@races/contracts';
import type { ArtifactStore, EventSink } from '../index.js';
import type { ExperimentStore } from '../runner/experiment.js';
import type { AgentTrialRunner } from '../agent/tools.js';
import { generateReproBundle, sha256Hex } from '../repro/generate.js';
import { runReproSpec } from '../repro/run.js';

export interface RepairStore {
  createReproducer(input: {
    runId: string;
    findingId: string;
    experimentId: string;
    bundlePath: string;
    testHash: string;
    planHash: string;
    checkHash: string;
    checkId: string;
  }): { id: string };
  createRepairAttempt(input: {
    runId: string;
    reproducerId: string;
    attempt: number;
    workspacePath: string;
    sourceIdentity: string;
  }): { id: string };
  finishRepairAttempt(
    id: string,
    input: { diff: string; status: RepairAttemptStatus },
  ): void;
  createVerificationCheck(input: {
    runId: string;
    reproducerId: string;
    repairAttemptId: string | null;
    name: string;
    status: VerificationCheckStatus;
    detail: VerificationCheckDetail;
  }): { id: string };
}

export interface FrozenBundle {
  reproducerId: string;
  dir: string;
  specPath: string;
  testHash: string;
  planHash: string;
  checkHash: string;
  checkId: string;
}

export interface FreezeInput {
  runId: string;
  finding: { id: string; title: string; explanation: string };
  experimentId: string;
  plan: ExperimentPlan;
  checkId: string;
  targetUrl: string;
  sourceIdentity: string;
  racesDir: string;
  store: RepairStore;
  artifacts: ArtifactStore;
}

/**
 * Write the repro bundle (spec, plan, readme, manifest) under the run's
 * artifact directory, pin content hashes, register each file as an artifact
 * for download, and record the reproducer row.
 */
export async function freezeReproducer(input: FreezeInput): Promise<FrozenBundle> {
  const dir = path.join(input.racesDir, 'artifacts', input.runId, 'repro');
  fs.mkdirSync(dir, { recursive: true });
  const bundle = generateReproBundle({
    plan: input.plan,
    checkId: input.checkId,
    targetUrl: input.targetUrl,
    findingTitle: input.finding.title,
    sourceIdentity: input.sourceIdentity,
  });
  const files: { name: string; content: string; kind: string; mime: string }[] = [
    { name: 'repro.spec.ts', content: bundle.spec, kind: 'repro-spec', mime: 'text/plain' },
    { name: 'plan.json', content: bundle.planJson, kind: 'repro-plan', mime: 'application/json' },
    { name: 'README.md', content: bundle.readme, kind: 'repro-readme', mime: 'text/markdown' },
    { name: 'manifest.json', content: bundle.manifest, kind: 'repro-manifest', mime: 'application/json' },
  ];
  for (const file of files) {
    fs.writeFileSync(path.join(dir, file.name), file.content);
  }
  const readBack = (name: string): string => fs.readFileSync(path.join(dir, name), 'utf8');
  const testHash = sha256Hex(readBack('repro.spec.ts'));
  const planHash = sha256Hex(readBack('plan.json'));
  const assertion = input.plan.assertions.find((a) => a.id === input.checkId);
  const checkHash = sha256Hex(JSON.stringify(assertion ?? { id: input.checkId }));
  for (const file of files) {
    await input.artifacts.saveArtifact({
      runId: input.runId,
      kind: file.kind,
      filename: file.name,
      mimeType: file.mime,
      data: new TextEncoder().encode(file.content),
    });
  }
  const { id } = input.store.createReproducer({
    runId: input.runId,
    findingId: input.finding.id,
    experimentId: input.experimentId,
    bundlePath: path.relative(input.racesDir, dir),
    testHash,
    planHash,
    checkHash,
    checkId: input.checkId,
  });
  return {
    reproducerId: id,
    dir,
    specPath: path.join(dir, 'repro.spec.ts'),
    testHash,
    planHash,
    checkHash,
    checkId: input.checkId,
  };
}

export async function verifyBundleIntact(bundle: FrozenBundle): Promise<boolean> {
  try {
    const spec = fs.readFileSync(bundle.specPath, 'utf8');
    const planJson = fs.readFileSync(path.join(bundle.dir, 'plan.json'), 'utf8');
    return sha256Hex(spec) === bundle.testHash && sha256Hex(planJson) === bundle.planHash;
  } catch {
    return false;
  }
}

export interface TrialExecution {
  trialRunner: AgentTrialRunner;
  browser: Browser;
  runId: string;
  signal: AbortSignal;
  events: EventSink;
  artifacts: ArtifactStore;
  store: ExperimentStore;
}

export interface PairOutcome {
  baseline: TrialOutcome;
  intervention: TrialOutcome;
  experimentId: string;
  passed: boolean;
}

async function runPair(exec: TrialExecution, plan: ExperimentPlan): Promise<PairOutcome> {
  const result = await exec.trialRunner.runExperiment({
    plan,
    runId: exec.runId,
    browser: exec.browser,
    signal: exec.signal,
    events: exec.events,
    artifacts: exec.artifacts,
    store: exec.store,
  });
  const baseline = result.baseline.outcome;
  const intervention = result.intervention?.outcome ?? 'runner-error';
  return {
    baseline,
    intervention,
    experimentId: result.experimentId,
    passed: baseline === 'pass' && intervention === 'pass',
  };
}

function pairStatus(outcome: PairOutcome): VerificationCheckStatus {
  if (outcome.passed) return 'pass';
  if (outcome.baseline === 'runner-error' || outcome.intervention === 'runner-error') {
    return 'incomplete';
  }
  return 'fail';
}

/**
 * No-worse-than-baseline rule for the project's own scripts: green is a pass,
 * a byte-identical pre-existing failure is skipped (never a pass), anything
 * else fails. A check that did not finish proves nothing either way.
 */
export function compareProjectCheck(
  result: { exitCode: number | null; output: string },
  baseline: { exitCode: number | null; output: string } | undefined,
): { status: VerificationCheckStatus; note: string | null } {
  if (result.exitCode === 0) return { status: 'pass', note: null };
  if (result.exitCode === null) {
    return { status: 'incomplete', note: 'did not finish (timeout or spawn error)' };
  }
  if (
    baseline &&
    baseline.exitCode !== null &&
    baseline.exitCode !== 0 &&
    baseline.exitCode === result.exitCode &&
    baseline.output === result.output
  ) {
    return { status: 'skipped', note: 'pre-existing failure, byte-identical to the pristine snapshot' };
  }
  return { status: 'fail', note: null };
}

export function buildVariationPlans(plan: ExperimentPlan): { early: ExperimentPlan; late: ExperimentPlan } {
  if (!plan.schedule) {
    return { early: plan, late: plan };
  }
  const remake = (settleMs: (original: number) => number): ExperimentPlan =>
    ExperimentPlanSchema.parse({
      ...plan,
      schedule: {
        hold: plan.schedule!.hold,
        releases: plan.schedule!.releases.map((step) => ({
          ...step,
          settleMs: Math.max(0, Math.min(plan.timeouts.maxHoldMs, settleMs(step.settleMs))),
        })),
      },
    });
  return {
    early: remake(() => 0),
    late: remake((original) => original * 2),
  };
}

function schedulesEqual(a: ExperimentPlan, b: ExperimentPlan): boolean {
  return JSON.stringify(a.schedule) === JSON.stringify(b.schedule);
}

export interface VerificationInput extends TrialExecution {
  frozenPlan: ExperimentPlan;
  checkId: string;
  patchedUrl: string;
  reproducerId: string;
  repairAttemptId: string;
  repairStore: RepairStore;
  /** Run a package check (typecheck/test) in the patched workspace. */
  runCheck: (name: string) => Promise<{ exitCode: number | null; output: string }>;
  /** Baseline outputs captured on the pristine snapshot, by check name. */
  baselineChecks: Map<string, { exitCode: number | null; output: string }>;
  scriptsPresent: Set<string>;
}

export interface VerificationResult {
  verified: boolean;
  summary: string[];
}

async function recordCheck(
  input: VerificationInput,
  name: string,
  status: VerificationCheckStatus,
  detail: VerificationCheckDetail,
): Promise<void> {
  input.repairStore.createVerificationCheck({
    runId: input.runId,
    reproducerId: input.reproducerId,
    repairAttemptId: input.repairAttemptId,
    name,
    status,
    detail,
  });
}

function retarget(plan: ExperimentPlan, url: string, name: string): ExperimentPlan {
  return ExperimentPlanSchema.parse({ ...plan, id: `${plan.id} ${name}`, startUrl: url });
}

/**
 * VF01 gate set on the patched app: frozen intervention pairs 3×, a natural
 * workflow pair, two delivery-timing variations, and the project's own
 * typecheck/test scripts with no-worse-than-baseline comparison (the build
 * gate runs in the orchestrator before serving). Every gate records a check
 * row; skipped gates (missing scripts, degenerate variations) never imply
 * a pass.
 */
export async function verifyPatchedApp(input: VerificationInput): Promise<VerificationResult> {
  const failures: string[] = [];
  const skips: string[] = [];
  const note = (text: string): void => {
    failures.push(text);
  };

  for (let rep = 0; rep < 3; rep += 1) {
    input.signal.throwIfAborted();
    const plan = retarget(input.frozenPlan, input.patchedUrl, `(verification rep ${rep + 1})`);
    const outcome = await runPair(input, plan);
    await recordCheck(input, `frozen-rep-${rep + 1}`, pairStatus(outcome), {
      baseline: outcome.baseline,
      intervention: outcome.intervention,
      experimentId: outcome.experimentId,
      targetUrl: input.patchedUrl,
    });
    if (!outcome.passed) note(`frozen repetition ${rep + 1}: baseline ${outcome.baseline}, intervention ${outcome.intervention}`);
  }

  input.signal.throwIfAborted();
  const natural = retarget(
    ExperimentPlanSchema.parse({ ...input.frozenPlan, schedule: null }),
    input.patchedUrl,
    '(natural workflow)',
  );
  const naturalOutcome = await runPair(input, natural);
  await recordCheck(input, 'normal-workflow', pairStatus(naturalOutcome), {
    baseline: naturalOutcome.baseline,
    intervention: naturalOutcome.intervention,
    experimentId: naturalOutcome.experimentId,
  });
  if (!naturalOutcome.passed) {
    note(`normal workflow: baseline ${naturalOutcome.baseline}, intervention ${naturalOutcome.intervention}`);
  }

  const variations = buildVariationPlans(input.frozenPlan);
  const variationCases = [
    { name: 'variation-early-delivery', plan: variations.early, note: 'settle 0ms (earliest stale delivery)' },
    { name: 'variation-late-delivery', plan: variations.late, note: 'settle doubled (latest stale delivery)' },
  ] as const;
  for (const variation of variationCases) {
    input.signal.throwIfAborted();
    if (!input.frozenPlan.schedule || schedulesEqual(variation.plan, input.frozenPlan)) {
      await recordCheck(input, variation.name, 'skipped', { note: 'degenerate: identical to the frozen schedule' });
      skips.push(variation.name);
      continue;
    }
    const plan = retarget(variation.plan, input.patchedUrl, `(${variation.name})`);
    const outcome = await runPair(input, plan);
    await recordCheck(input, variation.name, pairStatus(outcome), {
      baseline: outcome.baseline,
      intervention: outcome.intervention,
      experimentId: outcome.experimentId,
      note: variation.note,
    });
    if (!outcome.passed) {
      note(`${variation.name}: baseline ${outcome.baseline}, intervention ${outcome.intervention}`);
    }
  }

  // Build is gated by the orchestrator before serving, so only the remaining
  // project scripts run here.
  for (const name of ['typecheck', 'test'] as const) {
    input.signal.throwIfAborted();
    if (!input.scriptsPresent.has(name)) {
      await recordCheck(input, `project-${name}`, 'skipped', { note: `no ${name} script in package.json` });
      skips.push(`project-${name}`);
      continue;
    }
    const result = await input.runCheck(name);
    const baseline = input.baselineChecks.get(name);
    const { status, note: noteText } = compareProjectCheck(result, baseline);
    if (status === 'fail') {
      note(`project ${name} exited ${result.exitCode}`);
    } else if (status === 'incomplete') {
      note(`project ${name} did not finish`);
    } else if (status === 'skipped') {
      skips.push(`project-${name}`);
    }
    await recordCheck(input, `project-${name}`, status, {
      exitCode: result.exitCode,
      outputTail: result.output.slice(-2000),
      baselineExitCode: baseline?.exitCode ?? null,
      ...(noteText ? { note: noteText } : {}),
    });
  }

  const verified = failures.length === 0;
  return {
    verified,
    summary: verified
      ? [`All required gates passed${skips.length > 0 ? ` (${skips.length} skipped: ${skips.join(', ')})` : ''}.`]
      : failures,
  };
}
