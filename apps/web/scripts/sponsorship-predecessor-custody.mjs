/** Read-only link to a spent original, never a retry/admission or remote-state receipt.
 * The caller must pin this policy in its source manifest, separately establish the
 * material source correction (a new expiry/SQL hash alone is not one), and compare
 * an actual fresh preflight with assertPredecessorBeforeImage before proceeding.
 * No CLI, transport, credential access, writes, or environment/path overrides.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

export const PREDECESSOR_CUSTODY_DIRECTORY = '/Users/twoimo/.local/state/tzudong-sponsorship-sql-successor/aqlcofblfxdrjhhdmarw/4c6e9e290d54a596a4a36aa998dc394a9a0e825a57a38daf9e469564810ae2e1';
const FILES = ['admission.json', 'original.jsonl', 'send.lock'];
const MAX_BYTES = 256 * 1024;
const HASH = /^[a-f0-9]{64}$/;
const REVISION = /^[a-f0-9]{40}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const verifiedBindings = new WeakSet();
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = suffix => { const error = new Error(`SPONSORSHIP_PREDECESSOR_${suffix}`); error.code = error.message; throw error; };
const matches = (pattern, value) => typeof value === 'string' && pattern.test(value);
const admissionKeys = ['kind', 'authority', 'operationId', 'projectRef', 'databaseName', 'manifestSha256',
  'bundleSha256', 'scopeSha256', 'sourceRevision', 'sourceTree', 'sourceFilesSha256',
  'issuedAt', 'expiresAt', 'fences', 'protectedMain'];
const identityKeys = ['operationId', 'admissionSha256', 'manifestSha256', 'sourceRevision',
  'protectedMainSha', 'sourceFilesSha256', 'bundleSha256', 'projectRef'];

function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Reflect.ownKeys(value);
  return ownKeys.every(key => typeof key === 'string')
    && isDeepStrictEqual(ownKeys.sort(), [...keys].sort())
    && Object.values(descriptors).every(d => Object.hasOwn(d, 'value') && d.enumerable);
}
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Policy values are source-manifest authority, not facts inferred from disk.
 * expectedFileHashes includes newline bytes; admissionValueSha256 excludes them.
 * The policy's predecessor identity must never be replaced with the successor's.
 */
export function validatePredecessorPolicy(policy) {
  if (!exactKeys(policy, ['schemaVersion', 'kind', 'projectRef', 'operationId', 'sourceRevision',
    'manifestSha256', 'admissionValueSha256', 'sendSqlSha256', 'expectedFileHashes',
    'requireFreshBeforeImage', 'replayAllowed'])
    || policy.schemaVersion !== 1 || policy.kind !== 'spent_original_source_correction'
    || !matches(/^[a-z]{20}$/, policy.projectRef) || !matches(UUID, policy.operationId)
    || !matches(REVISION, policy.sourceRevision) || !matches(HASH, policy.manifestSha256)
    || !matches(HASH, policy.admissionValueSha256) || !matches(HASH, policy.sendSqlSha256)
    || policy.requireFreshBeforeImage !== true || policy.replayAllowed !== false
    || !exactKeys(policy.expectedFileHashes, FILES)
    || !FILES.every(name => matches(HASH, policy.expectedFileHashes[name]))) fail('POLICY_INVALID');
  return freeze(structuredClone(policy));
}

function canonicalLine(bytes) {
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); } catch { fail('JSON_INVALID'); }
  // Exact roundtrip rejects duplicate keys at every depth, partial/blank lines,
  // BOM/invalid UTF-8, CRLF, insignificant whitespace and noncanonical numbers.
  if (!bytes.equals(Buffer.from(`${JSON.stringify(value)}\n`))) fail('JSON_INVALID');
  return value;
}
function journalLines(bytes) {
  const parts = bytes.toString('utf8').split('\n');
  if (parts.length !== 4 || parts.at(-1) !== '' || parts.slice(0, 3).some(line => !line)) fail('JOURNAL_INVALID');
  const values = parts.slice(0, 3).map(line => canonicalLine(Buffer.from(`${line}\n`)));
  if (!bytes.equals(Buffer.from(values.map(value => `${JSON.stringify(value)}\n`).join('')))) fail('JSON_INVALID');
  return values;
}

