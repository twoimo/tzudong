#!/usr/bin/env node
/** Source-only compiler for the held receipt OCR 107 -> 108 successor. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readOriginalStatementVector } from './apply-supabase-migration.mjs';
import {
  compilePost106AclOperatingPlan,
  loadPost106AclSuccessorManifest,
} from './receipt-ocr-post106-acl-admission-sql-successor.mjs';
import { ledgerIdentityRoot } from './review-media-evidence-prefixed-sql-successors.mjs';
import { atomicMigrationSql, migrationEnvelope, statementSpans } from './supabase-migration-transaction.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
export const REPOSITORY_ROOT = resolve(dirname(SCRIPT_PATH), '../../..');
export const RECOVERY108_MANIFEST_PATH = resolve(
  REPOSITORY_ROOT,
  '.github/receipt-ocr-recovery108-sql-successor.v1.json',
);

const PREDECESSOR_MANIFEST_PATH = '.github/receipt-ocr-post106-acl-admission-sql-successor.v1.json';
const COMPILER_PATH = 'apps/web/scripts/receipt-ocr-recovery108-sql-successor.mjs';
const FIXTURE_PATH = 'backend/supabase/tests/receipt_ocr_indeterminate_recovery.sql';
const ACL_INITIAL_DEFAULT_FIXTURE_PATH = 'backend/supabase/tests/receipt_ocr_indeterminate_recovery_acl_initial_default.sql';
const ACL_ADMISSION_FIXTURE_PATH = 'backend/supabase/tests/receipt_ocr_indeterminate_recovery_acl_admission.sql';
const CAPABILITY_VERSION = 'receipt-ocr-indeterminate-recovery-v1';
const HEX = /^[0-9a-f]{64}$/;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const fail = code => { const error = new Error(code); error.code = code; throw error; };
const canonical = value => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
    : value;
const equal = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));

function exactKeys(value, keys, code = 'RECEIPT_OCR_RECOVERY108_CONTRACT_INVALID') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(code);
  }
}

function assertHex(value, code = 'RECEIPT_OCR_RECOVERY108_CONTRACT_INVALID') {
  if (typeof value !== 'string' || !HEX.test(value)) fail(code);
}

function readBoundSource(path, expectedSha, code) {
  if (typeof path !== 'string' || !path) fail(code);
  assertHex(expectedSha, code);
  let bytes;
  try { bytes = readFileSync(resolve(REPOSITORY_ROOT, path)); } catch { fail(code); }
  if (sha256(bytes) !== expectedSha) fail(code);
  return bytes;
}

function loadMigration(manifest) {
  exactKeys(manifest.migration, [
    'id', 'version', 'name', 'path', 'sha256', 'statementCount', 'statementVectorSha256',
  ]);
  const migration = manifest.migration;
  if (migration.id !== 'receipt_ocr_indeterminate_recovery'
    || migration.name !== migration.id
    || !/^\d{14}$/.test(migration.version)
    || migration.path !== `backend/supabase/migrations/${migration.version}_${migration.name}.sql`
    || !Number.isSafeInteger(migration.statementCount)
    || migration.statementCount < 1) {
    fail('RECEIPT_OCR_RECOVERY108_CONTRACT_INVALID');
  }
  assertHex(migration.sha256);
  assertHex(migration.statementVectorSha256);
  const bytes = readBoundSource(migration.path, migration.sha256, 'RECEIPT_OCR_RECOVERY108_SOURCE_DRIFT');
  let originalVector;
  try { originalVector = readOriginalStatementVector(migration, bytes); } catch {
    fail('RECEIPT_OCR_RECOVERY108_SOURCE_DRIFT');
  }
  if (originalVector.length !== migration.statementCount
    || sha256(JSON.stringify(originalVector)) !== migration.statementVectorSha256) {
    fail('RECEIPT_OCR_RECOVERY108_SOURCE_DRIFT');
  }
  return Object.freeze({
    bytes,
    identity: Object.freeze({
      version: migration.version,
      name: migration.name,
      statementCount: migration.statementCount,
      statementVectorSha256: migration.statementVectorSha256,
    }),
    originalVector: Object.freeze(originalVector),
  });
}

function validateManifestShape(manifest) {
  exactKeys(manifest, [
    'schemaVersion', 'id', 'purpose', 'projectRef', 'serverMajor', 'databaseName',
    'executorRole', 'advisoryLockKey', 'launchPolicy', 'protectedSource',
    'stateRootAlgorithm', 'operatingTransition', 'predecessor', 'migration',
    'operatingIdentity', 'fixture', 'aclInitialDefaultFixture',
    'aclAdmissionFixture', 'toolchain', 'requiredWriterFences',
  ]);
  exactKeys(manifest.launchPolicy, ['state', 'code', 'reason']);
  exactKeys(manifest.protectedSource, ['remote', 'ref', 'repositoryUrl']);
  exactKeys(manifest.operatingTransition, ['before', 'after']);
  exactKeys(manifest.predecessor, [
    'state', 'manifestPath', 'manifestSha256', 'ledgerCount', 'terminalIdentityRoot',
  ]);
  exactKeys(manifest.operatingIdentity, [
    'migrationIdentityRoot', 'predecessorIdentityRoot', 'targetIdentityRoot',
  ]);
  exactKeys(manifest.fixture, ['path', 'sha256']);
  exactKeys(manifest.aclInitialDefaultFixture, ['path', 'sha256']);
  exactKeys(manifest.aclAdmissionFixture, ['path', 'sha256']);
  if (manifest.schemaVersion !== 1
    || manifest.id !== 'receipt_ocr_recovery108_sql_successor_v1'
    || manifest.purpose !== 'receipt-ocr-provider-indeterminate-recovery'
    || manifest.projectRef !== 'aqlcofblfxdrjhhdmarw'
    || manifest.serverMajor !== 17
    || manifest.databaseName !== 'postgres'
    || manifest.executorRole !== 'postgres'
    || !Number.isSafeInteger(manifest.advisoryLockKey)
    || manifest.launchPolicy.state !== 'held'
    || manifest.launchPolicy.code !== 'RECEIPT_OCR_RECOVERY108_LAUNCH_HELD'
    || manifest.protectedSource.remote !== 'origin'
    || manifest.protectedSource.ref !== 'refs/heads/main'
    || manifest.stateRootAlgorithm !== 'review-media-ledger-identity/v1'
    || manifest.operatingTransition.before !== 107
    || manifest.operatingTransition.after !== 108
    || manifest.predecessor.state !== 'source_ready'
    || manifest.predecessor.manifestPath !== PREDECESSOR_MANIFEST_PATH
    || manifest.predecessor.ledgerCount !== 107
    || manifest.fixture.path !== FIXTURE_PATH
    || manifest.aclInitialDefaultFixture.path !== ACL_INITIAL_DEFAULT_FIXTURE_PATH
    || manifest.aclAdmissionFixture.path !== ACL_ADMISSION_FIXTURE_PATH) {
    fail('RECEIPT_OCR_RECOVERY108_CONTRACT_INVALID');
  }
  for (const value of [
    manifest.predecessor.manifestSha256,
    manifest.predecessor.terminalIdentityRoot,
    manifest.operatingIdentity.migrationIdentityRoot,
    manifest.operatingIdentity.predecessorIdentityRoot,
    manifest.operatingIdentity.targetIdentityRoot,
  ]) assertHex(value);
  if (manifest.operatingIdentity.predecessorIdentityRoot
    !== manifest.predecessor.terminalIdentityRoot) {
    fail('RECEIPT_OCR_RECOVERY108_CONTRACT_INVALID');
  }
  if (!Array.isArray(manifest.toolchain) || manifest.toolchain.length !== 1) {
    fail('RECEIPT_OCR_RECOVERY108_CONTRACT_INVALID');
  }
  exactKeys(manifest.toolchain[0], ['path', 'sha256']);
  if (manifest.toolchain[0].path !== COMPILER_PATH) {
    fail('RECEIPT_OCR_RECOVERY108_CONTRACT_INVALID');
  }
}

export function loadRecovery108HeldManifest({ manifestPath = RECOVERY108_MANIFEST_PATH } = {}) {
  let manifestBytes;
  let manifest;
  try {
    manifestBytes = readFileSync(manifestPath);
    manifest = JSON.parse(manifestBytes.toString('utf8'));
  } catch { fail('RECEIPT_OCR_RECOVERY108_MANIFEST_INVALID'); }
  validateManifestShape(manifest);

  const predecessorRecord = loadPost106AclSuccessorManifest({
    manifestPath: resolve(REPOSITORY_ROOT, manifest.predecessor.manifestPath),
  });
  if (predecessorRecord.manifestSha256 !== manifest.predecessor.manifestSha256
    || predecessorRecord.operatingRows.length !== manifest.predecessor.ledgerCount
    || predecessorRecord.manifest.operatingIdentity.targetIdentityRoot
      !== manifest.predecessor.terminalIdentityRoot
    || ledgerIdentityRoot(predecessorRecord.operatingRows)
      !== manifest.predecessor.terminalIdentityRoot) {
    fail('RECEIPT_OCR_RECOVERY108_PREDECESSOR_DRIFT');
  }

  const material = loadMigration(manifest);
  if (material.identity.version <= predecessorRecord.material.identity.version) {
    fail('RECEIPT_OCR_RECOVERY108_MIGRATION_ORDER_INVALID');
  }
  const operatingRows = [...predecessorRecord.operatingRows, material.identity];
  if (ledgerIdentityRoot([material.identity]) !== manifest.operatingIdentity.migrationIdentityRoot
    || ledgerIdentityRoot(operatingRows) !== manifest.operatingIdentity.targetIdentityRoot) {
    fail('RECEIPT_OCR_RECOVERY108_IDENTITY_BINDING_INVALID');
  }

  const fixtureBytes = readBoundSource(
    manifest.fixture.path,
    manifest.fixture.sha256,
    'RECEIPT_OCR_RECOVERY108_FIXTURE_DRIFT',
  );
  const aclInitialDefaultFixtureBytes = readBoundSource(
    manifest.aclInitialDefaultFixture.path,
    manifest.aclInitialDefaultFixture.sha256,
    'RECEIPT_OCR_RECOVERY108_ACL_INITIAL_DEFAULT_FIXTURE_DRIFT',
  );
  const aclAdmissionFixtureBytes = readBoundSource(
    manifest.aclAdmissionFixture.path,
    manifest.aclAdmissionFixture.sha256,
    'RECEIPT_OCR_RECOVERY108_ACL_ADMISSION_FIXTURE_DRIFT',
  );
  readBoundSource(
    manifest.toolchain[0].path,
    manifest.toolchain[0].sha256,
    'RECEIPT_OCR_RECOVERY108_TOOLCHAIN_DRIFT',
  );
  return Object.freeze({
    aclAdmissionFixtureBytes,
    aclInitialDefaultFixtureBytes,
    fixtureBytes,
    manifest,
    manifestBytes,
    manifestSha256: sha256(manifestBytes),
    material,
    operatingRows: Object.freeze(operatingRows),
    predecessorRecord,
  });
}

function leadingSql(token) {
  let value = token.trim();
  for (;;) {
    if (value.startsWith('--')) {
      const end = value.indexOf('\n');
      value = end < 0 ? '' : value.slice(end + 1).trim();
    } else if (value.startsWith('/*')) {
      const end = value.indexOf('*/', 2);
      if (end < 0) fail('RECEIPT_OCR_RECOVERY108_SQL_UNTERMINATED');
      value = value.slice(end + 2).trim();
    } else return value;
  }
}

