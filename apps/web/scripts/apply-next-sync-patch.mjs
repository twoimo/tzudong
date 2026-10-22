// Next 16.3.8 broadcasts each new client's initial SYNC to existing clients.
// Keep this exact-byte dev-only fix until the pinned upstream version changes.
import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync, constants, fchmodSync, fstatSync, fsyncSync, lstatSync,
  openSync, readSync, realpathSync, renameSync, unlinkSync, writeSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '16.3.8';
const ORIGINAL_SHA = 'dfe8d350b7d13436f8409892c992cf90f20d7795a25235c4ca30764353b6afcc';
const PATCHED_SHA = 'a8e1623f41b8df1d17e6e90c4ae3d439b24b654ba035a03b3d91e8b22c11d56c';
const OLD = '                this.publish({\n                    type: _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.SYNC,';
const NEW = '                this.publishToClient(client, {\n                    type: _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.SYNC,';
const MAX_MODULE_BYTES = 64 * 1024;
const MAX_METADATA_BYTES = 64 * 1024;
const MAX_LOCK_BYTES = 2 * 1024 * 1024;
const fail = (code) => { throw new Error(`NEXT_SYNC_PATCH_${code}`); };
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function nextSyncPatchErrorCode(error) {
  return error instanceof Error && /^NEXT_SYNC_PATCH_[A-Z_]+$/.test(error.message)
    ? error.message : 'NEXT_SYNC_PATCH_FAILED';
}

function checkedStat(file, directory = false, maxBytes = null) {
  const stat = lstatSync(file);
  if (stat.isSymbolicLink()) fail('SYMLINK_REJECTED');
  if (directory ? !stat.isDirectory() : !stat.isFile()) fail('SHAPE_REJECTED');
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) fail('OWNER_REJECTED');
  if (maxBytes !== null && (stat.size < 1 || stat.size > maxBytes)) fail('SIZE_REJECTED');
  return stat;
}

function readBounded(file, maxBytes) {
  const before = checkedStat(file, false, maxBytes);
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino
      || opened.size !== before.size || opened.mtimeMs !== before.mtimeMs) fail('FILE_CHANGED');
    const buffer = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(fd, buffer, length, buffer.length - length, length);
      if (count === 0) break;
      length += count;
    }
    const after = fstatSync(fd);
    if (length > maxBytes || length !== opened.size || after.size !== opened.size
      || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) fail('FILE_CHANGED');
    return { bytes: buffer.subarray(0, length), stat: after };
  } finally { closeSync(fd); }
}

function projectPaths(projectRoot) {
  const root = path.resolve(projectRoot);
  const realRoot = realpathSync.native(root);
  const directories = [];
  let cursor = root;
  for (const part of ['', 'node_modules', 'next', 'dist', 'server', 'dev']) {
    cursor = path.join(cursor, part);
    const stat = checkedStat(cursor, true);
    const real = realpathSync.native(cursor);
    const relative = path.relative(realRoot, real);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) fail('OUTSIDE_PROJECT');
    directories.push({ dev: stat.dev, ino: stat.ino, real });
  }
  return { root, target: path.join(cursor, 'hot-middleware.js'), directories };
}

function checkVersion(root) {
  const json = (file, maxBytes) => JSON.parse(readBounded(file, maxBytes).bytes.toString('utf8'));
  const manifest = json(path.join(root, 'package.json'), MAX_METADATA_BYTES);
  const lock = json(path.join(root, 'package-lock.json'), MAX_LOCK_BYTES);
  const installed = json(path.join(root, 'node_modules', 'next', 'package.json'), MAX_METADATA_BYTES);
  if (manifest.dependencies?.next !== VERSION
    || lock.packages?.['']?.dependencies?.next !== VERSION
    || lock.packages?.['node_modules/next']?.version !== VERSION
    || installed.name !== 'next' || installed.version !== VERSION) fail('VERSION_REJECTED');
}

function apply(projectRoot, verifyOnly) {
  const paths = projectPaths(projectRoot);
  checkVersion(paths.root);
  const { bytes: original, stat } = readBounded(paths.target, MAX_MODULE_BYTES);
  const current = sha256(original);
  if (current === PATCHED_SHA) return 'already-applied';
  if (current !== ORIGINAL_SHA) fail('UNKNOWN_SOURCE');
  if (verifyOnly) fail('NOT_APPLIED');
  const text = original.toString('utf8');
  if (text.split(OLD).length !== 2) fail('ANCHOR_REJECTED');
  const patched = Buffer.from(text.replace(OLD, NEW), 'utf8');
  if (sha256(patched) !== PATCHED_SHA) fail('RESULT_REJECTED');

  const temporary = path.join(path.dirname(paths.target), `.hot-middleware.js.${process.pid}.${randomBytes(8).toString('hex')}.tmp`);
  let fd;
  try {
    fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
      | (constants.O_NOFOLLOW ?? 0), stat.mode & 0o777);
    if (process.platform !== 'win32') fchmodSync(fd, stat.mode & 0o777);
    let written = 0;
    while (written < patched.length) {
      const count = writeSync(fd, patched, written, patched.length - written);
      if (count <= 0) fail('TEMP_WRITE_FAILED');
      written += count;
    }
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    if (sha256(readBounded(temporary, MAX_MODULE_BYTES).bytes) !== PATCHED_SHA) fail('TEMP_REJECTED');

    // Installs must be serialized per checkout. Recheck ordinary concurrent changes;
    // atomic rename avoids modifying a shared Bun cache inode, not an OS-level CAS.
    const latestPaths = projectPaths(paths.root);
    if (JSON.stringify(latestPaths.directories) !== JSON.stringify(paths.directories)) fail('CONCURRENT_CHANGE');
    checkVersion(paths.root);
    const latest = readBounded(paths.target, MAX_MODULE_BYTES);
    if (latest.stat.dev !== stat.dev || latest.stat.ino !== stat.ino
      || sha256(latest.bytes) !== ORIGINAL_SHA) fail('CONCURRENT_CHANGE');
    renameSync(temporary, paths.target);
    if (sha256(readBounded(paths.target, MAX_MODULE_BYTES).bytes) !== PATCHED_SHA) fail('READBACK_REJECTED');
    return 'applied';
  } finally {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(temporary); } catch (error) {
      if (error?.code !== 'ENOENT') fail('TEMP_CLEANUP_FAILED');
    }
  }
}

export function applyNextSyncPatch(projectRoot, { verifyOnly = false } = {}) {
  try { return apply(projectRoot, verifyOnly); }
  catch (error) { throw new Error(nextSyncPatchErrorCode(error)); }
}

let invokedDirectly = false;
try {
  invokedDirectly = Boolean(process.argv[1])
    && realpathSync.native(process.argv[1]) === realpathSync.native(fileURLToPath(import.meta.url));
} catch { /* Importing the module has no side effects. */ }
if (invokedDirectly) {
  try {
    if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== '--verify-only')) fail('ARGUMENT_REJECTED');
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const result = applyNextSyncPatch(root, { verifyOnly: process.argv[2] === '--verify-only' });
    process.stdout.write(`NEXT_SYNC_PATCH_${result === 'applied' ? 'APPLIED' : 'VERIFIED'}\n`);
  } catch (error) {
    process.stderr.write(`${nextSyncPatchErrorCode(error)}\n`);
    process.exitCode = 1;
  }
}
