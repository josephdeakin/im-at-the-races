import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getProject, getRun, listArtifactsByRun, listEvents } from '@races/db';
import { RUN_MODE_LABELS } from '@races/contracts';
import { getDb } from '@/lib/server/db';
import { toProjectJson, toRunEventJson, toRunJson } from '@/lib/server/serializers';
import { formatDateTime, formatDurationMs } from '@/lib/format';
import { RunMonitor } from '@/components/RunMonitor';

export default async function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const db = getDb();
  const runRow = getRun(db, runId);
  if (!runRow) notFound();
  const run = toRunJson(runRow);
  const projectRow = getProject(db, run.projectId);
  const project = projectRow ? toProjectJson(projectRow) : null;
  const events = listEvents(db, runId, -1).map(toRunEventJson);
  const nextAfter = events.length > 0 ? events[events.length - 1].sequence : -1;
  const artifacts = listArtifactsByRun(db, runId);

  return (
    <div className="space-y-8">
      <div>
        {project && (
          <Link
            href={`/projects/${project.id}`}
            className="text-sm text-sky-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700"
          >
            ← {project.name}
          </Link>
        )}
        <h1 className="mt-2 text-xl font-semibold tracking-tight text-stone-900">Run</h1>
        <p className="mt-1 font-mono text-xs text-stone-500">{run.id}</p>
      </div>

      <section
        aria-label="Run details"
        className="rounded-lg border border-stone-200 bg-white p-5"
      >
        <dl className="grid grid-cols-1 gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
          <div className="sm:col-span-2">
            <dt className="font-medium text-stone-800">Task</dt>
            <dd className="mt-0.5 text-stone-600">{run.task}</dd>
          </div>
          <div>
            <dt className="font-medium text-stone-800">Mode</dt>
            <dd className="mt-0.5 text-stone-600">
              {RUN_MODE_LABELS[run.mode]} <span className="text-stone-400">(stored intent)</span>
            </dd>
          </div>
          <div>
            <dt className="font-medium text-stone-800">Phase</dt>
            <dd className="mt-0.5 font-mono text-xs leading-5 text-stone-600">{run.phase}</dd>
          </div>
          <div>
            <dt className="font-medium text-stone-800">Limits</dt>
            <dd className="mt-0.5 text-stone-600">
              {formatDurationMs(run.limits.durationMs)} · {run.limits.modelCalls} model calls ·{' '}
              {run.limits.experiments} experiments
            </dd>
          </div>
          <div>
            <dt className="font-medium text-stone-800">Timestamps</dt>
            <dd className="mt-0.5 space-y-0.5 text-stone-600">
              <p>Created: {formatDateTime(run.createdAt)}</p>
              <p>Started: {formatDateTime(run.startedAt)}</p>
              <p>Finished: {formatDateTime(run.finishedAt)}</p>
              {run.cancelRequestedAt && (
                <p>Cancellation requested: {formatDateTime(run.cancelRequestedAt)}</p>
              )}
            </dd>
          </div>
          {run.errorMessage && (
            <div className="sm:col-span-2">
              <dt className="font-medium text-stone-800">Error</dt>
              <dd className="mt-0.5 font-mono text-xs text-red-700">
                {run.errorCode ? `${run.errorCode}: ` : ''}
                {run.errorMessage}
              </dd>
            </div>
          )}
        </dl>
      </section>

      <RunMonitor initialRun={run} initialEvents={events} initialNextAfter={nextAfter} />

      <section aria-label="Findings and replay evidence">
        <h2 className="text-sm font-semibold text-stone-900">Findings &amp; replay evidence</h2>
        {artifacts.length === 0 ? (
          <div className="mt-2 rounded-lg border border-dashed border-stone-300 bg-white px-6 py-10 text-center">
            <p className="text-sm font-medium text-stone-900">Nothing here yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-stone-600">
              Confirmed race conditions, timing evidence and replay artifacts will appear here once
              the experiment engine executes this run.
            </p>
          </div>
        ) : (
          <ul className="mt-2 divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white">
            {artifacts.map((artifact) => (
              <li key={artifact.id} className="px-4 py-3 font-mono text-xs text-stone-700">
                {artifact.kind} · {artifact.relativePath} · {artifact.mimeType}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
