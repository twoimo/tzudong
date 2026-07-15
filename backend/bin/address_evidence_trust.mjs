import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';

const MiB = 1024 * 1024;
const textDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
const SHA256_RE = /^[a-f0-9]{64}$/;
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const IDENTIFIER_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const CANONICAL_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const VIDEO_DOMAIN = 'tzudong.address.video-manifest.v2';
const PROVIDER_DOMAIN = 'tzudong.address.provider-receipt.v2';
export const ADDRESS_EVIDENCE_ADMIN_APPROVAL_DOMAIN = 'tzudong.address.admin-approval.v1';
export const ADDRESS_EVIDENCE_ADMIN_APPROVAL_ACTION = 'apply_tzuyang_address_evidence_ledger';
export const ADDRESS_EVIDENCE_ADMIN_APPROVAL_ROLE = 'admin_approval';
export const ADDRESS_EVIDENCE_ADMIN_APPROVAL_ROOT_ID = 'tzudong-address-admin-approval-v1';
const TRUSTED_ROOTS = new WeakSet();
const TRUSTED_ANCHORS = new WeakSet();
const TRUSTED_ADMIN_APPROVAL_ANCHORS = new WeakSet();
const TRUSTED_VERIFICATIONS = new WeakSet();

export const ADDRESS_EVIDENCE_LIMITS = Object.freeze({
  maxManifestEntries: 256,
  maxProviderReceipts: 32,
  maxLedgerRows: 10_000,
  maxManifestBytes: MiB,
  maxReceiptBytes: 256 * 1024,
  maxRawArtifactBytes: 8 * MiB,
  maxTotalRawBytes: 64 * MiB,
  maxLedgerBytes: 64 * MiB,
  maxJsonlLineBytes: MiB,
  maxJsonDepth: 32,
  maxJsonMembers: 10_000,
  maxPathBytes: 4096,
});

export const BLOCKING_FLAGS = Object.freeze([
  'ambiguous_candidates',
  'candidate_place_not_evidence_derived',
  'candidate_place_not_precise',
  'claimed_result_mismatch',
  'conflicting_high_precedence_evidence',
  'deleted_or_admin_touched',
  'duplicate_evidence_digest',
  'duplicate_evidence_producer',
  'evidence_alias_detected',
  'insufficient_external_evidence',
  'insufficient_family_count',
  'insufficient_independent_producer_families',
  'insufficient_independent_provider_digests',
  'insufficient_independent_provider_producers',
  'insufficient_independent_provider_source_artifacts',
  'insufficient_independent_provider_source_identities',
  'insufficient_trusted_producer_families',
  'insufficient_validated_provider_snapshots',
  'insufficient_video_evidence',
  'invalid_provider_snapshot_digest',
  'malformed_evidence_provenance',
  'malformed_provider_snapshot',
  'malformed_timestamp_bound_video_evidence',
  'missing_all_evidence_inputs',
  'missing_or_not_selected',
  'missing_signed_provider_receipts',
  'missing_signed_video_manifest',
  'missing_timestamp_bound_video_evidence',
  'missing_validated_provider_snapshot',
  'no_precise_address',
  'place_disagreement',
  'provider_blocked',
  'rate_limited',
  'same_youtube_duplicate',
  'self_referential_provider_snapshot',
  'stage0_not_applyable',
  'stale_db_row',
  'stale_provider_snapshot',
  'trust_verification_failed',
  'unauthenticated_provider_snapshot',
  'unauthenticated_video_evidence',
  'untrusted_address_evidence',
]);

class TrustFailure extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  throw new TrustFailure(code);
}

function frozen(value) {
  if (ArrayBuffer.isView(value) || (!Array.isArray(value) && !isPlainObject(value))) return value;
  if (!Object.isFrozen(value)) {
    for (const child of Object.values(value)) frozen(child);
    Object.freeze(value);
  }
  return value;
}

function success(value) {
  const result = frozen({ ok: true, code: 'ok', ...value });
  TRUSTED_VERIFICATIONS.add(result);
  return result;
}

function failure(error) {
  return frozen({ ok: false, code: error instanceof TrustFailure ? error.code : 'internal_verification_error' });
}
async function closeAll(items, quiet = false) {
  let firstError;
  for (const item of [...items].reverse()) {
    try {
      await item.close();
    } catch (error) {
      firstError ??= error;
    }
  }
  if (firstError && !quiet) throw firstError;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function strictBase64(value, code) {
  if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0 || !BASE64_RE.test(value)) fail(code);
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length === 0 || bytes.toString('base64') !== value) fail(code);
  return bytes;
}

function strictSha256(value, code) {
  if (typeof value !== 'string' || !SHA256_RE.test(value)) fail(code);
  return value;
}

function isPlainObject(value) {
  const prototype = value && typeof value === 'object' ? Object.getPrototypeOf(value) : null;
  return prototype === Object.prototype || prototype === null;
}

function assertIJsonString(value, code = 'invalid_ijson', maxBytes = undefined) {
  if (typeof value !== 'string') fail(code);
  if (value.includes('\u0000') || (maxBytes !== undefined && Buffer.byteLength(value, 'utf8') > maxBytes)) fail(code);
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) fail(code);
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      fail(code);
    }
  }
  return value;
}

function assertIdentifier(value, code) {
  assertIJsonString(value, code, ADDRESS_EVIDENCE_LIMITS.maxPathBytes);
  if (value.normalize('NFC') !== value || !IDENTIFIER_RE.test(value)) fail(code);
  return value;
}

function assertTimestamp(value, code) {
  if (typeof value !== 'string' || !TIMESTAMP_RE.test(value)) fail(code);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) fail(code);
  return parsed;
}

function assertExactKeys(value, keys, code) {
  if (!isPlainObject(value)) fail(code);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(code);
  return value;
}

class StrictJsonParser {
  constructor(text, limits) {
    this.text = text;
    this.index = 0;
    this.depth = 0;
    this.members = 0;
    this.limits = limits;
  }

  parse() {
    const value = this.value();
    this.space();
    if (this.index !== this.text.length) fail('invalid_json');
    return value;
  }

  space() {
    while (this.index < this.text.length && /[\u0020\u000a\u000d\u0009]/.test(this.text[this.index])) this.index += 1;
  }

  value() {
    this.space();
    if (this.depth > this.limits.maxJsonDepth) fail('json_depth_exceeded');
    const char = this.text[this.index];
    if (char === '{') return this.object();
    if (char === '[') return this.array();
    if (char === '"') return this.string();
    if (char === 't' && this.text.slice(this.index, this.index + 4) === 'true') {
      this.index += 4;
      return true;
    }
    if (char === 'f' && this.text.slice(this.index, this.index + 5) === 'false') {
      this.index += 5;
      return false;
    }
    if (char === 'n' && this.text.slice(this.index, this.index + 4) === 'null') {
      this.index += 4;
      return null;
    }
    if (char === '-' || (char >= '0' && char <= '9')) return this.number();
    fail('invalid_json');
  }

  object() {
    this.depth += 1;
    if (this.depth > this.limits.maxJsonDepth) fail('json_depth_exceeded');
    this.index += 1;
    this.space();
    const result = Object.create(null);
    const seen = new Set();
    let count = 0;
    if (this.text[this.index] === '}') {
      this.index += 1;
      this.depth -= 1;
      return result;
    }
    while (true) {
      this.space();
      if (this.text[this.index] !== '"') fail('invalid_json');
      const key = this.string();
      if (seen.has(key)) fail('duplicate_json_key');
      seen.add(key);
      this.space();
      if (this.text[this.index] !== ':') fail('invalid_json');
      this.index += 1;
      result[key] = this.value();
      count += 1;
      this.members += 1;
      if (count > this.limits.maxJsonMembers || this.members > this.limits.maxJsonMembers) fail('json_member_limit_exceeded');
      this.space();
      if (this.text[this.index] === '}') {
        this.index += 1;
        this.depth -= 1;
        return result;
      }
      if (this.text[this.index] !== ',') fail('invalid_json');
      this.index += 1;
    }
  }

