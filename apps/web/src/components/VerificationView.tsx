'use client';

import type {
  Artifact,
  Finding,
  RepairAttempt,
  Reproducer,
  VerificationCheck,
  VerificationCheckStatus,
} from '@races/contracts';
import { formatDateTime } from '@/lib/format';
import { checkLabel, checkOneLiner, summarizeAttemptChecks, summarizeRepair } from '@/lib/repair';
import { AttemptVerdictBadge } from './PatchView';
import { Badge, type BadgeVariant } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Card } from '@astryxdesign/core/Card';
import { CodeBlock } from '@astryxdesign/core/CodeBlock';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Link } from '@astryxdesign/core/Link';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Table } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';

const STATUS_VARIANT: Record<VerificationCheckStatus, BadgeVariant> = {
  pass: 'success',
  fail: 'error',
  incomplete: 'warning',
  skipped: 'neutral',
};

function fileName(relativePath: string): string {
  const parts = relativePath.split('/');
  return parts[parts.length - 1] || relativePath;
}

function CheckMatrix({ checks }: { checks: VerificationCheck[] }) {
  if (checks.length === 0) {
    return <Text type="supporting">No checks recorded yet.</Text>;
  }
  return (
    <Table
      data={checks}
      columns={[
        {
          key: 'check',
          header: 'Check',
          renderCell: (check) => (
            <VStack gap={0}>
              <Text weight="medium">{checkLabel(check.name)}</Text>
              <Text type="code">{check.name}</Text>
            </VStack>
          ),
        },
        {
          key: 'status',
          header: 'Status',
          renderCell: (check) => (
            <Badge variant={STATUS_VARIANT[check.status]} label={check.status} />
          ),
        },
        {
          key: 'detail',
          header: 'Detail',
          renderCell: (check) => (
            <VStack gap={1}>
              <Text>{checkOneLiner(check) ?? '—'}</Text>
              <Collapsible trigger={<Text type="supporting">Full detail</Text>}>
                <CodeBlock
                  code={JSON.stringify(check.detail, null, 2)}
                  language="json"
                  maxHeight={192}
                />
              </Collapsible>
            </VStack>
          ),
        },
      ]}
    />
  );
}

export function VerificationView({
  reproducers,
  attempts,
  checks,
  reproArtifacts,
  findings,
  runMode,
  runStatus,
}: {
  reproducers: Reproducer[];
  attempts: RepairAttempt[];
  checks: VerificationCheck[];
  reproArtifacts: Artifact[];
  findings: Finding[];
  runMode: string;
  runStatus: string;
}) {
  const summary = summarizeRepair(attempts, checks);
  const reproducer = reproducers[0] ?? null;
  const finding = reproducer ? (findings.find((f) => f.id === reproducer.findingId) ?? null) : null;
  const freezeChecks = checks.filter((c) => c.repairAttemptId === null);
  const orderedAttempts = [...attempts].sort((a, b) => a.attempt - b.attempt);

  if (!reproducer) {
    return (
      <EmptyState
        title="No frozen reproducer"
        description={
          runMode !== 'investigate-repair'
            ? 'This run did not request repair, so nothing was frozen or verified.'
            : runStatus === 'completed' || runStatus === 'failed'
              ? 'The run finished without freezing a reproducer — either no finding reproduced or repair hit a limitation. See the activity tab for the reason.'
              : 'A reproducer will be frozen here once a finding reproduces.'
        }
      />
    );
  }

  const verified = summary.verdict === 'verified' && summary.verifiedAttempt !== null;

  return (
    <VStack gap={4}>
      <Banner
        status={verified ? 'success' : summary.verdict === 'unverified' ? 'error' : 'info'}
        title={
          verified
            ? `Attempt ${summary.verifiedAttempt} passed every required gate`
            : summary.verdict === 'unverified'
              ? `No verified patch after ${summary.attempts} attempt(s)`
              : 'Repair has not produced an attempt yet'
        }
        description={
          verified
            ? 'The patch is safe to review — verification covers the frozen reproducer, timing variations, and the project\u2019s own checks, not the whole application.'
            : summary.verdict === 'unverified'
              ? 'The result stays investigation-only; the last patch is retained for inspection.'
              : undefined
        }
      />

      <Card>
        <VStack gap={3}>
          <Heading level={3}>Frozen reproducer</Heading>
          <MetadataList columns={2}>
            <MetadataListItem label="Finding">
              {finding ? finding.title : reproducer.findingId}{' '}
              <Text type="code">({reproducer.checkId})</Text>
            </MetadataListItem>
            <MetadataListItem label="Frozen at">
              {formatDateTime(reproducer.createdAt)}
            </MetadataListItem>
            <MetadataListItem label="Test hash">
              <Text type="code">{reproducer.testHash.slice(0, 16)}…</Text>
            </MetadataListItem>
            <MetadataListItem label="Plan hash">
              <Text type="code">{reproducer.planHash.slice(0, 16)}…</Text>
            </MetadataListItem>
          </MetadataList>
          <VStack gap={1}>
            <Heading level={4}>Export</Heading>
            {reproArtifacts.length === 0 ? (
              <Text type="supporting">
                Bundle files are still being written — they appear here once frozen.
              </Text>
            ) : (
              <HStack gap={2}>
                {reproArtifacts.map((artifact) => (
                  <Link
                    key={artifact.id}
                    href={`/api/artifacts/${artifact.id}`}
                    download={fileName(artifact.relativePath)}
                    isStandalone
                  >
                    ↓ {fileName(artifact.relativePath)}
                  </Link>
                ))}
              </HStack>
            )}
          </VStack>
        </VStack>
      </Card>

      <Card>
        <VStack gap={3}>
          <VStack gap={1}>
            <Heading level={3}>Freeze and baseline</Heading>
            <Text type="supporting">
              Proves the frozen reproducer fails on the original app and captures pristine
              project checks for comparison.
            </Text>
          </VStack>
          <CheckMatrix checks={freezeChecks} />
        </VStack>
      </Card>

      {orderedAttempts.map((attempt) => {
        const attemptChecks = checks.filter((c) => c.repairAttemptId === attempt.id);
        const verdict = summarizeAttemptChecks(attemptChecks).verdict;
        return (
          <Card key={attempt.id}>
            <VStack gap={3}>
              <HStack gap={2}>
                <Heading level={3}>Attempt {attempt.attempt} verification</Heading>
                <AttemptVerdictBadge verdict={verdict} />
              </HStack>
              <CheckMatrix checks={attemptChecks} />
            </VStack>
          </Card>
        );
      })}
    </VStack>
  );
}
