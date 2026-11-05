#!/usr/bin/env node
/** Source-only compiler for the held receipt OCR 105 -> 106 -> 107 successor. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readOriginalStatementVector } from './apply-supabase-migration.mjs';
import {
  compilePost105OperatingPlan,
  compilePost105RehearsalPlan,
  loadPost105SuccessorManifest,
} from './receipt-ocr-post105-sql-successor.mjs';
import { ledgerIdentityRoot } from './review-media-evidence-prefixed-sql-successors.mjs';
import {
  atomicMigrationSql,
  migrationEnvelope,
  statementSpans,
} from './supabase-migration-transaction.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
export const REPOSITORY_ROOT = resolve(dirname(SCRIPT_PATH), '../../..');
export const POST106_ACL_MANIFEST_PATH = resolve(
  REPOSITORY_ROOT,
  '.github/receipt-ocr-post106-acl-admission-sql-successor.v1.json',
);
const BASE_MANIFEST_PATH = '.github/receipt-ocr-post105-sql-successor.v1.json';
const COMPILER_PATH = 'apps/web/scripts/receipt-ocr-post106-acl-admission-sql-successor.mjs';
const CAPABILITY_VERSION = 'receipt-ocr-definitive-credential-release-v2';
const HEX_SHA256 = /^[0-9a-f]{64}$/;
const EXPECTED_TOP_LEVEL_KEYS = Object.freeze([
  'advisoryLockKey',
  'baseSuccessor',
  'databaseName',
  'executorRole',
  'id',
  'launchPolicy',
  'migration',
  'operatingIdentity',
  'operatingTransition',
  'predecessor',
  'projectRef',
  'protectedSource',
  'purpose',
  'rehearsalFixture',
  'requiredWriterFences',
  'schemaVersion',
  'serverMajor',
  'stateRootAlgorithm',
  'toolchain',
]);

const operationError = code => {
  const error = new Error(code);
  error.code = code;
  return error;
};
const fail = code => { throw operationError(code); };
const sha256 = value => createHash('sha256').update(value).digest('hex');
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const canonical = value => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
    : value;
const equal = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));

function exactKeys(value, keys, code = 'RECEIPT_OCR_POST106_ACL_CONTRACT_INVALID') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(code);
  }
}

function assertHex(value, code = 'RECEIPT_OCR_POST106_ACL_CONTRACT_INVALID') {
  if (typeof value !== 'string' || !HEX_SHA256.test(value)) fail(code);
}

function normalizeIdentity(row) {
  exactKeys(row, ['name', 'statementCount', 'statementVectorSha256', 'version']);
  if (!/^\d{14}$/.test(row.version)
    || !/^[a-z0-9_]+$/.test(row.name)
    || !Number.isSafeInteger(row.statementCount)
    || row.statementCount < 1) fail('RECEIPT_OCR_POST106_ACL_CONTRACT_INVALID');
  assertHex(row.statementVectorSha256);
  return Object.freeze({ ...row });
}

function loadMigration(manifest) {
  exactKeys(manifest.migration, [
    'id', 'name', 'path', 'sha256', 'statementCount', 'statementVectorSha256', 'version',
  ]);
  const identity = normalizeIdentity({
    version: manifest.migration.version,
    name: manifest.migration.name,
    statementCount: manifest.migration.statementCount,
    statementVectorSha256: manifest.migration.statementVectorSha256,
  });
  if (manifest.migration.id !== identity.name
    || manifest.migration.path !== `backend/supabase/migrations/${identity.version}_${identity.name}.sql`) {
    fail('RECEIPT_OCR_POST106_ACL_CONTRACT_INVALID');
  }
  assertHex(manifest.migration.sha256);
  let bytes;
  try { bytes = readFileSync(resolve(REPOSITORY_ROOT, manifest.migration.path)); } catch {
    fail('RECEIPT_OCR_POST106_ACL_SOURCE_DRIFT');
  }
  if (sha256(bytes) !== manifest.migration.sha256) fail('RECEIPT_OCR_POST106_ACL_SOURCE_DRIFT');
  let originalVector;
  try { originalVector = readOriginalStatementVector(manifest.migration, bytes); } catch {
    fail('RECEIPT_OCR_POST106_ACL_SOURCE_DRIFT');
  }
  if (originalVector.length !== identity.statementCount
    || sha256(JSON.stringify(originalVector)) !== identity.statementVectorSha256) {
    fail('RECEIPT_OCR_POST106_ACL_SOURCE_DRIFT');
  }
  return Object.freeze({ bytes, identity, originalVector });
}

function validateToolchain(manifest) {
  if (!Array.isArray(manifest.toolchain) || manifest.toolchain.length !== 1) {
    fail('RECEIPT_OCR_POST106_ACL_CONTRACT_INVALID');
  }
  const [entry] = manifest.toolchain;
  exactKeys(entry, ['path', 'sha256']);
  if (entry.path !== COMPILER_PATH) fail('RECEIPT_OCR_POST106_ACL_CONTRACT_INVALID');
  assertHex(entry.sha256);
  let bytes;
  try { bytes = readFileSync(resolve(REPOSITORY_ROOT, entry.path)); } catch {
    fail('RECEIPT_OCR_POST106_ACL_TOOLCHAIN_DRIFT');
  }
  if (sha256(bytes) !== entry.sha256) fail('RECEIPT_OCR_POST106_ACL_TOOLCHAIN_DRIFT');
}

function validateManifestShape(manifest) {
  exactKeys(manifest, EXPECTED_TOP_LEVEL_KEYS);
  if (manifest.schemaVersion !== 1
    || manifest.id !== 'receipt_ocr_post106_acl_admission_sql_successor_v1'
    || manifest.purpose !== 'receipt-ocr-credential-release-acl-admission-post106'
    || manifest.projectRef !== 'aqlcofblfxdrjhhdmarw'
    || manifest.serverMajor !== 17
    || manifest.databaseName !== 'postgres'
    || manifest.executorRole !== 'postgres'
    || manifest.stateRootAlgorithm !== 'review-media-ledger-identity/v1'
    || !Number.isSafeInteger(manifest.advisoryLockKey)
    || manifest.launchPolicy?.state !== 'held') {
    fail('RECEIPT_OCR_POST106_ACL_CONTRACT_INVALID');
  }
  exactKeys(manifest.launchPolicy, ['code', 'reason', 'state']);
  exactKeys(manifest.operatingTransition, ['after', 'before', 'intermediate']);
  if (manifest.operatingTransition.before !== 105
    || manifest.operatingTransition.intermediate !== 106
    || manifest.operatingTransition.after !== 107) {
    fail('RECEIPT_OCR_POST106_ACL_CONTRACT_INVALID');
  }
  exactKeys(manifest.predecessor, [
    'ledgerCount', 'manifestPath', 'manifestSha256', 'terminalIdentityRoot',
  ]);
  exactKeys(manifest.baseSuccessor, [
    'compilerPath', 'compilerSha256', 'manifestPath', 'manifestSha256',
    'operatingTargetIdentityRoot', 'rehearsalTargetIdentityRoot', 'state',
  ]);
  exactKeys(manifest.operatingIdentity, [
    'migrationIdentityRoot', 'stage106IdentityRoot', 'suffixRoot', 'targetIdentityRoot',
  ]);
  exactKeys(manifest.rehearsalFixture, [
    'ledgerCount', 'path', 'receiptSha256', 'stage106IdentityRoot',
    'targetIdentityRoot', 'terminalIdentityRoot',
  ]);
  for (const value of [
    manifest.predecessor.manifestSha256,
    manifest.predecessor.terminalIdentityRoot,
    manifest.baseSuccessor.compilerSha256,
    manifest.baseSuccessor.manifestSha256,
    manifest.baseSuccessor.operatingTargetIdentityRoot,
    manifest.baseSuccessor.rehearsalTargetIdentityRoot,
    manifest.operatingIdentity.migrationIdentityRoot,
    manifest.operatingIdentity.stage106IdentityRoot,
    manifest.operatingIdentity.suffixRoot,
    manifest.operatingIdentity.targetIdentityRoot,
    manifest.rehearsalFixture.receiptSha256,
    manifest.rehearsalFixture.stage106IdentityRoot,
    manifest.rehearsalFixture.targetIdentityRoot,
    manifest.rehearsalFixture.terminalIdentityRoot,
  ]) assertHex(value);
  if (manifest.predecessor.ledgerCount !== 105
    || manifest.baseSuccessor.manifestPath !== BASE_MANIFEST_PATH
    || manifest.baseSuccessor.compilerPath !== 'apps/web/scripts/receipt-ocr-post105-sql-successor.mjs'
    || manifest.baseSuccessor.state !== 'held_unapplied'
    || manifest.rehearsalFixture.ledgerCount !== 105) {
    fail('RECEIPT_OCR_POST106_ACL_CONTRACT_INVALID');
  }
}

function suffixRoot(baseRecord, manifest) {
  return sha256(JSON.stringify([
    {
      id: baseRecord.manifest.migration.id,
      path: baseRecord.manifest.migration.path,
      sha256: baseRecord.manifest.migration.sha256,
      statementVectorSha256: baseRecord.manifest.migration.statementVectorSha256,
    },
    {
      id: manifest.migration.id,
      path: manifest.migration.path,
      sha256: manifest.migration.sha256,
      statementVectorSha256: manifest.migration.statementVectorSha256,
    },
  ]));
}

export function loadPost106AclSuccessorManifest({ manifestPath = POST106_ACL_MANIFEST_PATH } = {}) {
  let bytes;
  let manifest;
  try {
    bytes = readFileSync(manifestPath);
    manifest = JSON.parse(bytes.toString('utf8'));
  } catch { fail('RECEIPT_OCR_POST106_ACL_MANIFEST_INVALID'); }
  validateManifestShape(manifest);

  const baseRecord = loadPost105SuccessorManifest({
    manifestPath: resolve(REPOSITORY_ROOT, manifest.baseSuccessor.manifestPath),
  });
  if (baseRecord.manifestSha256 !== manifest.baseSuccessor.manifestSha256
    || baseRecord.manifest.predecessor.manifestPath !== manifest.predecessor.manifestPath
    || baseRecord.manifest.predecessor.manifestSha256 !== manifest.predecessor.manifestSha256
    || baseRecord.manifest.predecessor.terminalIdentityRoot !== manifest.predecessor.terminalIdentityRoot
    || baseRecord.manifest.operatingIdentity.targetIdentityRoot
      !== manifest.baseSuccessor.operatingTargetIdentityRoot
    || baseRecord.manifest.rehearsalFixture.targetIdentityRoot
      !== manifest.baseSuccessor.rehearsalTargetIdentityRoot) {
    fail('RECEIPT_OCR_POST106_ACL_BASE_DRIFT');
  }
  if (sha256(readFileSync(resolve(REPOSITORY_ROOT, manifest.baseSuccessor.compilerPath)))
    !== manifest.baseSuccessor.compilerSha256) {
    fail('RECEIPT_OCR_POST106_ACL_BASE_DRIFT');
  }

  const material = loadMigration(manifest);
  const operatingRows = [...baseRecord.priorRows, baseRecord.material.identity, material.identity];
  const rehearsalRows = [
    ...baseRecord.rehearsalPriorRows,
    baseRecord.material.identity,
    material.identity,
  ];
  if (ledgerIdentityRoot([material.identity]) !== manifest.operatingIdentity.migrationIdentityRoot
    || ledgerIdentityRoot([...baseRecord.priorRows, baseRecord.material.identity])
      !== manifest.operatingIdentity.stage106IdentityRoot
    || ledgerIdentityRoot(operatingRows) !== manifest.operatingIdentity.targetIdentityRoot
    || suffixRoot(baseRecord, manifest) !== manifest.operatingIdentity.suffixRoot
    || baseRecord.rehearsalPriorRows.length !== manifest.rehearsalFixture.ledgerCount
    || ledgerIdentityRoot(baseRecord.rehearsalPriorRows)
      !== manifest.rehearsalFixture.terminalIdentityRoot
    || ledgerIdentityRoot([...baseRecord.rehearsalPriorRows, baseRecord.material.identity])
      !== manifest.rehearsalFixture.stage106IdentityRoot
    || ledgerIdentityRoot(rehearsalRows) !== manifest.rehearsalFixture.targetIdentityRoot) {
    fail('RECEIPT_OCR_POST106_ACL_IDENTITY_BINDING_INVALID');
  }
  if (manifest.rehearsalFixture.path !== baseRecord.manifest.rehearsalFixture.path
    || manifest.rehearsalFixture.receiptSha256
      !== baseRecord.manifest.rehearsalFixture.receiptSha256) {
    fail('RECEIPT_OCR_POST106_ACL_REHEARSAL_DRIFT');
  }
  validateToolchain(manifest);
  return Object.freeze({
    baseRecord,
    bytes,
    manifest,
    manifestSha256: sha256(bytes),
    material,
    operatingRows: Object.freeze(operatingRows),
    rehearsalRows: Object.freeze(rehearsalRows),
  });
}

function leadingSql(token) {
  let value = token.trim();
  for (;;) {
    if (value.startsWith('--')) {
      const end = value.indexOf('\n');
      value = end < 0 ? '' : value.slice(end + 1).trim();
    } else if (value.startsWith('/*')) {
      let depth = 1;
      let index = 2;
      while (depth && index < value.length) {
        if (value.startsWith('/*', index)) { depth += 1; index += 2; }
        else if (value.startsWith('*/', index)) { depth -= 1; index += 2; }
        else index += 1;
      }
      if (depth) fail('RECEIPT_OCR_POST106_ACL_SQL_UNTERMINATED');
      value = value.slice(index).trim();
    } else return value;
  }
}