  array() {
    this.depth += 1;
    if (this.depth > this.limits.maxJsonDepth) fail('json_depth_exceeded');
    this.index += 1;
    this.space();
    const result = [];
    if (this.text[this.index] === ']') {
      this.index += 1;
      this.depth -= 1;
      return result;
    }
    while (true) {
      result.push(this.value());
      this.members += 1;
      if (result.length > this.limits.maxJsonMembers || this.members > this.limits.maxJsonMembers) fail('json_member_limit_exceeded');
      this.space();
      if (this.text[this.index] === ']') {
        this.index += 1;
        this.depth -= 1;
        return result;
      }
      if (this.text[this.index] !== ',') fail('invalid_json');
      this.index += 1;
    }
  }

  string() {
    if (this.text[this.index] !== '"') fail('invalid_json');
    this.index += 1;
    let result = '';
    while (this.index < this.text.length) {
      const char = this.text[this.index++];
      if (char === '"') {
        assertIJsonString(result, 'invalid_ijson');
        return result;
      }
      if (char === '\\') {
        const escaped = this.text[this.index++];
        if (escaped === '"' || escaped === '\\' || escaped === '/') result += escaped;
        else if (escaped === 'b') result += '\b';
        else if (escaped === 'f') result += '\f';
        else if (escaped === 'n') result += '\n';
        else if (escaped === 'r') result += '\r';
        else if (escaped === 't') result += '\t';
        else if (escaped === 'u') {
          const hex = this.text.slice(this.index, this.index + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('invalid_json');
          const unit = Number.parseInt(hex, 16);
          this.index += 4;
          if (unit >= 0xd800 && unit <= 0xdbff) {
            if (this.text.slice(this.index, this.index + 2) !== '\\u') fail('invalid_ijson');
            const lowHex = this.text.slice(this.index + 2, this.index + 6);
            if (!/^[0-9a-fA-F]{4}$/.test(lowHex)) fail('invalid_json');
            const low = Number.parseInt(lowHex, 16);
            if (low < 0xdc00 || low > 0xdfff) fail('invalid_ijson');
            this.index += 6;
            result += String.fromCharCode(unit, low);
          } else if (unit >= 0xdc00 && unit <= 0xdfff) {
            fail('invalid_ijson');
          } else result += String.fromCharCode(unit);
        } else fail('invalid_json');
      } else {
        if (char < '\u0020' || char === undefined) fail('invalid_json');
        const unit = char.charCodeAt(0);
        if (unit >= 0xd800 && unit <= 0xdfff) fail('invalid_ijson');
        result += char;
      }
    }
    fail('invalid_json');
  }

  number() {
    const rest = this.text.slice(this.index);
    const match = rest.match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (!match) fail('invalid_json');
    const token = match[0];
    const next = rest[token.length];
    if (next && !/[\u0020\u000a\u000d\u0009,}\]]/.test(next)) fail('invalid_json');
    this.index += token.length;
    const numeric = Number(token);
    if (!Number.isFinite(numeric) || Object.is(numeric, -0)) fail('invalid_ijson');
    if (!/[.eE]/.test(token) && !Number.isSafeInteger(numeric)) fail('unsafe_json_number');
    return numeric;
  }
}

function parseJsonBytes(bytes, limits, { canonical = false } = {}) {
  let text;
  try {
    text = textDecoder.decode(bytes);
  } catch {
    fail('invalid_utf8');
  }
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) fail('invalid_json_bom');
  if (canonical && (text.endsWith('\n') || text.endsWith('\r'))) fail('noncanonical_json');
  const value = new StrictJsonParser(text, limits).parse();
  if (canonical && canonicalizeIJson(value) !== text) fail('noncanonical_json');
  return value;
}

export function canonicalizeIJson(value) {
  const state = { members: 0 };
  function canonicalize(item, depth = 0) {
    if (depth > ADDRESS_EVIDENCE_LIMITS.maxJsonDepth) fail('json_depth_exceeded');
    if (item === null) return 'null';
    if (item === true) return 'true';
    if (item === false) return 'false';
    if (typeof item === 'string') return JSON.stringify(assertIJsonString(item));
    if (typeof item === 'number') {
      if (!Number.isFinite(item) || Object.is(item, -0) || (Number.isInteger(item) && !Number.isSafeInteger(item))) fail('invalid_ijson');
      return JSON.stringify(item);
    }
    if (Array.isArray(item)) {
      state.members += item.length;
      if (item.length > ADDRESS_EVIDENCE_LIMITS.maxJsonMembers || state.members > ADDRESS_EVIDENCE_LIMITS.maxJsonMembers) fail('json_member_limit_exceeded');
      return `[${item.map((child) => canonicalize(child, depth + 1)).join(',')}]`;
    }
    if (!isPlainObject(item)) fail('invalid_ijson');
    const keys = Object.keys(item);
    state.members += keys.length;
    if (keys.length > ADDRESS_EVIDENCE_LIMITS.maxJsonMembers || state.members > ADDRESS_EVIDENCE_LIMITS.maxJsonMembers) fail('json_member_limit_exceeded');
    keys.forEach((key) => assertIJsonString(key));
    keys.sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(item[key], depth + 1)}`).join(',')}}`;
  }
  return canonicalize(value);
}

export function canonicalEnvelopeBytes(domain, envelope) {
  if (domain !== VIDEO_DOMAIN && domain !== PROVIDER_DOMAIN && domain !== ADDRESS_EVIDENCE_ADMIN_APPROVAL_DOMAIN) fail('unknown_signature_domain');
  return Buffer.from(`${domain}\n${canonicalizeIJson(envelope)}`, 'utf8');
}

function effectiveLimits(limits) {
  const result = {};
  for (const [key, maximum] of Object.entries(ADDRESS_EVIDENCE_LIMITS)) {
    const requested = limits?.[key];
    result[key] = requested === undefined ? maximum : Math.min(maximum, requested);
    if (!Number.isSafeInteger(result[key]) || result[key] < 1) fail('invalid_limits');
  }
  return Object.freeze(result);
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs && left.mode === right.mode;
}

function fileIdentity(stat) {
  return Object.freeze({
    dev: Number(stat.dev),
    ino: Number(stat.ino),
    size: Number(stat.size),
    mtimeMs: Number(stat.mtimeMs),
    ctimeMs: Number(stat.ctimeMs),
    mode: Number(stat.mode),
  });
}

