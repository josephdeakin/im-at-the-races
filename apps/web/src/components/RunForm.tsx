'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { DEFAULT_RUN_LIMITS, DEFAULT_RUN_TASK, type RunMode } from '@races/contracts';
import { extractApiMessage } from '@/lib/format';
import { FormError, hintClassName, inputClassName, labelClassName, primaryButtonClassName } from './form';

const MODES: { value: RunMode; title: string; description: string }[] = [
  {
    value: 'investigate',
    title: 'Investigate only',
    description: 'Find and reproduce race conditions without changing source.',
  },
  {
    value: 'investigate-repair',
    title: 'Investigate with repair',
    description: 'Additionally propose source patches for confirmed races.',
  },
];

export function RunForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [task, setTask] = useState('');
  const [mode, setMode] = useState<RunMode>('investigate');
  const [durationMinutes, setDurationMinutes] = useState(
    String(DEFAULT_RUN_LIMITS.durationMs / 60_000),
  );
  const [modelCalls, setModelCalls] = useState(String(DEFAULT_RUN_LIMITS.modelCalls));
  const [experiments, setExperiments] = useState(String(DEFAULT_RUN_LIMITS.experiments));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          task,
          mode,
          limits: {
            durationMs: Math.round(Number(durationMinutes) * 60_000),
            modelCalls: Number(modelCalls),
            experiments: Number(experiments),
          },
        }),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setError(extractApiMessage(body, 'Could not create the run.'));
        return;
      }
      const runId = (body as { runId?: string }).runId;
      if (!runId) {
        setError('Server returned an unexpected response.');
        return;
      }
      router.push(`/runs/${runId}`);
      router.refresh();
    } catch {
      setError('Could not reach the server. Is the web app running?');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5 rounded-lg border border-stone-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-stone-900">New investigation</h2>
      <div>
        <label htmlFor="run-task" className={labelClassName}>
          Task <span className="font-normal text-stone-500">(optional)</span>
        </label>
        <textarea
          id="run-task"
          name="task"
          rows={3}
          maxLength={4000}
          className={`${inputClassName} mt-1`}
          placeholder={DEFAULT_RUN_TASK}
          value={task}
          onChange={(e) => setTask(e.target.value)}
          disabled={saving}
        />
        <p className={hintClassName}>
          Leave blank for a broad investigation across the whole project.
        </p>
      </div>
      <fieldset>
        <legend className={labelClassName}>Mode</legend>
        <div className="mt-2 space-y-2">
          {MODES.map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-start gap-3 rounded-md border border-stone-200 px-3 py-2.5 has-checked:border-sky-700 has-checked:bg-sky-50"
            >
              <input
                type="radio"
                name="mode"
                value={option.value}
                checked={mode === option.value}
                onChange={() => setMode(option.value)}
                disabled={saving}
                className="mt-1 h-4 w-4 accent-sky-700"
              />
              <span>
                <span className="block text-sm font-medium text-stone-900">{option.title}</span>
                <span className="block text-xs text-stone-500">{option.description}</span>
              </span>
            </label>
          ))}
        </div>
        <p className={hintClassName}>
          Stored as intent only — execution is not implemented yet, so runs stay queued.
        </p>
      </fieldset>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="run-duration" className={labelClassName}>
            Duration (min)
          </label>
          <input
            id="run-duration"
            name="durationMinutes"
            type="number"
            required
            min={1}
            max={1440}
            step={1}
            inputMode="numeric"
            className={`${inputClassName} mt-1`}
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(e.target.value)}
            disabled={saving}
          />
        </div>
        <div>
          <label htmlFor="run-model-calls" className={labelClassName}>
            Model calls
          </label>
          <input
            id="run-model-calls"
            name="modelCalls"
            type="number"
            required
            min={0}
            max={100000}
            step={1}
            inputMode="numeric"
            className={`${inputClassName} mt-1`}
            value={modelCalls}
            onChange={(e) => setModelCalls(e.target.value)}
            disabled={saving}
          />
        </div>
        <div>
          <label htmlFor="run-experiments" className={labelClassName}>
            Experiments
          </label>
          <input
            id="run-experiments"
            name="experiments"
            type="number"
            required
            min={0}
            max={1000}
            step={1}
            inputMode="numeric"
            className={`${inputClassName} mt-1`}
            value={experiments}
            onChange={(e) => setExperiments(e.target.value)}
            disabled={saving}
          />
        </div>
      </div>
      <p className="text-xs text-stone-500">
        Limits bound the future experiment engine: wall-clock budget, model calls and timing
        experiments per run.
      </p>
      <FormError message={error} />
      <button type="submit" className={primaryButtonClassName} disabled={saving}>
        {saving ? 'Creating…' : 'Create investigation'}
      </button>
    </form>
  );
}
