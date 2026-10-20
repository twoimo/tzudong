/** Source-only composition of the held OCR 89 -> 108 operating chain. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildEvidencePrefixedSuccessorStateQuery,
  compileEvidencePrefixedApplyPlan,
  ledgerIdentityRoot,
  loadEvidencePrefixedSuccessorManifest,
} from './review-media-evidence-prefixed-sql-successors.mjs';
import { compilePost106AclOperatingPlan } from './receipt-ocr-post106-acl-admission-sql-successor.mjs';
import {
  buildRecovery108StateQuery,
  compileRecovery108OperatingPlan,
  loadRecovery108HeldManifest,
} from './receipt-ocr-recovery108-sql-successor.mjs';
import { statementSpans } from './supabase-migration-transaction.mjs';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const CHAIN_COMPILER_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = resolve(dirname(CHAIN_COMPILER_PATH), '../../..');
const HEX = /^[0-9a-f]{64}$/;
const fail = code => { const error = new Error(code); error.code = code; throw error; };
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const canonical = value => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
    : value;
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

function exactKeys(value, keys, code = 'RECEIPT_OCR_CHAIN_INPUT_INVALID') {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join('\0') !== [...keys].sort().join('\0')) fail(code);
}

function leadingSql(token) {
  let offset = 0;
  while (offset < token.length) {
    while (/\s/.test(token[offset] ?? '')) offset++;
    if (token.startsWith('--', offset)) {
      const end = token.indexOf('\n', offset + 2);
      offset = end < 0 ? token.length : end + 1;
    } else if (token.startsWith('/*', offset)) {
      let depth = 1;
      offset += 2;
      while (depth && offset < token.length) {
        if (token.startsWith('/*', offset)) { depth++; offset += 2; }
        else if (token.startsWith('*/', offset)) { depth--; offset += 2; }
        else offset++;
      }
      if (depth) fail('RECEIPT_OCR_CHAIN_SQL_INVALID');
    } else break;
  }
  return token.slice(offset);
}

const LEDGER_INSERT = /^INSERT\s+INTO\s+supabase_migrations\.schema_migrations\b/i;
const LEDGER_LOCK = /^LOCK\s+TABLE\s+supabase_migrations\.schema_migrations\s+IN\s+EXCLUSIVE\s+MODE\b/i;

function leadingWords(token) {
  const words = [];
  let index = 0;
  while (words.length < 2) {
    while (/\s/.test(token[index] ?? '')) index++;
    if (token.startsWith('--', index)) {
      const end = token.indexOf('\n', index + 2);
      index = end < 0 ? token.length : end + 1;
      continue;
    }
    if (token.startsWith('/*', index)) {
      let depth = 1;
      index += 2;
      while (depth && index < token.length) {
        if (token.startsWith('/*', index)) { depth++; index += 2; }
        else if (token.startsWith('*/', index)) { depth--; index += 2; }
        else index++;
      }
      if (depth) fail('RECEIPT_OCR_CHAIN_SQL_INVALID');
      continue;
    }
    const word = /^[A-Za-z_][A-Za-z_0-9]*/.exec(token.slice(index))?.[0];
    if (!word) break;
    words.push(word.toUpperCase());
    index += word.length;
  }
  return words;
}

function transactionControlAtStart(token) {
  const [first, second] = leadingWords(token);
  return ['BEGIN', 'COMMIT', 'END', 'ROLLBACK', 'ABORT', 'SAVEPOINT', 'RELEASE'].includes(first)
    || (['START', 'PREPARE', 'SET'].includes(first) && second === 'TRANSACTION');
}