function pathKey(value) {
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

function assertRelativePath(value, limits, code = 'invalid_artifact_path') {
  assertIJsonString(value, code);
  if (value.normalize('NFC') !== value) fail(code);
  if (Buffer.byteLength(value, 'utf8') > limits.maxPathBytes || value.includes('\\') || value.startsWith('/') || value.startsWith('//') || /^[A-Za-z]:/.test(value)) fail(code);
  const parts = value.split('/');
  if (!parts.length || parts.some((part) => !part || part === '.' || part === '..')) fail(code);
  return value;
}

async function bindRoot(rootId, rawRoot, limits) {
  assertIdentifier(rootId, 'invalid_root_id');
  assertExactKeys(rawRoot, ['kind', 'path'], 'invalid_trust_root');
  if (!['evaluation', 'crawling', 'provider'].includes(rawRoot.kind) || typeof rawRoot.path !== 'string' || !path.isAbsolute(rawRoot.path)) fail('invalid_trust_root');
  if (Buffer.byteLength(rawRoot.path, 'utf8') > limits.maxPathBytes) fail('invalid_trust_root');
  let before;
  let realPath;
  let after;
  try {
    before = await fsp.lstat(rawRoot.path);
    if (!before.isDirectory() || before.isSymbolicLink()) fail('unsafe_trust_root');
    realPath = await fsp.realpath(rawRoot.path);
    after = await fsp.lstat(realPath);
  } catch (error) {
    if (error instanceof TrustFailure) throw error;
    fail('unavailable_trust_root');
  }
  if (!after.isDirectory() || after.isSymbolicLink() || !sameIdentity(fileIdentity(before), fileIdentity(after))) fail('unsafe_trust_root');
  const bound = frozen({ id: rootId, kind: rawRoot.kind, path: rawRoot.path, realPath, identity: fileIdentity(after) });
  TRUSTED_ROOTS.add(bound);
  return bound;
}

function parseEnvObject(env, key, limits) {
  if (!env || typeof env[key] !== 'string' || env[key].length === 0) fail('missing_trust_anchors');
  const bytes = Buffer.from(env[key], 'utf8');
  if (bytes.length > limits.maxManifestBytes) fail('trust_anchor_bytes_exceeded');
  const value = parseJsonBytes(bytes, limits);
  if (!isPlainObject(value)) fail('invalid_trust_anchors');
  return value;
}

function parseSignerMap(value, { provider }) {
  const result = Object.create(null);
  for (const [signerId, record] of Object.entries(value)) {
    assertIdentifier(signerId, 'invalid_signer_id');
    assertExactKeys(record, provider
      ? ['algorithm', 'producer_id', 'provider_id', 'public_key_spki_der_base64', 'public_key_spki_sha256']
      : ['algorithm', 'public_key_spki_der_base64', 'public_key_spki_sha256'], 'invalid_signer_anchor');
    if (record.algorithm !== 'ed25519') fail('unsupported_signature_algorithm');
    const der = strictBase64(record.public_key_spki_der_base64, 'invalid_spki_base64');
    if (sha256(der) !== strictSha256(record.public_key_spki_sha256, 'invalid_spki_sha256')) fail('spki_hash_mismatch');
    let key;
    try {
      key = createPublicKey({ key: der, format: 'der', type: 'spki' });
    } catch {
      fail('invalid_spki_key');
    }
    if (key.asymmetricKeyType !== 'ed25519') fail('invalid_spki_key');
    if (provider) {
      assertIdentifier(record.provider_id, 'invalid_provider_assignment');
      assertIdentifier(record.producer_id, 'invalid_provider_assignment');
    }
    result[signerId] = frozen({
      algorithm: 'ed25519',
      publicKeySpkiSha256: record.public_key_spki_sha256,
      publicKey: key,
      ...(provider ? { providerId: record.provider_id, producerId: record.producer_id } : {}),
    });
  }
  if (Object.keys(result).length === 0) fail('missing_trust_anchors');
  return frozen(result);
}

function parseAdminApprovalSignerMap(value) {
  const result = Object.create(null);
  for (const [signerId, record] of Object.entries(value)) {
    assertIdentifier(signerId, 'invalid_admin_approval_signer_id');
    assertExactKeys(record, ['algorithm', 'public_key_spki_der_base64', 'public_key_spki_sha256', 'purpose', 'role', 'root_id'], 'invalid_admin_approval_signer_anchor');
    if (record.algorithm !== 'ed25519') fail('unsupported_signature_algorithm');
    if (record.role !== ADDRESS_EVIDENCE_ADMIN_APPROVAL_ROLE
      || record.purpose !== ADDRESS_EVIDENCE_ADMIN_APPROVAL_ACTION
      || record.root_id !== ADDRESS_EVIDENCE_ADMIN_APPROVAL_ROOT_ID) fail('admin_approval_signer_scope_invalid');
    const der = strictBase64(record.public_key_spki_der_base64, 'invalid_admin_approval_spki_base64');
    if (sha256(der) !== strictSha256(record.public_key_spki_sha256, 'invalid_admin_approval_spki_sha256')) fail('admin_approval_spki_hash_mismatch');
    let key;
    try {
      key = createPublicKey({ key: der, format: 'der', type: 'spki' });
    } catch {
      fail('invalid_admin_approval_spki_key');
    }
    if (key.asymmetricKeyType !== 'ed25519') fail('invalid_admin_approval_spki_key');
    result[signerId] = frozen({
      algorithm: 'ed25519',
      publicKeySpkiSha256: record.public_key_spki_sha256,
      publicKey: key,
      purpose: record.purpose,
      role: record.role,
      rootId: record.root_id,
    });
  }
  if (Object.keys(result).length === 0) fail('missing_admin_approval_trust_anchors');
  return frozen(result);
}

export async function loadTrustAnchors(env, options = {}) {
  try {
    const limits = effectiveLimits(options.limits);
    const videoRecords = parseEnvObject(env, 'TZUYANG_ADDRESS_VIDEO_SIGNERS_JSON', limits);
    const providerRecords = parseEnvObject(env, 'TZUYANG_ADDRESS_PROVIDER_SIGNERS_JSON', limits);
    const rootRecords = parseEnvObject(env, 'TZUYANG_ADDRESS_SOURCE_ROOTS_JSON', limits);
    const videoSigners = parseSignerMap(videoRecords, { provider: false });
    const providerSigners = parseSignerMap(providerRecords, { provider: true });
    for (const signerId of Object.keys(videoSigners)) if (providerSigners[signerId]) fail('signer_role_collision');
    const pinnedKeyHashes = new Set();
    for (const signer of [...Object.values(videoSigners), ...Object.values(providerSigners)]) {
      if (pinnedKeyHashes.has(signer.publicKeySpkiSha256)) fail('signer_key_collision');
      pinnedKeyHashes.add(signer.publicKeySpkiSha256);
    }
    const roots = Object.create(null);
    const canonicalRoots = new Set();
    for (const [rootId, record] of Object.entries(rootRecords)) {
      const root = await bindRoot(rootId, record, limits);
      if (canonicalRoots.has(pathKey(root.realPath))) fail('duplicate_trust_root');
      canonicalRoots.add(pathKey(root.realPath));
      roots[rootId] = root;
    }
    if (Object.keys(roots).length === 0) fail('missing_trust_anchors');
    if (options.explicitRoots !== undefined) {
      if (!isPlainObject(options.explicitRoots)) fail('invalid_explicit_roots');
      const configured = Object.keys(roots).sort();
      const explicit = Object.keys(options.explicitRoots).sort();
      if (configured.length !== explicit.length || configured.some((id, index) => id !== explicit[index])) fail('explicit_root_mismatch');
      for (const rootId of configured) {
        const explicitPath = options.explicitRoots[rootId];
        if (typeof explicitPath !== 'string' || !path.isAbsolute(explicitPath)) fail('explicit_root_mismatch');
        let realPath;
        try {
          realPath = await fsp.realpath(explicitPath);
        } catch {
          fail('explicit_root_mismatch');
        }
        if (pathKey(realPath) !== pathKey(roots[rootId].realPath)) fail('explicit_root_mismatch');
      }
    }
    const anchors = frozen({ kind: 'tzudong.address.trust-anchors.v2', limits, videoSigners, providerSigners, roots });
    TRUSTED_ANCHORS.add(anchors);
    return anchors;
  } catch (error) {
    if (error instanceof TrustFailure) throw error;
    throw new TrustFailure('invalid_trust_anchors');
  }
}

function assertBoundRoot(root) {
  if (!TRUSTED_ROOTS.has(root) || typeof root.realPath !== 'string' || typeof root.id !== 'string' || !root.identity) fail('invalid_trust_root');
  return root;
}
async function assertRootStillBound(root) {
  let stat;
  let realPath;
  try {
    stat = await fsp.lstat(root.realPath);
    realPath = await fsp.realpath(root.realPath);
  } catch {
    fail('trust_root_changed');
  }
  if (!stat.isDirectory() || stat.isSymbolicLink() || !sameIdentity(root.identity, fileIdentity(stat)) || pathKey(realPath) !== pathKey(root.realPath)) fail('trust_root_changed');
}

async function assertPathComponents(root, relativePath) {
  await assertRootStillBound(root);
  let current = root.realPath;
  for (const component of relativePath.split('/')) {
    current = path.join(current, component);
    let stat;
    try {
      stat = await fsp.lstat(current);
    } catch {
      fail('artifact_not_found');
    }
    if (stat.isSymbolicLink()) fail('artifact_symlink_detected');
  }
  return current;
}

export async function openBoundArtifact(root, ref, limits = ADDRESS_EVIDENCE_LIMITS) {
  let handle;
  try {
    const effective = effectiveLimits(limits);
    const boundRoot = assertBoundRoot(root);
    assertExactKeys(ref, ['byte_length', 'relative_path', 'sha256'], 'invalid_artifact_reference');
    const relativePath = assertRelativePath(ref.relative_path, effective);
    if (!Number.isSafeInteger(ref.byte_length) || ref.byte_length < 0 || ref.byte_length > effective.maxRawArtifactBytes) fail('invalid_artifact_length');
    const expectedDigest = strictSha256(ref.sha256, 'invalid_artifact_digest');
    const fullPath = await assertPathComponents(boundRoot, relativePath);
    const before = await fsp.lstat(fullPath);
    if (!before.isFile() || before.isSymbolicLink() || before.size !== ref.byte_length) fail('artifact_identity_mismatch');
    let canonicalPath;
    try {
      canonicalPath = await fsp.realpath(fullPath);
    } catch {
      fail('artifact_not_found');
    }
    const containment = path.relative(boundRoot.realPath, canonicalPath);
    if (!containment || containment === '..' || containment.startsWith(`..${path.sep}`) || path.isAbsolute(containment)) fail('artifact_root_escape');
    const flags = fs.constants.O_RDONLY | (process.platform === 'win32' ? 0 : (fs.constants.O_NOFOLLOW ?? 0));
    try {
      handle = await fsp.open(fullPath, flags);
    } catch {
      fail('artifact_open_failed');
    }
    const opened = await handle.stat();
    const beforeIdentity = fileIdentity(before);
    const openedIdentity = fileIdentity(opened);
    if (!opened.isFile() || !sameIdentity(beforeIdentity, openedIdentity)) fail('artifact_replaced_during_open');
    if (opened.size > effective.maxRawArtifactBytes) fail('artifact_bytes_exceeded');
    const bytes = Buffer.allocUnsafe(opened.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) fail('artifact_truncated_during_read');
      offset += bytesRead;
    }
    const afterRead = await handle.stat();
    const afterPath = await fsp.lstat(fullPath);
    const afterRealPath = await fsp.realpath(fullPath);
    if (!sameIdentity(openedIdentity, fileIdentity(afterRead)) || !sameIdentity(openedIdentity, fileIdentity(afterPath)) || pathKey(afterRealPath) !== pathKey(canonicalPath)) fail('artifact_changed_during_read');
    const digest = sha256(bytes);
    if (digest !== expectedDigest) fail('artifact_digest_mismatch');
    let closed = false;
    const recheck = async () => {
      if (closed) fail('artifact_handle_closed');
      await assertRootStillBound(boundRoot);
      const handleStat = await handle.stat();
      const pathStat = await fsp.lstat(fullPath);
      const realPath = await fsp.realpath(fullPath);
      if (!sameIdentity(openedIdentity, fileIdentity(handleStat)) || !sameIdentity(openedIdentity, fileIdentity(pathStat)) || pathKey(realPath) !== pathKey(canonicalPath)) fail('artifact_changed_after_verification');
      return true;
    };
    const close = async () => {
      if (!closed) {
        closed = true;
        await handle.close();
      }
    };
    return frozen({ bytes, byteLength: bytes.length, sha256: digest, rootId: boundRoot.id, relativePath, recheck, close });
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    throw error;
  }
}

