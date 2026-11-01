'use client';

import { useEffect, useState } from 'react';
import type { Finding } from '@races/contracts';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { CodeBlock } from '@astryxdesign/core/CodeBlock';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Grid } from '@astryxdesign/core/Grid';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { List, ListItem } from '@astryxdesign/core/List';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { formatDateTime } from '@/lib/format';
import { tallyConfirmations } from '@/lib/explain';
import type { ExperimentWithTrials } from './TimelineView';

export function FindingsView({
  findings,
  experiments,
  runStatus,
  onOpenTrial,
  visionNotes = [],
}: {
  findings: Finding[];
  experiments: ExperimentWithTrials[];
  runStatus: string;
  onOpenTrial: (trialId: string) => void;
  visionNotes?: string[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(findings[0]?.id ?? null);
  // Findings arrive live: select the first once they land, without
  // disturbing an explicit user selection.
  useEffect(() => {
    if (selectedId === null && findings.length > 0) {
      setSelectedId(findings[0].id);
    }
  }, [findings, selectedId]);
  const selected = findings.find((f) => f.id === selectedId) ?? null;

  if (findings.length === 0) {
    return (
      <EmptyState
        title="No findings recorded"
        description={
          runStatus === 'completed'
            ? 'The investigation finished without confirming a race. The timeline and activity tabs show what was tested. This is not a claim that the app is race-free.'
            : 'Findings will appear here once the agent confirms a timing failure.'
        }
      />
    );
  }

  const experiment = selected
    ? (experiments.find((e) => e.id === selected.experimentId) ?? null)
    : null;
  const tally = experiment ? tallyConfirmations(experiment.trials) : null;

  return (
    <Grid columns={{ minWidth: 300, max: 2 }} gap={4}>
      <Card>
          <List hasDividers edge="bleed" aria-label="Findings">
            {findings.map((finding) => (
              <ListItem
                key={finding.id}
                label={
                  <HStack gap={2}>
                    <Text aria-hidden="true">{finding.status === 'reproduced' ? '✗' : '?'}</Text>
                    <Text weight="medium">{finding.title}</Text>
                  </HStack>
                }
                description={
                  <Text type="code">
                    {finding.status} · {formatDateTime(finding.createdAt)}
                  </Text>
                }
                onSelect={() => setSelectedId(finding.id)}
                isSelected={finding.id === selectedId}
              />
            ))}
          </List>
        </Card>
        {selected && (
          <Card>
            <VStack gap={4}>
              <HStack gap={2}>
                <Badge
                  variant={selected.status === 'reproduced' ? 'error' : 'warning'}
                  label={selected.status === 'reproduced' ? 'Reproduced' : 'Candidate'}
                  icon={
                    <span aria-hidden="true">
                      {selected.status === 'reproduced' ? '✗' : '?'}
                    </span>
                  }
                />
                {tally && <Text type="code">Confirmed {tally.text}</Text>}
              </HStack>

              <Heading level={3}>{selected.title}</Heading>
              <Text>{selected.explanation}</Text>

              <VStack gap={1}>
                <Heading level={4}>Why this is wrong</Heading>
                <Text>{selected.expectationProvenance}</Text>
              </VStack>

              <VStack gap={1}>
                <Heading level={4}>Implicated code</Heading>
                {selected.implicatedCode.length === 0 ? (
                  <Text type="supporting">None cited.</Text>
                ) : (
                  <VStack gap={2}>
                    {selected.implicatedCode.map((code) => (
                      <Card key={code.path} variant="muted">
                        <VStack gap={1}>
                          <Text type="code">
                            {code.path}{' '}
                            {!code.exists && (
                              <Text type="supporting">(not present in captured source)</Text>
                            )}
                          </Text>
                          {code.excerpt && <CodeBlock code={code.excerpt} />}
                        </VStack>
                      </Card>
                    ))}
                  </VStack>
                )}
                <Text type="code">Source: {selected.sourceIdentity}</Text>
              </VStack>

              {visionNotes.length > 0 && (
                <VStack gap={1}>
                  <HStack gap={2}>
                    <Heading level={4}>What the screenshot shows</Heading>
                    <Badge variant="neutral" label="Model explanation — not evidence" />
                  </HStack>
                  {visionNotes.map((note) => (
                    <Text key={note}>{note}</Text>
                  ))}
                </VStack>
              )}

              <VStack gap={1}>
                <Heading level={4}>Evidence trials</Heading>
                {!experiment ? (
                  <Text type="supporting">The recording experiment is not available.</Text>
                ) : (
                  <HStack gap={2}>
                    {experiment.trials.map((trial) => (
                      <Button
                        key={trial.id}
                        variant="secondary"
                        size="sm"
                        label={`Open ${trial.kind} attempt ${trial.attempt} (${trial.outcome ?? 'running'})`}
                        onClick={() => onOpenTrial(trial.id)}
                      />
                    ))}
                  </HStack>
                )}
              </VStack>
            </VStack>
          </Card>
        )}
    </Grid>
  );
}
