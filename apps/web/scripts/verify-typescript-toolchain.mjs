#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { access, readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logCliError, redactCliText } from './privacy-safe-cli-log.mjs';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED = Object.freeze({ native: '7.0.2', compat: '6.0.2', eslint: '8.63.0' });
const statusError = (code) => Object.assign(new Error(code), { code });
const compilerFailure = (code, output) => {
  const error = statusError(code);
  error.diagnostic = redactCliText(output, 512);
  return error;
};
const BRIDGE_REQUIRE = createRequire(path.join(APP_ROOT, 'node_modules', 'typescript', 'package.json'));
function relativeReceiptPath(file) {
  const relative = path.relative(APP_ROOT, file);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw statusError('TOOLCHAIN_RECEIPT_PATH_INVALID');
  }
  return relative.replaceAll('\\', '/');
}

async function json(relativePath) {
  return JSON.parse(await readFile(path.join(APP_ROOT, relativePath), 'utf8'));
}
async function verifyBinShims(name, expectedEntrypoint, forbiddenEntrypoint) {
  const binRoot = path.join(APP_ROOT, 'node_modules', '.bin');
  let shimNames = [name];
  if (process.platform === 'win32') {
    const binaryShim = `${name}.exe`;
    try {
      await access(path.join(binRoot, binaryShim));
      shimNames = [binaryShim];
    } catch {
      shimNames = [name, `${name}.cmd`, `${name}.ps1`];
    }
  }
  const expectedToken = path.relative(binRoot, expectedEntrypoint).replaceAll('\\', '/').toLowerCase();
  const forbiddenToken = path.relative(binRoot, forbiddenEntrypoint).replaceAll('\\', '/').toLowerCase();

  return Promise.all(shimNames.map(async (shimName) => {
    const shimPath = path.join(binRoot, shimName);
    const shim = await readFile(shimPath);
    const binaryShim = shimName.endsWith('.exe');
    if (binaryShim) {
      if (shim.length < 1024 || shim[0] !== 0x4d || shim[1] !== 0x5a) {
        throw statusError('TOOLCHAIN_SHIM_BINARY_INVALID');
      }
    } else if (process.platform !== 'win32') {
      if (await realpath(shimPath) !== await realpath(expectedEntrypoint)) {
        throw statusError('TOOLCHAIN_SHIM_RESOLUTION_INVALID');
      }
    } else {
      const source = shim.toString('utf8').replaceAll('\\', '/').toLowerCase();
      if (!source.includes(expectedToken) || source.includes(forbiddenToken)) {
        throw statusError('TOOLCHAIN_SHIM_OWNER_INVALID');
      }
    }
    return {
      path: relativeReceiptPath(shimPath),
      sha256: createHash('sha256').update(shim).digest('hex'),
    };
  }));
}

function command(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: APP_ROOT,
    encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
    shell: false,
    windowsHide: true,
  });
  return checkedCommandOutput(result);
}

export function checkedCommandOutput(result) {
  const stdout = typeof result.stdout === 'string'
    ? redactCliText(result.stdout, 512)
    : '';
  const stderr = typeof result.stderr === 'string'
    ? redactCliText(result.stderr, 512)
    : '';
  if (result.error) {
    throw statusError('TOOLCHAIN_COMMAND_LAUNCH_FAILED');
  }
  if (result.signal) {
    throw compilerFailure('TOOLCHAIN_COMMAND_SIGNAL', stderr || stdout);
  }
  if (result.status !== 0) {
    throw compilerFailure('TOOLCHAIN_COMMAND_STATUS', stderr || stdout);
  }
  // Successful output is an internal protocol (including filesystem paths).
  // Redaction belongs only on the diagnostic path; it can corrupt valid paths.
  return typeof result.stdout === 'string' ? result.stdout.trim() : '';
}

