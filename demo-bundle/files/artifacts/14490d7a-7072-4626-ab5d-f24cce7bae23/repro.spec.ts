// Regression test for: Stale transfer response overwrites newer balance (lost update)
// Frozen from experiment plan bank-stale-race-1. Fails on the vulnerable
// app when check balance-correct is violated; passes once fixed.
// Standalone except Playwright 1.49.1 and a running app:
//   pnpm add -D playwright@1.49.1 && npx playwright install chromium
//   REPRO_TARGET_URL=<app-url> npx playwright test repro.spec.ts
import { expect, test } from 'playwright/test';

const TARGET_URL = process.env.REPRO_TARGET_URL || "http://127.0.0.1:4110/";
const TIMEOUTS = {"actionMs":10000,"observationMs":10000,"trialMs":120000,"maxHoldMs":15000};
const ACTIONS = [{"id":"amt1","kind":"fill","testId":"amount-input","value":"30"},{"id":"to1","kind":"fill","testId":"to-input","value":"rent"},{"id":"xfer1","kind":"click","testId":"transfer-button"},{"id":"to2","kind":"fill","testId":"to-input","value":"savings"},{"id":"xfer2","kind":"click","testId":"transfer-button"}];
const MATCHERS = [{"id":"early","method":"POST","urlPattern":".*/api/transfer.*","bodyContains":"rent","occurrence":1,"afterAction":"xfer1"},{"id":"late","method":"POST","urlPattern":".*/api/transfer.*","bodyContains":"savings","occurrence":1,"afterAction":"xfer2"}];
const SCHEDULE = {"hold":["early"],"releases":[{"request":"early","afterResponse":"late","settleMs":300,"timeoutMs":10000}]};
const ASSERTIONS = [{"id":"balance-correct","description":"After two $30 transfers (rent then savings) balance shows latest $40.00","type":"textEquals","testId":"balance-amount","expected":"$40.00"}];

function escapeTestId(id) {
  return String(id).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('timing regression bank-stale-race-1', async ({ page }) => {
  test.setTimeout(TIMEOUTS.trialMs);
  const seen = new Map();
  const bound = new Map();
  const startedActions = new Set();
  const completed = new Set();
  const held = new Map();
  const holdIds = new Set(SCHEDULE ? SCHEDULE.hold : []);

  function matchCandidate(m, c) {
    if (c.method !== m.method) return false;
    if (!new RegExp(m.urlPattern).test(c.url)) return false;
    if (m.afterAction && !startedActions.has(m.afterAction)) return false;
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
    if (String(await req.headerValue('upgrade').catch(() => '')).toLowerCase() === 'websocket') {
      await route.continue().catch(() => {});
      return;
    }
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
    startedActions.add(action.id);
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
      if (capture.forward) {
        capture.forward();
      } else {
        await capture.route.fulfill({ response: capture.response }).catch(() => {});
      }
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
      (lines.length > 0 ? '\n' + lines.join('\n') : ''),
  ).toEqual([]);
});
