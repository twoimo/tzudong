import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const NODE = '/opt/homebrew/opt/node@24/bin/node';
const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const REPO_ROOT = resolve(WEB_ROOT, '../..');
const OUT = resolve(WEB_ROOT, 'performance/admin-route-consistency-20261012');
const DIST = '.next-privacy-incidents-20261012';
const DEPENDENCIES = '/Users/twoimo/.codex/worktrees/goal-delivery-20261012/tzudong/apps/web/node_modules';
const NODE_MODULES = join(WEB_ROOT, 'node_modules');
const EXPECTED_LOCK_SHA256 = '607175eda02d7746caf5593d34835cef317bf197ca6d5428fa1266cdb2aae5f4';
const roots = ['app/admin', 'app/api/admin/privacy-incidents', 'components/admin', 'components/home', 'integrations', 'lib', 'styles'];
const extra = ['app/layout.tsx', 'app/app-runtime-layout.tsx', 'next.config.mjs', 'next-env.d.ts', 'package.json', 'package-lock.json', 'proxy.ts', 'tsconfig.json'];

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const relativePath = (path) => relative(WEB_ROOT, path).replaceAll('\\', '/');

function save(name, value) {
  writeFileSync(join(OUT, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
}

function manifest() {
  const paths = new Set(extra.filter((path) => existsSync(join(WEB_ROOT, path))));
  function walk(path) {
    const absolute = join(WEB_ROOT, path);
    if (!existsSync(absolute)) return;
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const child = `${path}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) paths.add(child);
      else throw new Error(`SOURCE_SYMLINK_NOT_ADMITTED:${child}`);
    }
  }
  roots.forEach(walk);
  return [...paths].sort().map((path) => ({
    path,
    bytes: readFileSync(join(WEB_ROOT, path)).byteLength,
    sha256: sha256(readFileSync(join(WEB_ROOT, path))),
  }));
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

if (realpathSync(process.execPath) !== realpathSync(NODE) || process.versions.node !== '24.21.0') {
  throw new Error('PINNED_NODE_REQUIRED');
}
for (const root of [WEB_ROOT, REPO_ROOT]) {
  for (const name of ['.env', '.env.local']) {
    if (existsSync(join(root, name))) throw new Error(`REPOSITORY_ENV_FILE_NOT_ADMITTED:${relativePath(join(root, name))}`);
  }
}
if (existsSync(join(WEB_ROOT, DIST))) throw new Error('DIST_ALREADY_EXISTS');
if (existsSync(NODE_MODULES)) throw new Error('NODE_MODULES_ALREADY_EXISTS');
if (!existsSync(join(DEPENDENCIES, 'next/package.json'))) throw new Error('PINNED_DEPENDENCIES_MISSING');
if (sha256(readFileSync(join(WEB_ROOT, 'package-lock.json'))) !== EXPECTED_LOCK_SHA256) throw new Error('PACKAGE_LOCK_MISMATCH');

mkdirSync(OUT, { recursive: true });
const before = manifest();
const beforeHash = sha256(JSON.stringify(before));
const tsconfig = readFileSync(join(WEB_ROOT, 'tsconfig.json'));
const nextEnvPath = join(WEB_ROOT, 'next-env.d.ts');
const nextEnv = existsSync(nextEnvPath) ? readFileSync(nextEnvPath) : null;
save('privacy-build-source-before.json', { baseHead: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: WEB_ROOT, encoding: 'utf8' }).stdout.trim(), rows: before, sha256: beforeHash });

let ownedDependencies = false;
let result;
let css = null;
try {
  symlinkSync(DEPENDENCIES, NODE_MODULES, 'dir');
  ownedDependencies = true;
  result = spawnSync(NODE, ['scripts/clean-next.mjs', '--skip-clean', '--', NODE, 'node_modules/next/dist/bin/next', 'build', '--webpack'], {
    cwd: WEB_ROOT,
    env: safeEnvironment(),
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status === 0) {
    const { verifyBuildRouteCssBoundaries } = await import('../../scripts/verify-route-css-boundaries.mjs');
    css = verifyBuildRouteCssBoundaries({ nextDirectory: join(WEB_ROOT, DIST) });
  }
} finally {
  const generated = new Set([`${DIST}/types/**/*.ts`, `${DIST}/dev/types/**/*.ts`]);
  const current = JSON.parse(readFileSync(join(WEB_ROOT, 'tsconfig.json'), 'utf8'));
  const original = JSON.parse(tsconfig.toString('utf8'));
  current.include = current.include.filter((path) => !generated.has(path));
  if (JSON.stringify(current) !== JSON.stringify(original)) throw new Error('UNEXPECTED_TSCONFIG_CHANGE');
  writeFileSync(join(WEB_ROOT, 'tsconfig.json'), tsconfig);
  if (nextEnv === null && existsSync(nextEnvPath)) unlinkSync(nextEnvPath);
  else if (nextEnv !== null) writeFileSync(nextEnvPath, nextEnv);
  if (ownedDependencies && lstatSync(NODE_MODULES).isSymbolicLink()) unlinkSync(NODE_MODULES);
}

const output = `${result?.stdout ?? ''}${result?.stderr ?? ''}`;
writeFileSync(join(OUT, 'privacy-build-output.log'), output, { flag: 'wx', mode: 0o600 });
const after = manifest();
const sourceUnchanged = JSON.stringify(before) === JSON.stringify(after);
save('privacy-build-source-after.json', { rows: after, sha256: sha256(JSON.stringify(after)), unchanged: sourceUnchanged });
const buildDirectory = join(WEB_ROOT, DIST);
const buildId = existsSync(join(buildDirectory, 'BUILD_ID')) ? readFileSync(join(buildDirectory, 'BUILD_ID'), 'utf8').trim() : null;
const artifacts = ['BUILD_ID', 'build-manifest.json', 'app-build-manifest.json', 'routes-manifest.json', 'required-server-files.json']
  .filter((path) => existsSync(join(buildDirectory, path)))
  .map((path) => ({ path, sha256: sha256(readFileSync(join(buildDirectory, path))) }));
const receipt = {
  schema: 'tzudong-privacy-incidents-local-build/v1',
  status: result?.status ?? 1,
  signal: result?.signal ?? null,
  node: process.versions.node,
  next: JSON.parse(readFileSync(join(DEPENDENCIES, 'next/package.json'), 'utf8')).version,
  distDir: DIST,
  buildId,
  sourceManifestSha256: beforeHash,
  sourceFileCount: before.length,
  sourceUnchanged,
  tsconfigRestored: readFileSync(join(WEB_ROOT, 'tsconfig.json')).equals(tsconfig),
  dependencyLockSha256: EXPECTED_LOCK_SHA256,
  dependenciesPath: DEPENDENCIES,
  dependencyLinkRemoved: !existsSync(NODE_MODULES),
  artifacts,
  css,
  environment: {
    inheritedAllowlistOnly: true,
    repositoryEnvFilesAdmitted: false,
    hostedCredentialsAdmitted: false,
    syntheticLoopbackOnly: true,
  },
  limitations: ['Local production bundle only; no browser render, OAuth, hosted database, provider, deployment, or production evidence.'],
};
save('privacy-build-receipt.json', receipt);
process.stdout.write(`${JSON.stringify(receipt)}\n`);
if (receipt.status !== 0 || !sourceUnchanged || !receipt.tsconfigRestored || !receipt.dependencyLinkRemoved || !buildId) process.exit(1);
