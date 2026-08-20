import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { resolveLocalDevDistDir } from './local-dev-dist-dir.mjs';
import { logCliError, redactCliText } from './privacy-safe-cli-log.mjs';

const projectRoot = process.cwd();
const args = process.argv.slice(2);
const DEFAULT_PORT_RANGE = [18100, 18129];

const readArg = (name, fallback = undefined) => {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
};
const readArgs = (name) => args.flatMap((arg, index) => (arg === name && args[index + 1] ? [args[index + 1]] : []));
const hasFlag = (name) => args.includes(name);

const label = readArg('--label', 'routes');
const mode = readArg('--mode', 'pages');
const order = readArg('--order', 'default');
const explicitPort = readArg('--port');
const outputDir = path.resolve(projectRoot, readArg('--out-dir', '.omx/reports/dev-compile'));
const requestedRoutes = readArgs('--route');
const includeWarm = !hasFlag('--no-warm');
const cold = hasFlag('--cold');
const trace = hasFlag('--trace');
const failOnHttpError = !hasFlag('--allow-http-errors');
const measurementMode = readArg('--measurement-mode', cold ? 'clean-cold' : 'persistent-cache-restart');
const statusError = (code) => Object.assign(new Error(code), { code });

function parsePositiveIntegerArg(name, fallback) {
  const raw = readArg(name, String(fallback));
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    return null;
  }
  return value;
}

const timeoutMs = parsePositiveIntegerArg('--timeout-ms', 240000);
const routeTimeoutMs = parsePositiveIntegerArg('--route-timeout-ms', 180000);
const retries = parsePositiveIntegerArg('--retries', 1);
const retryDelayMs = parsePositiveIntegerArg('--retry-delay-ms', 1000);
const repeat = parsePositiveIntegerArg('--repeat', 1);

const artifactTimestamp = new Date().toISOString().replace(/[:.]/g, '');
const safeLabel = redactCliText(String(label), 120).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'routes';
const artifactBase = path.join(outputDir, `${artifactTimestamp}-${safeLabel}`);
const logPath = `${artifactBase}.log`;
const jsonPath = `${artifactBase}.json`;
const csvPath = `${artifactBase}.csv`;
const mdPath = `${artifactBase}.md`;

const nowMs = () => Number(process.hrtime.bigint() / 1_000_000n);
const posix = (value) => value.split(path.sep).join('/');

function routeFromAppFile(filePath, kind) {
  const rel = posix(path.relative(path.join(projectRoot, 'app'), filePath));
  const parts = rel.split('/').slice(0, -1);
  let route = `/${parts.join('/')}`;
  if (route !== '/') route = route.replace(/\/$/, '');
  if (kind === 'page') {
    route = route.replace('[code]', 'measure-code').replace('[userId]', 'measure-user');
  }
  if (kind === 'route') {
    route = route.replace('[videoId]', 'measure-video').replace('[provider]', 'measure-provider');
  }
  return route;
}

function walkFiles(dir, fileName, found = []) {
  if (!fs.existsSync(dir)) return found;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, fileName, found);
    if (entry.isFile() && entry.name === fileName) found.push(full);
  }
  return found;
}

function discoverRoutes() {
  const pageRoutes = walkFiles(path.join(projectRoot, 'app'), 'page.tsx')
    .map((source) => ({ kind: 'page', route: routeFromAppFile(source, 'page'), source: posix(path.relative(projectRoot, source)) }));
  const apiRoutes = walkFiles(path.join(projectRoot, 'app'), 'route.ts')
    .map((source) => ({ kind: 'route', route: routeFromAppFile(source, 'route'), source: posix(path.relative(projectRoot, source)) }));

  const routes = mode === 'all' ? [...pageRoutes, ...apiRoutes] : mode === 'api' ? apiRoutes : pageRoutes;
  let selected = requestedRoutes.length > 0
    ? requestedRoutes.map((route) => routes.find((item) => item.route === route) ?? { kind: route.startsWith('/api/') || route.startsWith('/auth/') ? 'route' : 'page', route, source: '<manual>' })
    : routes.sort((a, b) => a.route.localeCompare(b.route));

  if (order === 'reverse') selected = selected.toReversed();
  if (order === 'home-first') selected = [...selected].sort((a, b) => Number(b.route === '/') - Number(a.route === '/'));
  if (order === 'mypage-first') selected = [...selected].sort((a, b) => Number(b.route === '/mypage') - Number(a.route === '/mypage'));
  if (order === 'submissions-first') selected = [...selected].sort((a, b) => Number(b.route === '/submissions') - Number(a.route === '/submissions'));
  if (order === 'admin-first') selected = [...selected].sort((a, b) => Number(b.route.startsWith('/admin/')) - Number(a.route.startsWith('/admin/')) || a.route.localeCompare(b.route));

  return selected;
}

