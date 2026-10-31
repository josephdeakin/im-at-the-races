'use client';

import { useState } from 'react';
import type { Run } from '@races/contracts';
import { Button } from '@astryxdesign/core/Button';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';

export function CancelRunButton({
  runId,
  onCancelled,
}: {
  runId: string;
  onCancelled?: (run: Run) => void;
}) {
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  async function onCancel() {
    setCancelling(true);
    setCancelError(null);
    try {
      const res = await fetch(`/api/runs/${runId}/cancel`, { method: 'POST' });
      const body = (await res.json().catch(() => null)) as { run?: Run } | null;
      if (!res.ok || !body?.run) {
        setCancelError('Cancellation failed. Please try again.');
        return;
      }
      onCancelled?.(body.run);
    } catch {
      setCancelError('Could not reach the server.');
    } finally {
      setCancelling(false);
    }
  }

  return (
    <HStack gap={3}>
      {cancelError && (
        <Text type="supporting">
          <span role="alert">{cancelError}</span>
        </Text>
      )}
      <Button
        variant="destructive"
        label={cancelling ? 'Cancelling run' : 'Cancel run'}
        onClick={onCancel}
        isLoading={cancelling}
      />
    </HStack>
  );
}
