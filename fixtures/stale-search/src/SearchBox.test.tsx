// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SearchBox } from './SearchBox';
import type { SearchResponse } from './api';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function responseFor(query: string): SearchResponse {
  return {
    query,
    delayMs: 0,
    results: [`Result 1 for "${query}"`],
    servedAt: new Date().toISOString(),
  };
}

/** Stub fetch so the test controls response delivery order. */
function stubFetch() {
  const pending = new Map<string, ReturnType<typeof deferred<Response>>>();
  const stub = vi.fn((input: string | URL | Request) => {
    const url = new URL(String(input), 'http://localhost');
    const query = url.searchParams.get('q') ?? '';
    const d = deferred<Response>();
    pending.set(query, d);
    return d.promise;
  });
  vi.stubGlobal('fetch', stub);
  return {
    pending,
    deliver: async (query: string) => {
      const d = pending.get(query);
      if (!d) throw new Error(`no pending request for query ${JSON.stringify(query)}`);
      await act(async () => {
        d.resolve(
          new Response(JSON.stringify(responseFor(query)), {
            headers: { 'content-type': 'application/json' },
          }),
        );
        await d.promise;
      });
    },
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function typeQuery(value: string) {
  fireEvent.change(screen.getByTestId('search-input'), { target: { value } });
}

describe('stale overwrite', () => {
  // Regression test for the stale-search race: fails on the vulnerable code
  // (buggy mode shows alpha) and passes once the race is repaired. This is
  // the FAIL_TO_PASS gate the repair verification relies on.
  test('FAIL_TO_PASS (expected red on vulnerable code): late earlier response never overwrites newer results, in either mode', async () => {
    for (const mode of ['buggy', 'fixed'] as const) {
      const net = stubFetch();
      const { unmount } = render(<SearchBox mode={mode} />);

      typeQuery('alpha');
      typeQuery('beta');
      await net.deliver('beta');
      expect(screen.getByTestId('results-for').textContent).toContain('beta');

      await net.deliver('alpha');
      expect((screen.getByTestId('search-input') as HTMLInputElement).value).toBe('beta');
      expect(screen.getByTestId('results-for').textContent).toContain('beta');
      unmount();
      vi.unstubAllGlobals();
    }
  });

  test('fixed mode: late earlier response is ignored', async () => {
    const net = stubFetch();
    render(<SearchBox mode="fixed" />);

    typeQuery('alpha');
    typeQuery('beta');
    await net.deliver('beta');
    await net.deliver('alpha');

    expect((screen.getByTestId('search-input') as HTMLInputElement).value).toBe('beta');
    expect(screen.getByTestId('results-for').textContent).toContain('beta');
  });

  test('in-order delivery shows the latest query in both modes', async () => {
    for (const mode of ['buggy', 'fixed'] as const) {
      const net = stubFetch();
      const { unmount } = render(<SearchBox mode={mode} />);
      typeQuery('alpha');
      await net.deliver('alpha');
      typeQuery('beta');
      await net.deliver('beta');
      expect(screen.getByTestId('results-for').textContent).toContain('beta');
      unmount();
      vi.unstubAllGlobals();
    }
  });
});
