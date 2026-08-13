import { spawn } from 'node:child_process';
import { constants as osConstants } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {
  assertLocalSupabaseReady,
  buildLocalWebEnvironment,
  loadLocalSupabaseEnvironment,
  loadLocalWebInputEnvironment,
} from './local-supabase-runtime.mjs';

const args = process.argv.slice(2).filter((arg) => arg !== '--');
let rawPort = '8080';
let operatorEnvFile;
for (let index = 0; index < args.length; index += 1) {
  const name = args[index];
  const value = args[index + 1];
  if (name === '--port' && value) {
    rawPort = value;
    index += 1;
    continue;
  }
  if (name === '--operator-env-file' && value) {
    if (operatorEnvFile !== undefined || !path.isAbsolute(value)) {
      process.stderr.write('[local-dev] error=InvalidOperatorEnvPath\n');
      process.exit(2);
    }
    operatorEnvFile = value;
    index += 1;
    continue;
  }
  process.stderr.write('[local-dev] error=InvalidArgument\n');
  process.exit(2);
}
const port = Number(rawPort);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  process.stderr.write('[local-dev] error=InvalidPort\n');
  process.exit(2);
}

let local;
try {
  local = loadLocalSupabaseEnvironment();
  assertLocalSupabaseReady(local);
} catch (error) {
  const message = error instanceof Error ? error.message : '[local-supabase] admission_failed';
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

process.stdout.write(
  `[local-dev] admitted project=${local.projectName} app=http://127.0.0.1:${port} supabase=${local.supabaseOrigin}\n`,
);
const child = spawn(
  'node',
  ['scripts/dev-prewarm.mjs', '--port', String(port), '--host', '127.0.0.1'],
  {
    cwd: process.cwd(),
    env: {
      ...buildLocalWebEnvironment(local, loadLocalWebInputEnvironment({
        repositoryRoot: local.repositoryRoot,
        operatorEnvFile,
      })),
      __NEXT_PROCESSED_ENV: 'true',
      NEXT_PUBLIC_SITE_URL: `http://127.0.0.1:${port}`,
      TZUDONG_NEXT_DIST_DIR: `.next-local-${port}`,
    },
    stdio: 'inherit',
  },
);

child.once('error', () => {
  process.stderr.write('[local-dev] error=SpawnFailed\n');
  process.exit(2);
});
let stoppingSignal = null;
let stopTimer;
const signalExitCode = (signal) => 128 + (osConstants.signals[signal] ?? 0);

child.once('exit', (code, signal) => {
  if (stopTimer) clearTimeout(stopTimer);
  const effectiveSignal = stoppingSignal ?? signal;
  process.exit(effectiveSignal ? signalExitCode(effectiveSignal) : (code ?? 1));
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (stoppingSignal) return;
    stoppingSignal = signal;
    child.kill(signal);
    stopTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      process.exit(signalExitCode(signal));
    }, 5_000);
    stopTimer.unref();
  });
}
