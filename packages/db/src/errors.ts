/** Thrown by query helpers when a referenced row does not exist. */
export class NotFoundError extends Error {
  readonly resource: string;
  readonly id: string;

  constructor(
    resource:
      | 'project'
      | 'run'
      | 'event'
      | 'artifact'
      | 'experiment'
      | 'trial'
      | 'finding'
      | 'reproducer'
      | 'repair-attempt',
    id: string,
  ) {
    super(`${resource} not found: ${id}`);
    this.name = 'NotFoundError';
    this.resource = resource;
    this.id = id;
  }
}