function suppressAssertionSelectOutput(execution) {
  const spans = statementSpans(execution);
  let cursor = 0;
  let compiled = '';
  for (const span of spans) {
    if (!/^SELECT\b/i.test(leadingSql(span.token))) continue;
    const tag = `$post106_acl_assert_${sha256(span.token).slice(0, 18)}$`;
    if (span.token.includes(tag)) fail('RECEIPT_OCR_POST106_ACL_SQL_DELIMITER_COLLISION');
    compiled += execution.slice(cursor, span.start);
    compiled += `DO ${tag}\nDECLARE assertion_row record;\nBEGIN\n FOR assertion_row IN\n${span.token}\n LOOP\n  NULL;\n END LOOP;\nEND;\n${tag};`;
    cursor = span.end;
  }
  return cursor ? compiled + execution.slice(cursor) : execution;
}

function targetRoot(record, mode) {
  return mode === 'operating'
    ? record.manifest.operatingIdentity.targetIdentityRoot
    : record.manifest.rehearsalFixture.targetIdentityRoot;
}

function terminalExpected(record, mode) {
  return Object.freeze({
    aclAdmitted: true,
    base106Present: true,
    capability: Object.freeze({
      schema_version: 1,
      status: 'ready',
      capability_version: CAPABILITY_VERSION,
    }),
    ledgerCount: 107,
    ledgerIdentityRoot: targetRoot(record, mode),
    migration107Present: true,
    schemaVersion: 1,
    v1ContractSealed: true,
    v2ContractSealed: true,
  });
}