function assertTrustedAnchors(anchors) {
  if (!TRUSTED_ANCHORS.has(anchors) || anchors.kind !== 'tzudong.address.trust-anchors.v2' || !anchors.roots || !anchors.videoSigners || !anchors.providerSigners) fail('invalid_trust_anchors');
  return anchors;
}
export function loadAddressEvidenceAdminApprovalAnchors(env, evidenceAnchors) {
  try {
    const evidence = assertTrustedAnchors(evidenceAnchors);
    const records = parseEnvObject(env, 'TZUYANG_ADDRESS_ADMIN_APPROVAL_SIGNERS_JSON', evidence.limits);
    const signers = parseAdminApprovalSignerMap(records);
    if (evidence.roots[ADDRESS_EVIDENCE_ADMIN_APPROVAL_ROOT_ID]) fail('admin_approval_root_collision');
    const producerSignerIds = new Set([...Object.keys(evidence.videoSigners), ...Object.keys(evidence.providerSigners)]);
    const producerKeyHashes = new Set([
      ...Object.values(evidence.videoSigners).map((signer) => signer.publicKeySpkiSha256),
      ...Object.values(evidence.providerSigners).map((signer) => signer.publicKeySpkiSha256),
    ]);
    const configuredSignerKeyHashes = new Set();
    for (const [signerId, signer] of Object.entries(signers)) {
      if (configuredSignerKeyHashes.has(signer.publicKeySpkiSha256)) fail('admin_approval_signer_key_collision');
      configuredSignerKeyHashes.add(signer.publicKeySpkiSha256);
      if (producerSignerIds.has(signerId)) fail('admin_approval_signer_role_collision');
      if (producerKeyHashes.has(signer.publicKeySpkiSha256)) fail('admin_approval_signer_key_collision');
    }
    const anchors = frozen({
      kind: 'tzudong.address.admin-approval-anchors.v1',
      limits: evidence.limits,
      purpose: ADDRESS_EVIDENCE_ADMIN_APPROVAL_ACTION,
      role: ADDRESS_EVIDENCE_ADMIN_APPROVAL_ROLE,
      rootId: ADDRESS_EVIDENCE_ADMIN_APPROVAL_ROOT_ID,
      signers,
    });
    TRUSTED_ADMIN_APPROVAL_ANCHORS.add(anchors);
    return anchors;
  } catch (error) {
    if (error instanceof TrustFailure) throw error;
    throw new TrustFailure('invalid_admin_approval_trust_anchors');
  }
}

function assertTrustedAdminApprovalAnchors(anchors) {
  if (!TRUSTED_ADMIN_APPROVAL_ANCHORS.has(anchors)
    || anchors.kind !== 'tzudong.address.admin-approval-anchors.v1'
    || anchors.purpose !== ADDRESS_EVIDENCE_ADMIN_APPROVAL_ACTION
    || anchors.role !== ADDRESS_EVIDENCE_ADMIN_APPROVAL_ROLE
    || anchors.rootId !== ADDRESS_EVIDENCE_ADMIN_APPROVAL_ROOT_ID
    || !anchors.signers) fail('invalid_admin_approval_trust_anchors');
  return anchors;
}

