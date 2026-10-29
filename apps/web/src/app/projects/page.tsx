import Link from 'next/link';
import { listProjects } from '@races/db';
import { getDb } from '@/lib/server/db';
import { toProjectJson } from '@/lib/server/serializers';
import { formatDateTime } from '@/lib/format';
import { EmptyState } from '@/components/EmptyState';
import { ProjectForm } from '@/components/ProjectForm';

export default async function ProjectsPage() {
  const projects = listProjects(getDb()).map(toProjectJson);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-stone-900">Projects</h1>
        <p className="mt-1 max-w-2xl text-sm text-stone-600">
          A project points this tool at a local repository and the running app to investigate.
          Repository paths refer to the machine running this tool — the same machine serving this
          page — not the browser.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <ProjectForm />
        </div>
        <div className="lg:col-span-3">
          {projects.length === 0 ? (
            <EmptyState title="No projects yet">
              <p>
                Create your first project to start queuing race-condition investigations. Projects
                are stored locally in the repository&apos;s <code className="font-mono text-xs">.races</code>{' '}
                directory.
              </p>
            </EmptyState>
          ) : (
            <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white">
              {projects.map((project) => (
                <li key={project.id}>
                  <Link
                    href={`/projects/${project.id}`}
                    className="block px-4 py-3.5 hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-sky-700"
                  >
                    <span className="block text-sm font-medium text-stone-900">
                      {project.name}
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-xs text-stone-500">
                      {project.repositoryPath}
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-xs text-stone-500">
                      {project.targetUrl}
                    </span>
                    <span className="mt-1 block text-xs text-stone-400">
                      Created {formatDateTime(project.createdAt)}
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
