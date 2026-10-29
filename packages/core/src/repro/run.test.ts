import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runReproSpec } from './run.js';

describe('runReproSpec', () => {
  it('resolves the Playwright CLI in this package layout and reports a passing spec', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'races-repro-run-test-'));
    try {
      const specPath = path.join(dir, 'trivial.spec.ts');
      fs.writeFileSync(
        specPath,
        "import { expect, test } from 'playwright/test';\ntest('trivial', () => { expect(1).toBe(1); });\n",
      );
      const result = await runReproSpec(specPath, 'http://127.0.0.1:9/', 'irrelevant');
      expect(result.output).not.toContain('Playwright installation not found');
      expect(result.status).toBe('passed');
      expect(result.exitCode).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
