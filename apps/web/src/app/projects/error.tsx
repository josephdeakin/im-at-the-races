'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { HStack } from '@astryxdesign/core/HStack';
import { VStack } from '@astryxdesign/core/VStack';

export default function ProjectsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <VStack gap={4}>
      <Banner
        status="error"
        title="Could not load projects"
        description={error.message || 'The local database may be unavailable. Check the server logs.'}
      />
      <HStack>
        <Button type="button" label="Try again" onClick={reset} />
      </HStack>
    </VStack>
  );
}
