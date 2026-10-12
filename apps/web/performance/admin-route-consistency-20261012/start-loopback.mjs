import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  createWriteStream,
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const NODE = '/opt/homebrew/opt/node@24/bin/node';
const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = resolve(WEB_ROOT, 'performance/admin-route-consistency-20261012');
const DIST = '.next-privacy-incidents-20261012';
const DEPENDENCIES = '/Users/twoimo/.codex/worktrees/goal-delivery-20261012/tzudong/apps/web/node_modules';
const NODE_MODULES = join(WEB_ROOT, 'node_modules');
const BUILD_RECEIPT = join(OUT, 'privacy-build-receipt.json');
const EXPECTED_LOCK_SHA256 = '607175eda02d7746caf5593d34835cef317bf197ca6d5428fa1266cdb2aae5f4';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function save(name, value) {
  writeFileSync(join(OUT, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
}

function safeEnvironment() {
  const inherited = Object.fromEntries(
    ['HOME', 'LANG', 'LC_ALL', 'SHELL', 'TERM', 'TMPDIR', 'TZ', 'USER']
      .filter((name) => typeof process.env[name] === 'string')
      .map((name) => [name, process.env[name]]),
  );
  return {
    ...inherited,
    PATH: '/opt/homebrew/opt/node@24/bin:/usr/bin:/bin:/usr/sbin:/sbin',
    NODE_ENV: 'production',
    NEXT_TELEMETRY_DISABLED: '1',
    NEXT_PUBLIC_NAVER_MAPS_SCRIPT_URL: '/__local/naver-maps.js',
    NEXT_PUBLIC_SITE_URL: 'http://127.0.0.1:18942',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-loopback-anon-key',
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:18941',
    NEXT_PUBLIC_TZUDONG_LOCAL_RUNTIME: '1',
    TZUDONG_NEXT_DIST_DIR: DIST,
    E2E_ADMIN_ROUTE_BYPASS: '1',
    E2E_ADMIN_ROUTE_BYPASS_CONTEXT: 'playwright',
    E2E_ADMIN_ROUTE_BYPASS_RUNTIME: 'local-production-bundle-smoke',
    E2E_ADMIN_ROUTE_BYPASS_TOKEN: 'privacy-incidents-synthetic-only',
    E2E_ADMIN_ROUTE_BYPASS_ALLOW_LOCAL_PRODUCTION_SMOKE: '1',
  };
}

if (realpathSync(process.execPath) !== realpathSync(NODE) || process.versions.node !== '24.21.0') throw new Error('PINNED_NODE_REQUIRED');
if (existsSync(NODE_MODULES)) throw new Error('NODE_MODULES_ALREADY_EXISTS');
if (!existsSync(BUILD_RECEIPT)) throw new Error('BUILD_RECEIPT_MISSING');
const receipt = JSON.parse(readFileSync(BUILD_RECEIPT, 'utf8'));
const buildId = readFileSync(join(WEB_ROOT, DIST, 'BUILD_ID'), 'utf8').trim();
if (receipt.status !== 0 || receipt.distDir !== DIST || receipt.buildId !== buildId || !receipt.sourceUnchanged || !receipt.tsconfigRestored) {
  throw new Error('BUILD_RECEIPT_INVALID');
}
if (sha256(readFileSync(join(WEB_ROOT, 'package-lock.json'))) !== EXPECTED_LOCK_SHA256) throw new Error('PACKAGE_LOCK_MISMATCH');

symlinkSync(DEPENDENCIES, NODE_MODULES, 'dir');
const runtimeLog = createWriteStream(join(OUT, 'privacy-runtime.log'), { flags: 'wx', mode: 0o600 });
function mirror(name, stream, target) {
  stream.on('data', (chunk) => {
    const text = chunk.toString('utf8');
    runtimeLog.write(`[${name}] ${text}`);
    target.write(text);
  });
}

const next = spawn(NODE, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '18940'], {
  cwd: WEB_ROOT,
  env: safeEnvironment(),
  shell: false,
  stdio: ['ignore', 'pipe', 'pipe'],
});
const gateway = spawn(NODE, ['performance/admin-route-consistency-20261012/fixture-server.mjs'], {
  cwd: WEB_ROOT,
  env: safeEnvironment(),
  shell: false,
  stdio: ['ignore', 'pipe', 'pipe'],
});
mirror('next:stdout', next.stdout, process.stdout);
mirror('next:stderr', next.stderr, process.stderr);
mirror('gateway:stdout', gateway.stdout, process.stdout);
mirror('gateway:stderr', gateway.stderr, process.stderr);

save('privacy-runtime-start.json', {
  schema: 'tzudong-privacy-incidents-loopback/v1',
  buildId,
  distDir: DIST,
  launcherPid: process.pid,
  nextPid: next.pid,
  gatewayPid: gateway.pid,
  origins: {
    next: 'http://127.0.0.1:18940',
    supabase: 'http://127.0.0.1:18941',
    gateway: 'http://127.0.0.1:18942',
    visibleStart: 'http://127.0.0.1:18942/__fixture/start',
  },
  source: {
    fixtureServerSha256: sha256(readFileSync(join(OUT, 'fixture-server.mjs'))),
    launcherSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
    buildReceiptSha256: sha256(readFileSync(BUILD_RECEIPT)),
  },
  boundaries: {
    loopbackOnly: true,
    syntheticDataOnly: true,
    browserMutationMethodsAllowed: false,
    hostedCredentialsAdmitted: false,
  },
});

process.stdout.write(`build_id=${buildId}\nfixture_start=http://127.0.0.1:18942/__fixture/start\n`);

let closing = false;
let exitCode = 0;
function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  exitCode = code;
  for (const child of [gateway, next]) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  }
  const timeout = setTimeout(() => {
    for (const child of [gateway, next]) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
  }, 5_000);
  timeout.unref();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => shutdown(0));
for (const [name, child] of [['next', next], ['gateway', gateway]]) {
  child.on('error', (error) => {
    runtimeLog.write(`[${name}:error] ${error.name}\n`);
    shutdown(1);
  });
  child.on('exit', (code, signal) => {
    runtimeLog.write(`[${name}:exit] code=${code} signal=${signal}\n`);
    if (!closing) shutdown(code || 1);
    if ((next.exitCode !== null || next.signalCode !== null) && (gateway.exitCode !== null || gateway.signalCode !== null)) {
      const dependencyLinkRemoved = existsSync(NODE_MODULES) && lstatSync(NODE_MODULES).isSymbolicLink()
        ? (unlinkSync(NODE_MODULES), true)
        : !existsSync(NODE_MODULES);
      runtimeLog.end(() => {
        save('privacy-runtime-stop.json', { exitCode, dependencyLinkRemoved });
        process.exit(exitCode);
      });
    }
  });
}
