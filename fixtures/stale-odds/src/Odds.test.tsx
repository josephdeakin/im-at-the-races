// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Odds } from './Odds';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

class MockSocket {
  static instances: MockSocket[] = [];
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  sent: string[] = [];
  readonly readyState = 1; // OPEN
  constructor(public url: string) {
    MockSocket.instances.push(this);
    queueMicrotask(() => this.onopen?.({}));
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {}
  deliver(message: unknown): void {
    this.onmessage?.({ data: typeof message === 'string' ? message : JSON.stringify(message) });
  }
}

function stubFetch() {
  return vi.fn((input: string | URL | Request) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname === '/api/reset' || url.pathname === '/api/odds') {
      return Promise.resolve(jsonResponse({ version: 0, price: null }));
    }
    throw new Error(`unexpected fetch: ${url.pathname}`);
  });
}

function serverPush(socket: MockSocket, requestId: number, version: number, price: string): void {
  socket.deliver({ type: 'odds', requestId, version, price, delayMs: 0, servedAt: 't' });
}

async function mount(mode: 'buggy' | 'fixed'): Promise<MockSocket> {
  render(<Odds mode={mode} />);
  await screen.findByText('(live)');
  const socket = MockSocket.instances[MockSocket.instances.length - 1];
  if (!socket) throw new Error('no socket opened');
  return socket;
}

function requestUpdate(delay: string): void {
  fireEvent.change(screen.getByTestId('delay-input'), { target: { value: delay } });
  fireEvent.click(screen.getByTestId('request-button'));
}

describe('stale odds', () => {
  beforeEach(() => {
    MockSocket.instances = [];
    vi.stubGlobal('fetch', stubFetch());
    vi.stubGlobal('WebSocket', MockSocket);
    Object.defineProperty(globalThis.WebSocket, 'OPEN', { value: 1, configurable: true });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  test('FAIL_TO_PASS (expected red on vulnerable code): late earlier update never overwrites newer odds, in either mode', async () => {
    for (const mode of ['buggy', 'fixed'] as const) {
      if (mode === 'fixed') {
        cleanup();
        MockSocket.instances = [];
      }
      const socket = await mount(mode);
      requestUpdate('800'); // slow v1 @ 2.50
      requestUpdate('0'); // fast v2 @ 1.80
      // Versions assign in arrival order; the fast push lands first.
      act(() => serverPush(socket, 2, 2, '1.80'));
      expect(await screen.findByText('1.80')).toBeDefined();
      act(() => serverPush(socket, 1, 1, '2.50'));
      expect(screen.getByTestId('odds-amount').textContent).toBe('1.80');
    }
  });

  test('fixed mode: late earlier update is ignored but still booked', async () => {
    const socket = await mount('fixed');
    requestUpdate('800');
    requestUpdate('0');
    act(() => serverPush(socket, 2, 2, '1.80'));
    act(() => serverPush(socket, 1, 1, '2.50'));
    expect(screen.getByTestId('odds-amount').textContent).toBe('1.80');
    expect(screen.getAllByTestId('feed-item')).toHaveLength(2);
  });

  test('in-order delivery shows the latest odds in both modes', async () => {
    for (const mode of ['buggy', 'fixed'] as const) {
      if (mode === 'fixed') {
        cleanup();
        MockSocket.instances = [];
      }
      const socket = await mount(mode);
      requestUpdate('0');
      requestUpdate('0');
      act(() => serverPush(socket, 1, 1, '2.50'));
      act(() => serverPush(socket, 2, 2, '1.80'));
      expect(screen.getByTestId('odds-amount').textContent).toBe('1.80');
    }
  });

  test('ignores malformed socket messages and keeps the odds', async () => {
    for (const mode of ['buggy', 'fixed'] as const) {
      if (mode === 'fixed') {
        cleanup();
        MockSocket.instances = [];
      }
      const socket = await mount(mode);
      requestUpdate('0');
      act(() => serverPush(socket, 1, 1, '2.50'));
      expect(screen.getByTestId('odds-amount').textContent).toBe('2.50');
      act(() => {
        socket.deliver('not-json{{{');
        socket.deliver({ type: 'pong' });
        socket.deliver({ type: 'odds', version: 'x', price: 42 });
      });
      expect(screen.getByTestId('odds-amount').textContent).toBe('2.50');
      expect(screen.queryAllByTestId('feed-item')).toHaveLength(1);
    }
  });
});
