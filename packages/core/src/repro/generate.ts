import { createHash } from 'node:crypto';
import type { ExperimentPlan } from '@races/contracts';

export const REPRO_TEMPLATE_VERSION = 'm5.1';

export function sha256Hex(content: string | Uint8Array): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

export interface ReproBundleInput {
  plan: ExperimentPlan;
  /** The violated assertion ID: the stated reason the test must fail for. */
  checkId: string;
  targetUrl: string;
  findingTitle: string;
  sourceIdentity: string;
}

export interface ReproBundleFiles {
  spec: string;
  planJson: string;
  readme: string;
  manifest: string;
}

function sanitizeComment(value: string, max = 200): string {
  return value
    .replace(/\*\//g, '* /')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, max);
}

function playwrightVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require('playwright/package.json') as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Generate a self-contained Playwright regression test from a frozen plan.
 * The spec runs the intervention delivery schedule and asserts the plan
 * checks: it FAILS on the vulnerable app (exit non-zero, naming the check)
 * and PASSES once fixed. Setup failures report REPRO-ERROR instead of a
 * check verdict so the harness never mistakes tooling trouble for a result.
 */
export function generateReproSpec(input: ReproBundleInput): string {
  const { plan } = input;
  const data = (value: unknown): string => JSON.stringify(value);
  return `// Regression test for: ${sanitizeComment(input.findingTitle)}
// Frozen from experiment plan ${sanitizeComment(plan.id)}. Fails on the vulnerable
// app when check ${sanitizeComment(input.checkId)} is violated; passes once fixed.
// Standalone except Playwright ${playwrightVersion()} and a running app:
//   pnpm add -D playwright@${playwrightVersion()} && npx playwright install chromium
//   REPRO_TARGET_URL=<app-url> npx playwright test repro.spec.ts
import { expect, test } from 'playwright/test';

const TARGET_URL = process.env.REPRO_TARGET_URL || ${data(input.targetUrl)};
const TIMEOUTS = ${data(plan.timeouts)};
const ACTIONS = ${data(plan.actions)};
const MATCHERS = ${data(plan.requests)};
const SCHEDULE = ${data(plan.schedule)};
const ASSERTIONS = ${data(plan.assertions)};

function escapeTestId(id) {
  return String(id).replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('timing regression ${sanitizeComment(plan.id, 100)}', async ({ page }) => {
  test.setTimeout(TIMEOUTS.trialMs);
  const seen = new Map();
  const bound = new Map();
  const completedActions = new Set();
  const completed = new Set();
  const held = new Map();
  const holdIds = new Set(SCHEDULE ? SCHEDULE.hold : []);

  function matchCandidate(m, c) {
    if (c.method !== m.method) return false;
    if (!new RegExp(m.urlPattern).test(c.url)) return false;
    if (m.afterAction && !completedActions.has(m.afterAction)) return false;
    if (m.query) {
      let params;
      try {
        params = new URL(c.url).searchParams;
      } catch {
        return false;
      }
      for (const entry of Object.entries(m.query)) {
        if (!(params.get(entry[0]) || '').includes(entry[1])) return false;
      }
    }
    if (m.bodyContains && !(c.body || '').includes(m.bodyContains)) return false;
    return true;
  }

  await page.route('**/*', async (route) => {
    const req = route.request();
    const candidate = { method: req.method(), url: req.url(), body: req.postData() || null };
    let logical = null;
    for (const m of MATCHERS) {
      if (bound.get(m.id)) continue;
      if (!matchCandidate(m, candidate)) continue;
      const n = (seen.get(m.id) || 0) + 1;
      seen.set(m.id, n);
      if (n === m.occurrence) {
        bound.set(m.id, true);
        logical = m.id;
        break;
      }
    }
    if (!logical) {
      await route.continue().catch(() => {});
      return;
    }
    let fetched;
    try {
      fetched = await route.fetch();
    } catch {
      completed.add(logical);
      await route.continue().catch(() => {});
      return;
    }
    if (!holdIds.has(logical)) {
      completed.add(logical);
      await route.fulfill({ response: fetched }).catch(() => {});
      return;
    }
    held.set(logical, { route, response: fetched });
  });

  try {
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.actionMs });
  } catch (err) {
    throw new Error('REPRO-ERROR navigation-failed: ' + ((err && err.message) || err));
  }

  for (const action of ACTIONS) {
    const locator = page.locator('[data-testid="' + escapeTestId(action.testId) + '"]');
    try {
      if (action.kind === 'fill') {
        await locator.fill(action.value || '', { timeout: action.timeoutMs || TIMEOUTS.actionMs });
      } else {
        await locator.click({ timeout: action.timeoutMs || TIMEOUTS.actionMs });
      }
    } catch (err) {
      throw new Error('REPRO-ERROR action-failed ' + action.id + ': ' + ((err && err.message) || err));
    }
    completedActions.add(action.id);
  }

  const matchDeadline = Date.now() + TIMEOUTS.observationMs;
  while (MATCHERS.some((m) => !bound.get(m.id))) {
    if (Date.now() >= matchDeadline) {
      const missing = MATCHERS.filter((m) => !bound.get(m.id))
        .map((m) => m.id)
        .join(',');
      throw new Error('REPRO-ERROR requests-not-matched: ' + missing);
    }
    await sleep(100);
  }

  if (SCHEDULE) {
    for (const step of SCHEDULE.releases) {
      const deadline = Date.now() + step.timeoutMs;
      while (!completed.has(step.afterResponse)) {
        if (Date.now() >= deadline) {
          throw new Error('REPRO-ERROR release-trigger-timeout: ' + step.request);
        }
        await sleep(50);
      }
      if (step.settleMs > 0) await sleep(step.settleMs);
      const capture = held.get(step.request);
      if (!capture) {
        throw new Error('REPRO-ERROR held-request-not-captured: ' + step.request);
      }
      held.delete(step.request);
      completed.add(step.request);
      await capture.route.fulfill({ response: capture.response }).catch(() => {});
    }
  }

  const failures = [];
  for (const assertion of ASSERTIONS) {
    const deadline = Date.now() + TIMEOUTS.observationMs;
    let observed = null;
    let passed = false;
    while (true) {
      observed = await page
        .locator('[data-testid="' + escapeTestId(assertion.testId) + '"]')
        .first()
        .textContent({ timeout: 1000 })
        .then((text) => (text === null ? null : text.trim()))
        .catch(() => null);
      const ok =
        assertion.type === 'textEquals'
          ? observed === assertion.expected
          : observed !== null && observed.includes(assertion.expected);
      if (ok) {
        passed = true;
        break;
      }
      if (Date.now() >= deadline) break;
      await sleep(200);
    }
    if (!passed) failures.push({ assertion, observed });
  }
  const lines = failures.map(
    (f) =>
      'REPRO-ASSERTION ' +
      f.assertion.id +
      ' expected=' +
      JSON.stringify(f.assertion.expected) +
      ' observed=' +
      JSON.stringify(f.observed),
  );
  expect(
    failures.map((f) => f.assertion.id),
    'REPRO-CHECK-FAILED ' +
      failures.map((f) => f.assertion.id).join(',') +
      (lines.length > 0 ? '\\n' + lines.join('\\n') : ''),
  ).toEqual([]);
});
`;
}

export function generateReproBundle(input: ReproBundleInput): ReproBundleFiles {
  const spec = generateReproSpec(input);
  const planJson = JSON.stringify(input.plan, null, 2);
  const readme = `# Regression test: ${input.findingTitle}

Frozen timing reproducer. Fails on the vulnerable app, passes once fixed.

## Run it

\`\`\`sh
pnpm add -D playwright@${playwrightVersion()}
npx playwright install chromium
# start the app under test, then:
REPRO_TARGET_URL=${input.targetUrl} npx playwright test repro.spec.ts
\`\`\`

## Reading the result

- Exit 0: all checks passed under the recorded delivery schedule.
- \`REPRO-CHECK-FAILED <id>\`: the app still exhibits the bug; the named check
  failed with expected/observed values printed alongside.
- \`REPRO-ERROR <stage>\`: the setup failed (unreachable app, missing
  selector, unmatched traffic). This is not a verdict about the bug.

## Provenance

- Source identity: ${input.sourceIdentity}
- Plan: \`plan.json\` (schema v${input.plan.schemaVersion})
- Manifest: \`manifest.json\` pins content hashes and versions.
- The test needs only Playwright and a running app; no model access.
`;
  const files: Record<string, string> = { 'repro.spec.ts': spec, 'plan.json': planJson };
  const manifest = JSON.stringify(
    {
      generator: `im-at-the-races repro ${REPRO_TEMPLATE_VERSION}`,
      planSchemaVersion: input.plan.schemaVersion,
      playwrightVersion: playwrightVersion(),
      sourceIdentity: input.sourceIdentity,
      targetUrlDefault: input.targetUrl,
      checkId: input.checkId,
      createdAt: new Date().toISOString(),
      files: Object.fromEntries(
        Object.entries(files).map(([name, content]) => [name, sha256Hex(content)]),
      ),
    },
    null,
    2,
  );
  return { spec, planJson, readme, manifest };
}
