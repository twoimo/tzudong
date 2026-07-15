#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logCliError } from './privacy-safe-cli-log.mjs';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = path.join(APP_ROOT, 'tsconfig.json');
const NATIVE_ENTRYPOINT = path.join(APP_ROOT, 'node_modules', '@typescript', 'native', 'bin', 'tsc');
const COMPAT_ENTRYPOINT = path.join(APP_ROOT, 'node_modules', 'typescript', 'bin', 'tsc6');
const BRIDGE_REQUIRE = createRequire(path.join(APP_ROOT, 'node_modules', 'typescript', 'package.json'));
const COMPAT_API_ROOT = path.dirname(BRIDGE_REQUIRE.resolve('@typescript/old/package.json'));
const COMMON_ARGS = ['--project', PROJECT, '--noEmit', '--pretty', 'false', '--incremental', 'false'];

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const codePointCompare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const normalizeSlashes = (value) => value.replaceAll('\\', '/');
function canonicalPath(value) {
  const normalized = normalizeSlashes(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}
function containedPath(root, target) {
  const relative = path.posix.relative(canonicalPath(root), canonicalPath(target));
  return relative === '' || (!relative.startsWith('../') && relative !== '..' && !path.posix.isAbsolute(relative));
}

function compilerArgs(kind, extra = []) {
  return [...COMMON_ARGS, ...(kind === 'native' ? ['--checkers', '4'] : ['--stableTypeOrdering']), ...extra];
}

function entrypoint(kind) {
  return kind === 'native' ? NATIVE_ENTRYPOINT : COMPAT_ENTRYPOINT;
}

function normalizeDiagnostics(value) {
  const root = normalizeSlashes(APP_ROOT);
  return normalizeSlashes(value)
    .replaceAll(root, '<app>')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .sort(codePointCompare)
    .join('\n');
}

function runCompiler(kind, extra = [], inherit = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entrypoint(kind), ...compilerArgs(kind, extra)], {
      cwd: APP_ROOT,
      env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
      shell: false,
      stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    if (!inherit) {
      child.stdout.on('data', (chunk) => stdout.push(chunk));
      child.stderr.on('data', (chunk) => stderr.push(chunk));
    }
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({
      code: code ?? 1,
      signal,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    }));
  });
}

async function packageMetadata(packageRoot) {
  const manifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
    throw new Error(`Invalid package metadata: ${packageRoot}`);
  }
  return manifest;
}

async function logicalInput(rawPath, kind) {
  const absolute = await realpath(path.resolve(rawPath.trim()));
  const normalized = normalizeSlashes(absolute);
  const root = normalizeSlashes(await realpath(APP_ROOT));
  const nativeLib = normalizeSlashes(await realpath(path.join(APP_ROOT, 'node_modules', '@typescript', `typescript-${process.platform}-${process.arch}`, 'lib')));
  const compatLib = normalizeSlashes(await realpath(path.join(COMPAT_API_ROOT, 'lib')));
  const contentHash = sha256(await readFile(absolute));
  const isNativeLib = containedPath(nativeLib, normalized);
  const isCompatLib = containedPath(compatLib, normalized);

  if (isNativeLib || isCompatLib) {
    if ((kind === 'native' && !isNativeLib) || (kind === 'compat' && !isCompatLib)) {
      throw new Error(`${kind} compiler listed a standard-library file from the opposite compiler root: ${normalized}`);
    }
    return {
      name: `lib:${path.posix.basename(normalized)}`,
      compiler: kind === 'native' ? 'typescript@7.0.2' : 'typescript@6.0.2',
      contentHash,
    };
  }

  const marker = '/node_modules/';
  const markerIndex = canonicalPath(normalized).lastIndexOf(marker);
  if (markerIndex >= 0) {
    const remainder = normalized.slice(markerIndex + marker.length).split('/');
    const packageParts = remainder[0].startsWith('@') ? remainder.slice(0, 2) : remainder.slice(0, 1);
    if (!packageParts.length || packageParts.some((part) => !part)) throw new Error(`Malformed node_modules input: ${normalized}`);
    const packageRoot = `${normalized.slice(0, markerIndex + marker.length)}${packageParts.join('/')}`;
    const metadata = await packageMetadata(packageRoot);
    const subpath = remainder.slice(packageParts.length).join('/');
    return { name: `${metadata.name}@${metadata.version}${subpath ? `/${subpath}` : ''}`, contentHash };
  }

  if (!containedPath(root, normalized)) throw new Error(`Compiler input escaped app root: ${normalized}`);
  return { name: path.posix.relative(root, normalized), contentHash };
}

