import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getProject, listRunsByProject } from '@races/db';
import { RUN_MODE_LABELS } from '@races/contracts';
import { getDb } from '@/lib/server/db';
import { toProjectJson, toRunJson } from '@/lib/server/serializers';
import { formatDateTime, shortId } from '@/lib/format';
import { EmptyState } from '@/components/EmptyState';
import { RunForm } from '@/components/RunForm';
import { StatusBadge } from '@/components/StatusBadge';

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const db = getDb();
  const projectRow = getProject(db, projectId);
  if (!projectRow) notFound();
  const project = toProjectJson(projectRow);
  const runs = listRunsByProject(db, projectId).map(toRunJson);

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/projects"
          className="text-sm text-sky-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700"
        >
          ← All projects
        </Link>
        <h1 className="mt-2 text-xl font-semibold tracking-tight text-stone-900">{project.name}</h1>
        <dl className="mt-2 space-y-1 text-sm">
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-stone-500">Repository:</dt>
            <dd className="font-mono text-xs leading-5 text-stone-800">{project.repositoryPath}</dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-stone-500">Target:</dt>
            <dd className="font-mono text-xs leading-5 text-stone-800">{project.targetUrl}</dd>
          </div>
        </dl>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <RunForm projectId={project.id} />
        </div>
        <div className="lg:col-span-3">
          <h2 className="text-sm font-semibold text-stone-900">Previous runs</h2>
          {runs.length === 0 ? (
            <div className="mt-2">
              <EmptyState title="No runs yet">
                <p>
                  Create an investigation to queue the first run for this project. Runs persist in
                  the local database and stay queued until the execution engine is connected.
                </p>
              </EmptyState>
            </div>
          ) : (
            <ul className="mt-2 divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white">
              {runs.map((run) => (
                <li key={run.id}>
                  <Link
                    href={`/runs/${run.id}`}
                    className="block px-4 py-3 hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-sky-700"
                  >
                    <span className="flex items-center gap-3">
                      <StatusBadge status={run.status} />
                      <span className="font-mono text-xs text-stone-500">{shortId(run.id)}</span>
                      <span className="ml-auto text-xs text-stone-400">
                        {formatDateTime(run.createdAt)}
                      </span>
                    </span>
                    <span className="mt-1.5 block truncate text-sm text-stone-800">{run.task}</span>
                    <span className="mt-0.5 block text-xs text-stone-500">
                      {RUN_MODE_LABELS[run.mode]} · phase {run.phase}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
