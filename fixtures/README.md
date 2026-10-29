# Fixtures

No fixtures are checked in yet.

The foundation task expected a pre-existing seeded "stale-search" app to
preserve and relocate under `fixtures/stale-search`, but the repository
contained only a README when the foundation was built, so there was nothing
to move and no fixture verification commands to keep working. The workspace
glob in `pnpm-workspace.yaml` already includes `fixtures/*`, so adding
`fixtures/stale-search` later needs no workspace changes.
