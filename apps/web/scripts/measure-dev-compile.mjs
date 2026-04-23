import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const projectRoot = process.cwd();
const DEFAULT_PORT_RANGE = [18080, 18089];
const args = process.argv.slice(2);

const readArg = (name, fallback = undefined) => {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
};

const hasFlag = (name) => args.includes(name);

const label = readArg('--label', 'baseline');
const timeoutMs = Number(readArg('--timeout-ms', '180000'));
const explicitPort = readArg('--port');
const outputDir = path.resolve(projectRoot, readArg('--out-dir', '.omx/reports/dev-compile'));
const cachePolicy = hasFlag('--cold') ? 'cold-dev-cache' : 'skip-clean';
const artifactTimestamp = new Date().toISOString().replace(/[:.]/g, '');
const safeLabel = String(label).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'run';
const artifactBase = path.join(outputDir, `${artifactTimestamp}-${safeLabel}`);
const logPath = `${artifactBase}.log`;
const jsonPath = `${artifactBase}.json`;

const nowMs = () => Number(process.hrtime.bigint() / 1_000_000n);

function parseDurationMs(value, unit) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return unit === 's' ? amount * 1000 : amount;
}

function parseRouteTiming(logText, route) {
  const escapedRoute = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const routeLinePattern = new RegExp(`(?:GET|HEAD)\\s+${escapedRoute}\\s+\\d+\\s+in\\s+([0-9.]+)(ms|s)(?:\\s+\\(next\\.js:\\s+([0-9.]+)(ms|s),\\s+application-code:\\s+([0-9.]+)(ms|s)\\))?`, 'g');
  const match = routeLinePattern.exec(logText);
  if (match) {
    return {
      total_ms: parseDurationMs(match[1], match[2]),
      next_ms: match[3] ? parseDurationMs(match[3], match[4]) : null,
      app_ms: match[5] ? parseDurationMs(match[5], match[6]) : null,
      line: match[0],
    };
  }
  return null;
}

async function canListen(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function choosePort() {
  if (explicitPort) {
    const port = Number(explicitPort);
    if (!Number.isInteger(port) || port <= 0) {
      throw new Error(`Invalid --port value: ${explicitPort}`);
    }
    return port;
  }

  for (let port = DEFAULT_PORT_RANGE[0]; port <= DEFAULT_PORT_RANGE[1]; port += 1) {
    if (await canListen(port)) return port;
  }
  throw new Error(`No free port in ${DEFAULT_PORT_RANGE[0]}..${DEFAULT_PORT_RANGE[1]}`);
}

async function timedFetch(url, { timeoutAt, label: requestLabel }) {
  const remainingMs = Math.max(0, timeoutAt - nowMs());
  if (remainingMs <= 0) {
    throw new Error(`${requestLabel} did not start before the benchmark timeout`);
  }

  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), remainingMs);
  const started = nowMs();
  try {
    const response = await fetch(url, { redirect: 'manual', signal: controller.signal });
    const text = await response.text().catch(() => '');
    return {
      status: response.status,
      ok: response.ok,
      elapsed_ms: nowMs() - started,
      bytes: text.length,
    };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`${requestLabel} did not complete within the remaining benchmark timeout (${remainingMs}ms)`);
    }
    throw error;
  } finally {
    clearTimeout(abortTimer);
  }
}

