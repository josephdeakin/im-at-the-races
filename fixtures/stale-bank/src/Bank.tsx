import { useEffect, useRef, useState } from 'react';
import { balanceRequest, resetRequest, transferRequest, type TransferResponse } from './api';

export type BankMode = 'buggy' | 'fixed';

interface LedgerEntry {
  key: string;
  to: string;
  amountCents: number;
}

export function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Minimal transfer UI with one request per click and no debounce, so
 * overlapping transfers are easy to produce.
 *
 * Buggy mode applies every transfer response unconditionally: a slow earlier
 * response overwrites the balance left by a newer transfer (lost update).
 * Two $30 transfers then show $70.00 instead of $40.00 while the ledger
 * records $60 out — money from thin air.
 *
 * Fixed mode ignores balance updates from transfers older than the latest
 * issued one, but still records every transfer in the ledger. It is the
 * authored control for comparison only — generated repairs must patch the
 * buggy path, never swap to this component.
 */
export function Bank({ mode }: { mode: BankMode }) {
  const [balanceCents, setBalanceCents] = useState<number | null>(null);
  const [amount, setAmount] = useState('30');
  const [to, setTo] = useState('rent');
  const [delayMs, setDelayMs] = useState(50);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const latestSequence = useRef(0);

  useEffect(() => {
    let cancelled = false;
    // Reseed on mount so every visit and every trial starts from $100,
    // including under vite (dev), where the server never sees the page load.
    // A failed reset still attempts the balance read below.
    resetRequest()
      .catch(() => null)
      .then(() => balanceRequest())
      .then(
      (response) => {
        if (!cancelled) setBalanceCents(response.balanceCents);
      },
      (err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const onTransfer = () => {
    const dollars = Number(amount);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setError('Enter a positive dollar amount.');
      return;
    }
    const amountCents = Math.round(dollars * 100);
    const recipient = to.trim();
    if (recipient === '') {
      setError('Enter a recipient.');
      return;
    }
    setError(null);
    latestSequence.current += 1;
    const sequence = latestSequence.current;
    const requestedDelay = delayMs;
    void transferRequest(amountCents, recipient, requestedDelay).then(
      (response: TransferResponse) => {
        setLedger((prev) => [
          ...prev,
          {
            key: `${response.transferId}-${sequence}`,
            to: response.to,
            amountCents: response.amountCents,
          },
        ]);
        if (mode === 'fixed' && sequence !== latestSequence.current) {
          return; // stale response: books keep the newer balance
        }
        setBalanceCents(response.balanceCents);
      },
      (err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      },
    );
  };

  return (
    <div>
      <p data-testid="mode-badge">
        {mode === 'buggy' ? 'Buggy bank (no stale guard)' : 'Fixed bank (stale guard control)'}
      </p>
      <p>
        Balance:{' '}
        <strong data-testid="balance-amount">
          {balanceCents === null ? '…' : formatUsd(balanceCents)}
        </strong>
      </p>
      <label>
        Amount ($){' '}
        <input
          data-testid="amount-input"
          type="number"
          min={1}
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </label>{' '}
      <label>
        To{' '}
        <input
          data-testid="to-input"
          type="text"
          value={to}
          autoComplete="off"
          onChange={(event) => setTo(event.target.value)}
        />
      </label>{' '}
      <label>
        Response delay (ms){' '}
        <input
          data-testid="delay-input"
          type="number"
          min={0}
          max={5000}
          value={delayMs}
          onChange={(event) => setDelayMs(Number(event.target.value))}
        />
      </label>{' '}
      <button data-testid="transfer-button" type="button" onClick={onTransfer}>
        Transfer
      </button>
      {error !== null && <p role="alert">Error: {error}</p>}
      <ul data-testid="ledger-list">
        {ledger.map((entry) => (
          <li key={entry.key} data-testid="ledger-item">
            {formatUsd(entry.amountCents)} to {entry.to}
          </li>
        ))}
      </ul>
    </div>
  );
}
