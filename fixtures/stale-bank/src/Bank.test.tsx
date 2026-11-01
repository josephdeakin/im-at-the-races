// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Bank } from './Bank';
import type { TransferResponse } from './api';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Stub fetch with a fake serialized ledger, so the test controls transfer
 * delivery order while the canned balances stay honest.
 */
function stubFetch() {
  let balanceCents = 10000;
  let nextId = 1;
  const pending = new Map<string, { d: ReturnType<typeof deferred<Response>>; response: TransferResponse }>();
  const stub = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname === '/api/reset') {
      balanceCents = 10000;
      nextId = 1;
      pending.clear();
      return Promise.resolve(jsonResponse({ balanceCents }));
    }
    if (url.pathname === '/api/balance') {
      return Promise.resolve(jsonResponse({ balanceCents }));
    }
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      amountCents?: number;
      to?: string;
    };
    const to = body.to ?? '';
    const amountCents = body.amountCents ?? 0;
    if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > balanceCents) {
      return Promise.resolve(jsonResponse({ error: 'insufficient funds', balanceCents }, 402));
    }
    balanceCents -= amountCents;
    const d = deferred<Response>();
    pending.set(to, {
      d,
      response: {
        transferId: nextId++,
        to,
        amountCents,
        delayMs: 0,
        balanceCents,
        servedAt: new Date().toISOString(),
      },
    });
    return d.promise;
  });
  vi.stubGlobal('fetch', stub);
  return {
    deliver: async (to: string) => {
      const entry = pending.get(to);
      if (!entry) throw new Error(`no pending transfer to ${JSON.stringify(to)}`);
      pending.delete(to);
      await act(async () => {
        entry.d.resolve(jsonResponse(entry.response));
        await entry.d.promise;
      });
    },
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function transfer(amount: string, to: string) {
  fireEvent.change(screen.getByTestId('amount-input'), { target: { value: amount } });
  fireEvent.change(screen.getByTestId('to-input'), { target: { value: to } });
  fireEvent.click(screen.getByTestId('transfer-button'));
}

describe('stale balance', () => {
  // Regression test for the bank lost update: fails on the vulnerable code
  // (buggy mode shows $70.00) and passes once the race is repaired. This is
  // the FAIL_TO_PASS gate the repair verification relies on.
  test('FAIL_TO_PASS (expected red on vulnerable code): late earlier transfer never overwrites a newer balance, in either mode', async () => {
    for (const mode of ['buggy', 'fixed'] as const) {
      const net = stubFetch();
      const { unmount } = render(<Bank mode={mode} />);
      expect(await screen.findByText('$100.00')).toBeDefined();

      transfer('30', 'rent');
      transfer('30', 'savings');
      await net.deliver('savings');
      expect(screen.getByTestId('balance-amount').textContent).toBe('$40.00');

      await net.deliver('rent');
      expect(screen.getByTestId('balance-amount').textContent).toBe('$40.00');
      expect(screen.getAllByTestId('ledger-item')).toHaveLength(2);
      unmount();
      vi.unstubAllGlobals();
    }
  });

  test('fixed mode: late earlier transfer is ignored but still booked', async () => {
    const net = stubFetch();
    render(<Bank mode="fixed" />);
    expect(await screen.findByText('$100.00')).toBeDefined();

    transfer('30', 'rent');
    transfer('30', 'savings');
    await net.deliver('savings');
    await net.deliver('rent');

    expect(screen.getByTestId('balance-amount').textContent).toBe('$40.00');
    expect(screen.getAllByTestId('ledger-item')).toHaveLength(2);
  });

  test('in-order delivery shows the latest balance in both modes', async () => {
    for (const mode of ['buggy', 'fixed'] as const) {
      const net = stubFetch();
      const { unmount } = render(<Bank mode={mode} />);
      expect(await screen.findByText('$100.00')).toBeDefined();
      transfer('30', 'rent');
      await net.deliver('rent');
      transfer('20', 'savings');
      await net.deliver('savings');
      expect(screen.getByTestId('balance-amount').textContent).toBe('$50.00');
      unmount();
      vi.unstubAllGlobals();
    }
  });

  test('insufficient funds surfaces an error and keeps the balance', async () => {
    stubFetch();
    render(<Bank mode="buggy" />);
    expect(await screen.findByText('$100.00')).toBeDefined();
    transfer('500', 'yacht');
    expect(await screen.findByRole('alert')).toBeDefined();
    expect(screen.getByTestId('balance-amount').textContent).toBe('$100.00');
    expect(screen.queryAllByTestId('ledger-item')).toHaveLength(0);
  });
});
