'use client';

import { useMemo } from 'react';
import type { RunEvent, TrialRequestRecord } from '@races/contracts';
import { Card } from '@astryxdesign/core/Card';
import { CodeBlock } from '@astryxdesign/core/CodeBlock';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { joinRequestTraffic, type RequestTrafficRow } from '@/lib/network';
import { toneBadge } from './TrialRail';

/** Captured HTTP traffic for one trial: every matched request with timing. */
export function NetworkPanel({
  requests,
  events,
  t0,
}: {
  requests: TrialRequestRecord[];
  events: RunEvent[];
  t0: number | null;
}) {
  const rows = useMemo(() => joinRequestTraffic(requests, events), [requests, events]);
  return (
    <Card>
      <VStack gap={3}>
        <Heading level={3}>Network</Heading>
        {rows.length === 0 ? (
          <EmptyState
            title="No requests captured"
            description="This trial matched no HTTP requests against the plan."
          />
        ) : (
          rows.map((row) => <NetworkRow key={row.id} row={row} t0={t0} />)
        )}
      </VStack>
    </Card>
  );
}

function offset(at: number | null, t0: number | null): string {
  if (at === null || t0 === null) return '—';
  return `+${((at - t0) / 1000).toFixed(1)}s`;
}

function prettyExcerpt(excerpt: string): { code: string; language: string } {
  try {
    return { code: JSON.stringify(JSON.parse(excerpt), null, 2), language: 'json' };
  } catch {
    return { code: excerpt, language: 'text' };
  }
}

function NetworkRow({ row, t0 }: { row: RequestTrafficRow; t0: number | null }) {
  const duration =
    row.startedAt !== null && row.capturedAt !== null
      ? `${((row.capturedAt - row.startedAt) / 1000).toFixed(1)}s`
      : null;
  const pretty = row.excerpt === null ? null : prettyExcerpt(row.excerpt);
  return (
    <VStack gap={1}>
      <HStack gap={2} wrap="wrap">
        {toneBadge('muted', '●', row.method)}
        <Text type="code">{row.id}</Text>
        {row.status === null ? (
          <Text type="supporting">{row.method === 'WS' ? 'frame' : 'no response'}</Text>
        ) : (
          toneBadge(row.status >= 200 && row.status < 300 ? 'good' : 'bad', '●', String(row.status))
        )}
        {row.held && toneBadge('accent', '▮', 'held')}
        {row.released && toneBadge('accent', '▶', 'released')}
        {!row.matched && toneBadge('bad', '✗', 'unmatched')}
      </HStack>
      <Text type="code">{row.url === '' ? '(no URL recorded)' : row.url}</Text>
      <Text type="supporting">
        {offset(row.startedAt, t0)} → {offset(row.capturedAt, t0)}
        {duration === null ? '' : ` (${duration})`}
        {row.heldAt !== null ? ` · held ${offset(row.heldAt, t0)}` : ''}
        {row.releasedAt !== null ? ` · released ${offset(row.releasedAt, t0)}` : ''}
      </Text>
      {pretty !== null && (
        <details>
          <summary>
            <Text type="supporting">
              Response excerpt{row.truncated ? ' (truncated)' : ''}
            </Text>
          </summary>
          <CodeBlock code={pretty.code} language={pretty.language} />
        </details>
      )}
    </VStack>
  );
}