function verifyDetachedWrapper(bytes, domain, signer, limits) {
  const wrapper = parseJsonBytes(bytes, limits, { canonical: true });
  assertExactKeys(wrapper, ['envelope', 'envelope_sha256', 'signature', 'signature_algorithm', 'signer_id'], 'invalid_signed_wrapper');
  if (wrapper.signature_algorithm !== 'ed25519') fail('unsupported_signature_algorithm');
  assertIdentifier(wrapper.signer_id, 'invalid_signer_id');
  if (!signer) fail('unknown_signer');
  const signedBytes = canonicalEnvelopeBytes(domain, wrapper.envelope);
  if (sha256(signedBytes) !== strictSha256(wrapper.envelope_sha256, 'invalid_envelope_digest')) fail('envelope_digest_mismatch');
  const signature = strictBase64(wrapper.signature, 'invalid_signature_base64');
  if (signature.length !== 64) fail('invalid_signature');
  if (!verifySignature(null, signedBytes, signer.publicKey, signature)) fail('invalid_signature');
  return { wrapper, envelope: wrapper.envelope, envelopeSha256: wrapper.envelope_sha256 };
}

function assertManifestEntry(entry, limits) {
  assertExactKeys(entry, ['artifact_id', 'byte_length', 'kind', 'relative_path', 'sha256', 'source_identity'], 'invalid_manifest_entry');
  assertIdentifier(entry.artifact_id, 'invalid_artifact_id');
  if (!['transform', 'transcript', 'frame_caption', 'meta'].includes(entry.kind)) fail('invalid_manifest_entry');
  assertRelativePath(entry.relative_path, limits);
  if (!Number.isSafeInteger(entry.byte_length) || entry.byte_length < 0 || entry.byte_length > limits.maxRawArtifactBytes) fail('invalid_manifest_entry');
  strictSha256(entry.sha256, 'invalid_manifest_entry');
  assertExactKeys(entry.source_identity, ['record_selector_sha256', 'video_id'], 'invalid_manifest_source_identity');
  assertIdentifier(entry.source_identity.video_id, 'invalid_video_id');
  strictSha256(entry.source_identity.record_selector_sha256, 'invalid_record_selector');
}

function sourceRefFrom(value, limits) {
  assertExactKeys(value, ['artifact_id', 'byte_length', 'kind', 'relative_path', 'root_id', 'sha256'], 'invalid_source_artifact');
  assertIdentifier(value.root_id, 'invalid_root_id');
  assertIdentifier(value.artifact_id, 'invalid_artifact_id');
  if (!['transform', 'transcript', 'frame_caption', 'meta', 'provider_response'].includes(value.kind)) fail('invalid_source_artifact');
  assertRelativePath(value.relative_path, limits);
  if (!Number.isSafeInteger(value.byte_length) || value.byte_length < 0 || value.byte_length > limits.maxRawArtifactBytes) fail('invalid_source_artifact');
  strictSha256(value.sha256, 'invalid_source_artifact');
  return value;
}

function sameSourceRef(entry, source) {
  return entry.artifact_id === source.artifact_id
    && entry.kind === source.kind
    && entry.relative_path === source.relative_path
    && entry.byte_length === source.byte_length
    && entry.sha256 === source.sha256;
}

function nowMilliseconds(value) {
  if (value === undefined) return Date.now();
  const result = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(result)) fail('invalid_verification_time');
  return result;
}
function assertCanonicalUuid(value, code) {
  if (typeof value !== 'string' || !CANONICAL_UUID_RE.test(value)) fail(code);
  return value;
}

function assertAdminApprovalEnvelope(envelope, now) {
  assertExactKeys(envelope, ['action', 'actor_user_id', 'expires_at', 'issued_at', 'nonce', 'operation_id', 'review_manifest_sha256', 'schema_version'], 'invalid_admin_approval_envelope');
  if (envelope.schema_version !== 1 || envelope.action !== ADDRESS_EVIDENCE_ADMIN_APPROVAL_ACTION) fail('invalid_admin_approval_action');
  assertCanonicalUuid(envelope.actor_user_id, 'invalid_admin_approval_actor');
  assertCanonicalUuid(envelope.operation_id, 'invalid_admin_approval_operation');
  strictSha256(envelope.review_manifest_sha256, 'invalid_admin_approval_manifest');
  const nonce = strictBase64(envelope.nonce, 'invalid_admin_approval_nonce');
  if (nonce.length < 16 || nonce.length > 64) fail('invalid_admin_approval_nonce');
  const issuedAt = assertTimestamp(envelope.issued_at, 'invalid_admin_approval_timestamp');
  const expiresAt = assertTimestamp(envelope.expires_at, 'invalid_admin_approval_timestamp');
  if (expiresAt <= issuedAt) fail('invalid_admin_approval_timestamp');
  if (now < issuedAt) fail('admin_approval_not_yet_valid');
  if (now >= expiresAt) fail('admin_approval_expired');
  return frozen({
    actorUserId: envelope.actor_user_id,
    action: envelope.action,
    expiresAt: envelope.expires_at,
    issuedAt: envelope.issued_at,
    nonceSha256: sha256(nonce),
    operationId: envelope.operation_id,
    reviewManifestSha256: envelope.review_manifest_sha256,
  });
}

export function verifyAddressEvidenceAdminApproval(input) {
  try {
    if (!isPlainObject(input)) fail('invalid_admin_approval_input');
    const anchors = assertTrustedAdminApprovalAnchors(input.anchors);
    const approvalBytes = input.approvalBytes;
    if (!Buffer.isBuffer(approvalBytes) || approvalBytes.length === 0 || approvalBytes.length > anchors.limits.maxReceiptBytes) fail('invalid_admin_approval_bytes');
    const actorUserId = assertCanonicalUuid(input.actorUserId, 'invalid_admin_approval_actor');
    const operationId = assertCanonicalUuid(input.operationId, 'invalid_admin_approval_operation');
    const reviewManifestSha256 = strictSha256(input.reviewManifestSha256, 'invalid_admin_approval_manifest');
    const signed = verifyDetachedWrapper(approvalBytes, ADDRESS_EVIDENCE_ADMIN_APPROVAL_DOMAIN, anchors.signers[parseJsonBytes(approvalBytes, anchors.limits, { canonical: true }).signer_id], anchors.limits);
    const envelope = assertAdminApprovalEnvelope(signed.envelope, nowMilliseconds(input.now));
    if (envelope.actorUserId !== actorUserId) fail('admin_approval_actor_mismatch');
    if (envelope.operationId !== operationId) fail('admin_approval_operation_mismatch');
    if (envelope.reviewManifestSha256 !== reviewManifestSha256) fail('admin_approval_manifest_mismatch');
    return frozen({
      ok: true,
      action: envelope.action,
      actorUserId: envelope.actorUserId,
      approvalEnvelopeSha256: sha256(approvalBytes),
      envelopeSha256: signed.envelopeSha256,
      expiresAt: envelope.expiresAt,
      issuedAt: envelope.issuedAt,
      nonceSha256: envelope.nonceSha256,
      operationId: envelope.operationId,
      reviewManifestSha256: envelope.reviewManifestSha256,
      signerId: signed.wrapper.signer_id,
    });
  } catch (error) {
    return failure(error);
  }
}

function assertManifestEnvelope(envelope, limits, now) {
  assertExactKeys(envelope, ['entries', 'expires_at', 'generated_at', 'manifest_id', 'schema_version', 'source_root_id'], 'invalid_manifest_envelope');
  if (envelope.schema_version !== 2) fail('unsupported_manifest_schema');
  assertIdentifier(envelope.manifest_id, 'invalid_manifest_id');
  assertIdentifier(envelope.source_root_id, 'invalid_root_id');
  const generated = assertTimestamp(envelope.generated_at, 'invalid_manifest_timestamp');
  const expires = assertTimestamp(envelope.expires_at, 'invalid_manifest_timestamp');
  if (expires <= generated || now < generated || now > expires) fail('manifest_expired');
  if (!Array.isArray(envelope.entries) || envelope.entries.length === 0 || envelope.entries.length > limits.maxManifestEntries) fail('invalid_manifest_entries');
  const paths = new Set();
  const artifactIds = new Set();
  for (const entry of envelope.entries) {
    assertManifestEntry(entry, limits);
    const key = entry.relative_path.toLowerCase();
    if (paths.has(key) || artifactIds.has(entry.artifact_id)) fail('manifest_membership_collision');
    paths.add(key);
    artifactIds.add(entry.artifact_id);
  }
}

