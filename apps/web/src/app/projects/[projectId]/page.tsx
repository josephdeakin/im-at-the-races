import { notFound } from 'next/navigation';
import { getProject, listRunsByProject } from '@races/db';
import { RUN_MODE_LABELS } from '@races/contracts';
import { Card } from '@astryxdesign/core/Card';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Grid } from '@astryxdesign/core/Grid';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Link } from '@astryxdesign/core/Link';
import { List, ListItem } from '@astryxdesign/core/List';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { getDb } from '@/lib/server/db';
import { toProjectJson, toRunJson } from '@/lib/server/serializers';
import { formatDateTime, shortId } from '@/lib/format';
import { RunForm } from '@/components/RunForm';
import { StatusBadge } from '@/components/StatusBadge';

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const db = getDb();
  const projectRow = getProject(db, projectId);
  if (!projectRow) notFound();
  const project = toProjectJson(projectRow);
  const runs = listRunsByProject(db, projectId).map(toRunJson);

  return (
    <VStack gap={4}>
      <VStack gap={2}>
        <Link href="/projects" isStandalone>
          ← All projects
        </Link>
        <Heading level={1}>{project.name}</Heading>
        <VStack gap={1}>
          <HStack gap={2}>
            <Text type="supporting">Repository:</Text>
            <Text type="code">{project.repositoryPath}</Text>
          </HStack>
          <HStack gap={2}>
            <Text type="supporting">Target:</Text>
            <Text type="code">{project.targetUrl}</Text>
          </HStack>
        </VStack>
      </VStack>

      <Grid columns={{ minWidth: 340, max: 2 }} gap={4}>
        <RunForm projectId={project.id} />
        <VStack gap={2}>
          <Heading level={2}>Previous runs</Heading>
          {runs.length === 0 ? (
            <EmptyState
              title="No runs yet"
              description="Create an investigation to queue the first run for this project. Runs persist in the local database."
            />
          ) : (
            <Card>
              <List hasDividers edge="bleed">
                {runs.map((run) => (
                  <ListItem
                    key={run.id}
                    href={`/runs/${run.id}`}
                    label={
                      <HStack gap={2}>
                        <StatusBadge status={run.status} />
                        <Text type="code">{shortId(run.id)}</Text>
                        <Text type="supporting">{formatDateTime(run.createdAt)}</Text>
                      </HStack>
                    }
                    description={
                      <VStack gap={0}>
                        <Text>{run.task}</Text>
                        <Text type="supporting">
                          {RUN_MODE_LABELS[run.mode]} · phase {run.phase}
                        </Text>
                      </VStack>
                    }
                  />
                ))}
              </List>
            </Card>
          )}
        </VStack>
      </Grid>
    </VStack>
  );
}