async function waitForReady({ getLog, processExited, timeoutAt }) {
  while (nowMs() < timeoutAt) {
    const log = getLog();
    const readyMatch = log.match(/(?:✓|\u2713) Ready in\s+([0-9.]+)(ms|s)/);
    if (readyMatch) {
      return parseDurationMs(readyMatch[1], readyMatch[2]);
    }
    if (processExited()) break;
    await delay(200);
  }
  return null;
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });

  if (hasFlag('--cold')) {
    fs.rmSync(path.join(projectRoot, '.next', 'dev'), { recursive: true, force: true });
  }

  const port = await choosePort();
  const command = [
    'node',
    'scripts/clean-next.mjs',
    '--skip-clean',
    '--',
    'node',
    'node_modules/next/dist/bin/next',
    'dev',
    '--port',
    String(port),
  ];

  const result = {
    run_started_at: new Date().toISOString(),
    cwd: projectRoot,
    command: command.join(' '),
    port,
    cache_policy: cachePolicy,
    label,
    ready_ms: null,
    first_health_ms: null,
    first_home_ms: null,
    first_home_next_ms: null,
    first_home_app_ms: null,
    warm_home_ms: null,
    first_script_ms: null,
    script_status: null,
    health_status: null,
    home_status: null,
    warm_home_status: null,
    slow_fs_warning: false,
    slow_fs_warning_text: null,
    raw_log_path: logPath,
    exit_code: null,
    exit_signal: null,
    errors: [],
  };

  const logChunks = [];
  const appendLog = (chunk) => {
    const text = chunk.toString();
    logChunks.push(text);
    fs.appendFileSync(logPath, text);
  };
  fs.writeFileSync(logPath, `$ ${command.join(' ')}\n`);

  const startedMs = nowMs();
  const timeoutAt = startedMs + timeoutMs;
  const useDetachedProcessGroup = process.platform !== 'win32';
  const child = spawn(command[0], command.slice(1), {
    cwd: projectRoot,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: useDetachedProcessGroup,
  });

  let exited = false;
  child.stdout.on('data', appendLog);
  child.stderr.on('data', appendLog);
  child.on('exit', (code, signal) => {
    exited = true;
    result.exit_code = code;
    result.exit_signal = signal;
  });

  const getLog = () => logChunks.join('');
  const signalChild = (signal) => {
    try {
      if (useDetachedProcessGroup) {
        process.kill(-child.pid, signal);
      } else {
        child.kill(signal);
      }
    } catch {
      // Process may already be gone.
    }
  };

  const stopChild = async () => {
    if (exited) return;
    signalChild('SIGTERM');
    for (let i = 0; i < 30 && !exited; i += 1) await delay(100);
    if (!exited) signalChild('SIGKILL');
  };

  try {
    result.ready_ms = await waitForReady({ getLog, processExited: () => exited, timeoutAt });
    if (result.ready_ms === null) {
      throw new Error(`Next dev did not become ready within ${timeoutMs}ms`);
    }

    const baseUrl = `http://127.0.0.1:${port}`;
    const health = await timedFetch(`${baseUrl}/api/health`, { timeoutAt, label: 'GET /api/health' });
    result.first_health_ms = health.elapsed_ms;
    result.health_status = health.status;

    const home = await timedFetch(`${baseUrl}/`, { timeoutAt, label: 'GET /' });
    result.first_home_ms = home.elapsed_ms;
    result.home_status = home.status;

    const script = await timedFetch(`${baseUrl}/scripts/viewport-height-fix.js`, { timeoutAt, label: 'GET /scripts/viewport-height-fix.js' });
    result.first_script_ms = script.elapsed_ms;
    result.script_status = script.status;

    const warmHome = await timedFetch(`${baseUrl}/`, { timeoutAt, label: 'warm GET /' });
    result.warm_home_ms = warmHome.elapsed_ms;
    result.warm_home_status = warmHome.status;

    await delay(500);
    const log = getLog();
    const homeTiming = parseRouteTiming(log, '/');
    if (homeTiming) {
      result.first_home_next_ms = homeTiming.next_ms;
      result.first_home_app_ms = homeTiming.app_ms;
      result.first_home_log_line = homeTiming.line;
    }

    const slowLine = log.split(/\r?\n/).find((line) => line.includes('Slow filesystem detected'));
    result.slow_fs_warning = Boolean(slowLine);
    result.slow_fs_warning_text = slowLine ?? null;

    if (!health.ok) result.errors.push(`/api/health returned ${health.status}`);
    if (!home.ok) result.errors.push(`/ returned ${home.status}`);
    if (!script.ok) result.errors.push(`/scripts/viewport-height-fix.js returned ${script.status}`);
    if (!warmHome.ok) result.errors.push(`warm / returned ${warmHome.status}`);
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    await stopChild();
    await delay(100);
    fs.writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`);
  }

  console.log(JSON.stringify({ jsonPath, logPath, result }, null, 2));
  if (result.errors.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
