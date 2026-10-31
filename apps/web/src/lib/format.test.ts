import { describe, expect, it } from 'vitest';
import { formatDateTime } from './format';

describe('formatDateTime', () => {
  it('renders identically regardless of runtime locale (hydration safety)', () => {
    // Constructed in local time so the expectation holds in any timezone;
    // the US shape must hold in any locale.
    const local = new Date(2026, 9, 31, 17, 30, 56);
    expect(formatDateTime(local.toISOString())).toBe('10/31/2026, 5:30:56 PM');
  });

  it('passes through blank and invalid input', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime('not-a-date')).toBe('not-a-date');
  });
});
