import { RUN_STATUS_LABELS, type RunStatus } from '@races/contracts';

const DOT_CLASSES: Record<RunStatus, string> = {
  queued: 'bg-stone-400',
  running: 'bg-sky-600',
  completed: 'bg-emerald-600',
  failed: 'bg-red-600',
  cancelled: 'bg-amber-600',
  interrupted: 'bg-amber-600',
};

export function StatusBadge({ status }: { status: RunStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-2.5 py-0.5 text-xs font-medium text-stone-700">
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${DOT_CLASSES[status]}`} />
      {RUN_STATUS_LABELS[status]}
    </span>
  );
}
