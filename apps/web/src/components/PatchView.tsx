'use client';

import { useState } from 'react';
import type { RepairAttempt, VerificationCheck } from '@races/contracts';
import { formatDateTime } from '@/lib/format';
import { summarizeAttemptChecks, type AttemptVerdict } from '@/lib/repair';
import { Badge, type BadgeVariant } from '@astryxdesign/core/Badge';
import { Card } from '@astryxdesign/core/Card';
import { CodeBlock } from '@astryxdesign/core/CodeBlock';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Grid } from '@astryxdesign/core/Grid';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { List, ListItem } from '@astryxdesign/core/List';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { PatchActions } from './PatchActions';

const VERDICT_BADGE: Record<
  AttemptVerdict,
  { variant: BadgeVariant; label: string; shortLabel: string }
> = {
  verified: { variant: 'success', label: 'Verified for the tested cases', shortLabel: 'Verified' },
  failed: { variant: 'error', label: 'Verification failed', shortLabel: 'Failed' },
  incomplete: { variant: 'warning', label: 'Verification incomplete', shortLabel: 'Incomplete' },
  'no-checks': { variant: 'neutral', label: 'No checks recorded', shortLabel: 'No checks' },
};

export function AttemptVerdictBadge({ verdict }: { verdict: AttemptVerdict }) {
  const badge = VERDICT_BADGE[verdict];
  return <Badge variant={badge.variant} label={badge.label} />;
}

export function PatchView({
  runId,
  repositoryPath,
  attempts,
  checks,
}: {
  runId: string;
  repositoryPath: string | null;
  attempts: RepairAttempt[];
  checks: VerificationCheck[];
}) {
  const ordered = [...attempts].sort((a, b) => a.attempt - b.attempt);
  const [selectedId, setSelectedId] = useState<string | null>(
    ordered.length > 0 ? ordered[ordered.length - 1].id : null,
  );
  const selected = ordered.find((a) => a.id === selectedId) ?? null;

  if (ordered.length === 0) {
    return (
      <EmptyState
        title="No patch attempts"
        description="Repair runs after a reproduced finding on investigate-with-repair runs. The latest patch attempt will appear here with its diff."
      />
    );
  }

  const selectedChecks = selected ? checks.filter((c) => c.repairAttemptId === selected.id) : [];
  const summary = summarizeAttemptChecks(selectedChecks);

  return (
    <Grid columns={{ minWidth: 300, max: 2 }} gap={4}>
      <Card>
        <List hasDividers edge="bleed" aria-label="Patch attempts">
          {ordered.map((attempt) => {
            const verdict = summarizeAttemptChecks(
              checks.filter((c) => c.repairAttemptId === attempt.id),
            ).verdict;
            const badge = VERDICT_BADGE[verdict];
            return (
              <ListItem
                key={attempt.id}
                label={`Attempt ${attempt.attempt}`}
                description={
                  <Text type="code">
                    {attempt.status} · {formatDateTime(attempt.finishedAt ?? attempt.createdAt)}
                  </Text>
                }
                endContent={<Badge variant={badge.variant} label={badge.shortLabel} />}
                onSelect={() => setSelectedId(attempt.id)}
                isSelected={attempt.id === selectedId}
              />
            );
          })}
        </List>
      </Card>

      {selected && (
        <Card>
          <VStack gap={4}>
            <HStack gap={2} wrap="wrap">
              <AttemptVerdictBadge verdict={summary.verdict} />
              <Text type="code">
                {summary.passed} passed · {summary.failed} failed · {summary.incomplete}{' '}
                incomplete · {summary.skipped} skipped
              </Text>
            </HStack>

            <Heading level={3}>Attempt {selected.attempt} patch</Heading>
            <MetadataList>
              <MetadataListItem label="Workspace">{selected.workspacePath}</MetadataListItem>
              <MetadataListItem label="Source">{selected.sourceIdentity}</MetadataListItem>
            </MetadataList>

            {selected.diff.trim() !== '' && (
              <PatchActions
                runId={runId}
                attemptId={selected.id}
                attemptNumber={selected.attempt}
                verdict={summary.verdict}
                repositoryPath={repositoryPath}
              />
            )}

            <VStack gap={1}>
              <Heading level={4}>Unified diff vs snapshot</Heading>
              {selected.diff.trim() === '' ? (
                <Text type="supporting">The attempt produced no changes.</Text>
              ) : (
                <CodeBlock
                  code={selected.diff}
                  isDiff
                  title={`Attempt ${selected.attempt} diff`}
                  hasLineNumbers={selected.diff.split('\n').length >= 5}
                  maxHeight={384}
                />
              )}
              <Text type="supporting">
                Added lines are shaded green, removed lines red. The diff covers the whole
                isolated package checkout.
              </Text>
            </VStack>
          </VStack>
        </Card>
      )}
    </Grid>
  );
}
