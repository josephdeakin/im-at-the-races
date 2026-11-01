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
import { Heading } from '@astryxdesign/core/Heading';
import { Link } from '@astryxdesign/core/Link';
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

      <RunWorkspace
        initialRun={run}
        initialEvents={events}
        initialNextAfter={nextAfter}
        initialExperiments={experiments}
        initialFindings={findings}
        initialTrialId={typeof trialParam === 'string' ? trialParam : null}
        initialRepair={initialRepair}
        initialArtifacts={artifacts.map(toArtifactJson)}
        repositoryPath={project?.repositoryPath ?? null}
      />
    </VStack>
  );
}