function manifestReference(value, limits) {
  assertExactKeys(value, ['entry_artifact_id', 'manifest_byte_length', 'manifest_relative_path', 'manifest_sha256', 'manifest_signer_id'], 'invalid_trusted_video_reference');
  assertRelativePath(value.manifest_relative_path, limits);
  if (!Number.isSafeInteger(value.manifest_byte_length) || value.manifest_byte_length < 0 || value.manifest_byte_length > limits.maxManifestBytes) fail('invalid_trusted_video_reference');
  strictSha256(value.manifest_sha256, 'invalid_trusted_video_reference');
  assertIdentifier(value.manifest_signer_id, 'invalid_trusted_video_reference');
  assertIdentifier(value.entry_artifact_id, 'invalid_trusted_video_reference');
  return value;
}

function normalizePlace(place, code) {
  assertExactKeys(place, ['jibun_address', 'lat', 'lng', 'name', 'road_address'], code);
  for (const field of ['name', 'road_address', 'jibun_address']) {
    if (typeof place[field] !== 'string') fail(code);
    assertIJsonString(place[field], code);
  }
  if (!place.name.trim() || (!place.road_address.trim() && !place.jibun_address.trim())) fail(code);
  for (const [field, minimum, maximum] of [['lat', -90, 90], ['lng', -180, 180]]) {
    const coordinate = place[field];
    if (typeof coordinate !== 'number' || !Number.isFinite(coordinate) || Object.is(coordinate, -0) || coordinate < minimum || coordinate > maximum || Math.round(coordinate * 10_000_000) !== coordinate * 10_000_000) fail(code);
  }
  return frozen({
    name: place.name.normalize('NFC').trim().replace(/\s+/gu, ' '),
    road_address: place.road_address.normalize('NFC').trim().replace(/\s+/gu, ' '),
    jibun_address: place.jibun_address.normalize('NFC').trim().replace(/\s+/gu, ' '),
    lat: place.lat,
    lng: place.lng,
  });
}

function samePlace(left, right) {
  return left.name === right.name
    && left.road_address === right.road_address
    && left.jibun_address === right.jibun_address
    && left.lat === right.lat
    && left.lng === right.lng;
}

function candidateFrom(value) {
  if (!isPlainObject(value)) fail('invalid_candidate');
  assertExactKeys(value, ['place', 'query_sha256', 'restaurant_id', 'video_id'], 'invalid_candidate');
  assertIdentifier(value.restaurant_id, 'invalid_candidate');
  assertIdentifier(value.video_id, 'invalid_candidate');
  strictSha256(value.query_sha256, 'invalid_candidate');
  return frozen({ restaurant_id: value.restaurant_id, video_id: value.video_id, query_sha256: value.query_sha256, place: normalizePlace(value.place, 'invalid_candidate_place') });
}

export async function verifyVideoManifest(input) {
  const holds = [];
  try {
    if (!isPlainObject(input)) fail('invalid_manifest_input');
    const anchors = assertTrustedAnchors(input.anchors ?? input.trustAnchors);
    const limits = anchors.limits;
    const reference = manifestReference(input.reference ?? input.video, limits);
    const source = sourceRefFrom(input.sourceArtifact ?? input.source_artifact, limits);
    const rootId = input.manifestRootId ?? input.manifest_root_id ?? source.root_id;
    if (typeof rootId !== 'string' || rootId !== source.root_id || !anchors.roots[rootId]) fail('manifest_root_mismatch');
    const root = anchors.roots[rootId];
    if (root.kind === 'provider') fail('manifest_root_mismatch');
    const manifest = await openBoundArtifact(root, {
      relative_path: reference.manifest_relative_path,
      byte_length: reference.manifest_byte_length,
      sha256: reference.manifest_sha256,
    }, { ...limits, maxRawArtifactBytes: limits.maxManifestBytes });
    holds.push(manifest);
    const signer = anchors.videoSigners[reference.manifest_signer_id];
    const signed = verifyDetachedWrapper(manifest.bytes, VIDEO_DOMAIN, signer, limits);
    if (signed.wrapper.signer_id !== reference.manifest_signer_id) fail('manifest_signer_mismatch');
    assertManifestEnvelope(signed.envelope, limits, nowMilliseconds(input.now));
    if (signed.envelope.source_root_id !== rootId) fail('manifest_root_mismatch');
    const entry = signed.envelope.entries.find((item) => item.artifact_id === reference.entry_artifact_id);
    if (!entry || !sameSourceRef(entry, source)) fail('manifest_membership_mismatch');
    const expectedVideoId = input.video_id ?? input.videoId ?? input.candidate?.video_id;
    if (expectedVideoId !== undefined && entry.source_identity.video_id !== expectedVideoId) fail('manifest_subject_mismatch');
    const selector = input.record_selector_sha256 ?? input.recordSelectorSha256;
    if (selector !== undefined && entry.source_identity.record_selector_sha256 !== selector) fail('manifest_source_selector_mismatch');
    const artifact = await openBoundArtifact(root, {
      relative_path: entry.relative_path,
      byte_length: entry.byte_length,
      sha256: entry.sha256,
    }, limits);
    holds.push(artifact);
    const close = async () => closeAll(holds);
    const recheck = async () => {
      for (const hold of holds) await hold.recheck();
      return true;
    };
    return success({
      manifest_id: signed.envelope.manifest_id,
      signer_id: signed.wrapper.signer_id,
      envelope_sha256: signed.envelopeSha256,
      manifest_sha256: manifest.sha256,
      manifest_relative_path: reference.manifest_relative_path,
      source_root_id: rootId,
      entry: frozen({ ...entry }),
      raw_artifact_sha256: artifact.sha256,
      recheck,
      close,
    });
  } catch (error) {
    await closeAll(holds, true);
    return failure(error);
  }
}

function receiptReference(value, limits) {
  assertExactKeys(value, ['artifact_id', 'receipt_byte_length', 'receipt_id', 'receipt_relative_path', 'receipt_sha256', 'receipt_signer_id'], 'invalid_trusted_provider_reference');
  assertIdentifier(value.artifact_id, 'invalid_trusted_provider_reference');
  assertRelativePath(value.receipt_relative_path, limits);
  if (!Number.isSafeInteger(value.receipt_byte_length) || value.receipt_byte_length < 0 || value.receipt_byte_length > limits.maxReceiptBytes) fail('invalid_trusted_provider_reference');
  strictSha256(value.receipt_sha256, 'invalid_trusted_provider_reference');
  assertIdentifier(value.receipt_signer_id, 'invalid_trusted_provider_reference');
  assertIdentifier(value.receipt_id, 'invalid_trusted_provider_reference');
  return value;
}

