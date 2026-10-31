import { describe, expect, it } from 'vitest';
import { DEFAULT_ARTIFACT_CAP_MB, parseArtifactCapMb } from './sinks.js';

describe('parseArtifactCapMb', () => {
  it('defaults when unset or malformed', () => {
    expect(parseArtifactCapMb(undefined)).toBe(DEFAULT_ARTIFACT_CAP_MB);
    expect(parseArtifactCapMb('')).toBe(DEFAULT_ARTIFACT_CAP_MB);
    expect(parseArtifactCapMb('abc')).toBe(DEFAULT_ARTIFACT_CAP_MB);
    expect(parseArtifactCapMb('10abc')).toBe(DEFAULT_ARTIFACT_CAP_MB);
    expect(parseArtifactCapMb('-5')).toBe(DEFAULT_ARTIFACT_CAP_MB);
    expect(parseArtifactCapMb('1.5')).toBe(DEFAULT_ARTIFACT_CAP_MB);
  });

  it('accepts bare non-negative integers', () => {
    expect(parseArtifactCapMb('0')).toBe(0);
    expect(parseArtifactCapMb('10')).toBe(10);
    expect(parseArtifactCapMb(' 42 ')).toBe(42);
  });
});
