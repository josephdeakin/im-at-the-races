'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function RerunButton({ runId }: { runId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onRerun() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${runId}/rerun`, { method: 'POST' });
      const body = (await res.json().catch(() => null)) as { runId?: string } | null;
      if (!res.ok || !body?.runId) {
        setError('Rerun failed. Please try again.');
        return;
      }
      router.push(`/runs/${body.runId}`);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      {error && (
        <span role="alert" className="text-xs text-red-700">
          {error}
        </span>
      )}
      <button
        type="button"
        onClick={onRerun}
        disabled={pending}
        title="Start a fresh investigation run with the same task. Recorded evidence is never modified."
        className="rounded border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-800 hover:bg-stone-50 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700"
      >
        {pending ? 'Starting…' : '↻ Rerun investigation'}
      </button>
    </span>
  );
}
