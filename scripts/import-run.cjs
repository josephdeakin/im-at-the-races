// Import a run bundle (see export-run.cjs) into the RACES_DIR database,
// preserving every ID so the recorded run browses exactly as exported.
// Usage: RACES_DIR=/tmp/races-demo node scripts/import-run.cjs <bundleDir>
// Refuses to overwrite an existing run with the same ID.
const fs = require('node:fs');
const path = require('node:path');
const db = require('../packages/db/dist/index.js');

const [bundleDir] = process.argv.slice(2);
if (!bundleDir) {
  console.error('Usage: RACES_DIR=<dir> node scripts/import-run.cjs <bundleDir>');
  process.exit(1);
}
const racesDir = process.env.RACES_DIR;
if (!racesDir) {
  console.error('RACES_DIR is required.');
  process.exit(1);
}
const read = (name) => JSON.parse(fs.readFileSync(path.join(bundleDir, `${name}.json`), 'utf8'));
const manifest = read('manifest');
if (manifest.bundleVersion !== 1) {
  console.error(`Unsupported bundle version: ${manifest.bundleVersion}`);
  process.exit(1);
}

const handle = db.openDatabase(path.join(racesDir, 'races.db'));
db.migrate(handle.sqlite);
const existing = handle.sqlite.prepare('SELECT id FROM runs WHERE id = ?').get(manifest.runId);
if (existing) {
  console.error(`Run ${manifest.runId} already exists in ${racesDir}; refusing to overwrite.`);
  process.exit(1);
}

const bundle = {
  projects: [read('project')],
  runs: [read('run')],
  runEvents: read('events'),
  artifacts: read('artifacts'),
  experiments: read('experiments'),
  trials: read('trials'),
  findings: read('findings'),
  reproducers: read('reproducers'),
  repairAttempts: read('repairAttempts'),
  verificationChecks: read('verificationChecks'),
};

// Old bundles predate artifact size accounting; backfill from the files.
for (const artifact of bundle.artifacts) {
  if (artifact.size_bytes === undefined || artifact.size_bytes === null) {
    const file = path.join(bundleDir, 'files', artifact.relative_path);
    artifact.size_bytes = fs.existsSync(file) ? fs.statSync(file).size : 0;
  }
  if (artifact.sha256 === undefined || artifact.sha256 === null) artifact.sha256 = '';
}

const insertAll = handle.sqlite.transaction(() => {
  for (const [table, rows, columns] of [
    ['projects', bundle.projects, ['id', 'name', 'repository_path', 'target_url', 'created_at', 'updated_at']],
    ['runs', bundle.runs, ['id', 'project_id', 'task', 'mode', 'status', 'phase', 'limits', 'cancel_requested_at', 'created_at', 'started_at', 'finished_at', 'error_code', 'error_message']],
    ['run_events', bundle.runEvents, ['id', 'run_id', 'sequence', 'kind', 'payload', 'created_at']],
    ['artifacts', bundle.artifacts, ['id', 'run_id', 'kind', 'relative_path', 'mime_type', 'size_bytes', 'sha256', 'created_at']],
    ['experiments', bundle.experiments, ['id', 'run_id', 'name', 'hypothesis', 'plan', 'status', 'created_at', 'finished_at']],
    ['trials', bundle.trials, ['id', 'experiment_id', 'kind', 'outcome', 'detail', 'started_at', 'finished_at', 'attempt']],
    ['findings', bundle.findings, ['id', 'run_id', 'experiment_id', 'title', 'status', 'expectation_provenance', 'explanation', 'implicated_code', 'source_identity', 'created_at']],
    ['reproducers', bundle.reproducers, ['id', 'run_id', 'finding_id', 'experiment_id', 'bundle_path', 'test_hash', 'plan_hash', 'check_hash', 'check_id', 'created_at']],
    ['repair_attempts', bundle.repairAttempts, ['id', 'run_id', 'reproducer_id', 'attempt', 'workspace_path', 'source_identity', 'diff', 'status', 'created_at', 'finished_at']],
    ['verification_checks', bundle.verificationChecks, ['id', 'run_id', 'reproducer_id', 'repair_attempt_id', 'name', 'status', 'detail', 'created_at']],
  ]) {
    if (rows.length === 0) continue;
    const placeholders = columns.map(() => '?').join(', ');
    const stmt = handle.sqlite.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`);
    for (const row of rows) stmt.run(...columns.map((c) => row[c] ?? null));
  }
});
insertAll();

let filesCopied = 0;
for (const artifact of bundle.artifacts) {
  const src = path.join(bundleDir, 'files', artifact.relative_path);
  if (!fs.existsSync(src)) continue;
  const dest = path.join(racesDir, artifact.relative_path);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  filesCopied += 1;
}
handle.sqlite.close();
console.log(`Imported run ${manifest.runId} into ${racesDir}: ${bundle.runEvents.length} events, ${filesCopied} files.`);