function terminalExpected(record) {
  return Object.freeze({
    capability: Object.freeze({
      schema_version: 1,
      status: 'ready',
      capability_version: CAPABILITY_VERSION,
    }),
    contractSealed: true,
    credentialReleaseV2Rebound: true,
    ledgerCount: 108,
    ledgerIdentityRoot: record.manifest.operatingIdentity.targetIdentityRoot,
    migration108Present: true,
    predecessor107Ready: true,
    schemaVersion: 1,
  });
}

export function buildRecovery108StateQuery(record) {
  const migration = record.manifest.migration;
  const predecessorMigration = record.predecessorRecord.manifest.migration;
  const predecessorRoot = quote(record.manifest.predecessor.terminalIdentityRoot);
  const targetRoot = quote(record.manifest.operatingIdentity.targetIdentityRoot);
  return `SELECT jsonb_build_object(
 'schemaVersion',1,
 'ledgerCount',ledger_scope.row_count,
 'ledgerIdentityRoot',ledger_scope.identity_root,
 'predecessor107Ready',ocr_private.get_receipt_ocr_credential_release_capability() IS NOT DISTINCT FROM '{"schema_version":1,"status":"ready","capability_version":"receipt-ocr-definitive-credential-release-v2"}'::jsonb,
 'credentialReleaseV2Rebound',(SELECT count(*) FROM ocr_private.receipt_credential_release_catalog_contract WHERE capability_version='receipt-ocr-definitive-credential-release-v2' AND migration_version=${quote(predecessorMigration.version)} AND migration_name=${quote(predecessorMigration.name)} AND statement_count=${predecessorMigration.statementCount} AND statement_vector_sha256=${quote(predecessorMigration.statementVectorSha256)} AND ledger_count=108 AND ledger_identity_root=${targetRoot} AND sealed_at IS NOT NULL)=1,
 'migration108Present',(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version=${quote(migration.version)} AND name=${quote(migration.name)} AND cardinality(statements)=${migration.statementCount} AND encode(extensions.digest(convert_to(array_to_json(statements)::text,'UTF8'),'sha256'),'hex')=${quote(migration.statementVectorSha256)})=1,
 'contractSealed',(SELECT count(*) FROM ocr_private.receipt_ocr_recovery_catalog_contract WHERE capability_version=${quote(CAPABILITY_VERSION)} AND migration_version=${quote(migration.version)} AND migration_name=${quote(migration.name)} AND statement_count=${migration.statementCount} AND statement_vector_sha256=${quote(migration.statementVectorSha256)} AND predecessor_ledger_count=107 AND predecessor_terminal_identity_root=${predecessorRoot} AND ledger_count=108 AND ledger_identity_root=${targetRoot} AND sealed_at IS NOT NULL AND (SELECT count(*) FROM jsonb_object_keys(function_contract))=17 AND (SELECT count(*) FROM jsonb_object_keys(table_contract))=3 AND (SELECT count(*) FROM jsonb_object_keys(trigger_contract))=2)=1,
 'capability',ocr_private.get_receipt_ocr_indeterminate_recovery_capability()
) AS receipt_ocr_recovery108_state
FROM (WITH ledger_identity AS (
 SELECT version,name,
  octet_length(convert_to(version,'UTF8'))::text||':'||version||chr(31)||
   CASE WHEN name IS NULL THEN '-1:' ELSE octet_length(convert_to(name,'UTF8'))::text||':'||name END||chr(31)||
   cardinality(statements)::text||chr(31)||
   encode(extensions.digest(convert_to(array_to_json(statements)::text,'UTF8'),'sha256'),'hex') AS row_material
 FROM supabase_migrations.schema_migrations
) SELECT count(*)::int AS row_count,
 encode(extensions.digest(convert_to(coalesce(string_agg(row_material,chr(30) ORDER BY version COLLATE "C",name COLLATE "C"),''),'UTF8'),'sha256'),'hex') AS identity_root
FROM ledger_identity) AS ledger_scope
WHERE ledger_scope.row_count=108 AND ledger_scope.identity_root=${targetRoot}`;
}

