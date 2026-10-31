import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Link } from '@astryxdesign/core/Link';

export default function ProjectNotFound() {
  return (
    <EmptyState
      title="Project not found"
      description="It may have been deleted, or the ID in the URL is wrong."
      actions={
        <Link href="/projects" isStandalone>
          ← Back to projects
        </Link>
      }
    />
  );
}