export function buildPost106AclStateQuery(record, { mode = 'operating' } = {}) {
  if (mode !== 'operating' && mode !== 'rehearsal') fail('RECEIPT_OCR_POST106_ACL_MODE_INVALID');
  const target = quote(targetRoot(record, mode));
  const base = record.baseRecord.manifest.migration;
  const migration = record.manifest.migration;
  return `SELECT jsonb_build_object(
 'schemaVersion',1,
 'ledgerCount',ledger_scope.row_count,
 'ledgerIdentityRoot',ledger_scope.identity_root,
 'base106Present',(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version=${quote(base.version)} AND name=${quote(base.name)} AND cardinality(statements)=${base.statementCount} AND encode(extensions.digest(convert_to(array_to_json(statements)::text,'UTF8'),'sha256'),'hex')=${quote(base.statementVectorSha256)})=1,
 'migration107Present',(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version=${quote(migration.version)} AND name=${quote(migration.name)} AND cardinality(statements)=${migration.statementCount} AND encode(extensions.digest(convert_to(array_to_json(statements)::text,'UTF8'),'sha256'),'hex')=${quote(migration.statementVectorSha256)})=1,
 'v1ContractSealed',(SELECT count(*) FROM ocr_private.receipt_credential_release_catalog_contract WHERE capability_version='receipt-ocr-definitive-credential-release-v1' AND sealed_at IS NOT NULL)=1,
 'v2ContractSealed',(SELECT count(*) FROM ocr_private.receipt_credential_release_catalog_contract WHERE capability_version=${quote(CAPABILITY_VERSION)} AND migration_version=${quote(migration.version)} AND migration_name=${quote(migration.name)} AND statement_count=${migration.statementCount} AND statement_vector_sha256=${quote(migration.statementVectorSha256)} AND ledger_count=107 AND ledger_identity_root=${target} AND sealed_at IS NOT NULL)=1,
 'aclAdmitted',ocr_private.receipt_credential_release_acl_admitted_v2(),
 'capability',ocr_private.get_receipt_ocr_credential_release_capability()
) AS receipt_ocr_post106_acl_state
FROM (WITH ledger_identity AS (
 SELECT version,name,
  octet_length(convert_to(version,'UTF8'))::text||':'||version||chr(31)||
   CASE WHEN name IS NULL THEN '-1:' ELSE octet_length(convert_to(name,'UTF8'))::text||':'||name END||chr(31)||
   cardinality(statements)::text||chr(31)||
   encode(extensions.digest(convert_to(array_to_json(statements)::text,'UTF8'),'sha256'),'hex') AS row_material
 FROM supabase_migrations.schema_migrations
) SELECT count(*)::int AS row_count,
 encode(extensions.digest(convert_to(coalesce(string_agg(row_material,chr(30) ORDER BY version COLLATE "C",name COLLATE "C"),''),'UTF8'),'sha256'),'hex') AS identity_root
FROM ledger_identity) AS ledger_scope`;
}

