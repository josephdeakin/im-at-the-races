import { chromium, type Browser } from 'playwright';

/**
 * Launch a local headless Chromium for trial execution. Throws a descriptive
 * error when the browser binary is missing (fix: `playwright install
 * chromium` in @races/core) so the failure surfaces as a runner error with
 * an actionable message rather than a stack trace.
 */
export async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({ headless: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Playwright Chromium launch failed: ${message}. ` +
        `If the browser is not installed, run: pnpm --filter @races/core exec playwright install chromium`,
    );
  }
}
