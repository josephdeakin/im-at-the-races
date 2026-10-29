import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import type { CreateProjectInput } from '@races/contracts';
import type { DbOrTx } from '../client.js';
import { projects, type ProjectRow } from '../schema.js';

export function createProject(db: DbOrTx, input: CreateProjectInput): ProjectRow {
  const now = Date.now();
  const row = db
    .insert(projects)
    .values({
      id: randomUUID(),
      name: input.name,
      repositoryPath: input.repositoryPath,
      targetUrl: input.targetUrl,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  return row;
}

export function getProject(db: DbOrTx, id: string): ProjectRow | undefined {
  return db.select().from(projects).where(eq(projects.id, id)).get();
}

export function listProjects(db: DbOrTx): ProjectRow[] {
  return db.select().from(projects).orderBy(desc(projects.createdAt)).all();
}