function buildRecoverySealSql(record) {
  const migration = record.manifest.migration;
  const predecessorMigration = record.predecessorRecord.manifest.migration;
  const predecessorRoot = record.manifest.predecessor.terminalIdentityRoot;
  const targetRoot = record.manifest.operatingIdentity.targetIdentityRoot;
  const ready = quote(JSON.stringify(terminalExpected(record).capability));
  const body = `WITH ledger_identity AS (
  SELECT version,name,
   octet_length(convert_to(version,'UTF8'))::text||':'||version||chr(31)||
    CASE WHEN name IS NULL THEN '-1:' ELSE octet_length(convert_to(name,'UTF8'))::text||':'||name END||chr(31)||
    cardinality(statements)::text||chr(31)||
    encode(extensions.digest(convert_to(array_to_json(statements)::text,'UTF8'),'sha256'),'hex') AS row_material
  FROM supabase_migrations.schema_migrations
 ) SELECT count(*)::int,
  encode(extensions.digest(convert_to(coalesce(string_agg(row_material,chr(30) ORDER BY version COLLATE "C",name COLLATE "C"),''),'UTF8'),'sha256'),'hex')
 INTO actual_ledger_count,actual_ledger_identity_root FROM ledger_identity;
 IF actual_ledger_count<>108 OR actual_ledger_identity_root<>${quote(targetRoot)}
 THEN RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_SEAL_LEDGER_MISMATCH'; END IF;
 IF ocr_private.receipt_credential_release_acl_admitted_v2() IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_PREDECESSOR_ACL_DRIFT'; END IF;
 UPDATE ocr_private.receipt_credential_release_catalog_contract
 SET ledger_count=108,
  ledger_identity_root=${quote(targetRoot)},
  sealed_at=pg_catalog.clock_timestamp()
 WHERE capability_version='receipt-ocr-definitive-credential-release-v2'
  AND migration_version=${quote(predecessorMigration.version)}
  AND migration_name=${quote(predecessorMigration.name)}
  AND statement_count=${predecessorMigration.statementCount}
  AND statement_vector_sha256=${quote(predecessorMigration.statementVectorSha256)}
  AND ledger_count=107
  AND ledger_identity_root=${quote(predecessorRoot)}
  AND sealed_at IS NOT NULL
  AND (SELECT count(*) FROM jsonb_object_keys(function_contract))=5
  AND (SELECT count(*) FROM jsonb_object_keys(table_contract))=2;
 GET DIAGNOSTICS predecessor_updated_rows=ROW_COUNT;
 IF predecessor_updated_rows<>1 THEN RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_PREDECESSOR_REBIND_FAILED'; END IF;
 IF ocr_private.get_receipt_ocr_credential_release_capability() IS DISTINCT FROM '{"schema_version":1,"status":"ready","capability_version":"receipt-ocr-definitive-credential-release-v2"}'::jsonb
 THEN RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_PREDECESSOR_REBIND_READBACK_FAILED'; END IF;
 UPDATE ocr_private.receipt_ocr_recovery_catalog_contract
 SET migration_version=${quote(migration.version)},
  migration_name=${quote(migration.name)},
  statement_count=${migration.statementCount},
  statement_vector_sha256=${quote(migration.statementVectorSha256)},
  predecessor_ledger_count=107,
  predecessor_terminal_identity_root=${quote(predecessorRoot)},
  ledger_count=108,
  ledger_identity_root=${quote(targetRoot)},
  sealed_at=pg_catalog.clock_timestamp()
 WHERE capability_version=${quote(CAPABILITY_VERSION)}
  AND migration_version IS NULL AND migration_name IS NULL
  AND statement_count IS NULL AND statement_vector_sha256 IS NULL
  AND predecessor_ledger_count IS NULL AND predecessor_terminal_identity_root IS NULL
  AND ledger_count IS NULL AND ledger_identity_root IS NULL
  AND sealed_at IS NULL
  AND (SELECT count(*) FROM jsonb_object_keys(function_contract))=17
  AND (SELECT count(*) FROM jsonb_object_keys(table_contract))=3
  AND (SELECT count(*) FROM jsonb_object_keys(trigger_contract))=2;
 GET DIAGNOSTICS updated_rows=ROW_COUNT;
 IF updated_rows<>1 THEN RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_SEAL_FAILED'; END IF;
 IF ocr_private.get_receipt_ocr_indeterminate_recovery_capability() IS DISTINCT FROM ${ready}::jsonb
 THEN RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_SEAL_READBACK_FAILED'; END IF;`;
  const tag = `$receipt_ocr_recovery108_seal_${sha256(body).slice(0, 18)}$`;
  return `DO ${tag}\nDECLARE actual_ledger_count integer; actual_ledger_identity_root text; predecessor_updated_rows integer; updated_rows integer;\nBEGIN\n ${body}\nEND;\n${tag};`;
}

