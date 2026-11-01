import { useEffect, useRef, useState } from 'react';
import {
  oddsSnapshotRequest,
  oddsSocketUrl,
  parseOddsMessage,
  resetRequest,
  sendSubscribe,
  type OddsMessage,
} from './api';

export type OddsMode = 'buggy' | 'fixed';

interface FeedEntry {
  requestId: number | string | null;
  version: number;
  price: string;
}

export function Odds({ mode }: { mode: OddsMode }) {
  const [price, setPrice] = useState<string | null>(null);
  const [delayMs, setDelayMs] = useState('50');
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const requestRef = useRef(0);
  const maxVersionRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    // Reseed on mount so every visit and every trial starts from v0,
    // including under vite (dev), where the server never sees the page load.
    resetRequest()
      .catch(() => null)
      .then(() => oddsSnapshotRequest())
      .then(
        (snapshot) => {
          if (cancelled) return;
          setPrice(snapshot.price);
          const socket = new WebSocket(oddsSocketUrl());
          socketRef.current = socket;
          socket.onopen = () => {
            if (!cancelled) setConnected(true);
          };
          socket.onmessage = (event: MessageEvent<unknown>) => {
            if (cancelled) return;
            const message = parseOddsMessage(event.data);
            if (!message) return;
            onOddsMessage(message);
          };
          socket.onerror = () => {
            if (!cancelled) setError('socket error');
          };
        },
        (err: unknown) => {
          if (!cancelled) setError(err instanceof Error ? err.message : String(err));
        },
      );
    return () => {
      cancelled = true;
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, []);

  function onOddsMessage(message: OddsMessage): void {
    setFeed((prev) => [
      ...prev,
      { requestId: message.requestId, version: message.version, price: message.price },
    ]);
    if (mode === 'fixed' && message.version <= maxVersionRef.current) {
      return; // stale update: feed keeps it, the display keeps the newer odds
    }
    maxVersionRef.current = Math.max(maxVersionRef.current, message.version);
    setPrice(message.price);
  }

  function onRequest(): void {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setError('socket not connected');
      return;
    }
    setError(null);
    const delay = Number.parseInt(delayMs, 10);
    requestRef.current += 1;
    sendSubscribe(socket, requestRef.current, Number.isFinite(delay) ? delay : 0);
  }

  return (
    <section>
      <p data-testid="mode-badge">{mode === 'fixed' ? 'Fixed control (version guard)' : 'Buggy odds (no version guard)'}</p>
      <p>
        Home win: <strong data-testid="odds-amount">{price ?? '—'}</strong>{' '}
        <span data-testid="connection-badge">{connected ? '(live)' : '(connecting…)'}</span>
      </p>
      <label>
        Push delay (ms){' '}
        <input
          data-testid="delay-input"
          value={delayMs}
          onChange={(event) => setDelayMs(event.target.value)}
        />
      </label>{' '}
      <button data-testid="request-button" type="button" onClick={onRequest}>
        Request update
      </button>
      {error !== null && <p role="alert">{error}</p>}
      <ul data-testid="feed-list">
        {feed.map((entry, index) => (
          <li key={`${entry.version}-${index}`} data-testid="feed-item">
            v{entry.version}: {entry.price}
          </li>
        ))}
      </ul>
    </section>
  );
}
