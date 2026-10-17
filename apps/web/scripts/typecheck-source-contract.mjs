import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const normalizeSlashes = (value) => value.replaceAll('\\', '/');

export function canonicalPath(value, platform = process.platform) {
  const normalized = normalizeSlashes(value);
  return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function containedPath(root, target, platform = process.platform) {
  const relative = path.posix.relative(canonicalPath(root, platform), canonicalPath(target, platform));
  return relative === '' || (!relative.startsWith('../') && relative !== '..' && !path.posix.isAbsolute(relative));
}

function sameIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function validateEntry(entry) {
  if (!entry || typeof entry.relativePath !== 'string' || typeof entry.logicalName !== 'string') {
    throw new Error('Invalid repository source contract entry');
  }
  const normalized = normalizeSlashes(entry.relativePath);
  if (path.posix.isAbsolute(normalized) || normalized === '' || normalized.split('/').some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error(`Invalid repository source contract path: ${entry.relativePath}`);
  }
  if (entry.logicalName !== `repo:${normalized}`) {
    throw new Error(`Repository source contract logical name must be canonical: ${entry.relativePath}`);
  }
  return { relativePath: normalized, logicalName: entry.logicalName };
}

async function captureFile(repoRoot, entry) {
  const requestedPath = path.resolve(repoRoot, entry.relativePath);
  if (!containedPath(repoRoot, requestedPath)) {
    throw new Error(`Repository source contract escaped repository root: ${entry.relativePath}`);
  }
  const resolvedPath = await realpath(requestedPath);
  if (canonicalPath(requestedPath) !== canonicalPath(resolvedPath)) {
    throw new Error(`Repository source contract must not traverse a symlink: ${entry.relativePath}`);
  }

  const beforePath = await lstat(requestedPath, { bigint: true });
  if (beforePath.isSymbolicLink() || !beforePath.isFile()) {
    throw new Error(`Repository source contract is not a regular non-symlink file: ${entry.relativePath}`);
  }
  const flags = constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW);
  const handle = await open(requestedPath, flags);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) throw new Error(`Repository source contract is not a regular file: ${entry.relativePath}`);
    if (!sameIdentity(beforePath, before)) {
      throw new Error(`Repository source changed before it was captured: ${entry.relativePath}`);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (!sameIdentity(before, after)) {
      throw new Error(`Repository source changed while it was captured: ${entry.relativePath}`);
    }
    const afterPath = await lstat(requestedPath, { bigint: true });
    const finalResolvedPath = await realpath(requestedPath);
    if (afterPath.isSymbolicLink()
      || !sameIdentity(after, afterPath)
      || canonicalPath(finalResolvedPath) !== canonicalPath(resolvedPath)) {
      throw new Error(`Repository source path changed while it was captured: ${entry.relativePath}`);
    }
    return {
      ...entry,
      requestedPath,
      resolvedPath,
      contentHash: sha256(bytes),
      identity: before,
    };
  } finally {
    await handle.close();
  }
}

export async function captureRepositorySourceContract({ repoRoot, entries }) {
  const canonicalRepoRoot = await realpath(repoRoot);
  const normalizedEntries = entries.map(validateEntry);
  const duplicatePaths = normalizedEntries.map(({ relativePath }) => relativePath);
  const duplicateNames = normalizedEntries.map(({ logicalName }) => logicalName);
  if (new Set(duplicatePaths).size !== duplicatePaths.length || new Set(duplicateNames).size !== duplicateNames.length) {
    throw new Error('Repository source contract entries must have unique paths and logical names');
  }

  const captured = await Promise.all(normalizedEntries.map((entry) => captureFile(canonicalRepoRoot, entry)));
  const byRequestedPath = new Map(captured.map((entry) => [canonicalPath(entry.requestedPath), entry]));
  const usedByCompiler = new Map(captured.map((entry) => [entry.logicalName, new Set()]));

  return {
    resolve(requestedPath, resolvedPath, compiler) {
      const entry = byRequestedPath.get(canonicalPath(requestedPath));
      if (!entry) return null;
      if (canonicalPath(resolvedPath) !== canonicalPath(entry.resolvedPath)) {
        throw new Error(`Repository source contract realpath changed: ${entry.relativePath}`);
      }
      usedByCompiler.get(entry.logicalName).add(compiler);
      return { name: entry.logicalName, contentHash: entry.contentHash };
    },
    assertUsedBy(compilers) {
      for (const entry of captured) {
        const used = usedByCompiler.get(entry.logicalName);
        const missing = compilers.filter((compiler) => !used.has(compiler));
        if (missing.length) {
          throw new Error(`Repository source contract input was not used by ${missing.join(',')}: ${entry.logicalName}`);
        }
      }
    },
    async verifyUnchanged() {
      for (const entry of captured) {
        const current = await captureFile(canonicalRepoRoot, entry);
        if (current.contentHash !== entry.contentHash || !sameIdentity(current.identity, entry.identity)) {
          throw new Error(`Repository source changed during typecheck: ${entry.relativePath}`);
        }
      }
    },
    entries: captured.map(({ relativePath, logicalName, contentHash }) => ({ relativePath, logicalName, contentHash })),
  };
}

