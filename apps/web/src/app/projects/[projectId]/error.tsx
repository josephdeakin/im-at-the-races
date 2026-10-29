'use client';

export default function ProjectError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="rounded-lg border border-red-200 bg-white p-6">
      <h1 className="text-base font-semibold text-stone-900">Could not load this project</h1>
      <p className="mt-1 text-sm text-stone-600">
        {error.message || 'The local database may be unavailable. Check the server logs.'}
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-4 inline-flex items-center justify-center rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700"
      >
        Try again
      </button>
    </div>
  );
}
