import { useRef, useState } from 'react';
import { searchRequest } from './api';

export type SearchMode = 'buggy' | 'fixed';

/**
 * Minimal search UI with one request per keystroke-change and no debounce,
 * so overlapping requests are easy to produce.
 *
 * Buggy mode applies every response unconditionally: a slow earlier response
 * overwrites the results of a newer query (stale overwrite).
 *
 * Fixed mode ignores any response whose query is no longer current. It is the
 * authored control for comparison only — generated repairs must patch the
 * buggy path, never swap to this component.
 */
export function SearchBox({ mode }: { mode: SearchMode }) {
  const [query, setQuery] = useState('');
  const [delayMs, setDelayMs] = useState(50);
  const [resultsFor, setResultsFor] = useState<string | null>(null);
  const [results, setResults] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const latestQuery = useRef('');

  const onQueryChange = (value: string) => {
    setQuery(value);
    setError(null);
    latestQuery.current = value;
    if (value === '') {
      setResultsFor(null);
      setResults([]);
      return;
    }
    const requestedDelay = delayMs;
    void searchRequest(value, requestedDelay).then(
      (response) => {
        if (mode === 'fixed' && response.query !== latestQuery.current) {
          return; // stale response: leave current results alone
        }
        setResultsFor(response.query);
        setResults(response.results);
      },
      (err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      },
    );
  };

  return (
    <div>
      <p data-testid="mode-badge">
        {mode === 'buggy' ? 'Buggy search (no stale guard)' : 'Fixed search (stale guard control)'}
      </p>
      <label>
        Search{' '}
        <input
          data-testid="search-input"
          type="text"
          value={query}
          autoComplete="off"
          onChange={(event) => onQueryChange(event.target.value)}
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
      </label>
      {error !== null && (
        <p role="alert">
          Error: {error}
        </p>
      )}
      {resultsFor === null ? (
        <p>Type to search.</p>
      ) : (
        <div>
          <p data-testid="results-for">Showing results for &ldquo;{resultsFor}&rdquo;</p>
          <ul data-testid="results-list">
            {results.map((item) => (
              <li key={item} data-testid="result-item">
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
