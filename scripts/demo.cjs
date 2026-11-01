// One-click guided demo: prepare the fixture target, start fixture + web +
// worker, queue the canonical investigate-repair run, and open the run page
// once the first finding lands. Everything it owns lives under /tmp.
//
// Usage:
//   pnpm demo                    # full guided demo (opens the run on finding)
//   pnpm demo -- --setup-only    # start + seed, print URL, do not wait/open
//   pnpm demo -- --no-open       # wait for the finding, print URL, do not open
//   pnpm demo -- --keep          # reuse existing demo dirs instead of wiping
//   pnpm demo -- --fixture odds  # race over WebSocket pushes instead of bank HTTP
//   pnpm demo:stop               # stop everything the demo started
const { spawn, spawnSync, execSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const strAfter = (name, fallback) => {
  const idx = args.indexOf(name);
  return idx >= 0 && typeof args[idx + 1] === 'string' ? args[idx + 1] : fallback;
};
const numAfter = (name, fallback) => {
  const idx = args.indexOf(name);
  const value = idx >= 0 ? Number(args[idx + 1]) : NaN;
  return Number.isInteger(value) && value > 0 && value < 65536 ? value : fallback;
};
const FIXTURES = {
  bank: {
    dir: 'stale-bank',
    fixturePort: 4100,
    webPort: 3100,
    commit: 'stale-bank fixture (demo target)',
    project: 'guided demo (stale-bank)',
    task:
      'The bank page may show a stale balance when transfer responses arrive out of ' +
      'order. Design and run an experiment that proves or disproves a stale-overwrite ' +
      'lost update on the balance display, then repair it.',
  },
  odds: {
    dir: 'stale-odds',
    fixturePort: 4130,
    webPort: 3130,
    commit: 'stale-odds fixture (demo target)',
    project: 'guided demo (stale-odds)',
    task:
      'The odds page shows a home-win price pushed over a WebSocket. Each Request ' +
      'update takes a push-delay in ms; the server versions pushes in arrival ' +
      'order. Design and run an experiment that proves or disproves a ' +
      'stale-overwrite race on the displayed odds using the delay control, then ' +
      'repair it.',
  },
};
const FIXTURE_NAME = strAfter('--fixture', 'bank');
const FIXTURE = FIXTURES[FIXTURE_NAME];
if (!FIXTURE) {
  console.error(`[demo] unknown --fixture ${FIXTURE_NAME}; want one of: ${Object.keys(FIXTURES).join(', ')}.`);
  process.exit(1);
}
const TARGET_DIR = `/tmp/races-demo-target-${FIXTURE_NAME}`;
const RACES_DIR = `/tmp/races-demo-live-${FIXTURE_NAME}`;
const FIXTURE_PORT = numAfter('--fixture-port', FIXTURE.fixturePort);
const WEB_PORT = numAfter('--web-port', FIXTURE.webPort);
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
const TARGET_URL = `http://127.0.0.1:${FIXTURE_PORT}/`;
const PIDS_FILE = path.join(RACES_DIR, 'demo-pids.json');
const LOG_DIR = path.join(RACES_DIR, 'logs');
const DEMO_TASK = FIXTURE.task;

const flag = (name) => args.includes(name);
if (flag('--help') || flag('-h')) {
  console.log('Usage: pnpm demo [-- --fixture bank|odds] [-- --setup-only] [-- --no-open] [-- --keep] [-- --timeout-mins N] [-- --fixture-port N] [-- --web-port N]');
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
  for (const entry of fs.readdirSync(path.join(ROOT, 'fixtures', FIXTURE.dir))) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    fs.cpSync(path.join(ROOT, 'fixtures', FIXTURE.dir, entry), path.join(TARGET_DIR, entry), {
      recursive: true,
    });
  }
  run('git init -q -b main .', { cwd: TARGET_DIR });
  run('git add -A', { cwd: TARGET_DIR });
  run(`git -c user.email=demo@local -c user.name=demo commit -qm "${FIXTURE.commit}"`, {
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
      name: FIXTURE.project,
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

  await waitFor(`${TARGET_URL}api/balance`, 60000, 'fixture');
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
  // Stacks are per-fixture; stop every stack that has a pids file.
  let stopped = 0;
  for (const name of Object.keys(FIXTURES)) {
    const pidsFile = path.join(`/tmp/races-demo-live-${name}`, 'demo-pids.json');
    if (!fs.existsSync(pidsFile)) continue;
    stopPids(JSON.parse(fs.readFileSync(pidsFile, 'utf8')));
    fs.rmSync(pidsFile, { force: true });
    stopped += 1;
  }
  log(stopped === 0 ? 'nothing to stop (no demo pids file).' : 'demo stopped. State stays under /tmp/races-demo-* for inspection.');
}

if (flag('--stop')) stop();
else start().catch((err) => die(String(err?.message ?? err)));