function buildAclSealSql(record, { mode }) {
  const migration = record.manifest.migration;
  const root = targetRoot(record, mode);
  const ready = quote(JSON.stringify(terminalExpected(record, mode).capability));
  const body = `IF ocr_private.receipt_credential_release_acl_admitted_v2() IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'RECEIPT_OCR_ACL_V2_SEAL_ADMISSION_FAILED'; END IF;
 WITH ledger_identity AS (
  SELECT version,name,
   octet_length(convert_to(version,'UTF8'))::text||':'||version||chr(31)||
    CASE WHEN name IS NULL THEN '-1:' ELSE octet_length(convert_to(name,'UTF8'))::text||':'||name END||chr(31)||
    cardinality(statements)::text||chr(31)||
    encode(extensions.digest(convert_to(array_to_json(statements)::text,'UTF8'),'sha256'),'hex') AS row_material
  FROM supabase_migrations.schema_migrations
 ) SELECT count(*)::int,
  encode(extensions.digest(convert_to(coalesce(string_agg(row_material,chr(30) ORDER BY version COLLATE "C",name COLLATE "C"),''),'UTF8'),'sha256'),'hex')
 INTO actual_ledger_count,actual_ledger_identity_root FROM ledger_identity;
 IF actual_ledger_count<>107 OR actual_ledger_identity_root<>${quote(root)}
 THEN RAISE EXCEPTION 'RECEIPT_OCR_ACL_V2_SEAL_LEDGER_MISMATCH'; END IF;
 UPDATE ocr_private.receipt_credential_release_catalog_contract
 SET migration_version=${quote(migration.version)},
  migration_name=${quote(migration.name)},
  statement_count=${migration.statementCount},
  statement_vector_sha256=${quote(migration.statementVectorSha256)},
  ledger_count=107,
  ledger_identity_root=${quote(root)},
  sealed_at=pg_catalog.clock_timestamp()
 WHERE capability_version=${quote(CAPABILITY_VERSION)}
  AND migration_version IS NULL AND migration_name IS NULL
  AND statement_count IS NULL AND statement_vector_sha256 IS NULL
  AND ledger_count IS NULL AND ledger_identity_root IS NULL AND sealed_at IS NULL
  AND (SELECT count(*) FROM jsonb_object_keys(function_contract))=5
  AND (SELECT count(*) FROM jsonb_object_keys(table_contract))=2;
 GET DIAGNOSTICS updated_rows=ROW_COUNT;
 IF updated_rows<>1 THEN RAISE EXCEPTION 'RECEIPT_OCR_ACL_V2_SEAL_FAILED'; END IF;
 IF ocr_private.get_receipt_ocr_credential_release_capability() IS DISTINCT FROM ${ready}::jsonb
 THEN RAISE EXCEPTION 'RECEIPT_OCR_ACL_V2_SEAL_READBACK_FAILED'; END IF;`;
  const tag = `$receipt_ocr_acl_v2_seal_${sha256(body).slice(0, 18)}$`;
  return `DO ${tag}\nDECLARE actual_ledger_count integer; actual_ledger_identity_root text; updated_rows integer;\nBEGIN\n ${body}\nEND;\n${tag};`;
}