function compilerSourceClosure() {
  const seen = new Map();
  function visit(path) {
    const relativePath = relative(REPOSITORY_ROOT, path);
    if (relativePath.startsWith('..') || relativePath.startsWith('/') || seen.has(relativePath)) {
      if (relativePath.startsWith('..') || relativePath.startsWith('/')) {
        fail('RECEIPT_OCR_CHAIN_COMPILER_SOURCE_INVALID');
      }
      return;
    }
    let bytes;
    try { bytes = readFileSync(path); } catch { fail('RECEIPT_OCR_CHAIN_COMPILER_SOURCE_INVALID'); }
    const source = bytes.toString('utf8');
    if (!Buffer.from(source).equals(bytes) || /\bimport\s*\(/.test(source)) {
      fail('RECEIPT_OCR_CHAIN_COMPILER_SOURCE_INVALID');
    }
    seen.set(relativePath, Object.freeze({ path: relativePath, sha256: sha256(bytes) }));
    const lines = source.split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      if (!/^\s*(?:import\s|export\s+(?:\*|\{))/.test(lines[index])) continue;
      let declaration = lines[index];
      while (!declaration.includes(';') && index + 1 < lines.length) declaration += `\n${lines[++index]}`;
      const specifier = /\bfrom\s*['"](\.[^'"]+)['"]/.exec(declaration)?.[1]
        ?? /^\s*import\s*['"](\.[^'"]+)['"]/.exec(declaration)?.[1];
      if (specifier) visit(resolve(dirname(path), specifier));
    }
  }
  visit(CHAIN_COMPILER_PATH);
  return Object.freeze([...seen.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export function validateTransactionBody(sql, expectedInserts) {
  if (typeof sql !== 'string' || !sql || !Number.isSafeInteger(expectedInserts)
    || expectedInserts < 1) fail('RECEIPT_OCR_CHAIN_SQL_INVALID');
  const spans = statementSpans(sql);
  if (spans.some(span => transactionControlAtStart(span.token))) {
    fail('RECEIPT_OCR_CHAIN_TRANSACTION_CONTROL_DENIED');
  }
  const inserts = spans.filter(span => LEDGER_INSERT.test(leadingSql(span.token)));
  if (inserts.length !== expectedInserts) fail('RECEIPT_OCR_CHAIN_LEDGER_INSERT_INVALID');
  return Object.freeze({ spans, inserts });
}

export function loadRecovery108ChainSource() {
  // 108 recursively authenticates 107, 105, and the evidence-prefixed feature source.
  const recovery = loadRecovery108HeldManifest();
  const acl = recovery.predecessorRecord;
  const post105 = acl.baseRecord;
  const feature = post105.predecessor;
  const predecessor = loadEvidencePrefixedSuccessorManifest('predecessor');
  const records = [predecessor, feature, post105, acl, recovery];
  const [first, second, third, fourth, fifth] = records.map(record => record.manifest);
  const transitions = [first.operatingTransition, second.operatingTransition,
    third.operatingTransition, fourth.operatingTransition, fifth.operatingTransition];
  if (!equal(transitions, [
    { before: 89, after: 100 }, { before: 100, after: 105 },
    { before: 105, after: 106 }, { before: 105, intermediate: 106, after: 107 },
    { before: 107, after: 108 },
  ]) || second.operatingIdentity.prefixIdentityRoot !== first.operatingIdentity.terminalIdentityRoot
    || third.predecessor.terminalIdentityRoot !== second.operatingIdentity.terminalIdentityRoot
    || fourth.operatingIdentity.stage106IdentityRoot !== third.operatingIdentity.targetIdentityRoot
    || fifth.predecessor.terminalIdentityRoot !== fourth.operatingIdentity.targetIdentityRoot
    || !equal(first.baseMapping, second.baseMapping)
    || !equal(first.historicalAppliedVariant, second.historicalAppliedVariant)
    || first.operatingIdentity.evidenceIdentityRoot !== second.operatingIdentity.evidenceIdentityRoot
    || records.some(record => record.manifest.projectRef !== first.projectRef
      || record.manifest.serverMajor !== 17
      || record.manifest.databaseName !== 'postgres'
      || record.manifest.executorRole !== 'postgres'
      || record.manifest.launchPolicy.state !== 'held'
      || !equal(record.manifest.requiredWriterFences, first.requiredWriterFences))
    || new Set(records.map(record => record.manifest.advisoryLockKey)).size !== records.length) {
    fail('RECEIPT_OCR_CHAIN_SOURCE_BOUNDARY_INVALID');
  }
  const migrations = [
    ...predecessor.targetRecord.manifest.migrations,
    ...feature.targetRecord.manifest.migrations,
    third.migration,
    fourth.migration,
    fifth.migration,
  ];
  const versions = migrations.map(migration => migration.path.match(/\/(\d{14})_[a-z0-9_]+\.sql$/)?.[1]);
  if (migrations.length !== 19 || versions.some((version, index) => !version
    || (index > 0 && version <= versions[index - 1]))
    || new Set(versions).size !== 19
    || new Set(migrations.map(migration => migration.id)).size !== 19
    || new Set(migrations.map(migration => migration.path)).size !== 19
    || migrations.some(migration => !HEX.test(migration.sha256)
      || !HEX.test(migration.statementVectorSha256))
    || ledgerIdentityRoot(recovery.operatingRows) !== fifth.operatingIdentity.targetIdentityRoot) {
    fail('RECEIPT_OCR_CHAIN_MIGRATION_IDENTITY_INVALID');
  }
  const manifestSha256s = Object.freeze(Object.fromEntries(
    ['predecessor', 'feature', 'post105', 'acl', 'recovery']
      .map((name, index) => [name, records[index].manifestSha256]),
  ));
  const compilerSources = compilerSourceClosure();
  const sourceRoot = sha256(JSON.stringify(canonical({
    compilerSources,
    manifestSha256s,
    migrations: migrations.map(migration => ({
      path: migration.path,
      sha256: migration.sha256,
      statementVectorSha256: migration.statementVectorSha256,
    })),
  })));
  return Object.freeze({ predecessor, feature, post105, acl, recovery,
    migrations: Object.freeze(migrations), manifestSha256s, compilerSources, sourceRoot });
}

function expiryWindow(now, expiresAt) {
  const parse = value => typeof value === 'string' && !Number.isNaN(Date.parse(value))
    && new Date(value).toISOString() === value ? Date.parse(value) : NaN;
  const start = parse(now);
  const end = parse(expiresAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)
    || end <= start || end - start > 900_000) fail('RECEIPT_OCR_CHAIN_EXPIRY_INVALID');
}

function expiryGuard(now, expiresAt) {
  const body = `IF current_user <> 'postgres' OR session_user <> 'postgres'
 OR pg_catalog.current_setting('server_version_num')::integer / 10000 <> 17
 OR pg_catalog.clock_timestamp() < ${quote(now)}::timestamptz
 OR pg_catalog.clock_timestamp() >= ${quote(expiresAt)}::timestamptz
 THEN RAISE EXCEPTION 'RECEIPT_OCR_CHAIN_WINDOW_EXPIRED'; END IF;
 remaining_ms := pg_catalog.ceil(pg_catalog.date_part('epoch', ${quote(expiresAt)}::timestamptz - pg_catalog.clock_timestamp()) * 1000)::integer;
 IF remaining_ms < 1 OR remaining_ms > 900000 THEN RAISE EXCEPTION 'RECEIPT_OCR_CHAIN_WINDOW_EXPIRED'; END IF;
 PERFORM pg_catalog.set_config('transaction_timeout', remaining_ms::text || 'ms', true);`;
  const tag = `$ocr_chain_window_${sha256(body).slice(0, 18)}$`;
  return `DO ${tag} DECLARE remaining_ms integer; BEGIN ${body} END; ${tag};\n`;
}

function guardedBody(body, expectedInserts, lockKeys, guard) {
  const { spans } = validateTransactionBody(body, expectedInserts);
  const wrapperLocks = spans.filter(span => {
    const sql = leadingSql(span.token);
    return /^DO\s+\$[a-z0-9_]+\$\s+BEGIN\s+PERFORM\s+pg_advisory_xact_lock\(\d+::bigint\);\s+END\b/i.test(sql)
      && lockKeys.some(key => sql.includes(`pg_advisory_xact_lock(${key}::bigint)`));
  });
  const ledgerLocks = spans.filter(span => LEDGER_LOCK.test(leadingSql(span.token)));
  const selected = spans.filter(span => LEDGER_INSERT.test(leadingSql(span.token))
    || LEDGER_LOCK.test(leadingSql(span.token))
    || wrapperLocks.includes(span));
  if (wrapperLocks.length !== lockKeys.length
    || lockKeys.some(key => wrapperLocks.filter(span => span.token.includes(`pg_advisory_xact_lock(${key}::bigint)`)).length !== 1)
    || ledgerLocks.length !== expectedInserts) {
    fail('RECEIPT_OCR_CHAIN_LOCK_BOUNDARY_INVALID');
  }
  let cursor = 0;
  let result = '';
  for (const span of selected) {
    result += body.slice(cursor, span.end) + '\n' + guard;
    cursor = span.end;
  }
  return result + body.slice(cursor);
}

export function compileRecovery108ChainPlan(input) {
  exactKeys(input, ['predecessorAdmission', 'featureAdmission', 'now', 'expiresAt']);
  expiryWindow(input.now, input.expiresAt);
  const source = loadRecovery108ChainSource();
  const predecessorPlan = compileEvidencePrefixedApplyPlan(source.predecessor, input.predecessorAdmission);
  const featurePlan = compileEvidencePrefixedApplyPlan(source.feature, input.featureAdmission);
  const aclPlan = compilePost106AclOperatingPlan(source.acl);
  const recoveryPlan = compileRecovery108OperatingPlan(source.recovery);
  if (predecessorPlan.identityMode !== 'operating' || featurePlan.identityMode !== 'operating'
    || predecessorPlan.finalReadback.expected.bundle.ledgerCount !== 100
    || predecessorPlan.finalReadback.expected.state.ledgerIdentityRoot
      !== featurePlan.priorReadback.expected.state.ledgerIdentityRoot
    || featurePlan.finalReadback.expected.bundle.ledgerCount !== 105
    || featurePlan.finalReadback.expected.state.ledgerIdentityRoot
      !== aclPlan.priorReadback.expected.state.ledgerIdentityRoot
    || !equal(aclPlan.finalReadback, recoveryPlan.priorReadback)) {
    fail('RECEIPT_OCR_CHAIN_STAGE_BOUNDARY_INVALID');
  }
  const guard = expiryGuard(input.now, input.expiresAt);
  const parts = [
    [predecessorPlan.sql, 11, [source.predecessor.manifest.advisoryLockKey]],
    [featurePlan.sql, 5, [source.feature.manifest.advisoryLockKey]],
    [aclPlan.transactionBodySql, 2, [source.acl.manifest.advisoryLockKey, source.post105.manifest.advisoryLockKey]],
    [recoveryPlan.transactionBodySql, 1, [source.recovery.manifest.advisoryLockKey]],
  ];
  const body = guard + parts.map(([sql, count, lock]) => guardedBody(sql, count, lock, guard)).join('\n') + guard;
  validateTransactionBody(body, 19);
  return Object.freeze({
    kind: 'receipt-ocr-89-to-108-source-only-chain-plan',
    sourceManifestSha256: source.recovery.manifestSha256,
    sourceManifestSha256s: source.manifestSha256s,
    compilerSources: source.compilerSources,
    sourceRoot: source.sourceRoot,
    migrationCount: 19,
    now: input.now,
    expiresAt: input.expiresAt,
    bodySql: body,
    applySql: `BEGIN;\n${body}COMMIT;\n`,
    rehearsalSql: `BEGIN;\n${body}ROLLBACK;\n`,
    terminalReadback: recoveryPlan.finalReadback,
    reconciliation: buildRecovery108ChainReconciliationPlan(source, predecessorPlan.priorReadback.expected,
      recoveryPlan.finalReadback.expected),
  });
}

function buildRecovery108ChainReconciliationPlan(source, initialExpected, terminalExpected) {
  const initialObjects = [
    'privacy_retention.g014_catalog_contract_manifest',
    'privacy_retention.g014_public_rpc_allowlist',
    'pipeline_control.restaurant_review_items',
    'pipeline_control.restaurant_review_policy',
    'pipeline_control.restaurant_review_runs',
    'storage.buckets',
    'storage.objects',
  ];
  const terminalObjects = [
    'public.reviews',
    'ocr_private.receipt_results',
    'privacy_retention.g014_public_rpc_allowlist',
    'ocr_private.receipt_credential_release_catalog_contract',
    'ocr_private.receipt_ocr_recovery_catalog_contract',
  ];
  const availabilityQuery = `SELECT jsonb_build_object(
 'ledgerExists',pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NOT NULL,
 'initialObjectsReady',${initialObjects.map(name => `pg_catalog.to_regclass(${quote(name)}) IS NOT NULL`).join(' AND ')}
  AND pg_catalog.to_regrole('privacy_workflow_owner') IS NOT NULL,
 'terminalObjectsReady',${terminalObjects.map(name => `pg_catalog.to_regclass(${quote(name)}) IS NOT NULL`).join(' AND ')}
  AND pg_catalog.to_regprocedure('ocr_private.get_receipt_ocr_credential_release_capability()') IS NOT NULL
  AND pg_catalog.to_regprocedure('ocr_private.get_receipt_ocr_indeterminate_recovery_capability()') IS NOT NULL
  AND pg_catalog.to_regprocedure('ocr_private.receipt_credential_release_acl_admitted_v2()') IS NOT NULL
  AND pg_catalog.to_regprocedure('ocr_private.receipt_ocr_recovery_catalog_snapshot_v1()') IS NOT NULL
  AND pg_catalog.to_regprocedure('ocr_private.receipt_ocr_recovery_acl_admitted_v1()') IS NOT NULL
  AND pg_catalog.to_regprocedure('extensions.digest(bytea,text)') IS NOT NULL
 ) AS availability`;
  const identityQuery = `SELECT jsonb_build_object('ledgerCount',count(*)::int,
 'ledgerIdentityRoot',encode(sha256(convert_to(coalesce(string_agg(row_material,chr(30)
 ORDER BY version COLLATE "C",name COLLATE "C"),''),'UTF8')),'hex')) AS identity
 FROM (SELECT version,name,
 octet_length(convert_to(version,'UTF8'))::text||':'||version||chr(31)||
 CASE WHEN name IS NULL THEN '-1:' ELSE octet_length(convert_to(name,'UTF8'))::text||':'||name END||chr(31)||
 cardinality(statements)::text||chr(31)||
 encode(sha256(convert_to(array_to_json(statements)::text,'UTF8')),'hex') AS row_material
 FROM supabase_migrations.schema_migrations) ledger_identity`;
  const lockKeys = [source.predecessor, source.feature, source.post105, source.acl, source.recovery]
    .map(record => record.manifest.advisoryLockKey).sort((a, b) => a - b);
  const lockBody = lockKeys.map(key => `IF NOT pg_catalog.pg_try_advisory_xact_lock(${key}::bigint)
 THEN RAISE EXCEPTION 'RECEIPT_OCR_CHAIN_SETTLEMENT_BUSY'; END IF;`).join('\n');
  const lockTag = `$ocr_chain_settlement_${sha256(lockBody).slice(0, 18)}$`;
  // Execute open, lock, availability, identity, the selected state query, and close
  // on one connection. A busy/error path must ROLLBACK before any retry. These
  // locks synchronize cooperative writers only; fresh writer fences and direct
  // SQL authority require separate operating verification.
  const settlement = Object.freeze({
    openSql: `BEGIN;\nSET TRANSACTION ISOLATION LEVEL READ COMMITTED;\nSET LOCAL lock_timeout='2s';\nSET LOCAL statement_timeout='15s';\nSET LOCAL transaction_timeout='15s';\n`,
    lockSql: `DO ${lockTag} BEGIN
 IF current_user <> 'postgres' OR session_user <> 'postgres'
 OR pg_catalog.current_setting('server_version_num')::integer / 10000 <> 17
 THEN RAISE EXCEPTION 'RECEIPT_OCR_CHAIN_SETTLEMENT_CONTEXT_INVALID'; END IF;
 ${lockBody}
 END; ${lockTag};
 LOCK TABLE supabase_migrations.schema_migrations IN SHARE MODE NOWAIT;\n`,
    closeSql: 'ROLLBACK;\n',
    lockKeys: Object.freeze(lockKeys),
  });
  return Object.freeze({
    settlement,
    availabilityQuery,
    identityQuery,
    initialStateQuery: buildEvidencePrefixedSuccessorStateQuery(source.predecessor),
    terminalStateQuery: buildRecovery108StateQuery(source.recovery),
    initialExpected,
    terminalExpected,
    initialRoot: source.predecessor.manifest.operatingIdentity.prefixIdentityRoot,
    terminalRoot: source.recovery.manifest.operatingIdentity.targetIdentityRoot,
  });
}

/** Classify untrusted caller-supplied readbacks. Only an executing adapter can certify settlement. */
export function classifyRecovery108ChainReconciliation(plan, observation) {
  exactKeys(observation, ['availability', 'identity', 'state']);
  if (!plan || typeof plan !== 'object') fail('RECEIPT_OCR_CHAIN_RECONCILIATION_INVALID');
  const { availability, identity, state } = observation;
  if (!availability || typeof availability !== 'object' || Array.isArray(availability)
    || availability.ledgerExists !== true) return 'unknown';
  exactKeys(availability, ['ledgerExists', 'initialObjectsReady', 'terminalObjectsReady'],
    'RECEIPT_OCR_CHAIN_RECONCILIATION_INVALID');
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)
    || !Number.isSafeInteger(identity.ledgerCount)
    || !HEX.test(identity.ledgerIdentityRoot ?? '')) return 'unknown';
  exactKeys(identity, ['ledgerCount', 'ledgerIdentityRoot'],
    'RECEIPT_OCR_CHAIN_RECONCILIATION_INVALID');
  if (identity.ledgerCount === 89) {
    if (identity.ledgerIdentityRoot !== plan.initialRoot
      || availability.initialObjectsReady !== true) return 'partial_conflict';
    if (state === null) return 'needs_settled_initial_state';
    return equal(state, plan.initialExpected) ? 'initial_match_unsettled' : 'partial_conflict';
  }
  if (identity.ledgerCount === 108) {
    if (identity.ledgerIdentityRoot !== plan.terminalRoot
      || availability.terminalObjectsReady !== true) return 'partial_conflict';
    if (state === null) return 'needs_settled_terminal_state';
    return equal(state, plan.terminalExpected) ? 'terminal_match_unsettled' : 'partial_conflict';
  }
  return identity.ledgerCount >= 89 && identity.ledgerCount <= 108
    ? 'partial_conflict' : 'unknown';
}