function insertSealAfterLedger(compiledSql, sealSql) {
  const inserts = statementSpans(compiledSql).filter(({ token }) =>
    /^INSERT\s+INTO\s+supabase_migrations\.schema_migrations\b/i.test(leadingSql(token)));
  if (inserts.length !== 1) fail('RECEIPT_OCR_RECOVERY108_LEDGER_INSERT_INVALID');
  const [{ end }] = inserts;
  return `${compiledSql.slice(0, end)}\n${sealSql}\n${compiledSql.slice(end)}`;
}

export function compileRecovery108OperatingPlan(record = loadRecovery108HeldManifest()) {
  const predecessorPlan = compilePost106AclOperatingPlan(record.predecessorRecord);
  const terminalQuery = buildRecovery108StateQuery(record);
  const migration = {
    expectedPriorState: predecessorPlan.finalReadback,
    id: record.manifest.migration.id,
    path: record.manifest.migration.path,
    sha256: record.manifest.migration.sha256,
    statementVectorSha256: record.manifest.migration.statementVectorSha256,
    terminalReadback: { expected: terminalExpected(record), query: terminalQuery },
  };
  const plan = migrationEnvelope(record.material.bytes, migration, record.material.originalVector);
  if (plan.vectorSha256 !== migration.statementVectorSha256) {
    fail('RECEIPT_OCR_RECOVERY108_VECTOR_DIGEST_MISMATCH');
  }
  const atomic108 = insertSealAfterLedger(
    atomicMigrationSql(plan, migration),
    buildRecoverySealSql(record),
  );
  const lockTag = `$receipt_ocr_recovery108_${sha256(String(record.manifest.advisoryLockKey)).slice(0, 16)}$`;
  return Object.freeze({
    finalReadback: migration.terminalReadback,
    id: record.manifest.id,
    migration,
    plan,
    predecessorPlan,
    priorReadback: migration.expectedPriorState,
    sql: `BEGIN;\nSET LOCAL idle_in_transaction_session_timeout='30s';\nDO ${lockTag} BEGIN PERFORM pg_advisory_xact_lock(${record.manifest.advisoryLockKey}::bigint); END ${lockTag};\n${atomic108}\nCOMMIT;\n`,
    stateQuery: terminalQuery,
    transactionMode: 'single-explicit-108-transaction-after-verified-107',
  });
}

