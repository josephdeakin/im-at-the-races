import { describe, expect, it } from 'vitest';
import { DEFAULT_ARTIFACT_CAP_MB, parseArtifactCapMb, pickVisionArtifact } from './sinks.js';

describe('parseArtifactCapMb', () => {
  it('defaults when unset or malformed', () => {
    expect(parseArtifactCapMb(undefined)).toBe(DEFAULT_ARTIFACT_CAP_MB);
    expect(parseArtifactCapMb('')).toBe(DEFAULT_ARTIFACT_CAP_MB);
    expect(parseArtifactCapMb('abc')).toBe(DEFAULT_ARTIFACT_CAP_MB);
    expect(parseArtifactCapMb('10abc')).toBe(DEFAULT_ARTIFACT_CAP_MB);
    expect(parseArtifactCapMb('-5')).toBe(DEFAULT_ARTIFACT_CAP_MB);
    expect(parseArtifactCapMb('1.5')).toBe(DEFAULT_ARTIFACT_CAP_MB);
  });

  it('prefers the last post-release capture for vision', () => {
    const images = [
      { relativePath: 'artifacts/r/observation-1.png' },
      { relativePath: 'artifacts/r/trial-intervention-a-post-release.png' },
      { relativePath: 'artifacts/r/observation-2.png' },
    ];
    expect(pickVisionArtifact(images)).toBe(images[1]);
    expect(pickVisionArtifact([])).toBeNull();
    expect(pickVisionArtifact([images[0]])).toBe(images[0]);
  });

  it('accepts bare non-negative integers', () => {
    expect(parseArtifactCapMb('0')).toBe(0);
    expect(parseArtifactCapMb('10')).toBe(10);
    expect(parseArtifactCapMb(' 42 ')).toBe(42);
  });
});
