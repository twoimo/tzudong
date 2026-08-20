import { spawn } from 'node:child_process';
import { constants as osConstants } from 'node:os';
import process from 'node:process';
import { logCliError, redactCliText } from './privacy-safe-cli-log.mjs';

const args = process.argv.slice(2);
const readArg = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : (args[index + 1] ?? fallback);
};
const hasFlag = (name) => args.includes(name);

const port = Number(readArg('--port', process.env.PORT ?? '8080'));
if (!Number.isInteger(port) || port <= 0) {
  process.stderr.write('[dev-prewarm] error=InvalidPort\n');
  process.exit(1);
}

const host = readArg('--host', 'localhost');
const hosted = hasFlag('--hosted');
const shouldUseWebpackDev = !hasFlag('--turbopack') && !hasFlag('--turbo');
const shouldPrewarm = !hasFlag('--no-prewarm') && !['0', 'false', 'no', 'off'].includes(String(process.env.TZUDONG_DEV_PREWARM ?? '1').toLowerCase());
if (hosted && !shouldUseWebpackDev) {
  process.stderr.write('[dev-prewarm] error=HostedTurbopackConflict\n');
  process.exit(2);
}
const prewarmPaths = ['/api/health', '/', '/scripts/viewport-height-fix.js'];
const readyPattern = /(?:✓|\u2713) Ready in\s+([0-9.]+)(ms|s)/;
let prewarmStarted = false;
let stoppingSignal = null;
let stopTimer;
const signalExitCode = (signal) => 128 + (osConstants.signals[signal] ?? 0);

const child = spawn(
  'node',
  [
    'scripts/clean-next.mjs',
    ...(hasFlag('--clean') ? [] : ['--skip-clean']),
    '--',
    'node',
    'node_modules/next/dist/bin/next',
    'dev',
    ...(shouldUseWebpackDev ? ['--webpack'] : []),
    '--port',
    String(port),
    '--hostname',
    host,
  ],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'development',
      ...(hosted ? { TZUDONG_HOSTED_DEV: '1' } : {}),
    },
    stdio: ['inherit', 'pipe', 'pipe'],
  },
);

const childOutputLimit = 4_096;

const forward = (stream, target) => {
  if (!stream?.on) return;

  stream.on('data', (chunk) => {
    const text = typeof chunk === 'string'
      ? chunk
      : Buffer.isBuffer(chunk)
        ? chunk.toString('utf8')
        : '';
    if (!text) return;

    target.write(redactCliText(text, childOutputLimit));
    if (shouldPrewarm && !prewarmStarted && readyPattern.test(text)) {
      prewarmStarted = true;
      void runPrewarm();
    }
  });
};

async function fetchWithTimeout(url, timeoutMs = 120_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'manual' });
    await response.arrayBuffer().catch(() => undefined);
    return { status: response.status, elapsedMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

async function runPrewarm() {
  const baseUrl = `http://${host}:${port}`;
  console.log(`[dev-prewarm] starting ${prewarmPaths.join(', ')}`);

  for (const path of prewarmPaths) {
    const url = `${baseUrl}${path}`;
    try {
      const result = await fetchWithTimeout(url);
      const ok = result.status >= 200 && result.status < 400;
      console.log(`[dev-prewarm] ${ok ? 'ok' : 'bad-status'} ${result.status} ${result.elapsedMs}ms ${path}`);
      if (!ok) {
        console.warn(`[dev-prewarm] ${path} returned ${result.status}; continuing dev server without failing startup`);
      }
    } catch (error) {
      logCliError(error, (line) => process.stderr.write(`[dev-prewarm] prewarm ${line}`));
    }
  }

  console.log('[dev-prewarm] complete; manual homepage opens should use the warm dev path');
}

forward(child.stdout, process.stdout);
forward(child.stderr, process.stderr);

child.on('error', (error) => {
  logCliError(error, (line) => process.stderr.write(`[dev-prewarm] child-process ${line}`));
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (stopTimer) clearTimeout(stopTimer);
  const effectiveSignal = stoppingSignal ?? signal;
  process.exit(effectiveSignal ? signalExitCode(effectiveSignal) : (code ?? 0));
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (stoppingSignal) return;
    stoppingSignal = signal;
    child.kill(signal);
    stopTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      process.exit(signalExitCode(signal));
    }, 4_000);
    stopTimer.unref();
  });
}
