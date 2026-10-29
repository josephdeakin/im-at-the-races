import { describe, expect, it } from 'vitest';
import {
  ApiErrorSchema,
  CreateProjectSchema,
  CreateRunSchema,
  DEFAULT_RUN_LIMITS,
  DEFAULT_RUN_TASK,
  EventsQuerySchema,
  isTerminalRunStatus,
  resolveRunInput,
  RunLimitsSchema,
} from './index.js';

describe('RunLimitsSchema', () => {
  it('accepts limits within range', () => {
    const parsed = RunLimitsSchema.safeParse({
      durationMs: 60_000,
      modelCalls: 10,
      experiments: 3,
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects non-integers, negatives and out-of-range values', () => {
    expect(RunLimitsSchema.safeParse({ ...DEFAULT_RUN_LIMITS, durationMs: 0 }).success).toBe(false);
    expect(RunLimitsSchema.safeParse({ ...DEFAULT_RUN_LIMITS, durationMs: 1.5 }).success).toBe(
      false,
    );
    expect(
      RunLimitsSchema.safeParse({ ...DEFAULT_RUN_LIMITS, durationMs: 86_400_001 }).success,
    ).toBe(false);
    expect(RunLimitsSchema.safeParse({ ...DEFAULT_RUN_LIMITS, modelCalls: -1 }).success).toBe(
      false,
    );
    expect(RunLimitsSchema.safeParse({ ...DEFAULT_RUN_LIMITS, experiments: -1 }).success).toBe(
      false,
    );
    expect(RunLimitsSchema.safeParse({ ...DEFAULT_RUN_LIMITS, experiments: 1001 }).success).toBe(
      false,
    );
  });

  it('rejects missing fields', () => {
    expect(RunLimitsSchema.safeParse({}).success).toBe(false);
  });
});

describe('CreateRunSchema + resolveRunInput', () => {
  it('fills every default when the body is empty', () => {
    const parsed = CreateRunSchema.safeParse({});
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(resolveRunInput(parsed.data)).toEqual({
      task: DEFAULT_RUN_TASK,
      mode: 'investigate',
      limits: DEFAULT_RUN_LIMITS,
    });
  });

  it('replaces a blank task with the broad-investigation default', () => {
    const parsed = CreateRunSchema.safeParse({ task: '   ' });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(resolveRunInput(parsed.data).task).toBe(DEFAULT_RUN_TASK);
  });

  it('keeps an explicit task and merges partial limits over defaults', () => {
    const parsed = CreateRunSchema.safeParse({
      task: '  Check the checkout flow  ',
      mode: 'investigate-repair',
      limits: { modelCalls: 5 },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(resolveRunInput(parsed.data)).toEqual({
      task: 'Check the checkout flow',
      mode: 'investigate-repair',
      limits: { ...DEFAULT_RUN_LIMITS, modelCalls: 5 },
    });
  });

  it('rejects unknown modes, over-long tasks and invalid limits', () => {
    expect(CreateRunSchema.safeParse({ mode: 'repair-only' }).success).toBe(false);
    expect(CreateRunSchema.safeParse({ task: 'x'.repeat(4001) }).success).toBe(false);
    expect(CreateRunSchema.safeParse({ limits: { durationMs: -5 } }).success).toBe(false);
  });
});

describe('CreateProjectSchema', () => {
  const valid = {
    name: 'Shop',
    repositoryPath: '/Users/dev/shop',
    targetUrl: 'http://127.0.0.1:3000',
  };

  it('accepts POSIX paths, Windows paths and http(s) URLs', () => {
    expect(CreateProjectSchema.safeParse(valid).success).toBe(true);
    expect(
      CreateProjectSchema.safeParse({ ...valid, repositoryPath: 'C:\\code\\shop' }).success,
    ).toBe(true);
    expect(
      CreateProjectSchema.safeParse({ ...valid, repositoryPath: '\\\\nas\\code\\shop' }).success,
    ).toBe(true);
    expect(
      CreateProjectSchema.safeParse({ ...valid, targetUrl: 'https://staging.example.test/app' })
        .success,
    ).toBe(true);
  });

  it('trims the name and rejects blank names', () => {
    const parsed = CreateProjectSchema.safeParse({ ...valid, name: '  Shop  ' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.name).toBe('Shop');
    expect(CreateProjectSchema.safeParse({ ...valid, name: '   ' }).success).toBe(false);
  });

  it('requires absolute repository paths', () => {
    expect(CreateProjectSchema.safeParse({ ...valid, repositoryPath: 'relative/path' }).success).toBe(
      false,
    );
    expect(CreateProjectSchema.safeParse({ ...valid, repositoryPath: '../up' }).success).toBe(false);
    expect(CreateProjectSchema.safeParse({ ...valid, repositoryPath: '' }).success).toBe(false);
  });

  it('requires absolute http(s) target URLs', () => {
    for (const targetUrl of [
      'not-a-url',
      '/relative/path',
      'ftp://example.test/x',
      'javascript:alert(1)',
      'file:///etc/passwd',
      '',
    ]) {
      expect(CreateProjectSchema.safeParse({ ...valid, targetUrl }).success, targetUrl).toBe(false);
    }
  });
});

describe('EventsQuerySchema', () => {
  it('defaults after to -1 and coerces query strings', () => {
    expect(EventsQuerySchema.safeParse({}).success).toBe(true);
    expect(EventsQuerySchema.parse({}).after).toBe(-1);
    expect(EventsQuerySchema.parse({ after: '42' }).after).toBe(42);
    expect(EventsQuerySchema.safeParse({ after: '-2' }).success).toBe(false);
    expect(EventsQuerySchema.safeParse({ after: 'nope' }).success).toBe(false);
  });
});

describe('terminal statuses', () => {
  it('classifies queued/running as live and the rest as terminal', () => {
    expect(isTerminalRunStatus('queued')).toBe(false);
    expect(isTerminalRunStatus('running')).toBe(false);
    for (const status of ['completed', 'failed', 'cancelled', 'interrupted'] as const) {
      expect(isTerminalRunStatus(status)).toBe(true);
    }
  });
});

describe('ApiErrorSchema', () => {
  it('accepts the shared envelope with and without details', () => {
    expect(
      ApiErrorSchema.safeParse({ error: { code: 'NOT_FOUND', message: 'Nope' } }).success,
    ).toBe(true);
    expect(
      ApiErrorSchema.safeParse({ error: { code: 'VALIDATION_ERROR', message: 'Bad', details: [] } })
        .success,
    ).toBe(true);
    expect(ApiErrorSchema.safeParse({ code: 'NOT_FOUND' }).success).toBe(false);
  });
});
