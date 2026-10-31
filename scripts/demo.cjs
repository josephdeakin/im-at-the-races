// One-click guided demo: prepare the fixture target, start fixture + web +
// worker, queue the canonical investigate-repair run, and open the run page
// once the first finding lands. Everything it owns lives under /tmp.
//
// Usage:
//   pnpm demo                    # full guided demo (opens the run on finding)
//   pnpm demo -- --setup-only    # start + seed, print URL, do not wait/open
//   pnpm demo -- --no-open       # wait for the finding, print URL, do not open
//   pnpm demo -- --keep          # reuse existing demo dirs instead of wiping
//   pnpm demo:stop               # stop everything the demo started
const { spawn, spawnSync, execSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const TARGET_DIR = '/tmp/races-demo-target';
const RACES_DIR = '/tmp/races-demo-live';
const args = process.argv.slice(2);
const numAfter = (name, fallback) => {
  const idx = args.indexOf(name);
  const value = idx >= 0 ? Number(args[idx + 1]) : NaN;
  return Number.isInteger(value) && value > 0 && value < 65536 ? value : fallback;
};
const FIXTURE_PORT = numAfter('--fixture-port', 4100);
const WEB_PORT = numAfter('--web-port', 3100);
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
const TARGET_URL = `http://127.0.0.1:${FIXTURE_PORT}/`;
const PIDS_FILE = path.join(RACES_DIR, 'demo-pids.json');
const LOG_DIR = path.join(RACES_DIR, 'logs');
const DEMO_TASK =
  'The search page may show stale results when responses arrive out of order. ' +
  'Design and run an experiment that proves or disproves a stale-overwrite race ' +
  'on the search results, then repair it.';

const flag = (name) => args.includes(name);
if (flag('--help') || flag('-h')) {
  console.log('Usage: pnpm demo [-- --setup-only] [-- --no-open] [-- --keep] [-- --timeout-mins N] [-- --fixture-port N] [-- --web-port N]');
  console.log('       pnpm demo:stop');
  process.exit(0);
}
const FINDING_TIMEOUT_MS = numAfter('--timeout-mins', 20) * 60 * 1000;

const log = (msg) => console.log(`[demo] ${msg}`);
const die = (msg) => {
  console.error(`[demo] ${msg}`);
  process.exit(1);
};

function portBusy(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
  });
}

function run(cmd, opts = {}) {
  try {
    execSync(cmd, { cwd: ROOT, stdio: 'pipe', encoding: 'utf8', ...opts });
  } catch (err) {
    const tail = String(err.stdout ?? '') + String(err.stderr ?? '');
    die(`command failed: ${cmd}\n${tail.slice(-2000)}`);
  }
}

async function waitFor(url, timeoutMs, label) {
  const start = Date.now();
  for (;;) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (res.ok) return;
    } catch {
      // Not up yet.
    }
    if (Date.now() - start > timeoutMs) {
      die(`${label} did not answer at ${url} within ${Math.round(timeoutMs / 1000)}s. See ${LOG_DIR}/.`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function preflight() {
  if (!fs.existsSync(path.join(ROOT, 'node_modules'))) die('node_modules missing: run pnpm install first.');
  const envPath = path.join(ROOT, '.env');
  const env = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  if (!/^RACES_MODEL_API_KEY=\S+/m.test(env)) {
    die('root .env has no RACES_MODEL_API_KEY. Copy .env.example to .env and paste a key, then retry.');
  }
  for (const port of [FIXTURE_PORT, WEB_PORT]) {
    if (await portBusy(port)) die(`port ${port} is busy. Run pnpm demo:stop (or free the port) and retry.`);
  }
  log('preflight ok (deps, model key, ports, chromium check next)');
  const probe = spawnSync(
    'node',
    ['-e', 'require("./packages/core/node_modules/playwright").chromium.launch().then((b) => b.close())'],
    { cwd: ROOT, timeout: 60000, stdio: 'pipe', encoding: 'utf8' },
  );
  if (probe.status !== 0) {
    die(
      'Playwright chromium did not launch. Run: pnpm --filter @races/core exec playwright install chromium\n' +
        String(probe.stderr ?? '').slice(-500),
    );
  }
  log('chromium launches');
}

function prepareTarget() {
  if (flag('--keep') && fs.existsSync(path.join(TARGET_DIR, 'dist', 'index.html'))) {
    log(`reusing ${TARGET_DIR} (--keep)`);
    return;
  }
  log(`preparing fixture target at ${TARGET_DIR}`);
  fs.rmSync(TARGET_DIR, { recursive: true, force: true });
  fs.mkdirSync(TARGET_DIR, { recursive: true });
  for (const entry of fs.readdirSync(path.join(ROOT, 'fixtures', 'stale-search'))) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    fs.cpSync(path.join(ROOT, 'fixtures', 'stale-search', entry), path.join(TARGET_DIR, entry), {
      recursive: true,
    });
  }
  run('git init -q -b main .', { cwd: TARGET_DIR });
  run('git add -A', { cwd: TARGET_DIR });
  run('git -c user.email=demo@local -c user.name=demo commit -qm "stale-search fixture (demo target)"', {
    cwd: TARGET_DIR,
  });
  log('installing target dependencies (once; this takes a while)');
  run('pnpm install --silent', { cwd: TARGET_DIR });
  run('pnpm build', { cwd: TARGET_DIR });
  if (!fs.existsSync(path.join(TARGET_DIR, 'dist', 'index.html'))) die('target build produced no dist/index.html.');
}

function ensureToolBuild() {
  if (fs.existsSync(path.join(ROOT, 'apps', 'web', '.next', 'BUILD_ID'))) {
    log('reusing existing web build');
    return;
  }
  log('building packages + web + worker (once; this takes a while)');
  run('pnpm build');
}

function startDetached(name, cmd, cmdArgs, env, cwd = ROOT) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const logPath = path.join(LOG_DIR, `${name}.log`);
  const out = fs.openSync(logPath, 'a');
  const child = spawn(cmd, cmdArgs, {
    cwd,
    env: { ...process.env, ...env },
    detached: true,
    stdio: ['ignore', out, out],
  });
  child.unref();
  log(`${name} started (pid ${child.pid}, log ${logPath})`);
  return child.pid;
}

