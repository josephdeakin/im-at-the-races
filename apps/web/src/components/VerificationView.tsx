'use client';

import type {
  Artifact,
  Finding,
  RepairAttempt,
  Reproducer,
  VerificationCheck,
  VerificationCheckStatus,
} from '@races/contracts';
import { formatDateTime } from '@/lib/format';
import { checkLabel, checkOneLiner, summarizeAttemptChecks, summarizeRepair } from '@/lib/repair';
import { AttemptVerdictBadge } from './PatchView';

const STATUS_STYLE: Record<VerificationCheckStatus, { glyph: string; className: string }> = {
  pass: { glyph: '✓', className: 'bg-green-700 text-white' },
  fail: { glyph: '✗', className: 'bg-red-700 text-white' },
  incomplete: { glyph: '?', className: 'bg-amber-100 text-amber-900' },
  skipped: { glyph: '○', className: 'bg-stone-200 text-stone-800' },
};

function StatusBadge({ status }: { status: VerificationCheckStatus }) {
  const style = STATUS_STYLE[status];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 font-mono text-[11px] font-semibold ${style.className}`}
    >
      <span aria-hidden="true">{style.glyph}</span>
      {status}
    </span>
  );
}

function fileName(relativePath: string): string {
  const parts = relativePath.split('/');
  return parts[parts.length - 1] || relativePath;
}

function CheckMatrix({ checks }: { checks: VerificationCheck[] }) {
  if (checks.length === 0) {
    return <p className="text-sm text-stone-500">No checks recorded yet.</p>;
  }
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-stone-200 text-left text-xs text-stone-500">
          <th scope="col" className="py-2 pr-4 font-semibold">
            Check
          </th>
          <th scope="col" className="py-2 pr-4 font-semibold">
            Status
          </th>
          <th scope="col" className="py-2 font-semibold">
            Detail
          </th>
        </tr>
      </thead>
      <tbody>
        {checks.map((check) => (
          <tr key={check.id} className="border-b border-stone-100 last:border-0">
            <td className="py-2 pr-4 align-top">
              <p className="font-medium text-stone-900">{checkLabel(check.name)}</p>
              <p className="font-mono text-[11px] text-stone-500">{check.name}</p>
            </td>
            <td className="py-2 pr-4 align-top">
              <StatusBadge status={check.status} />
            </td>
            <td className="py-2 align-top">
              <p className="text-stone-700">{checkOneLiner(check) ?? '—'}</p>
              <details className="mt-1">
                <summary className="cursor-pointer text-xs text-sky-700 hover:underline">
                  Full detail
                </summary>
                <pre className="mt-1 max-h-48 overflow-auto rounded border border-stone-200 bg-stone-50 p-2 font-mono text-[11px] text-stone-700">
                  {JSON.stringify(check.detail, null, 2)}
                </pre>
              </details>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function VerificationView({
  reproducers,
  attempts,
  checks,
  reproArtifacts,
  findings,
  runMode,
  runStatus,
}: {
  reproducers: Reproducer[];
  attempts: RepairAttempt[];
  checks: VerificationCheck[];
  reproArtifacts: Artifact[];
  findings: Finding[];
  runMode: string;
  runStatus: string;
}) {
  const summary = summarizeRepair(attempts, checks);
  const reproducer = reproducers[0] ?? null;
  const finding = reproducer ? (findings.find((f) => f.id === reproducer.findingId) ?? null) : null;
  const freezeChecks = checks.filter((c) => c.repairAttemptId === null);
  const orderedAttempts = [...attempts].sort((a, b) => a.attempt - b.attempt);

  if (!reproducer) {
    return (
      <div className="rounded-lg border border-dashed border-stone-300 bg-white px-6 py-10 text-center">
        <p className="text-sm font-medium text-stone-900">No frozen reproducer</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-stone-600">
          {runMode !== 'investigate-repair'
            ? 'This run did not request repair, so nothing was frozen or verified.'
            : runStatus === 'completed' || runStatus === 'failed'
              ? 'The run finished without freezing a reproducer — either no finding reproduced or repair hit a limitation. See the activity tab for the reason.'
              : 'A reproducer will be frozen here once a finding reproduces.'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div
        className={`flex flex-wrap items-center gap-3 rounded-lg border p-4 ${
          summary.verdict === 'verified'
            ? 'border-green-700 bg-green-50'
            : summary.verdict === 'unverified'
              ? 'border-red-700 bg-red-50'
              : 'border-stone-200 bg-white'
        }`}
      >
        {summary.verdict === 'verified' && summary.verifiedAttempt !== null ? (
          <>
            <AttemptVerdictBadge verdict="verified" />
            <p className="text-sm text-stone-700">
              Attempt {summary.verifiedAttempt} passed every required gate. The patch is safe to
              review — verification covers the frozen reproducer, timing variations, and the
              project&apos;s own checks, not the whole application.
            </p>
          </>
        ) : (
          <>
            <AttemptVerdictBadge
              verdict={summary.verdict === 'unverified' ? 'failed' : 'no-checks'}
            />
            <p className="text-sm text-stone-700">
              {summary.verdict === 'unverified'
                ? `No verified patch after ${summary.attempts} attempt(s). The result stays investigation-only; the last patch is retained for inspection.`
                : 'Repair has not produced an attempt yet.'}
            </p>
          </>
        )}
      </div>

      <section
        aria-label="Frozen reproducer"
        className="rounded-lg border border-stone-200 bg-white p-5"
      >
        <h3 className="text-sm font-semibold text-stone-900">Frozen reproducer</h3>
        <dl className="mt-2 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold text-stone-500">Finding</dt>
            <dd className="mt-0.5 text-stone-700">
              {finding ? finding.title : reproducer.findingId}{' '}
              <span className="font-mono text-xs text-stone-500">({reproducer.checkId})</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-stone-500">Frozen at</dt>
            <dd className="mt-0.5 text-stone-700">{formatDateTime(reproducer.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-stone-500">Test hash</dt>
            <dd className="mt-0.5 break-all font-mono text-xs text-stone-700" title={reproducer.testHash}>
              {reproducer.testHash.slice(0, 16)}…
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-stone-500">Plan hash</dt>
            <dd className="mt-0.5 break-all font-mono text-xs text-stone-700" title={reproducer.planHash}>
              {reproducer.planHash.slice(0, 16)}…
            </dd>
          </div>
        </dl>
        <div className="mt-3">
          <h4 className="text-xs font-semibold text-stone-500">Export</h4>
          {reproArtifacts.length === 0 ? (
            <p className="mt-1 text-sm text-stone-500">
              Bundle files are still being written — they appear here once frozen.
            </p>
          ) : (
            <ul className="mt-1 flex flex-wrap gap-2">
              {reproArtifacts.map((artifact) => (
                <li key={artifact.id}>
                  <a
                    href={`/api/artifacts/${artifact.id}`}
                    download={fileName(artifact.relativePath)}
                    className="inline-block rounded border border-stone-300 bg-stone-50 px-2 py-1 font-mono text-xs text-sky-800 hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700"
                  >
                    ↓ {fileName(artifact.relativePath)}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section
        aria-label="Freeze checks"
        className="rounded-lg border border-stone-200 bg-white p-5"
      >
        <h3 className="text-sm font-semibold text-stone-900">Freeze and baseline</h3>
        <p className="mt-1 text-sm text-stone-600">
          Proves the frozen reproducer fails on the original app and captures pristine project
          checks for comparison.
        </p>
        <div className="mt-3">
          <CheckMatrix checks={freezeChecks} />
        </div>
      </section>

      {orderedAttempts.map((attempt) => {
        const attemptChecks = checks.filter((c) => c.repairAttemptId === attempt.id);
        const verdict = summarizeAttemptChecks(attemptChecks).verdict;
        return (
          <section
            key={attempt.id}
            aria-label={`Attempt ${attempt.attempt} verification`}
            className="rounded-lg border border-stone-200 bg-white p-5"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-stone-900">
                Attempt {attempt.attempt} verification
              </h3>
              <AttemptVerdictBadge verdict={verdict} />
            </div>
            <div className="mt-3">
              <CheckMatrix checks={attemptChecks} />
            </div>
          </section>
        );
      })}
    </div>
  );
}