function parseDurationMs(value, unit) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return unit === 's' ? amount * 1000 : amount;
}

function parseRouteTiming(logText, route) {
  const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?:GET|HEAD)\\s+${escaped}\\s+\\d+\\s+in\\s+([0-9.]+)(ms|s)(?:\\s+\\(next\\.js:\\s+([0-9.]+)(ms|s)(?:,\\s+proxy\\.ts:\\s+([0-9.]+)(ms|s))?,\\s+application-code:\\s+([0-9.]+)(ms|s)\\))?`, 'g');
  let match;
  let latest = null;
  while ((match = pattern.exec(logText))) {
    latest = {
      total_ms: parseDurationMs(match[1], match[2]),
      next_ms: match[3] ? parseDurationMs(match[3], match[4]) : null,
      proxy_ms: match[5] ? parseDurationMs(match[5], match[6]) : null,
      app_ms: match[7] ? parseDurationMs(match[7], match[8]) : null,
      line: match[0],
    };
  }
  return latest;
}

async function canListen(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

async function choosePort() {
  if (explicitPort) {
    const port = Number(explicitPort);
    if (!Number.isInteger(port) || port <= 0) {
      throw statusError('DEV_ROUTE_INVALID_PORT');
    }
    return port;
  }
  for (let port = DEFAULT_PORT_RANGE[0]; port <= DEFAULT_PORT_RANGE[1]; port += 1) {
    if (await canListen(port)) return port;
  }
  throw statusError('DEV_ROUTE_NO_FREE_PORT');
}

async function waitForReady({ getLog, processExited, timeoutAt }) {
  while (nowMs() < timeoutAt) {
    const match = getLog().match(/(?:✓|\u2713) Ready in\s+([0-9.]+)(ms|s)/);
    if (match) return parseDurationMs(match[1], match[2]);
    if (processExited()) break;
    await delay(200);
  }
  return null;
}

function shouldRetryRequest(result) {
  return result.status === 0 || result.status >= 500;
}

async function timedFetch(url) {
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), routeTimeoutMs);
  const started = nowMs();
  try {
    const response = await fetch(url, { redirect: 'manual', signal: controller.signal });
    const text = await response.text().catch(() => '');
    return { status: response.status, ok: response.ok, elapsed_ms: nowMs() - started, bytes: text.length, error: null };
  } catch {
    return {
      status: 0,
      ok: false,
      elapsed_ms: nowMs() - started,
      bytes: 0,
      error: controller.signal.aborted
        ? 'DEV_ROUTE_REQUEST_TIMEOUT'
        : 'DEV_ROUTE_REQUEST_FAILED',
    };
  } finally {
    clearTimeout(abortTimer);
  }
}

async function timedFetchWithRetries(url) {
  const attempts = [];
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const result = await timedFetch(url);
    attempts.push({ ...result, attempt: attempt + 1 });
    if (!shouldRetryRequest(result) || attempt === retries) break;
    await delay(retryDelayMs);
  }
  const final = attempts.at(-1);
  return {
    ...final,
    attempts,
    retry_count: attempts.length - 1,
  };
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function summarize(values) {
  const sorted = values.filter(Number.isFinite).toSorted((a, b) => a - b);
  if (sorted.length === 0) {
    return { count: 0, min_ms: null, p25_ms: null, median_ms: null, p75_ms: null, max_ms: null, mean_ms: null, mad_ms: null, stddev_ms: null, cv: null };
  }
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const median = percentile(sorted, 0.5);
  const deviations = sorted.map((value) => Math.abs(value - median)).toSorted((a, b) => a - b);
  const variance = sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / sorted.length;
  return {
    count: sorted.length,
    min_ms: sorted[0],
    p25_ms: percentile(sorted, 0.25),
    median_ms: median,
    p75_ms: percentile(sorted, 0.75),
    max_ms: sorted.at(-1),
    mean_ms: mean,
    mad_ms: percentile(deviations, 0.5),
    stddev_ms: Math.sqrt(variance),
    cv: mean === 0 ? null : Math.sqrt(variance) / mean,
  };
}

function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }
  return map;
}

function buildSummaries(requests, iterations) {
  const byRound = {};
  for (const [round, rows] of groupBy(requests, (row) => row.round)) {
    byRound[round] = summarize(rows.map((row) => row.elapsed_ms));
  }
  const byRoute = {};
  for (const [route, rows] of groupBy(requests, (row) => row.route)) {
    byRoute[route] = {
      elapsed_ms: summarize(rows.map((row) => row.elapsed_ms)),
      log_total_ms: summarize(rows.map((row) => row.log_total_ms)),
      log_next_ms: summarize(rows.map((row) => row.log_next_ms)),
      log_proxy_ms: summarize(rows.map((row) => row.log_proxy_ms)),
      log_app_ms: summarize(rows.map((row) => row.log_app_ms)),
    };
  }
  return {
    ready_ms: summarize(iterations.map((iteration) => iteration.ready_ms)),
    by_round: byRound,
    by_route: byRoute,
  };
}

function directorySizeBytes(targetPath) {
  if (!fs.existsSync(targetPath)) return 0;
  let total = 0;
  const stack = [targetPath];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      try {
        if (entry.isDirectory()) stack.push(full);
        else if (entry.isFile()) total += fs.statSync(full).size;
      } catch {}
    }
  }
  return total;
}

function commandOutput(command, commandArgs) {
  try {
    return execFileSync(command, commandArgs, { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function detectMountInfo() {
  const mounts = fs.existsSync('/proc/mounts') ? fs.readFileSync('/proc/mounts', 'utf8').split('\n') : [];
  const normalizedRoot = path.resolve(projectRoot);
  let best = null;
  for (const line of mounts) {
    const [device, mountPoint, type] = line.split(' ');
    if (!mountPoint) continue;
    const decodedMountPoint = mountPoint.replace(/\\040/g, ' ');
    if (normalizedRoot === decodedMountPoint || normalizedRoot.startsWith(`${decodedMountPoint.replace(/\/$/, '')}/`)) {
      if (!best || decodedMountPoint.length > best.mount_point.length) {
        best = { device, mount_point: decodedMountPoint, type };
      }
    }
  }
  return best;
}


async function removeNextCacheForColdIteration(nextDistDir) {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      fs.rmSync(nextDistDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
      return;
    } catch {
      if (attempt === 6) throw statusError('DEV_ROUTE_CACHE_CLEAR_FAILED');
      await delay(250 * attempt);
    }
  }
}

function collectEnvironmentSnapshot(stage, nextDistDir) {
  const diskLine = redactCliText(
    commandOutput('df', ['-Pk', projectRoot])?.split('\n').at(-1) ?? '',
    512,
  );
  const processLines = commandOutput('pgrep', ['-af', 'next dev|measure-dev-routes|node_modules/next/dist/bin/next|bun'])
    ?.split('\n')
    .filter(Boolean)
    .filter((line) => !line.includes('pgrep -af')) ?? [];
  return {
    stage,
    timestamp: new Date().toISOString(),
    platform: process.platform,
    release: os.release(),
    cpus: os.cpus().length,
    loadavg: os.loadavg(),
    free_memory_bytes: os.freemem(),
    total_memory_bytes: os.totalmem(),
    cwd: projectRoot,
    next_dist_dir: path.relative(projectRoot, nextDistDir),
    mount: detectMountInfo(),
    disk_df_pk: diskLine,
    next_dir_size_bytes: directorySizeBytes(nextDistDir),
    process_count_matching_next_node_bun: processLines.length,
    trace_enabled: trace,
    measurement_mode: measurementMode,
  };
}

function formatSeconds(value) {
  return value === null || value === undefined || !Number.isFinite(value) ? '?' : `${(value / 1000).toFixed(3)}s`;
}

function formatPercent(value) {
  return value === null || value === undefined || !Number.isFinite(value) ? '?' : `${(value * 100).toFixed(1)}%`;
}

function classifyVariability(summary) {
  if (!summary || summary.count < 3) return 'insufficient-repeat';
  if (!Number.isFinite(summary.cv)) return 'unknown';
  if (summary.cv <= 0.15) return 'stable';
  if (summary.cv <= 0.35) return 'moderate-noise';
  return 'high-noise';
}

function writeArtifacts(result) {
  result.summaries = buildSummaries(result.requests, result.iterations);
  fs.writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`);
  const csvCell = (value) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const rows = ['iteration,round,route,kind,source,status,ok,retry_count,elapsed_ms,log_total_ms,log_next_ms,log_proxy_ms,log_app_ms,bytes,error'];
  for (const row of result.requests) {
    rows.push([
      row.iteration,
      row.round,
      row.route,
      row.kind,
      row.source,
      row.status,
      row.ok,
      row.retry_count ?? 0,
      row.elapsed_ms,
      row.log_total_ms ?? '',
      row.log_next_ms ?? '',
      row.log_proxy_ms ?? '',
      row.log_app_ms ?? '',
      row.bytes,
      row.error ?? '',
    ].map(csvCell).join(','));
  }
  fs.writeFileSync(csvPath, `${rows.join('\n')}\n`);

  const lines = [];
  lines.push(`# Dev route compile measurement: ${safeLabel}`);
  lines.push('');
  lines.push(`- started: ${result.run_started_at}`);
  lines.push(`- cwd: ${result.cwd}`);
  lines.push(`- command: \`${result.command}\``);
  lines.push(`- mode/order: ${mode}/${order}`);
  lines.push(`- measurement_mode: ${measurementMode}`);
  lines.push(`- repeat: ${result.repeat}`);
  lines.push(`- port: ${result.port}`);
  lines.push(`- ready median/p75: ${formatSeconds(result.summaries.ready_ms.median_ms)} / ${formatSeconds(result.summaries.ready_ms.p75_ms)}`);
  lines.push(`- trace: ${trace ? 'enabled' : 'disabled'}`);
  lines.push(`- fail_on_http_error: ${result.fail_on_http_error ? 'enabled' : 'disabled'}`);
  lines.push(`- retries: ${result.retries}`);
  lines.push(`- log: \`${logPath}\``);
  lines.push(`- csv: \`${csvPath}\``);
  lines.push(`- json: \`${jsonPath}\``);
  lines.push('');

  lines.push('## Environment snapshot');
  const env = result.iterations[0]?.environment_before ?? result.environment_start;
  lines.push(`- platform/release: ${env.platform} ${env.release}`);
  lines.push(`- cpus: ${env.cpus}`);
  lines.push(`- loadavg: ${env.loadavg.map((value) => value.toFixed(2)).join(', ')}`);
  lines.push(`- memory free/total: ${(env.free_memory_bytes / 1024 / 1024).toFixed(0)}MiB / ${(env.total_memory_bytes / 1024 / 1024).toFixed(0)}MiB`);
  lines.push(`- mount: ${env.mount ? `${env.mount.mount_point} (${env.mount.type})` : 'unknown'}`);
  lines.push(`- disk: ${env.disk_df_pk ?? 'unknown'}`);
  lines.push(`- effective Next dist dir: \`${env.next_dist_dir}\``);
  lines.push(`- effective Next dist size before first measured iteration: ${(env.next_dir_size_bytes / 1024 / 1024).toFixed(1)}MiB`);
  lines.push(`- matching next/node/bun processes at start: ${env.process_count_matching_next_node_bun}`);
  lines.push('- interpretation: compare medians and p75s across repeated runs; treat single-run or high-CV results as noisy local evidence, not an absolute performance claim.');
  lines.push('');

  for (const [round, summary] of Object.entries(result.summaries.by_round)) {
    lines.push(`## ${round}`);
    lines.push(`- count: ${summary.count}`);
    lines.push(`- median: ${formatSeconds(summary.median_ms)}`);
    lines.push(`- p75: ${formatSeconds(summary.p75_ms)}`);
    lines.push(`- max: ${formatSeconds(summary.max_ms)}`);
    lines.push(`- min: ${formatSeconds(summary.min_ms)}`);
    lines.push(`- MAD: ${formatSeconds(summary.mad_ms)}`);
    lines.push('');
  }

  lines.push('## Route summary');
  lines.push('| route | count | median | p75 | min | max | MAD | CV | variability | median next/app | source |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|');
  const sourceByRoute = new Map(result.routes.map((route) => [route.route, route.source]));
  for (const [route, summaries] of Object.entries(result.summaries.by_route).sort((a, b) => (b[1].elapsed_ms.p75_ms ?? 0) - (a[1].elapsed_ms.p75_ms ?? 0))) {
    const elapsed = summaries.elapsed_ms;
    const nextApp = `${formatSeconds(summaries.log_next_ms.median_ms)}/${formatSeconds(summaries.log_app_ms.median_ms)}`;
    lines.push(`| \`${route}\` | ${elapsed.count} | ${formatSeconds(elapsed.median_ms)} | ${formatSeconds(elapsed.p75_ms)} | ${formatSeconds(elapsed.min_ms)} | ${formatSeconds(elapsed.max_ms)} | ${formatSeconds(elapsed.mad_ms)} | ${formatPercent(elapsed.cv)} | ${classifyVariability(elapsed)} | ${nextApp} | \`${sourceByRoute.get(route) ?? '<manual>'}\` |`);
  }
  lines.push('');

  lines.push('## Slowest individual requests');
  lines.push('| iteration | round | route | status | retry | seconds | log next/app | source |');
  lines.push('|---:|---|---|---:|---:|---:|---:|---|');
  for (const row of result.requests.toSorted((a, b) => b.elapsed_ms - a.elapsed_ms).slice(0, 40)) {
    const logParts = row.log_next_ms === null || row.log_next_ms === undefined ? '' : `${formatSeconds(row.log_next_ms)}/${formatSeconds(row.log_app_ms)}`;
    lines.push(`| ${row.iteration} | ${row.round} | \`${row.route}\` | ${row.status} | ${row.retry_count ?? 0} | ${(row.elapsed_ms / 1000).toFixed(3)} | ${logParts} | \`${row.source}\` |`);
  }
  lines.push('');

  lines.push('## Error-like dev log lines');
  if (result.error_like_lines.length === 0) {
    lines.push('- none');
  } else {
    for (const line of result.error_like_lines.slice(0, 40)) lines.push(`- \`${line.slice(0, 180)}\``);
  }
  fs.writeFileSync(mdPath, `${lines.join('\n')}\n`);
}

