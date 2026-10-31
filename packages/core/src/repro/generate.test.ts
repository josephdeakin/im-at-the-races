import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PLAN_TIMEOUTS, type ExperimentPlan } from '@races/contracts';
import { generateReproBundle, sha256Hex } from './generate.js';

function samplePlan(): ExperimentPlan {
  return {
    schemaVersion: 1,
    id: 'stale-1',
    hypothesis: 'Late response overwrites.',
    startUrl: 'http://127.0.0.1:4100/',
    actions: [
      { id: 'a1', kind: 'fill', testId: 'search-input', value: 'alpha' },
      { id: 'a2', kind: 'fill', testId: 'search-input', value: 'beta' },
    ],
    requests: [
      { id: 'early', method: 'GET', urlPattern: '/api/search', query: { q: 'alpha' }, occurrence: 1, afterAction: 'a1' },
      { id: 'late', method: 'GET', urlPattern: '/api/search', query: { q: 'beta' }, occurrence: 1, afterAction: 'a2' },
    ],
    schedule: {
      hold: ['early'],
      releases: [{ request: 'early', afterResponse: 'late', settleMs: 500, timeoutMs: 10_000 }],
    },
    assertions: [
      { id: 'final', description: 'Latest shown.', type: 'textContains', testId: 'results-for', expected: 'beta' },
    ],
    timeouts: { ...DEFAULT_PLAN_TIMEOUTS },
    requiredCapabilities: ['http-hold-release'],
  };
}

function extractConst(spec: string, name: string): unknown {
  const match = new RegExp(`const ${name} = (.+);$`, 'm').exec(spec);
  if (!match) throw new Error(`generated spec is missing ${name}`);
  return JSON.parse(match[1]);
}

describe('generateReproBundle', () => {
  it('emits a spec that mirrors the plan semantics', () => {
    const plan = samplePlan();
    const bundle = generateReproBundle({
      plan,
      checkId: 'final',
      targetUrl: 'http://127.0.0.1:4100/',
      findingTitle: 'Stale overwrite',
      sourceIdentity: 'git:abc:clean',
    });
    // The spec must carry the plan's semantics verbatim, not just keywords.
    expect(JSON.parse(bundle.planJson)).toEqual(plan);
    expect(extractConst(bundle.spec, 'ACTIONS')).toEqual(plan.actions);
    expect(extractConst(bundle.spec, 'MATCHERS')).toEqual(plan.requests);
    expect(extractConst(bundle.spec, 'SCHEDULE')).toEqual(plan.schedule);
    expect(extractConst(bundle.spec, 'ASSERTIONS')).toEqual(plan.assertions);
    expect(extractConst(bundle.spec, 'TIMEOUTS')).toEqual(plan.timeouts);
    expect(bundle.spec).toContain("from 'playwright/test'");
    expect(bundle.spec).toContain('process.env.REPRO_TARGET_URL');
    expect(bundle.spec).toContain('http://127.0.0.1:4100/');
    expect(bundle.spec).toContain('route.fetch()');
    expect(bundle.spec).toContain('REPRO-CHECK-FAILED');
    expect(bundle.spec).toContain('REPRO-ERROR');
    expect(bundle.spec).toContain('REPRO-ASSERTION');
    expect(bundle.spec).toContain('"alpha"');
    expect(bundle.spec).toContain('"results-for"');
    expect(bundle.spec).not.toContain('undefined');
    expect(bundle.readme).toContain('REPRO_TARGET_URL');
    expect(bundle.readme).toContain('git:abc:clean');
    expect(JSON.parse(bundle.planJson)).toMatchObject({ id: 'stale-1' });
  });

  it('pins content hashes in the manifest', () => {
    const bundle = generateReproBundle({
      plan: samplePlan(),
      checkId: 'final',
      targetUrl: 'http://127.0.0.1:4100/',
      findingTitle: 'Stale overwrite',
      sourceIdentity: 'git:abc:clean',
    });
    const manifest = JSON.parse(bundle.manifest) as {
      files: Record<string, string>;
      checkId: string;
    };
    expect(manifest.checkId).toBe('final');
    expect(manifest.files['repro.spec.ts']).toBe(sha256Hex(bundle.spec));
    expect(manifest.files['plan.json']).toBe(sha256Hex(bundle.planJson));
  });

  it('generates syntactically valid JavaScript', () => {
    const bundle = generateReproBundle({
      plan: samplePlan(),
      checkId: 'final',
      targetUrl: 'http://127.0.0.1:4100/',
      findingTitle: 'Stale overwrite',
      sourceIdentity: 'git:abc:clean',
    });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repro-syntax-'));
    try {
      const file = path.join(dir, 'repro.spec.mjs');
      fs.writeFileSync(file, bundle.spec);
      execFileSync(process.execPath, ['--check', file], { timeout: 10_000 });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
