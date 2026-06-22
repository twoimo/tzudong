import { spawn } from 'node:child_process';
import process from 'node:process';

const args = process.argv.slice(2);
const readArg = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : (args[index + 1] ?? fallback);
};
const hasFlag = (name) => args.includes(name);

const port = Number(readArg('--port', process.env.PORT ?? '8080'));
if (!Number.isInteger(port) || port <= 0) {
  console.error(`[dev-prewarm] invalid --port: ${readArg('--port', process.env.PORT ?? '8080')}`);
  process.exit(1);
}

const host = readArg('--host', 'localhost');
const shouldUseWebpackDev = !hasFlag('--turbopack') && !hasFlag('--turbo');
const shouldPrewarm = !hasFlag('--no-prewarm') && !['0', 'false', 'no', 'off'].includes(String(process.env.TZUDONG_DEV_PREWARM ?? '1').toLowerCase());
const prewarmPaths = ['/api/health', '/', '/scripts/viewport-height-fix.js'];
const readyPattern = /(?:✓|\u2713) Ready in\s+([0-9.]+)(ms|s)/;
let prewarmStarted = false;
let stopping = false;

const child = spawn(
  'node',
  [
    'scripts/clean-next.mjs',
    '--skip-clean',
    '--',
    'node',
    'node_modules/next/dist/bin/next',
    'dev',
    ...(shouldUseWebpackDev ? ['--webpack'] : []),
    '--port',
    String(port),
  ],
  {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'development' },
    stdio: ['inherit', 'pipe', 'pipe'],
  },
);

const forward = (stream, target) => {
  stream.on('data', (chunk) => {
    target.write(chunk);
    const text = chunk.toString();
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
  console.log(`[dev-prewarm] starting ${prewarmPaths.join(', ')} on ${baseUrl}`);

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
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[dev-prewarm] failed ${path}: ${message}`);
    }
  }

  console.log('[dev-prewarm] complete; manual homepage opens should use the warm dev path');
}

forward(child.stdout, process.stdout);
forward(child.stderr, process.stderr);

child.on('error', (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (stopping) return;
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopping = true;
    child.kill(signal);
    const timer = setTimeout(() => process.exit(signal === 'SIGINT' ? 130 : 143), 2000);
    timer.unref();
  });
}