function packageCoordinates(relativePath) {
  const parts = normalizeSlashes(relativePath).split('/');
  const nestedNodeModules = parts.lastIndexOf('node_modules');
  const packageIndex = nestedNodeModules < 0 ? 0 : nestedNodeModules + 1;
  const packageParts = parts[packageIndex]?.startsWith('@')
    ? parts.slice(packageIndex, packageIndex + 2)
    : parts.slice(packageIndex, packageIndex + 1);
  if (!packageParts.length || packageParts.some((part) => !part)) {
    throw new Error(`Malformed node_modules input: ${relativePath}`);
  }
  return {
    packagePath: parts.slice(0, packageIndex).concat(packageParts).join('/'),
    subpath: parts.slice(packageIndex + packageParts.length).join('/'),
  };
}

export async function trustedPackageInput({ requestedPath, resolvedPath, nodeModulesRoot }) {
  const requestedRoot = path.resolve(nodeModulesRoot);
  const trustedRoot = await realpath(nodeModulesRoot);
  const canonicalTrustedRoot = canonicalPath(trustedRoot);
  if (!containedPath(canonicalPath(requestedRoot), canonicalPath(requestedPath))) {
    if (containedPath(canonicalTrustedRoot, canonicalPath(resolvedPath))) {
      throw new Error(`Compiler package input used an untrusted path alias: ${requestedPath}`);
    }
  }
  if (!containedPath(canonicalTrustedRoot, canonicalPath(resolvedPath))) {
    const requested = canonicalPath(requestedPath);
    if (requested.includes('/node_modules/') || requested.endsWith('/node_modules')) {
      throw new Error(`Compiler input used an untrusted node_modules root: ${resolvedPath}`);
    }
    return null;
  }

  const relative = path.posix.relative(canonicalTrustedRoot, canonicalPath(resolvedPath));
  const { packagePath, subpath } = packageCoordinates(relative);
  const packageRoot = path.join(trustedRoot, packagePath);
  const canonicalPackageRoot = await realpath(packageRoot);
  if (!containedPath(canonicalTrustedRoot, canonicalPath(canonicalPackageRoot))) {
    throw new Error(`Compiler package escaped the trusted node_modules root: ${resolvedPath}`);
  }
  const manifest = JSON.parse(await readFile(path.join(canonicalPackageRoot, 'package.json'), 'utf8'));
  if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
    throw new Error(`Invalid package metadata: ${canonicalPackageRoot}`);
  }
  const current = await stat(resolvedPath, { bigint: true });
  if (!current.isFile()) throw new Error(`Compiler package input is not a regular file: ${resolvedPath}`);
  return {
    metadata: { name: manifest.name, version: manifest.version },
    subpath,
    contentHash: sha256(await readFile(resolvedPath)),
  };
}

export function applicationInputName({ resolvedPath, appRoot }) {
  const root = canonicalPath(appRoot);
  const target = canonicalPath(resolvedPath);
  if (!containedPath(root, target)) throw new Error(`Compiler input escaped app root: ${resolvedPath}`);
  return path.posix.relative(root, target);
}
