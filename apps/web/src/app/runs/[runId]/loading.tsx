import { Skeleton } from '@astryxdesign/core/Skeleton';
import { VStack } from '@astryxdesign/core/VStack';

export default function RunLoading() {
  return (
    <VStack gap={4} aria-label="Loading run">
      <Skeleton width={192} height={28} />
      <Skeleton height={224} />
      <VStack gap={3}>
        {[0, 1, 2].map((key) => (
          <Skeleton key={key} height={64} />
        ))}
      </VStack>
    </VStack>
  );
}
