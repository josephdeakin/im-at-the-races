import { describe, expect, it } from 'vitest';
import { redactExcerpt, redactUrl } from './redact.js';

describe('redactUrl', () => {
  it('masks known secret params and preserves ordinary queries', () => {
    expect(redactUrl('http://x/api/search?q=alpha&delay=50')).toBe(
      'http://x/api/search?q=alpha&delay=50',
    );
    expect(redactUrl('http://x/api?q=alpha&api_key=hunter2')).toBe(
      'http://x/api?q=alpha&api_key=%5Bredacted%5D',
    );
    expect(redactUrl('http://x/api?TOKEN=abc')).toBe('http://x/api?TOKEN=%5Bredacted%5D');
    expect(redactUrl('http://x/api')).toBe('http://x/api');
  });
});

describe('redactExcerpt', () => {
  it('masks credential schemes and obvious secret values', () => {
    expect(redactExcerpt('Authorization: Bearer abc123')).toBe(
      'Authorization: Bearer [redacted]',
    );
    expect(redactExcerpt('x: Basic ZHVsZTp3b3JsZA==')).toBe('x: Basic [redacted]');
    expect(redactExcerpt('{"token": "abc", "q": "alpha"}')).toBe(
      '{"token": "[redacted]", "q": "alpha"}',
    );
    expect(redactExcerpt('{"results": ["a"]}')).toBe('{"results": ["a"]}');
  });
});
