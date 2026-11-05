import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildFixtureLaunchPlan } from '../admin-header-consistency-20261011/launch.mjs';
import { readE2EAdminRouteBypassContract } from '../admin-header-consistency-20261011/source-contract.mjs';

const root = resolve(import.meta.dirname, '../..');
const variant = process.env.BUILD_VARIANT ?? '';
if (variant && !/^[a-z0-9-]{1,32}$/.test(variant)) throw new Error('INVALID_BUILD_VARIANT');
const suffix = variant ? `-${variant}` : '';
const dist = `.next-taste-admin-20261015${suffix}`;
if (process.versions.node.split('.')[0] !== '24') throw new Error('NODE_24_REQUIRED');
if (existsSync(resolve(root, dist))) throw new Error('BUILD_OUTPUT_ALREADY_EXISTS');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const tsPath = resolve(root, 'tsconfig.json');
const nextEnvPath = resolve(root, 'next-env.d.ts');
const tsBefore = readFileSync(tsPath);
const nextBefore = readFileSync(nextEnvPath);
function manifest() {
  const rows = {};
  function walk(path = '') {
    for (const entry of readdirSync(resolve(root, path), { withFileTypes: true })) {
      const relative = path ? `${path}/${entry.name}` : entry.name;
      if ((!path && ['node_modules', 'performance', '.vercel', '.git', '.lazyweb', '.omx'].includes(entry.name)) || entry.name.startsWith('.next') || relative === 'supabase/.temp') continue;
      if (entry.isDirectory()) walk(relative);
      else if (entry.isFile()) { const bytes = readFileSync(resolve(root, relative)); rows[relative] = { bytes: bytes.length, sha256: sha(bytes) }; }
    }
  }
  walk(); return rows;
}
const before = manifest();
const plan = buildFixtureLaunchPlan([], readE2EAdminRouteBypassContract());
const environment = {
  ...plan.nextEnvironment,
  NODE_ENV: 'production',
  PATH: `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
  TZUDONG_NEXT_DIST_DIR: dist,
  E2E_ADMIN_ROUTE_BYPASS_RUNTIME: 'local-production-bundle-smoke',
  E2E_ADMIN_ROUTE_BYPASS_ALLOW_LOCAL_PRODUCTION_SMOKE: '1',
};
const result = spawnSync(process.execPath, ['node_modules/next/dist/bin/next', 'build', '--webpack'], { cwd: root, env: environment, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
const cleanupFailures = [];
const current = JSON.parse(readFileSync(tsPath));
current.include = current.include.filter(value => ![`${dist}/types/**/*.ts`, `${dist}/dev/types/**/*.ts`].includes(value));
if (JSON.stringify(current) === JSON.stringify(JSON.parse(tsBefore))) writeFileSync(tsPath, tsBefore);
else cleanupFailures.push('UNEXPECTED_TSCONFIG_CHANGE');
const generatedPattern = /^import ["']\.\/\.next[^"']*\/types\/(?:routes|root-params)\.d\.ts["'];$/gm;
const afterNext = readFileSync(nextEnvPath);
if (afterNext.toString().replace(generatedPattern, '') === nextBefore.toString().replace(generatedPattern, '')) writeFileSync(nextEnvPath, nextBefore);
else cleanupFailures.push('UNEXPECTED_NEXT_ENV_CHANGE');
const after = manifest();
const drift = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(path => before[path]?.sha256 !== after[path]?.sha256);
let css = null;
if (result.status === 0) {
  const { verifyBuildRouteCssBoundaries } = await import('../../scripts/verify-route-css-boundaries.mjs');
  css = verifyBuildRouteCssBoundaries({ nextDirectory: resolve(root, dist) });
}
const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
const receipt = { schemaVersion: 1, environment: 'Node24 / pinned installed npm lock dependencies / synthetic loopback configuration; no deployment or hosted data', node: process.version, exitCode: result.status, signal: result.signal, source: before, sourceDrift: drift, cleanupFailures, css, outputSha256: sha(output), outputTail: output.slice(-10000) };
writeFileSync(resolve(import.meta.dirname, `build-report${suffix}.json`), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ exitCode: result.status, sourceInputs: Object.keys(before).length, sourceDrift: drift, cleanupFailures, css }));
if (result.status !== 0 || drift.length || cleanupFailures.length) process.exitCode = 1;