async function main() {
  const manifest = await json('package.json');
  const aliases = {
    '@typescript/native': 'npm:typescript@7.0.2',
    '@typescript/old': 'npm:typescript@6.0.2',
    typescript: 'npm:@typescript/typescript6@6.0.2',
    'typescript-eslint': '8.63.0',
  };
  for (const [name, expected] of Object.entries(aliases)) {
    if (manifest.devDependencies?.[name] !== expected) {
      throw statusError('TOOLCHAIN_MANIFEST_ALIAS_INVALID');
    }
  }
  if (manifest.overrides?.['@typescript/old']) {
    throw statusError('TOOLCHAIN_OLD_OVERRIDE_FORBIDDEN');
  }

  const nativeManifest = await json('node_modules/@typescript/native/package.json');
  const bridgeManifest = await json('node_modules/typescript/package.json');
  const oldManifestPath = BRIDGE_REQUIRE.resolve('@typescript/old/package.json');
  const oldManifest = JSON.parse(await readFile(oldManifestPath, 'utf8'));
  const eslintManifest = await json('node_modules/typescript-eslint/package.json');
  if (nativeManifest.name !== 'typescript' || nativeManifest.version !== EXPECTED.native) {
    throw statusError('TOOLCHAIN_NATIVE_PACKAGE_INVALID');
  }
  if (bridgeManifest.name !== '@typescript/typescript6' || bridgeManifest.version !== EXPECTED.compat) {
    throw statusError('TOOLCHAIN_BRIDGE_PACKAGE_INVALID');
  }
  if (oldManifest.name !== 'typescript' || oldManifest.version !== EXPECTED.compat) {
    throw statusError('TOOLCHAIN_STABLE_API_DEPENDENCY_INVALID');
  }
  if (eslintManifest.version !== EXPECTED.eslint) {
    throw statusError('TOOLCHAIN_ESLINT_PACKAGE_INVALID');
  }
  if (nativeManifest.bin?.tsc !== './bin/tsc') {
    throw statusError('TOOLCHAIN_NATIVE_BIN_OWNER_INVALID');
  }
  if (bridgeManifest.bin?.tsc6 !== './bin/tsc6') {
    throw statusError('TOOLCHAIN_BRIDGE_BIN_OWNER_INVALID');
  }

  const nativeEntrypoint = path.join(APP_ROOT, 'node_modules', '@typescript', 'native', 'bin', 'tsc');
  const compatEntrypoint = path.join(APP_ROOT, 'node_modules', 'typescript', 'bin', 'tsc6');
  await Promise.all([access(nativeEntrypoint), access(compatEntrypoint)]);
  const [nativeBinShims, compatBinShims] = await Promise.all([
    verifyBinShims('tsc', nativeEntrypoint, compatEntrypoint),
    verifyBinShims('tsc6', compatEntrypoint, nativeEntrypoint),
  ]);
  const nativeVersion = command([nativeEntrypoint, '--version']).replace(/^Version\s+/, '');
  const compatVersion = command([compatEntrypoint, '--version']).replace(/^Version\s+/, '');
  const apiIdentity = JSON.parse(command(['-e', "process.stdout.write(JSON.stringify({version:require('typescript').version,manifest:require.resolve('typescript/package.json')}))"]));
  const expectedBridgeManifest = await realpath(path.join(APP_ROOT, 'node_modules', 'typescript', 'package.json'));
  if (await realpath(apiIdentity.manifest) !== expectedBridgeManifest) {
    throw statusError('TOOLCHAIN_API_MANIFEST_INVALID');
  }
  if (nativeVersion !== EXPECTED.native || compatVersion !== EXPECTED.compat || apiIdentity.version !== EXPECTED.compat) {
    throw statusError('TOOLCHAIN_VERSION_MISMATCH');
  }

  const platformPackageName = `@typescript/typescript-${process.platform}-${process.arch}`;
  const platformDirectory = path.join(APP_ROOT, 'node_modules', ...platformPackageName.split('/'));
  const platformManifest = JSON.parse(await readFile(path.join(platformDirectory, 'package.json'), 'utf8'));
  if (platformManifest.name !== platformPackageName || platformManifest.version !== EXPECTED.native) {
    throw statusError('TOOLCHAIN_PLATFORM_PACKAGE_INVALID');
  }
  const binaryPath = path.join(platformDirectory, 'lib', process.platform === 'win32' ? 'tsc.exe' : 'tsc');
  const binary = await readFile(binaryPath);
  if (binary.length < 1024) throw statusError('TOOLCHAIN_PLATFORM_BINARY_INVALID');

  process.stdout.write(`${JSON.stringify({
    status: 'passed',
    nativeCli: nativeVersion,
    compatCli: compatVersion,
    programmaticApi: apiIdentity.version,
    stableApiManifest: relativeReceiptPath(apiIdentity.manifest),
    stableApiDependencyManifest: relativeReceiptPath(oldManifestPath),
    nativeCliEntrypointSha256: createHash('sha256').update(await readFile(nativeEntrypoint)).digest('hex'),
    compatCliEntrypointSha256: createHash('sha256').update(await readFile(compatEntrypoint)).digest('hex'),
    platformPackage: platformPackageName,
    nativeBinShims,
    compatBinShims,
    platformBinarySha256: createHash('sha256').update(binary).digest('hex'),
  })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    logCliError(error, (line) => process.stderr.write(`[verify-typescript-toolchain] ${line}`));
    process.exitCode = 1;
  });
}