function insertSealAfterLedger(compiledSql, sealSql) {
  const inserts = statementSpans(compiledSql).filter(({ token }) =>
    /^INSERT\s+INTO\s+supabase_migrations\.schema_migrations\b/i.test(leadingSql(token)));
  if (inserts.length !== 1) fail('RECEIPT_OCR_POST106_ACL_LEDGER_INSERT_INVALID');
  const [{ end }] = inserts;
  return `${compiledSql.slice(0, end)}\n${sealSql}\n${compiledSql.slice(end)}`;
}

function compilePlan(record, { mode }) {
  if (mode !== 'operating' && mode !== 'rehearsal') fail('RECEIPT_OCR_POST106_ACL_MODE_INVALID');
  const basePlan = mode === 'operating'
    ? compilePost105OperatingPlan(record.baseRecord)
    : compilePost105RehearsalPlan(record.baseRecord);
  const terminalQuery = buildPost106AclStateQuery(record, { mode });
  const migration = {
    expectedPriorState: basePlan.finalReadback,
    id: record.manifest.migration.id,
    path: record.manifest.migration.path,
    sha256: record.manifest.migration.sha256,
    statementVectorSha256: record.manifest.migration.statementVectorSha256,
    terminalReadback: { expected: terminalExpected(record, mode), query: terminalQuery },
  };
  const sourcePlan = migrationEnvelope(
    record.material.bytes,
    migration,
    record.material.originalVector,
  );
  if (sourcePlan.vectorSha256 !== migration.statementVectorSha256) {
    fail('RECEIPT_OCR_POST106_ACL_VECTOR_DIGEST_MISMATCH');
  }
  const plan = Object.freeze({
    ...sourcePlan,
    execution: suppressAssertionSelectOutput(sourcePlan.execution),
  });
  const atomic107 = insertSealAfterLedger(
    atomicMigrationSql(plan, migration),
    buildAclSealSql(record, { mode }),
  );
  const lockTag = `$receipt_ocr_post106_acl_${sha256(String(record.manifest.advisoryLockKey)).slice(0, 16)}$`;
  return Object.freeze({
    basePlan,
    finalReadback: migration.terminalReadback,
    id: record.manifest.id,
    migration,
    plan,
    priorReadback: migration.expectedPriorState,
    sql: `BEGIN;\nSET LOCAL idle_in_transaction_session_timeout='30s';\nDO ${lockTag} BEGIN PERFORM pg_advisory_xact_lock(${record.manifest.advisoryLockKey}::bigint); END ${lockTag};\n${basePlan.sql}\n${atomic107}\nCOMMIT;\n`,
    stateQuery: terminalQuery,
    transactionMode: 'single-explicit-outer-transaction',
  });
}

