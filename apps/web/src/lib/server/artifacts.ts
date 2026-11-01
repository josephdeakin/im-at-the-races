import { createHash } from 'node:crypto';

/**
 * True when artifact bytes match the recorded hash. The worker records
 * `sha256:`-prefixed digests; bare hex and pre-hash empty rows also verify.
 */
export function artifactBytesMatch(storedHash: string, data: Uint8Array): boolean {
  if (storedHash === '') return true;
  const digest = createHash('sha256').update(data).digest('hex');
  return storedHash === digest || storedHash === `sha256:${digest}`;
}
