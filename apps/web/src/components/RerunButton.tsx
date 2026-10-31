'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CreateRunResponseSchema } from '@races/contracts';
import { Button } from '@astryxdesign/core/Button';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';

export function RerunButton({ runId }: { runId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onRerun() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${runId}/rerun`, { method: 'POST' });
      const body: unknown = await res.json().catch(() => null);
      const parsed = CreateRunResponseSchema.safeParse(body);
      if (!res.ok || !parsed.success) {
        setError('Rerun failed. Please try again.');
        return;
      }
      router.push(`/runs/${parsed.data.runId}`);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setPending(false);
    }
  }

  return (
    <HStack gap={2}>
      {error && (
        <Text type="supporting" color="primary">
          <span role="alert">{error}</span>
        </Text>
      )}
      <Button
        variant="secondary"
        label={pending ? 'Starting rerun' : 'Rerun investigation'}
        tooltip="Start a fresh investigation run with the same task. Recorded evidence is never modified."
        onClick={onRerun}
        isLoading={pending}
      />
    </HStack>
  );
}
