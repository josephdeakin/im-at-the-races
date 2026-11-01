import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { artifactBytesMatch } from './artifacts';

const BYTES = new TextEncoder().encode('fake-png-bytes');
const HEX = createHash('sha256').update(BYTES).digest('hex');

describe('artifactBytesMatch', () => {
  it('accepts the sha256:-prefixed hashes the worker records', () => {
    expect(artifactBytesMatch(`sha256:${HEX}`, BYTES)).toBe(true);
  });

  it('accepts bare hex and pre-hash empty rows', () => {
    expect(artifactBytesMatch(HEX, BYTES)).toBe(true);
    expect(artifactBytesMatch('', BYTES)).toBe(true);
  });

  it('rejects tampered bytes in either hash form', () => {
    const other = new TextEncoder().encode('different-bytes');
    expect(artifactBytesMatch(`sha256:${HEX}`, other)).toBe(false);
    expect(artifactBytesMatch(HEX, other)).toBe(false);
  });
});