export function validateRecovery108TerminalState(value, record = loadRecovery108HeldManifest()) {
  const expected = terminalExpected(record);
  if (!equal(value, expected)) fail('RECEIPT_OCR_RECOVERY108_STAGE_INVALID');
  return Object.freeze({ targetIdentityRoot: expected.ledgerIdentityRoot });
}

export function assertRecovery108LaunchReady(record = loadRecovery108HeldManifest()) {
  if (record.manifest.launchPolicy.state !== 'ready') fail(record.manifest.launchPolicy.code);
}

export function recovery108ContractSummary(record) {
  return Object.freeze({
    id: record.manifest.id,
    launchState: record.manifest.launchPolicy.state,
    manifestSha256: record.manifestSha256,
    migrationVersion: record.manifest.migration.version,
    operatingTransition: record.manifest.operatingTransition,
    predecessorIdentityRoot: record.manifest.predecessor.terminalIdentityRoot,
    targetIdentityRoot: record.manifest.operatingIdentity.targetIdentityRoot,
  });
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  try {
    if (process.argv.length !== 3 || process.argv[2] !== '--check') {
      fail('RECEIPT_OCR_RECOVERY108_ARGUMENT_INVALID');
    }
    const record = loadRecovery108HeldManifest();
    compileRecovery108OperatingPlan(record);
    process.stdout.write(`${JSON.stringify(canonical(recovery108ContractSummary(record)))}\n`);
  } catch (error) {
    process.stderr.write(`${error?.code || 'RECEIPT_OCR_RECOVERY108_COMPILER_FAILED'}\n`);
    process.exitCode = 1;
  }
}
