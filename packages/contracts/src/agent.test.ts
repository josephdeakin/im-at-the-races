import { describe, expect, it } from 'vitest';
import {
  ActArgsSchema,
  FinishArgsSchema,
  ListFilesArgsSchema,
  ReadFileArgsSchema,
  RunExperimentArgsSchema,
  SearchCodeArgsSchema,
} from './index.js';

describe('agent tool-arg schemas', () => {
  it('applies list/search/read defaults and bounds', () => {
    expect(ListFilesArgsSchema.parse({})).toMatchObject({ path: '.', limit: 100 });
    expect(SearchCodeArgsSchema.parse({ query: 'fetch' })).toMatchObject({
      path: '.',
      limit: 30,
    });
    expect(ReadFileArgsSchema.parse({ path: 'src/a.ts' })).toMatchObject({
      offset: 1,
      limit: 80,
    });
    expect(ReadFileArgsSchema.safeParse({ path: 'x', limit: 301 }).success).toBe(false);
  });

  it('rejects absolute paths and parent traversal', () => {
    for (const schema of [ListFilesArgsSchema, SearchCodeArgsSchema, ReadFileArgsSchema]) {
      expect(schema.safeParse({ path: '/etc/passwd', query: 'x' }).success).toBe(false);
      expect(schema.safeParse({ path: '../escape', query: 'x' }).success).toBe(false);
    }
    expect(
      FinishArgsSchema.safeParse({
        summary: 's',
        coverage: { experimentsRun: 0 },
        findings: [
          {
            experimentId: 'e1',
            title: 't',
            expectationProvenance: 'observed',
            explanation: 'x',
            implicatedCode: [{ path: '../escape' }],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('enforces fill-value and click-no-value parity with plans', () => {
    expect(ActArgsSchema.safeParse({ kind: 'fill', testId: 'q', value: 'a' }).success).toBe(true);
    expect(ActArgsSchema.safeParse({ kind: 'fill', testId: 'q' }).success).toBe(false);
    expect(ActArgsSchema.safeParse({ kind: 'click', testId: 'q' }).success).toBe(true);
    expect(ActArgsSchema.safeParse({ kind: 'click', testId: 'q', value: 'a' }).success).toBe(
      false,
    );
  });

  it('accepts explore plans and confirm references', () => {
    const confirm = RunExperimentArgsSchema.safeParse({ mode: 'confirm', experimentId: 'e1' });
    expect(confirm.success).toBe(true);
    if (confirm.success && confirm.data.mode === 'confirm') {
      expect(confirm.data.attempts).toBe(3);
    }
    expect(RunExperimentArgsSchema.safeParse({ mode: 'confirm' }).success).toBe(false);
    expect(RunExperimentArgsSchema.safeParse({ mode: 'explore' }).success).toBe(false);
  });

  it('requires a summary and coverage on finish', () => {
    const parsed = FinishArgsSchema.safeParse({
      summary: 'done',
      coverage: { experimentsRun: 2 },
    });
    expect(parsed.success).toBe(true);
    expect(FinishArgsSchema.safeParse({ coverage: { experimentsRun: 0 } }).success).toBe(false);
  });
});
