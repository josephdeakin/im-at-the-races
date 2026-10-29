'use client';

import { useState } from 'react';
import type { Finding } from '@races/contracts';
import { formatDateTime } from '@/lib/format';
import { tallyConfirmations } from '@/lib/explain';
import type { ExperimentWithTrials } from './TimelineView';

export function FindingsView({
  findings,
  experiments,
  runStatus,
  onOpenTrial,
}: {
  findings: Finding[];
  experiments: ExperimentWithTrials[];
  runStatus: string;
  onOpenTrial: (trialId: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(findings[0]?.id ?? null);
  const selected = findings.find((f) => f.id === selectedId) ?? null;

  if (findings.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-stone-300 bg-white px-6 py-10 text-center">
        <p className="text-sm font-medium text-stone-900">No findings recorded</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-stone-600">
          {runStatus === 'completed'
            ? 'The investigation finished without confirming a race. The timeline and activity tabs show what was tested — this is not a claim that the app is race-free.'
            : 'Findings will appear here once the agent confirms a timing failure.'}
        </p>
      </div>
    );
  }

  const experiment = selected
    ? (experiments.find((e) => e.id === selected.experimentId) ?? null)
    : null;
  const tally = experiment ? tallyConfirmations(experiment.trials) : null;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      <div className="lg:col-span-4">
        <ol className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white">
          {findings.map((finding) => (
            <li key={finding.id}>
              <button
                type="button"
                onClick={() => setSelectedId(finding.id)}
                aria-current={finding.id === selectedId}
                className={`block w-full px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-sky-700 ${
                  finding.id === selectedId ? 'bg-sky-50' : 'hover:bg-stone-50'
                }`}
              >
                <span className="flex items-center gap-2 text-sm font-medium text-stone-900">
                  <span aria-hidden="true">{finding.status === 'reproduced' ? '✗' : '?'}</span>
                  {finding.title}
                </span>
                <span className="mt-1 block font-mono text-xs text-stone-500">
                  {finding.status} · {formatDateTime(finding.createdAt)}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>

      <div className="lg:col-span-8">
        {selected && (
          <article className="space-y-4 rounded-lg border border-stone-200 bg-white p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold ${
                  selected.status === 'reproduced'
                    ? 'bg-red-700 text-white'
                    : 'bg-amber-100 text-amber-900'
                }`}
              >
                <span aria-hidden="true">{selected.status === 'reproduced' ? '✗' : '?'}</span>
                {selected.status === 'reproduced' ? 'Reproduced' : 'Candidate'}
              </span>
              {tally && (
                <span className="font-mono text-xs text-stone-600">
                  Confirmed {tally.text}
                </span>
              )}
            </div>

            <h3 className="text-base font-semibold text-stone-900">{selected.title}</h3>
            <p className="text-sm text-stone-700">{selected.explanation}</p>

            <div>
              <h4 className="text-xs font-semibold text-stone-500">Why this is wrong</h4>
              <p className="mt-1 text-sm text-stone-700">{selected.expectationProvenance}</p>
            </div>

            <div>
              <h4 className="text-xs font-semibold text-stone-500">Implicated code</h4>
              {selected.implicatedCode.length === 0 ? (
                <p className="mt-1 text-sm text-stone-500">None cited.</p>
              ) : (
                <ul className="mt-1 space-y-2">
                  {selected.implicatedCode.map((code) => (
                    <li key={code.path} className="rounded border border-stone-200 p-2">
                      <p className="font-mono text-xs text-stone-900">
                        {code.path}{' '}
                        {!code.exists && (
                          <span className="text-amber-700">(not present in captured source)</span>
                        )}
                      </p>
                      {code.excerpt && (
                        <pre className="mt-1 overflow-x-auto rounded bg-stone-50 p-2 font-mono text-xs text-stone-700">
                          {code.excerpt}
                        </pre>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-1 font-mono text-[11px] text-stone-500">
                Source: {selected.sourceIdentity}
              </p>
            </div>

            <div>
              <h4 className="text-xs font-semibold text-stone-500">Evidence trials</h4>
              {!experiment ? (
                <p className="mt-1 text-sm text-stone-500">
                  The recording experiment is not available.
                </p>
              ) : (
                <ul className="mt-1 flex flex-wrap gap-2">
                  {experiment.trials.map((trial) => (
                    <li key={trial.id}>
                      <button
                        type="button"
                        onClick={() => onOpenTrial(trial.id)}
                        className="rounded border border-stone-300 bg-stone-50 px-2 py-1 font-mono text-xs text-sky-800 hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700"
                      >
                        Open {trial.kind} attempt {trial.attempt} ({trial.outcome ?? 'running'}) →
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </article>
        )}
      </div>
    </div>
  );
}