async function collectLogicalInputs(kind) {
  const result = await runCompiler(kind, ['--listFilesOnly']);
  const diagnostic = normalizeDiagnostics(`${result.stdout}\n${result.stderr}`);
  const stderr = normalizeDiagnostics(result.stderr);
  if (result.signal || result.code !== 0) {
    throw new Error(`${kind} --listFilesOnly failed (${result.signal ?? result.code}): ${diagnostic}`);
  }
  if (stderr) throw new Error(`${kind} --listFilesOnly wrote to stderr: ${stderr}`);
  const files = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!files.length) throw new Error(`${kind} --listFilesOnly produced no input files`);
  const inputs = await Promise.all(files.map((file) => logicalInput(file, kind)));
  if (!inputs.length) throw new Error(`${kind} --listFilesOnly produced no logical inputs`);
  const unique = new Map();
  for (const input of inputs) {
    const existing = unique.get(input.name);
    if (existing && existing.contentHash !== input.contentHash) {
      throw new Error(`${kind} produced conflicting content for logical input ${input.name}`);
    }
    unique.set(input.name, input);
  }
  return [...unique.values()].sort((left, right) => codePointCompare(left.name, right.name));
}

async function parity() {
  const [nativeCheck, compatCheck] = await Promise.all([runCompiler('native'), runCompiler('compat')]);
  const nativeDiagnostics = normalizeDiagnostics(`${nativeCheck.stdout}\n${nativeCheck.stderr}`);
  const compatDiagnostics = normalizeDiagnostics(`${compatCheck.stdout}\n${compatCheck.stderr}`);
  if (nativeCheck.signal || compatCheck.signal) {
    throw new Error(`Compiler terminated by signal: native=${nativeCheck.signal}, compat=${compatCheck.signal}`);
  }
  if (nativeCheck.code !== 0 || compatCheck.code !== 0 || nativeDiagnostics || compatDiagnostics) {
    throw new Error(`Both diagnostic streams must be empty\n--- native (${nativeCheck.code}) ---\n${nativeDiagnostics}\n--- compat (${compatCheck.code}) ---\n${compatDiagnostics}`);
  }

  const [nativeInputs, compatInputs] = await Promise.all([collectLogicalInputs('native'), collectLogicalInputs('compat')]);
  const nativeNames = nativeInputs.map(({ name }) => name);
  const compatNames = compatInputs.map(({ name }) => name);
  if (JSON.stringify(nativeNames) !== JSON.stringify(compatNames)) {
    const nativeSet = new Set(nativeNames);
    const compatSet = new Set(compatNames);
    throw new Error(`Logical input parity failed\nnative-only: ${JSON.stringify(nativeNames.filter((name) => !compatSet.has(name)))}\ncompat-only: ${JSON.stringify(compatNames.filter((name) => !nativeSet.has(name)))}`);
  }
  const nativeNonLib = nativeInputs.filter((input) => !input.name.startsWith('lib:')).map(({ name, contentHash }) => [name, contentHash]);
  const compatNonLib = compatInputs.filter((input) => !input.name.startsWith('lib:')).map(({ name, contentHash }) => [name, contentHash]);
  if (JSON.stringify(nativeNonLib) !== JSON.stringify(compatNonLib)) throw new Error('Logical input content-hash parity failed');

  process.stdout.write(`${JSON.stringify({
    status: 'passed',
    diagnostics: 0,
    logicalInputs: nativeNames.length,
    logicalInputNamesSha256: sha256(JSON.stringify(nativeNames)),
    nonLibraryContentSha256: sha256(JSON.stringify(nativeNonLib)),
    standardLibraryContentSha256: {
      native: sha256(JSON.stringify(nativeInputs.filter((input) => input.name.startsWith('lib:')))),
      compat: sha256(JSON.stringify(compatInputs.filter((input) => input.name.startsWith('lib:')))),
    },
  })}\n`);
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] === '--compiler' ? args[1] : args[0];
  const consumed = args[0] === '--compiler' ? 2 : 1;
  if (args.length !== consumed || !['native', 'compat', 'parity'].includes(mode)) {
    throw new Error('Usage: node scripts/run-typecheck.mjs [--compiler] <native|compat|parity>');
  }
  if (mode === 'parity') return parity();
  const result = await runCompiler(mode, [], true);
  if (result.signal && process.platform !== 'win32') process.kill(process.pid, result.signal);
  else process.exitCode = result.code;
}

main().catch((error) => {
  logCliError(error, (line) => process.stderr.write(`typecheck: ${line}`));
  process.exitCode = 1;
});