const statFields = ['dev', 'ino', 'mode', 'nlink', 'uid', 'gid', 'size', 'mtimeNs', 'ctimeNs'];
function sameStat(a, b) { return statFields.every(key => a[key] === b[key]); }
function privateStat(stat, directory) {
  if (typeof process.getuid !== 'function' || stat.uid !== BigInt(process.getuid())
    || (stat.mode & 0o7777n) !== (directory ? 0o700n : 0o600n)
    || (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1n
      || stat.size < 1n || stat.size > BigInt(MAX_BYTES))) fail('CUSTODY_INVALID');
}
function readBounded(fd, stat) {
  const bytes = Buffer.alloc(Number(stat.size) + 1);
  let used = 0;
  while (used < bytes.length) {
    const count = fs.readSync(fd, bytes, used, bytes.length - used, used);
    if (!count) break;
    used += count;
  }
  if (used !== Number(stat.size)) fail('CUSTODY_CHANGED');
  return bytes.subarray(0, used);
}
function capture(directory) {
  const descriptors = [];
  try {
    if (typeof directory !== 'string' || resolve(directory) !== directory
      || fs.realpathSync(directory) !== directory) fail('CUSTODY_INVALID');
    const initialDirectory = fs.lstatSync(directory, { bigint: true });
    privateStat(initialDirectory, true);
    const dirFd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    descriptors.push(dirFd);
    if (!sameStat(initialDirectory, fs.fstatSync(dirFd, { bigint: true }))) fail('CUSTODY_CHANGED');
    if (!isDeepStrictEqual(fs.readdirSync(directory).sort(), FILES)) fail('CUSTODY_INVALID');
    const opened = FILES.map(name => {
      const path = join(directory, name), stat = fs.lstatSync(path, { bigint: true });
      privateStat(stat, false);
      const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      descriptors.push(fd);
      if (!sameStat(stat, fs.fstatSync(fd, { bigint: true }))) fail('CUSTODY_CHANGED');
      return { name, path, stat, fd };
    });
    const bytes = Object.fromEntries(opened.map(entry => [entry.name, readBounded(entry.fd, entry.stat)]));
    // Keep every descriptor open across both captures. Recheck path identities,
    // metadata and bytes so an append, chmod, rename or replacement cannot hide
    // behind the initially opened inode. Reads intentionally ignore atime changes.
    for (const entry of opened) {
      if (!sameStat(entry.stat, fs.fstatSync(entry.fd, { bigint: true }))
        || !sameStat(entry.stat, fs.lstatSync(entry.path, { bigint: true }))
        || !bytes[entry.name].equals(readBounded(entry.fd, entry.stat))
        || !sameStat(entry.stat, fs.fstatSync(entry.fd, { bigint: true }))) fail('CUSTODY_CHANGED');
    }
    for (const entry of opened) {
      if (!sameStat(entry.stat, fs.lstatSync(entry.path, { bigint: true }))
        || !sameStat(entry.stat, fs.fstatSync(entry.fd, { bigint: true }))) fail('CUSTODY_CHANGED');
    }
    if (fs.realpathSync(directory) !== directory
      || !sameStat(initialDirectory, fs.lstatSync(directory, { bigint: true }))
      || !sameStat(initialDirectory, fs.fstatSync(dirFd, { bigint: true }))
      || !isDeepStrictEqual(fs.readdirSync(directory).sort(), FILES)) fail('CUSTODY_CHANGED');
    return bytes;
  } catch (error) {
    if (error instanceof Error && /^SPONSORSHIP_PREDECESSOR_[A-Z_]+$/.test(error.message)) throw error;
    fail('CUSTODY_INVALID'); // Never expose path or operating-system diagnostics.
  } finally {
    for (const fd of descriptors.reverse()) fs.closeSync(fd);
  }
}

