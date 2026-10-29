import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getProject,
  getRun,
  listArtifactsByRun,
  listEvents,
  listExperimentsByRun,
  listFindingsByRun,
  listRepairAttemptsByRun,
  listReproducersByRun,
  listTrialsByExperiment,
  listVerificationChecksByRun,
} from '@races/db';
import { RUN_MODE_LABELS } from '@races/contracts';
import { getDb } from '@/lib/server/db';
import {
  toArtifactJson,
  toExperimentJson,
  toFindingJson,
  toProjectJson,
  toRepairAttemptJson,
  toReproducerJson,
  toRunEventJson,
  toRunJson,
  toTrialJson,
  toVerificationCheckJson,
} from '@/lib/server/serializers';
import { formatDateTime, formatDurationMs } from '@/lib/format';
import { RunWorkspace } from '@/components/RunWorkspace';

export default async function RunPage({
  params,
  searchParams,
}: {
  params: Promise<{ runId: string }>;
  searchParams: Promise<{ trial?: string }>;
}) {
  const { runId } = await params;
  const { trial: trialParam } = await searchParams;
  const db = getDb();
  const runRow = getRun(db, runId);
  if (!runRow) notFound();
  const run = toRunJson(runRow);
  const projectRow = getProject(db, run.projectId);
  const project = projectRow ? toProjectJson(projectRow) : null;
  const events = listEvents(db, runId, -1).map(toRunEventJson);
  const nextAfter = events.length > 0 ? events[events.length - 1].sequence : -1;
  const artifacts = listArtifactsByRun(db, runId);
  const experiments = listExperimentsByRun(db, runId).map((row) => ({
    ...toExperimentJson(row),
    trials: listTrialsByExperiment(db, row.id).map(toTrialJson),
  }));
  const findings = listFindingsByRun(db, runId).map(toFindingJson);
  const initialRepair = {
    reproducers: listReproducersByRun(db, runId).map(toReproducerJson),
    attempts: listRepairAttemptsByRun(db, runId).map(toRepairAttemptJson),
    checks: listVerificationChecksByRun(db, runId).map(toVerificationCheckJson),
    reproArtifacts: artifacts
      .filter((artifact) => artifact.kind.startsWith('repro-'))
      .map(toArtifactJson),
  };

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

      <RunWorkspace
        initialRun={run}
        initialEvents={events}
        initialNextAfter={nextAfter}
        experiments={experiments}
        findings={findings}
        initialTrialId={typeof trialParam === 'string' ? trialParam : null}
        initialRepair={initialRepair}
      />

      <section aria-label="Run artifacts">
        <h2 className="text-sm font-semibold text-stone-900">Run artifacts</h2>
        {artifacts.length === 0 ? (
          <div className="mt-2 rounded-lg border border-dashed border-stone-300 bg-white px-6 py-10 text-center">
            <p className="text-sm font-medium text-stone-900">Nothing here yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-stone-600">
              Screenshots and recorded values will appear here once the run executes trials.
            </p>
          </div>
        ) : (
          <ul className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {artifacts.map((artifact) => (
              <li
                key={artifact.id}
                className="overflow-hidden rounded-lg border border-stone-200 bg-white"
              >
                {artifact.mimeType.startsWith('image/') ? (
                  <a
                    href={`/api/artifacts/${artifact.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700"
                  >
                    {/* Plain img: artifact bytes are local evidence, not optimized assets. */}
                    <img
                      src={`/api/artifacts/${artifact.id}`}
                      alt={`${artifact.kind} evidence: ${artifact.relativePath}`}
                      className="aspect-video w-full object-cover object-top"
                    />
                  </a>
                ) : (
                  <a
                    href={`/api/artifacts/${artifact.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="block px-4 py-6 text-center text-sm text-sky-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700"
                  >
                    Open {artifact.kind} ({artifact.mimeType})
                  </a>
                )}
                <p className="border-t border-stone-200 px-4 py-2 font-mono text-xs text-stone-500">
                  {artifact.kind} · {artifact.relativePath}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
