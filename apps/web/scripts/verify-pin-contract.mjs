#!/usr/bin/env node

// Pin_Contract verifier (design C2 / requirements 5.1, 5.2, 5.4, 5.5, 5.7, 5.8, 5.9).
//
// Verifies the six Pin_Contract items' declared value against their resolved
// value, records a per-item match/mismatch receipt, and fails closed:
//   - any declared != resolved  -> `pin_contract_drift`, no pin value is ever
//     mutated, but the per-item receipt is still emitted so the drift is recorded.
//   - the type-check compiler resolving outside the repo-owned dependency tree
//     -> `global_compiler_not_admitted`, and NO result artifact is produced.
//
// Lock reconciliation (requirement 5.4): when `bun.lock` and `package-lock.json`
// disagree on a resolved version, `package-lock.json` is the release authority.
// This verifier DETECTS and REPORTS the mismatch (package name list + count) by
// default. Per AGENTS.md, `bun.lock` is reconciled with `package-lock.json` and
// is never treated as the release authority; `package.json` and
// `package-lock.json` are never modified here. Adjusting `bun.lock` is gated
// behind the explicit `--reconcile-bun-lock` opt-in and is left unimplemented as
// a mutation on purpose (report-only is the safe default); the receipt records
// the reconcile intent so a named operator can act on it.
//
// Type checking runs only via `npm run typecheck:parity` and the compiler is the
// repo-owned `@typescript/native` alias `7.0.2` at
// `node_modules/@typescript/native/bin/tsc` (requirement 5.5).

import { access, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logCliError } from './privacy-safe-cli-log.mjs';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Bounded fixed codes owned by this verifier.
const PIN_CONTRACT_DRIFT = 'pin_contract_drift';
const GLOBAL_COMPILER_NOT_ADMITTED = 'global_compiler_not_admitted';

const EXPECTED = Object.freeze({
  npm: '11.6.2',
  nodeMajor: 24,
  nodeRange: '24.x',
  nativeAlias: 'npm:typescript@7.0.2',
  nativeResolved: '7.0.2',
  nativeResolvedName: 'typescript',
  compatAlias: 'npm:@typescript/typescript6@6.0.2',
  compatResolved: '6.0.2',
  compatResolvedName: '@typescript/typescript6',
  typecheckParityScript: 'node scripts/run-typecheck.mjs --compiler parity',
});

const statusError = (code) => Object.assign(new Error(code), { code });

const normalizeSlashes = (value) => value.replaceAll('\\', '/');

function containedPath(root, target) {
  const relative = path.relative(root, target);
  return relative === ''
    || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function json(relativePath) {
  return JSON.parse(await readFile(path.join(APP_ROOT, relativePath), 'utf8'));
}

// bun.lock carries JSONC-style trailing commas; strip them before parsing.
async function bunLock() {
  const source = await readFile(path.join(APP_ROOT, 'bun.lock'), 'utf8');
  return JSON.parse(source.replace(/,\s*([}\]])/g, '$1'));
}

// The runtime npm version is the resolved value for the npm pin item. A launch
// failure yields a null resolution, which is reported as a drift rather than a
// crash so the check still fails closed.
async function runtimeNpmVersion() {
  const { spawnSync } = await import('node:child_process');
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(command, ['--version'], {
    cwd: APP_ROOT,
    encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
    shell: false,
    windowsHide: true,
  });
  if (result.error || result.signal || result.status !== 0) return null;
  const version = typeof result.stdout === 'string' ? result.stdout.trim() : '';
  return /^\d+\.\d+\.\d+/.test(version) ? version.split(/\s/)[0] : null;
}

function nodeMajor(version) {
  const match = /^v?(\d+)\./.exec(version);
  return match ? Number(match[1]) : Number.NaN;
}

// requirement 5.5 / 5.9: the type-check compiler must resolve inside the
// repo-owned dependency tree. Missing or escaping resolution is a global
// compiler and blocks the check with no result artifact.
async function resolveCompilerInRepoTree() {
  const entrypoint = path.join(APP_ROOT, 'node_modules', '@typescript', 'native', 'bin', 'tsc');
  try {
    await access(entrypoint);
  } catch {
    throw statusError(GLOBAL_COMPILER_NOT_ADMITTED);
  }
  const resolvedEntrypoint = await realpath(entrypoint);
  const resolvedRoot = await realpath(APP_ROOT);
  if (!containedPath(resolvedRoot, resolvedEntrypoint)) {
    throw statusError(GLOBAL_COMPILER_NOT_ADMITTED);
  }
  return normalizeSlashes(path.relative(resolvedRoot, resolvedEntrypoint));
}

