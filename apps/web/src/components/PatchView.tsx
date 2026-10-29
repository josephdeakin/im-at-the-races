'use client';

import { useState } from 'react';
import type { RepairAttempt, VerificationCheck } from '@races/contracts';
import { formatDateTime } from '@/lib/format';
import { summarizeAttemptChecks, type AttemptVerdict } from '@/lib/repair';

const VERDICT_STYLE: Record<AttemptVerdict, { glyph: string; label: string; className: string }> = {
  verified: {
    glyph: '✓',
    label: 'Verified for the tested cases',
    className: 'bg-green-700 text-white',
  },
  failed: { glyph: '✗', label: 'Verification failed', className: 'bg-red-700 text-white' },
  incomplete: {
    glyph: '?',
    label: 'Verification incomplete',
    className: 'bg-amber-100 text-amber-900',
  },
  'no-checks': { glyph: '○', label: 'No checks recorded', className: 'bg-stone-200 text-stone-800' },
};

export function AttemptVerdictBadge({ verdict }: { verdict: AttemptVerdict }) {
  const style = VERDICT_STYLE[verdict];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold ${style.className}`}
    >
      <span aria-hidden="true">{style.glyph}</span>
      {style.label}
    </span>
  );
}

function diffLineClass(line: string): string {
  if (line.startsWith('+') && !line.startsWith('+++')) return 'bg-green-50 text-green-900';
  if (line.startsWith('-') && !line.startsWith('---')) return 'bg-red-50 text-red-900';
  if (line.startsWith('@@')) return 'bg-sky-50 text-sky-900';
  return '';
}

export function PatchView({
  attempts,
  checks,
}: {
  attempts: RepairAttempt[];
  checks: VerificationCheck[];
}) {
  const ordered = [...attempts].sort((a, b) => a.attempt - b.attempt);
  const [selectedId, setSelectedId] = useState<string | null>(
    ordered.length > 0 ? ordered[ordered.length - 1].id : null,
  );
  const selected = ordered.find((a) => a.id === selectedId) ?? null;

  if (ordered.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-stone-300 bg-white px-6 py-10 text-center">
        <p className="text-sm font-medium text-stone-900">No patch attempts</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-stone-600">
          Repair runs after a reproduced finding on investigate-with-repair runs. The latest
          patch attempt will appear here with its diff.
        </p>
      </div>
    );
  }

  const selectedChecks = selected ? checks.filter((c) => c.repairAttemptId === selected.id) : [];
  const summary = summarizeAttemptChecks(selectedChecks);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      <div className="lg:col-span-4">
        <ol className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white">
          {ordered.map((attempt) => {
            const verdict = summarizeAttemptChecks(
              checks.filter((c) => c.repairAttemptId === attempt.id),
            ).verdict;
            return (
              <li key={attempt.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(attempt.id)}
                  aria-current={attempt.id === selectedId}
                  className={`block w-full px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-sky-700 ${
                    attempt.id === selectedId ? 'bg-sky-50' : 'hover:bg-stone-50'
                  }`}
                >
                  <span className="flex items-center gap-2 text-sm font-medium text-stone-900">
                    <span aria-hidden="true">{VERDICT_STYLE[verdict].glyph}</span>
                    Attempt {attempt.attempt}
                  </span>
                  <span className="mt-1 block font-mono text-xs text-stone-500">
                    {attempt.status} · {formatDateTime(attempt.finishedAt ?? attempt.createdAt)}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="lg:col-span-8">
        {selected && (
          <article className="space-y-4 rounded-lg border border-stone-200 bg-white p-5">
            <div className="flex flex-wrap items-center gap-2">
              <AttemptVerdictBadge verdict={summary.verdict} />
              <span className="font-mono text-xs text-stone-600">
                {summary.passed} passed · {summary.failed} failed · {summary.incomplete} incomplete ·{' '}
                {summary.skipped} skipped
              </span>
            </div>

            <h3 className="text-base font-semibold text-stone-900">
              Attempt {selected.attempt} patch
            </h3>
            <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs font-semibold text-stone-500">Workspace</dt>
                <dd className="mt-0.5 break-all font-mono text-xs text-stone-700">
                  {selected.workspacePath}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-stone-500">Source</dt>
                <dd className="mt-0.5 break-all font-mono text-xs text-stone-700">
                  {selected.sourceIdentity}
                </dd>
              </div>
            </dl>

            <div>
              <h4 className="text-xs font-semibold text-stone-500">Unified diff vs snapshot</h4>
              {selected.diff.trim() === '' ? (
                <p className="mt-1 text-sm text-stone-500">
                  The attempt produced no changes.
                </p>
              ) : (
                <pre
                  className="mt-1 max-h-96 overflow-auto rounded border border-stone-200 bg-stone-50 p-2 font-mono text-xs leading-5"
                  aria-label={`Diff for attempt ${selected.attempt}`}
                >
                  {selected.diff.split('\n').map((line, index) => (
                    <span key={index} className={`block px-1 ${diffLineClass(line)}`}>
                      {line === '' ? ' ' : line}
                    </span>
                  ))}
                </pre>
              )}
              <p className="mt-1 text-xs text-stone-500">
                Added lines are shaded green, removed lines red. The diff covers the whole
                isolated package checkout.
              </p>
            </div>
          </article>
        )}
      </div>
    </div>
  );
}
