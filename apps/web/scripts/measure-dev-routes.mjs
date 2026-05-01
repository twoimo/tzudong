import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

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

function parsePositiveIntegerArg(name, fallback) {
  const raw = readArg(name, String(fallback));
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid ${name} value: ${raw}`);
  }
  return value;
}

const timeoutMs = parsePositiveIntegerArg('--timeout-ms', 240000);
const routeTimeoutMs = parsePositiveIntegerArg('--route-timeout-ms', 180000);

const artifactTimestamp = new Date().toISOString().replace(/[:.]/g, '');
const safeLabel = String(label).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'routes';
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
      throw new Error(`Invalid --port value: ${explicitPort}`);
    }
    return port;
  }
  for (let port = DEFAULT_PORT_RANGE[0]; port <= DEFAULT_PORT_RANGE[1]; port += 1) {
    if (await canListen(port)) return port;
  }
  throw new Error(`No free port in ${DEFAULT_PORT_RANGE[0]}..${DEFAULT_PORT_RANGE[1]}`);
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

async function timedFetch(url, requestLabel) {
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), routeTimeoutMs);
  const started = nowMs();
  try {
    const response = await fetch(url, { redirect: 'manual', signal: controller.signal });
    const text = await response.text().catch(() => '');
    return { status: response.status, ok: response.ok, elapsed_ms: nowMs() - started, bytes: text.length, error: null };
  } catch (error) {
    return { status: 0, ok: false, elapsed_ms: nowMs() - started, bytes: 0, error: `${requestLabel}: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    clearTimeout(abortTimer);
  }
}

function summarize(values) {
  const sorted = values.filter(Number.isFinite).toSorted((a, b) => a - b);
  if (sorted.length === 0) return { count: 0, min_ms: null, median_ms: null, max_ms: null };
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { count: sorted.length, min_ms: sorted[0], median_ms: median, max_ms: sorted.at(-1) };
}

