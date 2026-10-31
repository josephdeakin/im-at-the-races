// Export one run (records + artifact bytes + manifest) into a portable bundle.
// Usage: RACES_DIR=/tmp/races-m5 node scripts/export-run.cjs <runId> <outDir>
// Reads with raw SQL so it tolerates databases from earlier milestones.
const fs = require('node:fs');
const path = require('node:path');
const db = require('../packages/db/dist/index.js');

const [runId, outDir] = process.argv.slice(2);
if (!runId || !outDir) {
  console.error('Usage: RACES_DIR=<dir> node scripts/export-run.cjs <runId> <outDir>');
  process.exit(1);
}
const racesDir = process.env.RACES_DIR;
if (!racesDir) {
  console.error('RACES_DIR is required.');
  process.exit(1);
}

const handle = db.openDatabase(path.join(racesDir, 'races.db'));
const all = (sql, ...params) => handle.sqlite.prepare(sql).all(...params);
const one = (sql, ...params) => handle.sqlite.prepare(sql).get(...params);

// One snapshot transaction: a live worker cannot tear the bundle mid-read.
const readBundle = handle.sqlite.transaction(() => {
  const run = one('SELECT * FROM runs WHERE id = ?', runId);
  if (!run) return null;
  const bundle = {
    run,
    project: one('SELECT * FROM projects WHERE id = ?', run.project_id),
    events: all('SELECT * FROM run_events WHERE run_id = ? ORDER BY sequence', runId),
    artifacts: all('SELECT * FROM artifacts WHERE run_id = ? ORDER BY created_at', runId),
    experiments: all('SELECT * FROM experiments WHERE run_id = ? ORDER BY created_at', runId),
    trials: [],
    findings: all('SELECT * FROM findings WHERE run_id = ? ORDER BY created_at', runId),
    reproducers: [],
    repairAttempts: [],
    verificationChecks: [],
  };
  const tables = new Set(handle.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((t) => t.name));
  for (const exp of bundle.experiments) {
    bundle.trials.push(...all('SELECT * FROM trials WHERE experiment_id = ? ORDER BY started_at, id', exp.id));
  }
  if (tables.has('reproducers')) bundle.reproducers = all('SELECT * FROM reproducers WHERE run_id = ? ORDER BY created_at', runId);
  if (tables.has('repair_attempts')) bundle.repairAttempts = all('SELECT * FROM repair_attempts WHERE run_id = ? ORDER BY attempt', runId);
  if (tables.has('verification_checks')) bundle.verificationChecks = all('SELECT * FROM verification_checks WHERE run_id = ? ORDER BY created_at', runId);
  return bundle;
});
const bundle = readBundle();
if (!bundle) {
  console.error(`Run not found: ${runId}`);
  process.exit(1);
}
const hasColumn = (table, column) =>
  handle.sqlite.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);

// Build beside the target and rename into place: no partial bundles.
const tmpDir = `${outDir}.tmp-${process.pid}`;
fs.rmSync(tmpDir, { recursive: true, force: true });
fs.mkdirSync(tmpDir, { recursive: true });
try {
  for (const [name, rows] of Object.entries(bundle)) {
    fs.writeFileSync(path.join(tmpDir, `${name}.json`), JSON.stringify(rows, null, 2));
  }
  let filesCopied = 0;
  const missingFiles = [];
  for (const artifact of bundle.artifacts) {
    const src = path.join(racesDir, artifact.relative_path);
    const dest = path.join(tmpDir, 'files', artifact.relative_path);
    if (!fs.existsSync(src)) {
      missingFiles.push(artifact.relative_path);
      continue;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    filesCopied += 1;
  }
  const manifest = {
    bundleVersion: 1,
    exportedAt: new Date().toISOString(),
    runId,
    sourceIdentity: bundle.findings[0]?.source_identity ?? null,
    artifactSizeAccounting: hasColumn('artifacts', 'size_bytes'),
    counts: Object.fromEntries(Object.entries(bundle).map(([k, v]) => [k, Array.isArray(v) ? v.length : 1])),
    filesCopied,
    missingFiles,
    toolVersions: {
      node: process.version,
      imAtTheRaces: require('../package.json').version,
    },
  };
  fs.writeFileSync(path.join(tmpDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.renameSync(tmpDir, outDir);
  console.log(`Exported run ${runId} to ${outDir}: ${bundle.events.length} events, ${filesCopied} files${missingFiles.length > 0 ? `, ${missingFiles.length} missing` : ''}.`);
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  handle.sqlite.close();
}