async function seed() {
  const projectRes = await fetch(`${WEB_URL}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'guided demo (stale-search)',
      repositoryPath: TARGET_DIR,
      targetUrl: TARGET_URL,
    }),
  });
  if (!projectRes.ok) die(`project seeding failed: HTTP ${projectRes.status}. See ${LOG_DIR}/web.log.`);
  const project = await projectRes.json();
  const runRes = await fetch(`${WEB_URL}/api/projects/${project.project.id}/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ task: DEMO_TASK, mode: 'investigate-repair' }),
  });
  if (!runRes.ok) die(`run queueing failed: HTTP ${runRes.status}. See ${LOG_DIR}/web.log.`);
  const queued = await runRes.json();
  return { projectId: project.project.id, runId: queued.runId };
}

async function waitForFinding(runId) {
  const url = `${WEB_URL}/runs/${runId}`;
  const start = Date.now();
  for (;;) {
    const [runRes, findingsRes] = await Promise.all([
      fetch(`${WEB_URL}/api/runs/${runId}`, { cache: 'no-store' }).catch(() => null),
      fetch(`${WEB_URL}/api/runs/${runId}/findings`, { cache: 'no-store' }).catch(() => null),
    ]);
    const run = runRes?.ok ? (await runRes.json()).run : null;
    const findings = findingsRes?.ok ? (await findingsRes.json()).findings : [];
    if (findings.length > 0) {
      log(`finding recorded: “${findings[0].title}” (${findings[0].status})`);
      return { url, terminal: false };
    }
    if (run && ['completed', 'failed', 'cancelled', 'interrupted'].includes(run.status)) {
      log(`run ended (${run.status}) before a finding landed. Open the run to see why.`);
      return { url, terminal: true };
    }
    if (Date.now() - start > FINDING_TIMEOUT_MS) {
      log('still waiting for a finding after the timeout; leaving everything running.');
      return { url, terminal: false };
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
}

function openBrowser(url) {
  if (flag('--no-open')) return;
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    spawnSync(opener, [url], { stdio: 'ignore', timeout: 15000 });
  } catch {
    // Opening is a courtesy; the URL below is the contract.
  }
}

async function start() {
  await preflight();
  if (!flag('--keep')) {
    fs.rmSync(RACES_DIR, { recursive: true, force: true });
    log(`fresh state at ${RACES_DIR}`);
  }
  fs.mkdirSync(RACES_DIR, { recursive: true });
  prepareTarget();
  ensureToolBuild();

  const pids = {};
  pids.fixture = startDetached(
    'fixture',
    'node',
    ['server.mjs'],
    { PORT: String(FIXTURE_PORT) },
    TARGET_DIR,
  );

  pids.web = startDetached('web', 'pnpm', ['--filter', 'web', 'start'], {
    RACES_DIR,
    PORT: String(WEB_PORT),
  });
  pids.worker = startDetached('worker', 'pnpm', ['--filter', 'worker', 'start'], { RACES_DIR });
  fs.writeFileSync(PIDS_FILE, JSON.stringify(pids, null, 2));

  await waitFor(`${TARGET_URL}api/search?q=smoke`, 60000, 'fixture');
  log(`fixture serving at ${TARGET_URL}`);
  await waitFor(`${WEB_URL}/api/projects`, 120000, 'web');
  log(`web serving at ${WEB_URL}`);

  const { runId } = await seed();
  const url = `${WEB_URL}/runs/${runId}`;
  console.log(`\n[demo] Run queued: ${url}\n`);

  if (flag('--setup-only')) {
    log('setup-only: leaving everything running. Stop with: pnpm demo:stop');
    return;
  }
  log('waiting for the first finding (the worker is investigating)…');
  await waitForFinding(runId);
  console.log(`\n[demo] Open the run: ${url}`);
  console.log('[demo] Stop everything with: pnpm demo:stop\n');
  openBrowser(url);
}

function stopPids(pids) {
  for (const [name, pid] of Object.entries(pids)) {
    // Detached children lead their own process group (pnpm wraps node), so
    // signal the group; fall back to the bare pid on Windows.
    try {
      process.kill(process.platform === 'win32' ? pid : -pid, 'SIGTERM');
      log(`stopped ${name} (pid ${pid})`);
    } catch {
      try {
        process.kill(pid, 'SIGTERM');
        log(`stopped ${name} (pid ${pid})`);
      } catch {
        // Already gone.
      }
    }
  }
}

function stop() {
  if (!fs.existsSync(PIDS_FILE)) {
    log('nothing to stop (no demo pids file).');
    return;
  }
  const pids = JSON.parse(fs.readFileSync(PIDS_FILE, 'utf8'));
  stopPids(pids);
  fs.rmSync(PIDS_FILE, { force: true });
  log('demo stopped. State stays under /tmp/races-demo-* for inspection.');
}

if (flag('--stop')) stop();
else start().catch((err) => die(String(err?.message ?? err)));