function pinItems({ manifest, npmLock, runtimeNpm, runtimeNode }) {
  const npmNative = npmLock.packages?.['node_modules/@typescript/native'] ?? {};
  const npmCompat = npmLock.packages?.['node_modules/typescript'] ?? {};
  const rootLock = npmLock.packages?.[''] ?? {};

  const releaseAuthorityAligned =
    JSON.stringify(rootLock.dependencies) === JSON.stringify(manifest.dependencies)
    && JSON.stringify(rootLock.devDependencies) === JSON.stringify(manifest.devDependencies);

  return [
    {
      item: 'npm',
      declared: manifest.packageManager ?? null,
      declaredValue: EXPECTED.npm,
      resolved: runtimeNpm,
      match: manifest.packageManager === `npm@${EXPECTED.npm}` && runtimeNpm === EXPECTED.npm,
    },
    {
      item: 'node',
      declared: manifest.engines?.node ?? null,
      resolved: runtimeNode,
      match:
        manifest.engines?.node === EXPECTED.nodeRange
        && nodeMajor(runtimeNode) === EXPECTED.nodeMajor,
    },
    {
      item: 'typescript_native_alias',
      declared: manifest.devDependencies?.['@typescript/native'] ?? null,
      resolved: npmNative.version ?? null,
      match:
        manifest.devDependencies?.['@typescript/native'] === EXPECTED.nativeAlias
        && npmNative.name === EXPECTED.nativeResolvedName
        && npmNative.version === EXPECTED.nativeResolved,
    },
    {
      item: 'typescript_compat_bridge',
      declared: manifest.devDependencies?.typescript ?? null,
      resolved: npmCompat.version ?? null,
      match:
        manifest.devDependencies?.typescript === EXPECTED.compatAlias
        && npmCompat.name === EXPECTED.compatResolvedName
        && npmCompat.version === EXPECTED.compatResolved,
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
      match:
        (npmLock.lockfileVersion ?? 0) >= 2
        && typeof rootLock === 'object'
        && releaseAuthorityAligned,
    },
  ];
}

// requirement 5.4: report `bun.lock` <-> `package-lock.json` resolved-version
// conflicts. package-lock.json is the authority; only bun.lock would ever be
// adjusted (report-only here). package.json/package-lock.json are never touched.
function lockConflicts({ manifest, npmLock, bun }) {
  const names = [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ];
  const mismatches = [];
  for (const name of names) {
    const npmVersion = npmLock.packages?.[`node_modules/${name}`]?.version ?? null;
    const bunIdentity = bun.packages?.[name]?.[0] ?? null;
    const bunVersion =
      typeof bunIdentity === 'string' ? bunIdentity.slice(bunIdentity.lastIndexOf('@') + 1) : null;
    if (npmVersion === null || bunVersion === null || npmVersion !== bunVersion) {
      mismatches.push(name);
    }
  }
  return mismatches.sort();
}

async function main() {
  const reconcileBunLock = process.argv.includes('--reconcile-bun-lock');

  const manifest = await json('package.json');

  // Type-check wiring and compiler containment are evaluated first. A global
  // compiler blocks with no result artifact (requirement 5.9).
  const typecheckParity = manifest.scripts?.['typecheck:parity'] ?? null;
  const compilerEntrypoint = await resolveCompilerInRepoTree();

  const [npmLock, bun, runtimeNpm] = await Promise.all([
    json('package-lock.json'),
    bunLock(),
    runtimeNpmVersion(),
  ]);
  const runtimeNode = process.versions.node;

  const items = pinItems({ manifest, npmLock, runtimeNpm, runtimeNode });
  const typecheckMatch = typecheckParity === EXPECTED.typecheckParityScript;

  const mismatchPackages = lockConflicts({ manifest, npmLock, bun });

  const drift = items.some((entry) => !entry.match) || !typecheckMatch;

  const receipt = {
    status: drift ? 'failed' : 'passed',
    code: drift ? PIN_CONTRACT_DRIFT : null,
    pinContract: items.map(({ item, declared, resolved, match }) => ({ item, declared, resolved, match })),
    typecheck: {
      script: typecheckParity,
      expectedScript: EXPECTED.typecheckParityScript,
      match: typecheckMatch,
      compilerEntrypoint,
      compilerInRepoTree: true,
    },
    lockReconciliation: {
      authority: 'package-lock.json',
      mismatchPackages,
      mismatchCount: mismatchPackages.length,
      bunLockAdjusted: false,
      // Requirement 5.4 reconcile intent: only bun.lock may be adjusted, never
      // package.json/package-lock.json. Report-only unless explicitly opted in.
      reconcileRequested: reconcileBunLock,
    },
  };

  // requirement 5.8: fail closed on drift, never auto-change a pin value. The
  // per-item receipt is still emitted so the drift is recorded (requirement 5.7).
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  if (drift) process.exitCode = 1;
}

main().catch((error) => {
  // requirement 5.9: when the compiler is not admitted, produce no result
  // artifact. Only a safe, bounded fixed code is written.
  logCliError(error, (line) => process.stderr.write(`[verify-pin-contract] ${line}`));
  process.exitCode = 1;
});
