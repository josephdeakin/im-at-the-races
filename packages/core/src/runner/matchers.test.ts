import { describe, expect, it } from 'vitest';
import type { PlanRequestMatcher } from '@races/contracts';
import { RequestTracker } from './matchers.js';

function matcher(overrides: Partial<PlanRequestMatcher> = {}): PlanRequestMatcher {
  return {
    id: 'reqA',
    method: 'GET',
    urlPattern: '/api/search',
    occurrence: 1,
    ...overrides,
  };
}

describe('RequestTracker', () => {
  it('binds by method, URL pattern, and query predicates', () => {
    const tracker = new RequestTracker([
      matcher({ id: 'reqA', query: { q: 'alpha' } }),
      matcher({ id: 'reqB', query: { q: 'beta' } }),
    ]);
    expect(
      tracker.observe({
        method: 'GET',
        url: 'http://127.0.0.1:4100/api/search?q=alpha&delay=10',
        body: null,
      }),
    ).toBe('reqA');
    expect(
      tracker.observe({
        method: 'POST',
        url: 'http://127.0.0.1:4100/api/search?q=beta',
        body: null,
      }),
    ).toBeNull();
    expect(
      tracker.observe({
        method: 'GET',
        url: 'http://127.0.0.1:4100/api/search?q=beta',
        body: null,
      }),
    ).toBe('reqB');
    expect(tracker.unmatched()).toEqual([]);
  });

  it('binds the nth occurrence and ignores the rest', () => {
    const tracker = new RequestTracker([matcher({ id: 'second', occurrence: 2 })]);
    const candidate = { method: 'GET', url: 'http://x/api/search?q=1', body: null };
    expect(tracker.observe(candidate)).toBeNull();
    expect(tracker.observe(candidate)).toBe('second');
    expect(tracker.observe(candidate)).toBeNull();
  });

  it('requires the after-action relationship', () => {
    const tracker = new RequestTracker([matcher({ afterAction: 'a1' })]);
    const candidate = { method: 'GET', url: 'http://x/api/search?q=1', body: null };
    expect(tracker.observe(candidate)).toBeNull();
    tracker.noteActionStarted('a1');
    expect(tracker.observe(candidate)).toBe('reqA');
  });

  it("binds the action's own immediate request, observed before the action resolves", () => {
    const tracker = new RequestTracker([
      matcher({ method: 'POST', urlPattern: '/api/transfer', afterAction: 'a3' }),
    ]);
    const candidate = { method: 'POST', url: 'http://x/api/transfer', body: '{"to":"rent"}' };
    expect(tracker.observe(candidate)).toBeNull();
    tracker.noteActionStarted('a3');
    // A click's fetch fires while the click call is still resolving.
    expect(tracker.observe(candidate)).toBe('reqA');
  });

  it('binds sequential occurrences of identical matchers in request order', () => {
    const tracker = new RequestTracker([
      matcher({ id: 'first-request', occurrence: 1 }),
      matcher({ id: 'second-request', occurrence: 2 }),
    ]);
    const candidate = { method: 'GET', url: 'http://x/api/search?q=1', body: null };
    expect(tracker.observe(candidate)).toBe('first-request');
    expect(tracker.observe(candidate)).toBe('second-request');
    expect(tracker.observe(candidate)).toBeNull();
    expect(tracker.unmatched()).toEqual([]);
  });

  it('matches request bodies and binds each candidate once', () => {
    const tracker = new RequestTracker([
      matcher({ id: 'first', method: 'POST', bodyContains: 'hello' }),
      matcher({ id: 'second', method: 'POST', bodyContains: 'hello' }),
    ]);
    expect(
      tracker.observe({ method: 'POST', url: 'http://x/api/search', body: 'say hello' }),
    ).toBe('first');
    expect(tracker.unmatched()).toEqual(['second']);
    expect(tracker.isBound('first')).toBe(true);
    expect(tracker.isBound('second')).toBe(false);
  });

  it('binds WebSocket frames by socket URL and frame text', () => {
    const tracker = new RequestTracker([
      matcher({ id: 'push1', method: 'WS', urlPattern: '/api/odds', bodyContains: '"version":1' }),
      matcher({ id: 'push2', method: 'WS', urlPattern: '/api/odds', bodyContains: '"version":2' }),
    ]);
    expect(
      tracker.observe({ method: 'WS', url: 'ws://127.0.0.1:4311/api/odds', body: '{"type":"odds","version":2}' }),
    ).toBe('push2');
    expect(
      tracker.observe({ method: 'WS', url: 'ws://127.0.0.1:4311/api/odds', body: '{"type":"odds","version":1}' }),
    ).toBe('push1');
    expect(tracker.unmatched()).toEqual([]);
  });
});
