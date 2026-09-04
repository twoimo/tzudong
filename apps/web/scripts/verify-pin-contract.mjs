#!/usr/bin/env node

// Read-only Pin_Contract verifier reconstructed from the tracked release
// authority described by the repository: package.json, package-lock.json,
// npm 11.6.2, Node 24.x, the TypeScript native alias, and the stable bridge.

import { access, readFile, realpath } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logCliError } from './privacy-safe-cli-log.mjs';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PIN_CONTRACT_DRIFT = 'pin_contract_drift';
const GLOBAL_COMPILER_NOT_ADMITTED = 'global_compiler_not_admitted';

const EXPECTED = Object.freeze({
  npm: '11.6.2',
  nodeMajor: 24,
  nodeRange: '24.x',
  nativeAlias: 'npm:typescript@7.0.2',
  nativeName: 'typescript',
  nativeVersion: '7.0.2',
  compatAlias: 'npm:@typescript/typescript6@6.0.2',
  compatName: '@typescript/typescript6',
  compatVersion: '6.0.2',
  typecheckParityScript: 'node scripts/run-typecheck.mjs --compiler parity',
});

const statusError = (code) => Object.assign(new Error(code), { code });

const containedPath = (root, target) => {
  const relative = path.relative(root, target);
  return relative === ''
    || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};

const readJson = async (relativePath) =>
  JSON.parse(await readFile(path.join(APP_ROOT, relativePath), 'utf8'));

const readBunLock = async () => {
  const source = await readFile(path.join(APP_ROOT, 'bun.lock'), 'utf8');
  return JSON.parse(source.replace(/,\s*([}\]])/g, '$1'));
};

const runtimeNpmVersion = () => {
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(command, ['--version'], {
    cwd: APP_ROOT,
    encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
    shell: false,
    windowsHide: true,
  });
  if (result.error || result.signal || result.status !== 0) return null;
  const value = typeof result.stdout === 'string' ? result.stdout.trim() : '';
  return /^\d+\.\d+\.\d+$/.test(value) ? value : null;
};

const nodeMajor = (version) => {
  const match = /^v?(\d+)\./.exec(version);
  return match ? Number(match[1]) : Number.NaN;
};

async function resolveCompilerInRepoTree() {
  const entrypoint = path.join(APP_ROOT, 'node_modules', '@typescript', 'native', 'bin', 'tsc');
  try {
    await access(entrypoint);
  } catch {
    throw statusError(GLOBAL_COMPILER_NOT_ADMITTED);
  }
  const [resolvedEntrypoint, resolvedRoot] = await Promise.all([
    realpath(entrypoint),
    realpath(APP_ROOT),
  ]);
  if (!containedPath(resolvedRoot, resolvedEntrypoint)) {
    throw statusError(GLOBAL_COMPILER_NOT_ADMITTED);
  }
  return path.relative(resolvedRoot, resolvedEntrypoint).replaceAll('\\', '/');
}

function pinItems({ manifest, npmLock, runtimeNpm, runtimeNode }) {
  const native = npmLock.packages?.['node_modules/@typescript/native'] ?? {};
  const compat = npmLock.packages?.['node_modules/typescript'] ?? {};
  const root = npmLock.packages?.[''] ?? {};
  const releaseAuthorityAligned =
    JSON.stringify(root.dependencies) === JSON.stringify(manifest.dependencies)
    && JSON.stringify(root.devDependencies) === JSON.stringify(manifest.devDependencies);

  return [
    {
      item: 'npm',
      declared: manifest.packageManager ?? null,
      resolved: runtimeNpm,
      match: manifest.packageManager === `npm@${EXPECTED.npm}` && runtimeNpm === EXPECTED.npm,
    },
    {
      item: 'node',
      declared: manifest.engines?.node ?? null,
      resolved: runtimeNode,
      match: manifest.engines?.node === EXPECTED.nodeRange
        && nodeMajor(runtimeNode) === EXPECTED.nodeMajor,
    },
    {
      item: 'typescript_native_alias',
      declared: manifest.devDependencies?.['@typescript/native'] ?? null,
      resolved: native.version ?? null,
      match: manifest.devDependencies?.['@typescript/native'] === EXPECTED.nativeAlias
        && native.name === EXPECTED.nativeName
        && native.version === EXPECTED.nativeVersion,
    },
    {
      item: 'typescript_compat_bridge',
      declared: manifest.devDependencies?.typescript ?? null,
      resolved: compat.version ?? null,
      match: manifest.devDependencies?.typescript === EXPECTED.compatAlias
        && compat.name === EXPECTED.compatName
        && compat.version === EXPECTED.compatVersion,
    },
    {
      item: 'package_json',
      declared: 'release_authority',
      resolved: 'release_authority',
      match: typeof manifest.name === 'string' && releaseAuthorityAligned,
    },
    {
      item: 'package_lock_json',
      declared: 'release_authority',
      resolved: 'release_authority',
      match: Number(npmLock.lockfileVersion) >= 2 && releaseAuthorityAligned,
    },
  ];
}

function lockConflicts({ manifest, npmLock, bun }) {
  const names = [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ];
  return names.filter((name) => {
    const npmVersion = npmLock.packages?.[`node_modules/${name}`]?.version ?? null;
    const bunIdentity = bun.packages?.[name]?.[0] ?? null;
    const bunVersion = typeof bunIdentity === 'string'
      ? bunIdentity.slice(bunIdentity.lastIndexOf('@') + 1)
      : null;
    return npmVersion === null || bunVersion === null || npmVersion !== bunVersion;
  }).sort();
}

async function main() {
  const manifest = await readJson('package.json');
  const compilerEntrypoint = await resolveCompilerInRepoTree();
  const [npmLock, bun, runtimeNpm] = await Promise.all([
    readJson('package-lock.json'),
    readBunLock(),
    runtimeNpmVersion(),
  ]);
  const items = pinItems({
    manifest,
    npmLock,
    runtimeNpm,
    runtimeNode: process.versions.node,
  });
  const typecheckMatch =
    manifest.scripts?.['typecheck:parity'] === EXPECTED.typecheckParityScript;
  const mismatchPackages = lockConflicts({ manifest, npmLock, bun });
  const drift = items.some((item) => !item.match) || !typecheckMatch;

  process.stdout.write(`${JSON.stringify({
    status: drift ? 'failed' : 'passed',
    code: drift ? PIN_CONTRACT_DRIFT : null,
    pinContract: items,
    typecheck: {
      script: manifest.scripts?.['typecheck:parity'] ?? null,
      match: typecheckMatch,
      compilerEntrypoint,
      compilerInRepoTree: true,
    },
    lockReconciliation: {
      authority: 'package-lock.json',
      mismatchPackages,
      mismatchCount: mismatchPackages.length,
      bunLockAdjusted: false,
    },
  })}\n`);
  if (drift) process.exitCode = 1;
}

main().catch((error) => {
  logCliError(error, (line) => process.stderr.write(`[verify-pin-contract] ${line}`));
  process.exitCode = 1;
});