function assertReceiptEnvelope(envelope, limits, now) {
  assertExactKeys(envelope, ['artifact', 'content', 'expires_at', 'fetched_at', 'nonce', 'producer_id', 'provider_id', 'receipt_id', 'schema_version', 'source_id', 'source_root_id', 'subject'], 'invalid_receipt_envelope');
  if (envelope.schema_version !== 2) fail('unsupported_receipt_schema');
  for (const field of ['receipt_id', 'provider_id', 'producer_id', 'source_id', 'source_root_id']) assertIdentifier(envelope[field], 'invalid_receipt_envelope');
  const fetched = assertTimestamp(envelope.fetched_at, 'invalid_receipt_timestamp');
  const expires = assertTimestamp(envelope.expires_at, 'invalid_receipt_timestamp');
  if (expires <= fetched || now < fetched || now > expires) fail('receipt_expired');
  strictBase64(envelope.nonce, 'invalid_receipt_nonce');
  assertExactKeys(envelope.artifact, ['artifact_id', 'byte_length', 'relative_path', 'sha256'], 'invalid_receipt_artifact');
  assertIdentifier(envelope.artifact.artifact_id, 'invalid_receipt_artifact');
  assertRelativePath(envelope.artifact.relative_path, limits);
  if (!Number.isSafeInteger(envelope.artifact.byte_length) || envelope.artifact.byte_length < 0 || envelope.artifact.byte_length > limits.maxRawArtifactBytes) fail('invalid_receipt_artifact');
  strictSha256(envelope.artifact.sha256, 'invalid_receipt_artifact');
  assertExactKeys(envelope.subject, ['query_sha256', 'restaurant_id', 'video_id'], 'invalid_receipt_subject');
  assertIdentifier(envelope.subject.restaurant_id, 'invalid_receipt_subject');
  assertIdentifier(envelope.subject.video_id, 'invalid_receipt_subject');
  strictSha256(envelope.subject.query_sha256, 'invalid_receipt_subject');
  assertExactKeys(envelope.content, ['canonical_sha256', 'media_type', 'place'], 'invalid_receipt_content');
  if (envelope.content.media_type !== 'application/json') fail('invalid_receipt_content');
  strictSha256(envelope.content.canonical_sha256, 'invalid_receipt_content');
  normalizePlace(envelope.content.place, 'invalid_receipt_place');
}

function rawSelectedEnvelope(raw, input) {
  if (input.selectProviderResult !== undefined) {
    if (typeof input.selectProviderResult !== 'function') fail('invalid_provider_result_selector');
    const selected = input.selectProviderResult(raw);
    if (!isPlainObject(selected)) fail('invalid_provider_result');
    return selected;
  }
  if (!isPlainObject(raw)) fail('invalid_provider_result');
  return raw;
}

function collectStrings(value, target = new Set()) {
  if (typeof value === 'string') target.add(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, target));
  else if (isPlainObject(value)) Object.values(value).forEach((item) => collectStrings(item, target));
  return target;
}

export async function verifyProviderReceipt(input) {
  const holds = [];
  try {
    if (!isPlainObject(input)) fail('invalid_receipt_input');
    const anchors = assertTrustedAnchors(input.anchors ?? input.trustAnchors);
    const limits = anchors.limits;
    const reference = receiptReference(input.reference ?? input.provider, limits);
    const source = sourceRefFrom(input.sourceArtifact ?? input.source_artifact, limits);
    const candidate = candidateFrom(input.candidate);
    const rootId = input.receiptRootId ?? input.receipt_root_id ?? source.root_id;
    if (typeof rootId !== 'string' || rootId !== source.root_id || !anchors.roots[rootId] || anchors.roots[rootId].kind !== 'provider') fail('receipt_root_mismatch');
    const receipt = await openBoundArtifact(anchors.roots[rootId], {
      relative_path: reference.receipt_relative_path,
      byte_length: reference.receipt_byte_length,
      sha256: reference.receipt_sha256,
    }, { ...limits, maxRawArtifactBytes: limits.maxReceiptBytes });
    holds.push(receipt);
    const signer = anchors.providerSigners[reference.receipt_signer_id];
    const signed = verifyDetachedWrapper(receipt.bytes, PROVIDER_DOMAIN, signer, limits);
    if (signed.wrapper.signer_id !== reference.receipt_signer_id) fail('receipt_signer_mismatch');
    assertReceiptEnvelope(signed.envelope, limits, nowMilliseconds(input.now));
    if (signed.envelope.source_root_id !== rootId || signed.envelope.receipt_id !== reference.receipt_id || signed.envelope.artifact.artifact_id !== reference.artifact_id) fail('receipt_reference_mismatch');
    if (signer.providerId !== signed.envelope.provider_id || signer.producerId !== signed.envelope.producer_id) fail('provider_signer_assignment_mismatch');
    if (signed.envelope.subject.restaurant_id !== candidate.restaurant_id || signed.envelope.subject.video_id !== candidate.video_id || signed.envelope.subject.query_sha256 !== candidate.query_sha256) fail('receipt_subject_mismatch');
    if (!sameSourceRef({ ...signed.envelope.artifact, kind: source.kind }, source)) fail('receipt_artifact_mismatch');
    const artifact = await openBoundArtifact(anchors.roots[rootId], {
      relative_path: signed.envelope.artifact.relative_path,
      byte_length: signed.envelope.artifact.byte_length,
      sha256: signed.envelope.artifact.sha256,
    }, limits);
    holds.push(artifact);
    const raw = parseJsonBytes(artifact.bytes, limits);
    const selected = rawSelectedEnvelope(raw, input);
    if (sha256(Buffer.from(canonicalizeIJson(selected), 'utf8')) !== signed.envelope.content.canonical_sha256) fail('provider_canonical_digest_mismatch');
    const receiptPlace = normalizePlace(signed.envelope.content.place, 'invalid_receipt_place');
    const selectedPlace = normalizePlace(selected.place, 'provider_selected_place_mismatch');
    if (!samePlace(receiptPlace, selectedPlace) || !samePlace(receiptPlace, candidate.place)) fail('provider_place_mismatch');
    const close = async () => closeAll(holds);
    const recheck = async () => {
      for (const hold of holds) await hold.recheck();
      return true;
    };
    return success({
      receipt_id: signed.envelope.receipt_id,
      signer_id: signed.wrapper.signer_id,
      envelope_sha256: signed.envelopeSha256,
      provider_id: signed.envelope.provider_id,
      producer_id: signed.envelope.producer_id,
      source_id: signed.envelope.source_id,
      source_root_id: signed.envelope.source_root_id,
      artifact: frozen({ ...signed.envelope.artifact }),
      receipt_sha256: receipt.sha256,
      receipt_relative_path: reference.receipt_relative_path,
      raw_artifact_sha256: artifact.sha256,
      raw_strings: frozen([...collectStrings(raw)].sort()),
      place: receiptPlace,
      recheck,
      close,
    });
  } catch (error) {
    await closeAll(holds, true);
    return failure(error);
  }
}

function assertSourceArtifacts(value, limits) {
  if (!Array.isArray(value) || value.length === 0 || value.length > limits.maxProviderReceipts + 1) fail('invalid_source_artifacts');
  const artifacts = value.map((item) => sourceRefFrom(item, limits));
  const ids = new Set();
  const paths = new Set();
  for (const artifact of artifacts) {
    const key = `${artifact.root_id}\u0000${artifact.relative_path.toLowerCase()}`;
    if (ids.has(artifact.artifact_id) || paths.has(key)) fail('source_artifact_collision');
    ids.add(artifact.artifact_id);
    paths.add(key);
  }
  return artifacts;
}