async function runIteration({ iteration, routes, port, command, env, nextDistDir, result }) {
  if (cold) await removeNextCacheForColdIteration(nextDistDir);

  const iterationResult = {
    iteration,
    started_at: new Date().toISOString(),
    ready_ms: null,
    environment_before: collectEnvironmentSnapshot(`iteration-${iteration}-before`, nextDistDir),
    environment_after: null,
    exit_code: null,
    exit_signal: null,
  };
  result.iterations.push(iterationResult);

  fs.appendFileSync(logPath, `\n## iteration ${iteration}/${repeat}\n$ ${trace ? 'NEXT_TURBOPACK_TRACING=1 ' : ''}${command.join(' ')}\n`);
  const logChunks = [];
  const appendLog = (chunk) => {
    const text = chunk.toString();
    logChunks.push(text);
    fs.appendFileSync(logPath, redactCliText(text, 1_024));
  };
  const useDetachedProcessGroup = process.platform !== 'win32';
  const child = spawn(command[0], command.slice(1), { cwd: projectRoot, env, stdio: ['ignore', 'pipe', 'pipe'], detached: useDetachedProcessGroup });
  let exited = false;
  child.stdout.on('data', appendLog);
  child.stderr.on('data', appendLog);
  child.on('exit', (code, signal) => {
    exited = true;
    iterationResult.exit_code = code;
    iterationResult.exit_signal = signal;
  });
  child.on('error', () => {
    exited = true;
    result.errors.push('DEV_ROUTE_CHILD_PROCESS_ERROR');
  });
  const getLog = () => logChunks.join('');
  const stopChild = async () => {
    if (exited) return;
    try {
      if (useDetachedProcessGroup) process.kill(-child.pid, 'SIGTERM');
      else child.kill('SIGTERM');
    } catch {}
    for (let i = 0; i < 30 && !exited; i += 1) await delay(100);
    if (!exited) {
      try {
        if (useDetachedProcessGroup) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {}
    }
  };

  try {
    const timeoutAt = nowMs() + timeoutMs;
    iterationResult.ready_ms = await waitForReady({ getLog, processExited: () => exited, timeoutAt });
    if (result.ready_ms === null) result.ready_ms = iterationResult.ready_ms;
    if (iterationResult.ready_ms === null) throw statusError('DEV_ROUTE_READY_TIMEOUT');
    const baseUrl = `http://127.0.0.1:${port}`;
    for (const round of ['coldish', ...(includeWarm ? ['warm'] : [])]) {
      for (const route of routes) {
        const request = await timedFetchWithRetries(`${baseUrl}${route.route}`);
        await delay(50);
        const timing = parseRouteTiming(getLog(), route.route);
        result.requests.push({
          iteration,
          round,
          route: route.route,
          kind: route.kind,
          source: route.source,
          status: request.status,
          elapsed_ms: request.elapsed_ms,
          bytes: request.bytes,
          ok: request.ok,
          error: request.error,
          retry_count: request.retry_count,
          attempts: request.attempts,
          log_total_ms: timing?.total_ms ?? null,
          log_next_ms: timing?.next_ms ?? null,
          log_proxy_ms: timing?.proxy_ms ?? null,
          log_app_ms: timing?.app_ms ?? null,
          log_line: timing ? redactCliText(timing.line, 512) : null,
        });
      }
    }
    await delay(500);
  } catch {
    result.errors.push('DEV_ROUTE_ITERATION_FAILED');
  } finally {
    await stopChild();
    await delay(150);
    iterationResult.environment_after = collectEnvironmentSnapshot(`iteration-${iteration}-after`, nextDistDir);
    const log = getLog();
    result.error_like_lines.push(
      ...log
        .split(/\r?\n/)
        .filter((line) => /Error:|Failed|Module not found|uncaught|panic/i.test(line)
          && !/terminated by signal SIGTERM/.test(line))
        .map((line) => redactCliText(line, 180)),
    );
  }
}

async function main() {
  if (![timeoutMs, routeTimeoutMs, retries, retryDelayMs, repeat].every(Number.isInteger)) {
    throw statusError('DEV_ROUTE_INVALID_POSITIVE_INTEGER');
  }
  fs.mkdirSync(outputDir, { recursive: true });

  const routes = discoverRoutes();
  const port = await choosePort();
  const nextDistDir = resolveLocalDevDistDir(projectRoot, port);
  const command = ['node', 'scripts/run-local-dev.mjs', '--port', String(port)];
  const env = { ...process.env };
  if (trace) env.NEXT_TURBOPACK_TRACING = '1';

  const result = {
    run_started_at: new Date().toISOString(),
    cwd: projectRoot,
    command: command.join(' '),
    mode,
    order,
    measurement_mode: measurementMode,
    port,
    next_dist_dir: path.relative(projectRoot, nextDistDir),
    cold,
    trace,
    repeat,
    fail_on_http_error: failOnHttpError,
    retries,
    retry_delay_ms: retryDelayMs,
    ready_ms: null,
    routes,
    iterations: [],
    requests: [],
    summaries: null,
    environment_start: collectEnvironmentSnapshot('run-start', nextDistDir),
    environment_end: null,
    error_like_lines: [],
    raw_log_path: logPath,
    csv_path: csvPath,
    markdown_path: mdPath,
    json_path: jsonPath,
    exit_code: null,
    exit_signal: null,
    errors: [],
  };

  fs.writeFileSync(logPath, '');
  for (let iteration = 1; iteration <= repeat; iteration += 1) {
    await runIteration({ iteration, routes, port, command, env, nextDistDir, result });
  }
  result.environment_end = collectEnvironmentSnapshot('run-end', nextDistDir);
  result.exit_code = result.iterations.at(-1)?.exit_code ?? null;
  result.exit_signal = result.iterations.at(-1)?.exit_signal ?? null;

  const failedRequests = result.requests.filter((row) => row.status === 0 || (failOnHttpError && !row.ok));
  if (failedRequests.length > 0) {
    result.errors.push(`${failedRequests.length} request(s) failed status validation`);
  }
  writeArtifacts(result);
  console.log(JSON.stringify({ jsonPath, mdPath, csvPath, logPath, result: { ready_ms: result.ready_ms, repeat: result.repeat, request_count: result.requests.length, errors: result.errors, error_like_lines: result.error_like_lines.length } }, null, 2));
  if (result.errors.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  logCliError(error, (line) => process.stderr.write(`[measure-dev-routes] ${line}`));
  process.exit(1);
});
