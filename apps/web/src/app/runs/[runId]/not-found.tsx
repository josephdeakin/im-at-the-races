import Link from 'next/link';

export default function RunNotFound() {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-6 text-center">
      <h1 className="text-base font-semibold text-stone-900">Run not found</h1>
      <p className="mt-1 text-sm text-stone-600">
        It may have been deleted, or the ID in the URL is wrong.
      </p>
      <Link
        href="/projects"
        className="mt-4 inline-block text-sm text-sky-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700"
      >
        ← Back to projects
      </Link>
    </div>
  );
}