function validateBefore(before) {
  const dataKeys = ['businessCount', 'businessHash', 'cohortCount', 'cohortHash',
    'indexCount', 'indexHash', 'untouchedCount', 'untouchedHash'];
  if (!exactKeys(before, ['identity', 'catalog', 'ledger', 'revision', 'data'])
    || before.identity !== true || before.catalog !== true
    || !exactKeys(before.ledger, ['count', 'priorHash', 'targets'])
    || !Number.isSafeInteger(before.ledger.count) || before.ledger.count < 0
    || !matches(HASH, before.ledger.priorHash)
    || !isDeepStrictEqual(before.ledger.targets, ['20261028195647', '20261028225926']
      .map(version => ({ version, present: false, equal: false })))
    || !exactKeys(before.revision, ['count', 'singletonCount', 'value'])
    || before.revision.count !== 1 || before.revision.singletonCount !== 1
    || !matches(/^(0|[1-9][0-9]{0,18})$/, before.revision.value)
    || BigInt(before.revision.value) >= 9223372036854775807n
    || !exactKeys(before.data, dataKeys)
    || !dataKeys.every(key => key.endsWith('Hash') ? matches(HASH, before.data[key])
      : Number.isSafeInteger(before.data[key]) && before.data[key] >= 0)
    || before.data.cohortCount > before.data.businessCount
    || before.data.untouchedCount > before.data.indexCount) fail('BEFORE_IMAGE_INVALID');
}
function validateAdmission(admission, policy) {
  if (!exactKeys(admission, admissionKeys)
    || admission.kind !== 'sponsorship_scoped_admission_v2'
    || admission.authority !== 'authenticated-repository-owner-local-cli'
    || admission.operationId !== policy.operationId || admission.projectRef !== policy.projectRef
    || admission.sourceRevision !== policy.sourceRevision || admission.manifestSha256 !== policy.manifestSha256
    || admission.databaseName !== 'postgres' || !matches(REVISION, admission.sourceTree)
    || !['sourceFilesSha256', 'scopeSha256', 'bundleSha256'].every(key => matches(HASH, admission[key]))
    || !isDeepStrictEqual(admission.fences, { generalFreeze: 'active', githubProducer: 'disabled_manually',
      privilegedCatalogWriters: 'common_serializer_no_out_of_band', directIndexWriters: 'common_serializer_no_out_of_band',
      producerRuntimeSettings: 'preserve' })
    || !exactKeys(admission.protectedMain, ['repository', 'branch', 'sha', 'protected', 'observedAt'])
    || admission.protectedMain.repository !== 'twoimo/tzudong' || admission.protectedMain.branch !== 'main'
    || admission.protectedMain.sha !== policy.sourceRevision || admission.protectedMain.protected !== true
    || sha(JSON.stringify(admission)) !== policy.admissionValueSha256) fail('BINDING_INVALID');
  const times = [admission.issuedAt, admission.expiresAt, admission.protectedMain.observedAt];
  if (!times.every(value => matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value)) fail('BINDING_INVALID');
  const [issued, expires, observed] = times.map(Date.parse);
  if (expires <= issued || expires - issued > 600000 || observed > issued || issued - observed > 600000) fail('BINDING_INVALID');
  // Historical expiry is deliberately not renewed or used as current authority.
}

/** Library-only directory injection is for isolated real-FS fixtures. There is
 * deliberately no read/write adapter or CLI override. The default is fixed.
 * This returns local custody facts only, never "remote not applied".
 */
export function readPredecessorCustody(policy, options = {}) {
  if (!exactKeys(options, []) && !exactKeys(options, ['directory'])) fail('ARGUMENT_INVALID');
  const directory = options.directory ?? PREDECESSOR_CUSTODY_DIRECTORY;
  const pinned = validatePredecessorPolicy(policy), bytes = capture(directory);
  const fileHashes = Object.fromEntries(FILES.map(name => [name, sha(bytes[name])]));
  if (!isDeepStrictEqual(fileHashes, pinned.expectedFileHashes)) fail('HASH_MISMATCH');
  const admission = canonicalLine(bytes['admission.json']);
  validateAdmission(admission, pinned);
  const [prepared, intent, unconfirmed] = journalLines(bytes['original.jsonl']);
  const reservation = canonicalLine(bytes['send.lock']);
  const identity = { operationId: admission.operationId, admissionSha256: pinned.admissionValueSha256,
    manifestSha256: admission.manifestSha256, sourceRevision: admission.sourceRevision,
    protectedMainSha: admission.protectedMain.sha, sourceFilesSha256: admission.sourceFilesSha256,
    bundleSha256: admission.bundleSha256, projectRef: admission.projectRef };
  if (!exactKeys(prepared, ['event', 'identity', 'before', 'sqlSha256']) || prepared.event !== 'prepared'
    || !exactKeys(intent, ['event', 'identity', 'sqlSha256']) || intent.event !== 'send_intent'
    || !exactKeys(unconfirmed, ['event', 'identity']) || unconfirmed.event !== 'unconfirmed_reconcile_original'
    || !exactKeys(reservation, ['event', 'identity']) || reservation.event !== 'send_reserved'
    || ![prepared, intent, unconfirmed, reservation].every(value => exactKeys(value.identity, identityKeys)
      && isDeepStrictEqual(value.identity, identity))
    || prepared.sqlSha256 !== pinned.sendSqlSha256 || intent.sqlSha256 !== pinned.sendSqlSha256) fail('BINDING_INVALID');
  validateBefore(prepared.before);
  const binding = freeze({ kind: 'verified_spent_predecessor_custody_v1', policy: pinned, identity,
    sqlSha256: pinned.sendSqlSha256, before: prepared.before, fileHashes,
    replayAllowed: false, remoteStateVerified: false });
  verifiedBindings.add(binding);
  return binding;
}

/** Call with the actual parsed fresh, read-only preflight state. Equality is
 * necessary, never evidence that the caller performed a remote read. No local
 * reconcile receipt, selected counters or caller-created binding is accepted.
 */
export function assertPredecessorBeforeImage(binding, freshState) {
  if (!verifiedBindings.has(binding)) fail('BINDING_INVALID');
  if (!isDeepStrictEqual(freshState, binding.before)) fail('BEFORE_IMAGE_MISMATCH');
  return true;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stderr.write('SPONSORSHIP_PREDECESSOR_LIBRARY_ONLY\n');
  process.exitCode = 2;
}