function independenceFailure(video, providers) {
  const count = providers.length;
  if (count < 2) return 'insufficient_provider_receipts';
  const providerSets = [
    providers.map((item) => item.provider_id),
    providers.map((item) => item.producer_id),
    providers.map((item) => item.source_id),
    providers.map((item) => `${item.source_root_id}\u0000${item.artifact.relative_path}`),
    providers.map((item) => item.artifact.artifact_id),
    providers.map((item) => item.raw_artifact_sha256),
    providers.map((item) => item.receipt_id),
    providers.map((item) => item.signer_id),
  ];
  if (providerSets.some((values) => new Set(values).size !== count)) return 'provider_independence_mismatch';
  if (new Set([video.signer_id, ...providers.map((item) => item.signer_id)]).size !== count + 1) return 'trusted_signer_independence_mismatch';
  if (new Set([video.envelope_sha256, ...providers.map((item) => item.envelope_sha256)]).size !== count + 1) return 'envelope_independence_mismatch';
  if (new Set([video.raw_artifact_sha256, ...providers.map((item) => item.raw_artifact_sha256)]).size !== count + 1) return 'artifact_digest_independence_mismatch';
  const videoValues = new Set([
    video.entry.artifact_id,
    video.raw_artifact_sha256,
    video.entry.relative_path,
    `${video.source_root_id}\u0000${video.entry.relative_path}`,
    video.manifest_sha256,
    video.manifest_relative_path,
    `${video.source_root_id}\u0000${video.manifest_relative_path}`,
  ]);
  const seenValues = new Set(videoValues);
  for (const provider of providers) {
    const values = [
      provider.artifact.artifact_id,
      provider.raw_artifact_sha256,
      provider.artifact.relative_path,
      `${provider.source_root_id}\u0000${provider.artifact.relative_path}`,
      provider.receipt_id,
      provider.receipt_sha256,
      provider.receipt_relative_path,
      `${provider.source_root_id}\u0000${provider.receipt_relative_path}`,
    ];
    if (values.some((value) => seenValues.has(value) || provider.raw_strings.includes(value))) return 'evidence_alias_detected';
    if (provider.raw_strings.some((value) => seenValues.has(value))) return 'evidence_alias_detected';
    for (const value of values) seenValues.add(value);
  }
  return null;
}

function trustSummary(video, providers) {
  return frozen({
    schema_version: 2,
    video_manifest_id: video.manifest_id,
    video_signer_id: video.signer_id,
    provider_receipt_count: providers.length,
    provider_ids: providers.map((item) => item.provider_id).sort(),
    provider_signer_ids: providers.map((item) => item.signer_id).sort(),
    producer_ids: providers.map((item) => item.producer_id).sort(),
    source_ids: providers.map((item) => item.source_id).sort(),
    raw_artifact_sha256: [video.raw_artifact_sha256, ...providers.map((item) => item.raw_artifact_sha256)].sort(),
    envelope_sha256: [video.envelope_sha256, ...providers.map((item) => item.envelope_sha256)].sort(),
  });
}

function inputRiskFlags(input) {
  const value = input.risk_flags ?? input.riskFlags ?? [];
  if (!Array.isArray(value) || value.some((flag) => typeof flag !== 'string' || !flag)) fail('invalid_risk_flags');
  return value;
}

export function computeAddressPredicate(input) {
  try {
    if (!isPlainObject(input)) fail('invalid_predicate_input');
    const verification = input.verification ?? input;
    const riskFlags = inputRiskFlags(input);
    const blockers = new Set();
    const missing = new Set();
    let video;
    let providers = [];
    if (!TRUSTED_VERIFICATIONS.has(verification) || verification.ok !== true || !verification.video || !Array.isArray(verification.providers)) {
      blockers.add('trust_verification_failed');
      missing.add('trusted_address_evidence');
    } else {
      video = verification.video;
      providers = verification.providers;
      if (!video) {
        blockers.add('missing_signed_video_manifest');
        missing.add('signed_video_manifest');
      }
      if (providers.length < 2) {
        blockers.add('missing_signed_provider_receipts');
        missing.add('two_independent_provider_receipts');
      }
      const independent = video ? independenceFailure(video, providers) : 'missing_video_manifest';
      if (independent) {
        blockers.add(independent === 'evidence_alias_detected' ? 'evidence_alias_detected' : 'insufficient_independent_producer_families');
        missing.add(independent);
      }
    }
    for (const flag of riskFlags) {
      if (BLOCKING_FLAGS.includes(flag)) blockers.add(flag);
      else blockers.add('untrusted_address_evidence');
    }
    const families = video
      ? [`video:${video.entry.kind}`, ...providers.map((provider) => `provider:${provider.provider_id}`)].sort()
      : [];
    if (new Set(families).size < 3) {
      blockers.add('insufficient_family_count');
      missing.add('independent_evidence_families');
    }
    const summary = video ? trustSummary(video, providers) : frozen({ schema_version: 2, provider_receipt_count: 0 });
    return frozen({
      pass: blockers.size === 0,
      families,
      blocking_risk_flags: [...blockers].sort(),
      missing_requirements: [...missing].sort(),
      trust_summary: summary,
    });
  } catch {
    return frozen({
      pass: false,
      families: [],
      blocking_risk_flags: ['trust_verification_failed'],
      missing_requirements: ['valid_predicate_input'],
      trust_summary: frozen({ schema_version: 2, provider_receipt_count: 0 }),
    });
  }
}

export async function verifyAddressEvidenceBundle(input) {
  const results = [];
  try {
    if (!isPlainObject(input)) fail('invalid_bundle_input');
    const anchors = assertTrustedAnchors(input.anchors ?? input.trustAnchors);
    const candidate = candidateFrom(input.candidate);
    const trusted = input.trusted_evidence ?? input.trustedEvidence;
    assertExactKeys(trusted, ['providers', 'video'], 'invalid_trusted_evidence');
    const sourceArtifacts = assertSourceArtifacts(input.source_artifacts ?? input.sourceArtifacts, anchors.limits);
    let totalRawBytes = 0;
    for (const artifact of sourceArtifacts) {
      totalRawBytes += artifact.byte_length;
      if (totalRawBytes > anchors.limits.maxTotalRawBytes) fail('total_raw_bytes_exceeded');
    }
    const videoSource = sourceArtifacts.find((item) => item.artifact_id === trusted.video?.entry_artifact_id);
    if (!videoSource) fail('missing_video_source_artifact');
    const video = await verifyVideoManifest({
      anchors,
      reference: trusted.video,
      sourceArtifact: videoSource,
      candidate,
      video_id: candidate.video_id,
      record_selector_sha256: input.record_selector_sha256 ?? input.recordSelectorSha256,
      manifestRootId: input.manifest_root_id ?? input.manifestRootId ?? videoSource.root_id,
      now: input.now,
    });
    if (!video.ok) fail(video.code);
    results.push(video);
    if (!Array.isArray(trusted.providers) || trusted.providers.length < 2 || trusted.providers.length > anchors.limits.maxProviderReceipts) fail('invalid_provider_receipts');
    const providers = [];
    const usedSourceArtifactIds = new Set([videoSource.artifact_id]);
    for (const reference of trusted.providers) {
      const source = sourceArtifacts.find((item) => item.artifact_id === reference?.artifact_id);
      if (!source) fail('missing_provider_source_artifact');
      usedSourceArtifactIds.add(source.artifact_id);
      const provider = await verifyProviderReceipt({
        anchors,
        reference,
        sourceArtifact: source,
        candidate,
        receiptRootId: input.receipt_root_id ?? input.receiptRootId ?? source.root_id,
        selectProviderResult: input.selectProviderResult,
        now: input.now,
      });
      if (!provider.ok) fail(provider.code);
      results.push(provider);
      providers.push(provider);
    }
    if (sourceArtifacts.length !== providers.length + 1 || usedSourceArtifactIds.size !== sourceArtifacts.length) fail('unexpected_source_artifact');
    const independence = independenceFailure(video, providers);
    if (independence) fail(independence);
    const summary = trustSummary(video, providers);
    const provisional = success({ video, providers, trust_summary: summary });
    const predicate = computeAddressPredicate({ verification: provisional, risk_flags: input.risk_flags ?? input.riskFlags ?? [] });
    const recheck = async () => {
      for (const result of results) await result.recheck();
      return true;
    };
    const close = async () => closeAll(results);
    return success({ video, providers, trust_summary: summary, predicate, recheck, close });
  } catch (error) {
    await closeAll(results, true);
    return failure(error);
  }
}
