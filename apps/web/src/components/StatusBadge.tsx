import { Badge } from '@astryxdesign/core/Badge';
import { RUN_STATUS_LABELS, type RunStatus } from '@races/contracts';

const VARIANTS = {
  queued: 'neutral',
  running: 'info',
  completed: 'success',
  failed: 'error',
  cancelled: 'warning',
  interrupted: 'warning',
} as const;

export function StatusBadge({ status }: { status: RunStatus }) {
  return <Badge variant={VARIANTS[status]} label={RUN_STATUS_LABELS[status]} />;
}
