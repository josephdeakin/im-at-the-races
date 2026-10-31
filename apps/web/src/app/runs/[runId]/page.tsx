import { notFound } from 'next/navigation';
import {
  getProject,
  getRun,
  listArtifactsByRun,
  listEvents,
  listExperimentsByRun,
  listFindingsByRun,
  listRepairAttemptsByRun,
  listReproducersByRun,
  listTrialsByRun,
  listVerificationChecksByRun,
  type TrialRow,
} from '@races/db';
import { RUN_MODE_LABELS } from '@races/contracts';
import { Card } from '@astryxdesign/core/Card';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Grid } from '@astryxdesign/core/Grid';
import { Heading } from '@astryxdesign/core/Heading';
import { Link } from '@astryxdesign/core/Link';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { getDb } from '@/lib/server/db';
import {
  toArtifactJson,
  toExperimentJson,
  toFindingJson,
  toProjectJson,
  toRepairAttemptJson,
  toReproducerJson,
  toRunEventJsonSafe,
  toRunJson,
  toTrialJson,
  toVerificationCheckJson,
} from '@/lib/server/serializers';
import { formatDateTime, formatDurationMs } from '@/lib/format';
import { RunWorkspace } from '@/components/RunWorkspace';

export default async function RunPage({
  params,
  searchParams,
}: {
  params: Promise<{ runId: string }>;
  searchParams: Promise<{ trial?: string }>;
}) {
  const { runId } = await params;
  const { trial: trialParam } = await searchParams;
  const db = getDb();
  const runRow = getRun(db, runId);
  if (!runRow) notFound();
  const run = toRunJson(runRow);
  const projectRow = getProject(db, run.projectId);
  const project = projectRow ? toProjectJson(projectRow) : null;
  const events = listEvents(db, runId, -1).map(toRunEventJsonSafe);
  const nextAfter = events.length > 0 ? events[events.length - 1].sequence : -1;
  const artifacts = listArtifactsByRun(db, runId);
  const trialsByExperiment = new Map<string, TrialRow[]>();
  for (const trial of listTrialsByRun(db, runId)) {
    const list = trialsByExperiment.get(trial.experimentId) ?? [];
    list.push(trial);
    trialsByExperiment.set(trial.experimentId, list);
  }
  const experiments = listExperimentsByRun(db, runId).map((row) => ({
    ...toExperimentJson(row),
    trials: (trialsByExperiment.get(row.id) ?? []).map(toTrialJson),
  }));
  const findings = listFindingsByRun(db, runId).map(toFindingJson);
  const initialRepair = {
    reproducers: listReproducersByRun(db, runId).map(toReproducerJson),
    attempts: listRepairAttemptsByRun(db, runId).map(toRepairAttemptJson),
    checks: listVerificationChecksByRun(db, runId).map(toVerificationCheckJson),
    reproArtifacts: artifacts
      .filter((artifact) => artifact.kind.startsWith('repro-'))
      .map(toArtifactJson),
  };

  return (
    <VStack gap={5}>
      <VStack gap={2}>
        {project && (
          <Link href={`/projects/${project.id}`} isStandalone>
            ← {project.name}
          </Link>
        )}
        <Heading level={1}>Run</Heading>
        <Text type="code">{run.id}</Text>
      </VStack>

      <Card>
        <MetadataList title="Run details" columns={2}>
          <MetadataListItem label="Task">{run.task}</MetadataListItem>
          <MetadataListItem label="Mode">
            {RUN_MODE_LABELS[run.mode]} <Text type="supporting">(stored intent)</Text>
          </MetadataListItem>
          <MetadataListItem label="Phase">
            <Text type="code">{run.phase}</Text>
          </MetadataListItem>
          <MetadataListItem label="Limits">
            {formatDurationMs(run.limits.durationMs)} · {run.limits.modelCalls} model calls ·{' '}
            {run.limits.experiments} experiments
          </MetadataListItem>
          <MetadataListItem label="Timestamps">
            <VStack gap={0}>
              <Text>Created: {formatDateTime(run.createdAt)}</Text>
              <Text>Started: {formatDateTime(run.startedAt)}</Text>
              <Text>Finished: {formatDateTime(run.finishedAt)}</Text>
              {run.cancelRequestedAt && (
                <Text>Cancellation requested: {formatDateTime(run.cancelRequestedAt)}</Text>
              )}
            </VStack>
          </MetadataListItem>
          {run.errorMessage && (
            <MetadataListItem label="Error">
              <Text type="code">
                {run.errorCode ? `${run.errorCode}: ` : ''}
                {run.errorMessage}
              </Text>
            </MetadataListItem>
          )}
        </MetadataList>
      </Card>

      <RunWorkspace
        initialRun={run}
        initialEvents={events}
        initialNextAfter={nextAfter}
        initialExperiments={experiments}
        initialFindings={findings}
        initialTrialId={typeof trialParam === 'string' ? trialParam : null}
        initialRepair={initialRepair}
        repositoryPath={project?.repositoryPath ?? null}
      />

      <VStack gap={2}>
        <Heading level={2}>Run artifacts</Heading>
        {artifacts.length === 0 ? (
          <EmptyState
            title="Nothing here yet"
            description="Screenshots and recorded values will appear here once the run executes trials."
          />
        ) : (
          <Grid columns={{ minWidth: 300, max: 2 }} gap={4}>
            {artifacts.map((artifact) => (
              <Card key={artifact.id}>
                <VStack gap={2}>
                  {artifact.mimeType.startsWith('image/') ? (
                    <a href={`/api/artifacts/${artifact.id}`} target="_blank" rel="noreferrer">
                      {/* Plain img: artifact bytes are local evidence, not optimized assets. */}
                      <img
                        src={`/api/artifacts/${artifact.id}`}
                        alt={`${artifact.kind} evidence: ${artifact.relativePath}`}
                        className="aspect-video w-full rounded-md object-cover object-top"
                      />
                    </a>
                  ) : (
                    <Link
                      href={`/api/artifacts/${artifact.id}`}
                      target="_blank"
                      isStandalone
                    >
                      Open {artifact.kind} ({artifact.mimeType})
                    </Link>
                  )}
                  <Text type="code">
                    {artifact.kind} · {artifact.relativePath}
                  </Text>
                </VStack>
              </Card>
            ))}
          </Grid>
        )}
      </VStack>
    </VStack>
  );
}
