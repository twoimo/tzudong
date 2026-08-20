import { spawn } from 'node:child_process';
import { constants as osConstants } from 'node:os';
import process from 'node:process';

const clientId = process.env.NEXT_PUBLIC_NAVER_CLIENT_ID?.trim();
const isPlaceholderClientId = !clientId
  || clientId === 'test'
  || /^(?:approved[-_]local|replace[-_]with|your[-_])/i.test(clientId);
if (isPlaceholderClientId) {
  process.stderr.write('[naver-live-smoke] error=ClientIdRequired\n');
  process.exit(2);
}

const child = spawn(
  process.execPath,
  [
    'node_modules/@playwright/test/cli.js',
    'test',
    'tests/naver-live-marker.spec.ts',
    '--project=chromium',
    '--workers=1',
  ],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PLAYWRIGHT_NAVER_LIVE_PROVIDER_SMOKE: '1',
      PLAYWRIGHT_REUSE_EXISTING_SERVER: '0',
    },
    stdio: 'inherit',
  },
);

child.once('error', () => {
  process.stderr.write('[naver-live-smoke] error=SpawnFailed\n');
  process.exit(2);
});

let stoppingSignal = null;
const signalExitCode = (signal) => 128 + (osConstants.signals[signal] ?? 0);

child.once('exit', (code, signal) => {
  const effectiveSignal = stoppingSignal ?? signal;
  process.exit(effectiveSignal ? signalExitCode(effectiveSignal) : (code ?? 1));
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (stoppingSignal) return;
    stoppingSignal = signal;
    child.kill(signal);
  });
}
