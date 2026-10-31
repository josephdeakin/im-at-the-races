import { Card } from '@astryxdesign/core/Card';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Grid } from '@astryxdesign/core/Grid';
import { Heading } from '@astryxdesign/core/Heading';
import { List, ListItem } from '@astryxdesign/core/List';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { getDb } from '@/lib/server/db';
import { listProjects } from '@races/db';
import { toProjectJson } from '@/lib/server/serializers';
import { formatDateTime } from '@/lib/format';
import { ProjectForm } from '@/components/ProjectForm';

export default async function ProjectsPage() {
  const db = getDb();
  const projects = listProjects(db).map(toProjectJson);

  return (
    <VStack gap={4}>
      <VStack gap={2}>
        <Heading level={1}>Projects</Heading>
        <Text type="supporting">
          A project points this tool at a local repository and the running app to investigate.
          Repository paths refer to the machine running this tool — the same machine serving
          this page — not the browser.
        </Text>
      </VStack>

      <Grid columns={{ minWidth: 340, max: 2 }} gap={4}>
        <ProjectForm />
        {projects.length === 0 ? (
          <EmptyState
            title="No projects yet"
            description="Create your first project to start queuing race-condition investigations. Projects are stored locally in the repository's .races directory."
          />
        ) : (
          <Card>
            <List hasDividers edge="bleed">
              {projects.map((project) => (
              <ListItem
                key={project.id}
                href={`/projects/${project.id}`}
                label={project.name}
                description={
                  <VStack gap={0}>
                    <Text type="code">{project.repositoryPath}</Text>
                    <Text type="code">{project.targetUrl}</Text>
                    <Text type="supporting">Created {formatDateTime(project.createdAt)}</Text>
                  </VStack>
                }
              />
              ))}
            </List>
          </Card>
        )}
      </Grid>
    </VStack>
  );
}