export function compilePost106AclRehearsalPlan(record) {
  return compilePlan(record, { mode: 'rehearsal' });
}

export function compilePost106AclOperatingPlan(record) {
  return compilePlan(record, { mode: 'operating' });
}

export function expectedPost106AclTerminalState(record, { mode = 'operating' } = {}) {
  return terminalExpected(record, mode);
}

export function validatePost106AclTerminalState(value, record, { mode = 'operating' } = {}) {
  const expected = terminalExpected(record, mode);
  if (!equal(value, expected)) fail('RECEIPT_OCR_POST106_ACL_STAGE_INVALID');
  return Object.freeze({ mode, targetIdentityRoot: expected.ledgerIdentityRoot });
}

export function assertPost106AclLaunchReady(record) {
  if (record.manifest.launchPolicy.state !== 'ready') fail(record.manifest.launchPolicy.code);
}

export function post106AclContractSummary(record) {
  return Object.freeze({
    id: record.manifest.id,
    launchState: record.manifest.launchPolicy.state,
    manifestSha256: record.manifestSha256,
    migrationVersion: record.manifest.migration.version,
    operatingTransition: record.manifest.operatingTransition,
    predecessorIdentityRoot: record.manifest.predecessor.terminalIdentityRoot,
    stage106IdentityRoot: record.manifest.operatingIdentity.stage106IdentityRoot,
    targetIdentityRoot: record.manifest.operatingIdentity.targetIdentityRoot,
  });
}

export function mainPost106AclSuccessor(argv = process.argv.slice(2)) {
  if (argv.length !== 1 || argv[0] !== '--check') {
    fail('RECEIPT_OCR_POST106_ACL_ARGUMENT_INVALID');
  }
  const record = loadPost106AclSuccessorManifest();
  process.stdout.write(`${JSON.stringify(canonical(post106AclContractSummary(record)))}\n`);
}

if (import.meta.main) {
  try { mainPost106AclSuccessor(); } catch (error) {
    process.stderr.write(`${error?.code ?? 'RECEIPT_OCR_POST106_ACL_FAILURE'}\n`);
    process.exitCode = 1;
  }
}
