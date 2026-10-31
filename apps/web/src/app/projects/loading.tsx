import { Skeleton } from '@astryxdesign/core/Skeleton';
import { VStack } from '@astryxdesign/core/VStack';

export default function ProjectsLoading() {
  return (
    <VStack gap={4} aria-label="Loading projects">
      <Skeleton width={160} height={28} />
      <Skeleton height={384} />
      <VStack gap={3}>
        {[0, 1, 2].map((key) => (
          <Skeleton key={key} height={96} />
        ))}
      </VStack>
    </VStack>
  );
}