function writeArtifacts(result) {
  fs.writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`);
  const csvCell = (value) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const rows = ['round,route,kind,source,status,elapsed_ms,log_total_ms,log_next_ms,log_proxy_ms,log_app_ms,bytes,error'];
  for (const row of result.requests) {
    rows.push([
      row.round,
      row.route,
      row.kind,
      row.source,
      row.status,
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

  const coldRows = result.requests.filter((row) => row.round === 'coldish');
  const warmRows = result.requests.filter((row) => row.round === 'warm');
  const lines = [];
  lines.push(`# Dev route compile measurement: ${label}`);
  lines.push('');
  lines.push(`- started: ${result.run_started_at}`);
  lines.push(`- cwd: ${result.cwd}`);
  lines.push(`- command: \`${result.command}\``);
  lines.push(`- mode/order: ${mode}/${order}`);
  lines.push(`- port: ${result.port}`);
  lines.push(`- ready: ${result.ready_ms}ms`);
  lines.push(`- trace: ${trace ? 'enabled' : 'disabled'}`);
  lines.push(`- log: \`${logPath}\``);
  lines.push(`- csv: \`${csvPath}\``);
  lines.push(`- json: \`${jsonPath}\``);
  lines.push('');
  for (const [title, rowsForRound] of [['coldish', coldRows], ['warm', warmRows]]) {
    if (rowsForRound.length === 0) continue;
    const summary = summarize(rowsForRound.map((row) => row.elapsed_ms));
    lines.push(`## ${title}`);
    lines.push(`- count: ${summary.count}`);
    lines.push(`- median: ${(summary.median_ms / 1000).toFixed(3)}s`);
    lines.push(`- max: ${(summary.max_ms / 1000).toFixed(3)}s`);
    lines.push(`- min: ${(summary.min_ms / 1000).toFixed(3)}s`);
    lines.push('');
    lines.push('| route | status | seconds | log next/app | source |');
    lines.push('|---|---:|---:|---:|---|');
    for (const row of rowsForRound.toSorted((a, b) => b.elapsed_ms - a.elapsed_ms)) {
      const logParts = row.log_next_ms === null || row.log_next_ms === undefined ? '' : `${(row.log_next_ms / 1000).toFixed(3)}/${row.log_app_ms === null || row.log_app_ms === undefined ? '?' : (row.log_app_ms / 1000).toFixed(3)}`;
      lines.push(`| \`${row.route}\` | ${row.status} | ${(row.elapsed_ms / 1000).toFixed(3)} | ${logParts} | \`${row.source}\` |`);
    }
    lines.push('');
  }
  lines.push('## Error-like dev log lines');
  if (result.error_like_lines.length === 0) {
    lines.push('- none');
  } else {
    for (const line of result.error_like_lines.slice(0, 40)) lines.push(`- \`${line.slice(0, 180)}\``);
  }
  fs.writeFileSync(mdPath, `${lines.join('\n')}\n`);
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  if (cold) fs.rmSync(path.join(projectRoot, '.next', 'dev'), { recursive: true, force: true });

  const routes = discoverRoutes();
  const port = await choosePort();
  const command = ['node', 'scripts/clean-next.mjs', '--skip-clean', '--', 'node', 'node_modules/next/dist/bin/next', 'dev', '--port', String(port)];
  const env = { ...process.env };
  if (trace) env.NEXT_TURBOPACK_TRACING = '1';

  const result = {
    run_started_at: new Date().toISOString(),
    cwd: projectRoot,
    command: command.join(' '),
    mode,
    order,
    port,
    cold,
    trace,
    ready_ms: null,
    routes,
    requests: [],
    error_like_lines: [],
    raw_log_path: logPath,
    csv_path: csvPath,
    markdown_path: mdPath,
    json_path: jsonPath,
    exit_code: null,
    exit_signal: null,
    errors: [],
  };

  fs.writeFileSync(logPath, `$ ${trace ? 'NEXT_TURBOPACK_TRACING=1 ' : ''}${command.join(' ')}\n`);
  const logChunks = [];
  const appendLog = (chunk) => {
    const text = chunk.toString();
    logChunks.push(text);
    fs.appendFileSync(logPath, text);
  };
  const useDetachedProcessGroup = process.platform !== 'win32';
  const child = spawn(command[0], command.slice(1), { cwd: projectRoot, env, stdio: ['ignore', 'pipe', 'pipe'], detached: useDetachedProcessGroup });
  let exited = false;
  child.stdout.on('data', appendLog);
  child.stderr.on('data', appendLog);
  child.on('exit', (code, signal) => { exited = true; result.exit_code = code; result.exit_signal = signal; });
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
    result.ready_ms = await waitForReady({ getLog, processExited: () => exited, timeoutAt });
    if (result.ready_ms === null) throw new Error(`Next dev did not become ready within ${timeoutMs}ms`);
    const baseUrl = `http://127.0.0.1:${port}`;
    for (const round of ['coldish', ...(includeWarm ? ['warm'] : [])]) {
      for (const route of routes) {
        const request = await timedFetch(`${baseUrl}${route.route}`, `${round} GET ${route.route}`);
        await delay(50);
        const timing = parseRouteTiming(getLog(), route.route);
        result.requests.push({
          round,
          route: route.route,
          kind: route.kind,
          source: route.source,
          status: request.status,
          elapsed_ms: request.elapsed_ms,
          bytes: request.bytes,
          error: request.error,
          log_total_ms: timing?.total_ms ?? null,
          log_next_ms: timing?.next_ms ?? null,
          log_proxy_ms: timing?.proxy_ms ?? null,
          log_app_ms: timing?.app_ms ?? null,
          log_line: timing?.line ?? null,
        });
      }
    }
    await delay(500);
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    await stopChild();
    await delay(150);
    const log = getLog();
    result.error_like_lines = log.split(/\r?\n/).filter((line) => /Error:|Failed|Module not found|uncaught|panic/i.test(line) && !/terminated by signal SIGTERM/.test(line));
    writeArtifacts(result);
  }

  console.log(JSON.stringify({ jsonPath, mdPath, csvPath, logPath, result: { ready_ms: result.ready_ms, request_count: result.requests.length, errors: result.errors, error_like_lines: result.error_like_lines.length } }, null, 2));
  if (result.errors.length > 0 || result.requests.some((row) => row.status === 0)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
