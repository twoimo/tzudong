#!/usr/bin/env node
/** Source-only compiler for the held receipt OCR 105 -> 106 successor. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readOriginalStatementVector } from './apply-supabase-migration.mjs';
import {
  ledgerIdentityRoot,
  loadEvidencePrefixedSuccessorManifest,
} from './review-media-evidence-prefixed-sql-successors.mjs';
import {
  atomicMigrationSql,
  migrationEnvelope,
  statementSpans,
} from './supabase-migration-transaction.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
export const REPOSITORY_ROOT = resolve(dirname(SCRIPT_PATH), '../../..');
export const POST105_MANIFEST_PATH = resolve(
  REPOSITORY_ROOT,
  '.github/receipt-ocr-post105-sql-successor.v1.json',
);

const HEX_SHA256 = /^[0-9a-f]{64}$/;
const EXPECTED_TOP_LEVEL_KEYS = Object.freeze([
  'advisoryLockKey',
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
const EXPECTED_STAGE_KEYS = Object.freeze(['bundle', 'state']);
const EXPECTED_BUNDLE_KEYS = Object.freeze([
  'ledgerCount', 'prefixRoot', 'priorCount', 'suffixRoot', 'targetCount',
]);
const EXPECTED_STATE_KEYS = Object.freeze([
  'ledgerIdentityRoot',
  'predecessorIdentityRoot',
  'predecessorReady',
  'runtimeObjectCount',
  'runtimeReady',
  'targetIdentityRoot',
  'targetReady',
  'targetStageIndex',
  'terminalReady',
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

function exactKeys(value, keys, code = 'RECEIPT_OCR_POST105_CONTRACT_INVALID') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(code);
  }
}

function assertHex(value, code = 'RECEIPT_OCR_POST105_CONTRACT_INVALID') {
  if (typeof value !== 'string' || !HEX_SHA256.test(value)) fail(code);
}

function normalizeIdentity(row, code = 'RECEIPT_OCR_POST105_CONTRACT_INVALID') {
  exactKeys(row, ['name', 'statementCount', 'statementVectorSha256', 'version'], code);
  if (!/^\d{14}$/.test(row.version)
    || !/^[a-z0-9_]+$/.test(row.name)
    || !Number.isSafeInteger(row.statementCount)
    || row.statementCount < 1) fail(code);
  assertHex(row.statementVectorSha256, code);
  return Object.freeze({
    version: row.version,
    name: row.name,
    statementCount: row.statementCount,
    statementVectorSha256: row.statementVectorSha256,
  });
}

function validateToolchain(manifest) {
  if (!Array.isArray(manifest.toolchain) || manifest.toolchain.length !== 1) {
    fail('RECEIPT_OCR_POST105_CONTRACT_INVALID');
  }
  const entry = manifest.toolchain[0];
  exactKeys(entry, ['path', 'sha256']);
  if (entry.path !== 'apps/web/scripts/receipt-ocr-post105-sql-successor.mjs') {
    fail('RECEIPT_OCR_POST105_CONTRACT_INVALID');
  }
  assertHex(entry.sha256);
  let bytes;
  try { bytes = readFileSync(resolve(REPOSITORY_ROOT, entry.path)); } catch {
    fail('RECEIPT_OCR_POST105_TOOLCHAIN_DRIFT');
  }
  if (sha256(bytes) !== entry.sha256) fail('RECEIPT_OCR_POST105_TOOLCHAIN_DRIFT');
}

function targetRowsFromPredecessor(record) {
  return Object.freeze([
    ...record.baseRows,
    ...record.evidenceRows,
    ...record.predecessorRows,
    ...record.featureRows,
  ]);
}

function rehearsalRowsFromPredecessor(record) {
  const fixtureVector = sha256(JSON.stringify(['local schema-only predecessor fixture']));
  const baseRows = Array.from({ length: 86 }, (_, index) => ({
    version: String(index + 1).padStart(14, '0'),
    name: `local_predecessor_${index + 1}`,
    statementCount: 1,
    statementVectorSha256: fixtureVector,
  }));
  return Object.freeze([
    ...baseRows,
    ...record.evidenceRows,
    ...record.predecessorRows,
    ...record.featureRows,
  ]);
}

function validateRehearsalFixture(manifest, predecessor, migrationIdentity) {
  exactKeys(manifest.rehearsalFixture, [
    'ledgerCount', 'path', 'receiptSha256', 'targetIdentityRoot', 'terminalIdentityRoot',
  ]);
  if (manifest.rehearsalFixture.ledgerCount !== 105
    || manifest.rehearsalFixture.path
      !== 'apps/web/performance/feature-sql-integration-20261013/pg17-evidence-prefixed-aggregate-compiled-20261018.json') {
    fail('RECEIPT_OCR_POST105_REHEARSAL_FIXTURE_INVALID');
  }
  for (const value of [
    manifest.rehearsalFixture.receiptSha256,
    manifest.rehearsalFixture.terminalIdentityRoot,
    manifest.rehearsalFixture.targetIdentityRoot,
  ]) assertHex(value, 'RECEIPT_OCR_POST105_REHEARSAL_FIXTURE_INVALID');
  let bytes;
  let receipt;
  try {
    bytes = readFileSync(resolve(REPOSITORY_ROOT, manifest.rehearsalFixture.path));
    receipt = JSON.parse(bytes.toString('utf8'));
  } catch { fail('RECEIPT_OCR_POST105_REHEARSAL_FIXTURE_INVALID'); }
  if (sha256(bytes) !== manifest.rehearsalFixture.receiptSha256
    || receipt.status !== 'passed'
    || receipt.aggregateExecution?.terminalLedger !== 105
    || receipt.aggregateExecution?.feature?.terminalIdentityRoot
      !== manifest.rehearsalFixture.terminalIdentityRoot) {
    fail('RECEIPT_OCR_POST105_REHEARSAL_FIXTURE_INVALID');
  }
  const rows = rehearsalRowsFromPredecessor(predecessor);
  if (rows.length !== 105
    || ledgerIdentityRoot(rows) !== manifest.rehearsalFixture.terminalIdentityRoot
    || ledgerIdentityRoot([...rows, migrationIdentity]) !== manifest.rehearsalFixture.targetIdentityRoot) {
    fail('RECEIPT_OCR_POST105_REHEARSAL_FIXTURE_INVALID');
  }
  return rows;
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
    fail('RECEIPT_OCR_POST105_CONTRACT_INVALID');
  }
  assertHex(manifest.migration.sha256);
  let bytes;
  try { bytes = readFileSync(resolve(REPOSITORY_ROOT, manifest.migration.path)); } catch {
    fail('RECEIPT_OCR_POST105_SOURCE_DRIFT');
  }
  if (sha256(bytes) !== manifest.migration.sha256) fail('RECEIPT_OCR_POST105_SOURCE_DRIFT');
  let originalVector;
  try { originalVector = readOriginalStatementVector(manifest.migration, bytes); } catch {
    fail('RECEIPT_OCR_POST105_SOURCE_DRIFT');
  }
  if (originalVector.length !== identity.statementCount
    || sha256(JSON.stringify(originalVector)) !== identity.statementVectorSha256) {
    fail('RECEIPT_OCR_POST105_SOURCE_DRIFT');
  }
  return Object.freeze({ bytes, identity, originalVector });
}

function validateManifestShape(manifest) {
  exactKeys(manifest, EXPECTED_TOP_LEVEL_KEYS);
  if (manifest.schemaVersion !== 1
    || manifest.id !== 'receipt_ocr_post105_sql_successor_v1'
    || manifest.purpose !== 'receipt-ocr-definitive-credential-release-post105'
    || manifest.projectRef !== 'aqlcofblfxdrjhhdmarw'
    || manifest.serverMajor !== 17
    || manifest.databaseName !== 'postgres'
    || manifest.executorRole !== 'postgres'
    || manifest.stateRootAlgorithm !== 'review-media-ledger-identity/v1'
    || !Number.isSafeInteger(manifest.advisoryLockKey)
    || manifest.launchPolicy?.state !== 'held') {
    fail('RECEIPT_OCR_POST105_CONTRACT_INVALID');
  }
  exactKeys(manifest.launchPolicy, ['code', 'reason', 'state']);
  exactKeys(manifest.operatingTransition, ['after', 'before']);
  if (manifest.operatingTransition.before !== 105 || manifest.operatingTransition.after !== 106) {
    fail('RECEIPT_OCR_POST105_CONTRACT_INVALID');
  }
  exactKeys(manifest.predecessor, [
    'ledgerCount', 'manifestPath', 'manifestSha256', 'terminalIdentityRoot',
  ]);
  if (manifest.predecessor.ledgerCount !== 105
    || manifest.predecessor.manifestPath !== '.github/review-media-evidence-prefixed-feature-successor.v1.json') {
    fail('RECEIPT_OCR_POST105_CONTRACT_INVALID');
  }
  exactKeys(manifest.operatingIdentity, [
    'migrationIdentityRoot', 'suffixRoot', 'targetIdentityRoot',
  ]);
  for (const value of [
    manifest.predecessor.manifestSha256,
    manifest.predecessor.terminalIdentityRoot,
    manifest.operatingIdentity.migrationIdentityRoot,
    manifest.operatingIdentity.suffixRoot,
    manifest.operatingIdentity.targetIdentityRoot,
  ]) assertHex(value);
}

export function loadPost105SuccessorManifest({ manifestPath = POST105_MANIFEST_PATH } = {}) {
  let bytes;
  let manifest;
  try {
    bytes = readFileSync(manifestPath);
    manifest = JSON.parse(bytes.toString('utf8'));
  } catch { fail('RECEIPT_OCR_POST105_MANIFEST_INVALID'); }
  validateManifestShape(manifest);

  const predecessor = loadEvidencePrefixedSuccessorManifest('feature');
  if (manifest.predecessor.manifestSha256 !== predecessor.manifestSha256
    || manifest.predecessor.terminalIdentityRoot !== predecessor.manifest.operatingIdentity.terminalIdentityRoot) {
    fail('RECEIPT_OCR_POST105_PREDECESSOR_DRIFT');
  }
  const priorRows = targetRowsFromPredecessor(predecessor);
  if (priorRows.length !== manifest.predecessor.ledgerCount
    || ledgerIdentityRoot(priorRows) !== manifest.predecessor.terminalIdentityRoot) {
    fail('RECEIPT_OCR_POST105_PREDECESSOR_DRIFT');
  }

  const material = loadMigration(manifest);
  const migrationIdentityRoot = ledgerIdentityRoot([material.identity]);
  const targetIdentityRoot = ledgerIdentityRoot([...priorRows, material.identity]);
  const suffixRoot = sha256(JSON.stringify({
    id: manifest.migration.id,
    path: manifest.migration.path,
    sha256: manifest.migration.sha256,
    statementVectorSha256: manifest.migration.statementVectorSha256,
  }));
  if (manifest.operatingIdentity.migrationIdentityRoot !== migrationIdentityRoot
    || manifest.operatingIdentity.targetIdentityRoot !== targetIdentityRoot
    || manifest.operatingIdentity.suffixRoot !== suffixRoot) {
    fail('RECEIPT_OCR_POST105_IDENTITY_BINDING_INVALID');
  }
  const rehearsalPriorRows = validateRehearsalFixture(manifest, predecessor, material.identity);
  validateToolchain(manifest);
  return Object.freeze({
    bytes,
    manifest,
    manifestSha256: sha256(bytes),
    material,
    predecessor,
    priorRows,
    rehearsalPriorRows,
  });
}

function identityScopeCte(name, predicate) {
  return `${name} AS (
  SELECT count(*)::int AS row_count,
   encode(sha256(convert_to(coalesce(string_agg(row_material,chr(30) ORDER BY version COLLATE "C",name COLLATE "C"),''),'UTF8')),'hex') AS identity_root
  FROM ledger_identities WHERE ${predicate}
 )`;
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
      if (depth) fail('RECEIPT_OCR_POST105_SQL_UNTERMINATED');
      value = value.slice(index).trim();
    } else {
      return value;
    }
  }
}

function suppressAssertionSelectOutput(execution) {
  const spans = statementSpans(execution);
  let cursor = 0;
  let compiled = '';
  for (const span of spans) {
    if (!/^SELECT\b/i.test(leadingSql(span.token))) continue;
    const tag = `$post105_assert_${sha256(span.token).slice(0, 18)}$`;
    if (span.token.includes(tag)) fail('RECEIPT_OCR_POST105_SQL_DELIMITER_COLLISION');
    compiled += execution.slice(cursor, span.start);
    compiled += `DO ${tag}\nDECLARE assertion_row record;\nBEGIN\n FOR assertion_row IN\n${span.token}\n LOOP\n  NULL;\n END LOOP;\nEND;\n${tag};`;
    cursor = span.end;
  }
  return cursor ? compiled + execution.slice(cursor) : execution;
}

function buildCatalogSealSql(record, { mode }) {
  const ledgerIdentityRootValue = mode === 'operating'
    ? record.manifest.operatingIdentity.targetIdentityRoot
    : record.manifest.rehearsalFixture.targetIdentityRoot;
  const readyCapability = `${quote(JSON.stringify({
    schema_version: 1,
    status: 'ready',
    capability_version: 'receipt-ocr-definitive-credential-release-v1',
  }))}::jsonb`;
  const sealBody = `WITH ledger_identity AS (
   SELECT migration.version,
    migration.name,
    pg_catalog.octet_length(pg_catalog.convert_to(migration.version,'UTF8'))::text||':'||migration.version||pg_catalog.chr(31)||
     CASE WHEN migration.name IS NULL THEN '-1:' ELSE pg_catalog.octet_length(pg_catalog.convert_to(migration.name,'UTF8'))::text||':'||migration.name END||pg_catalog.chr(31)||
     pg_catalog.cardinality(migration.statements)::text||pg_catalog.chr(31)||
     pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.array_to_json(migration.statements)::text,'UTF8'),'sha256'),'hex') AS row_material
   FROM supabase_migrations.schema_migrations AS migration
  )
  SELECT pg_catalog.count(*)::integer,
   pg_catalog.encode(extensions.digest(pg_catalog.convert_to(coalesce(pg_catalog.string_agg(ledger_identity.row_material,pg_catalog.chr(30) ORDER BY ledger_identity.version COLLATE "C",ledger_identity.name COLLATE "C"),''),'UTF8'),'sha256'),'hex')
  INTO actual_ledger_count,actual_ledger_identity_root
  FROM ledger_identity;
  IF actual_ledger_count<>${record.manifest.operatingTransition.after}
   OR actual_ledger_identity_root<>${quote(ledgerIdentityRootValue)}
   OR (SELECT pg_catalog.count(*) FROM supabase_migrations.schema_migrations AS migration
       WHERE migration.version=${quote(record.manifest.migration.version)}
        AND migration.name=${quote(record.manifest.migration.name)}
        AND pg_catalog.cardinality(migration.statements)=${record.manifest.migration.statementCount}
        AND pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.array_to_json(migration.statements)::text,'UTF8'),'sha256'),'hex')=${quote(record.manifest.migration.statementVectorSha256)})<>1
  THEN RAISE EXCEPTION 'RECEIPT_OCR_CATALOG_SEAL_LEDGER_MISMATCH'; END IF;
  UPDATE ocr_private.receipt_credential_release_catalog_contract
 SET migration_version=${quote(record.manifest.migration.version)},
     migration_name=${quote(record.manifest.migration.name)},
     statement_count=${record.manifest.migration.statementCount},
     statement_vector_sha256=${quote(record.manifest.migration.statementVectorSha256)},
     ledger_count=${record.manifest.operatingTransition.after},
     ledger_identity_root=${quote(ledgerIdentityRootValue)},
     sealed_at=pg_catalog.clock_timestamp()
 WHERE capability_version='receipt-ocr-definitive-credential-release-v1'
  AND migration_version IS NULL
  AND migration_name IS NULL
  AND statement_count IS NULL
  AND statement_vector_sha256 IS NULL
  AND ledger_count IS NULL
  AND ledger_identity_root IS NULL
  AND sealed_at IS NULL
  AND pg_catalog.jsonb_typeof(function_contract)='object'
  AND (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(function_contract))=4;
 GET DIAGNOSTICS updated_rows=ROW_COUNT;
 IF updated_rows<>1 THEN RAISE EXCEPTION 'RECEIPT_OCR_CATALOG_SEAL_FAILED'; END IF;
 IF ocr_private.get_receipt_ocr_credential_release_capability() IS DISTINCT FROM ${readyCapability}
 THEN RAISE EXCEPTION 'RECEIPT_OCR_CATALOG_SEAL_READBACK_FAILED'; END IF;`;
  const tag = `$receipt_ocr_catalog_seal_${sha256(sealBody).slice(0, 18)}$`;
  return `DO ${tag}
DECLARE
 actual_ledger_count integer;
 actual_ledger_identity_root text;
 updated_rows integer;
BEGIN
 ${sealBody}
END;
${tag};`;
}

function insertCatalogSealAfterLedger(compiledSql, catalogSealSql) {
  const ledgerInserts = statementSpans(compiledSql).filter(({ token }) =>
    /^INSERT\s+INTO\s+supabase_migrations\.schema_migrations\b/i.test(leadingSql(token)));
  if (ledgerInserts.length !== 1) fail('RECEIPT_OCR_POST105_LEDGER_INSERT_INVALID');
  const [{ end }] = ledgerInserts;
  return `${compiledSql.slice(0, end)}\n${catalogSealSql}\n${compiledSql.slice(end)}`;
}

export function buildPost105StateQuery(record, { mode = 'operating', phase = 'terminal' } = {}) {
  if (mode !== 'operating' && mode !== 'rehearsal') {
    fail('RECEIPT_OCR_POST105_MODE_INVALID');
  }
  if (phase !== 'prior' && phase !== 'terminal') {
    fail('RECEIPT_OCR_POST105_PHASE_INVALID');
  }
  const { manifest } = record;
  const version = quote(manifest.migration.version);
  const predecessorRootValue = mode === 'operating'
    ? manifest.predecessor.terminalIdentityRoot
    : manifest.rehearsalFixture.terminalIdentityRoot;
  const terminalRootValue = mode === 'operating'
    ? manifest.operatingIdentity.targetIdentityRoot
    : manifest.rehearsalFixture.targetIdentityRoot;
  const predecessorRoot = quote(predecessorRootValue);
  const migrationRoot = quote(manifest.operatingIdentity.migrationIdentityRoot);
  const targetRoot = quote(terminalRootValue);
  const suffixRoot = quote(manifest.operatingIdentity.suffixRoot);
  const capabilityGuard = phase === 'terminal'
    ? `
   AND ocr_private.get_receipt_ocr_credential_release_capability()
    = '{"schema_version":1,"status":"ready","capability_version":"receipt-ocr-definitive-credential-release-v1"}'::jsonb`
    : '';
  return `SELECT * FROM (WITH
 ledger_identities AS (
  SELECT version,name,cardinality(statements)::int AS statement_count,
   encode(sha256(convert_to(array_to_json(statements)::text,'UTF8')),'hex') AS statement_vector_sha256,
   octet_length(convert_to(version,'UTF8'))::text||':'||version||chr(31)||
    CASE WHEN name IS NULL THEN '-1:' ELSE octet_length(convert_to(name,'UTF8'))::text||':'||name END||chr(31)||
    cardinality(statements)::text||chr(31)||
    encode(sha256(convert_to(array_to_json(statements)::text,'UTF8')),'hex') AS row_material
  FROM supabase_migrations.schema_migrations
 ),
 ${identityScopeCte('predecessor_scope', `version<>${version}`)},
 ${identityScopeCte('target_scope', `version=${version}`)},
 ${identityScopeCte('ledger_scope', 'true')},
 runtime AS (
  SELECT
	   (CASE WHEN pg_catalog.to_regclass('ocr_private.receipt_credential_rejection_releases') IS NULL THEN 0 ELSE 1 END
	    + CASE WHEN pg_catalog.to_regclass('ocr_private.receipt_credential_release_catalog_contract') IS NULL THEN 0 ELSE 1 END
    + CASE WHEN pg_catalog.to_regprocedure('public.release_receipt_ocr_definitive_credential_rejection(uuid,uuid)') IS NULL THEN 0 ELSE 1 END
    + CASE WHEN pg_catalog.to_regprocedure('ocr_private.release_receipt_ocr_definitive_credential_rejection(uuid,uuid)') IS NULL THEN 0 ELSE 1 END
    + CASE WHEN pg_catalog.to_regprocedure('public.get_receipt_ocr_credential_release_capability()') IS NULL THEN 0 ELSE 1 END
    + CASE WHEN pg_catalog.to_regprocedure('ocr_private.get_receipt_ocr_credential_release_capability()') IS NULL THEN 0 ELSE 1 END)::int AS object_count,
   EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS relation
    WHERE relation.oid=pg_catalog.to_regclass('ocr_private.receipt_credential_rejection_releases')
     AND relation.relkind='r' AND relation.relowner='postgres'::regrole
     AND relation.relrowsecurity AND relation.relforcerowsecurity
     AND NOT pg_catalog.has_table_privilege('anon',relation.oid,'SELECT,INSERT,UPDATE,DELETE')
     AND NOT pg_catalog.has_table_privilege('authenticated',relation.oid,'SELECT,INSERT,UPDATE,DELETE')
     AND NOT pg_catalog.has_table_privilege('service_role',relation.oid,'SELECT,INSERT,UPDATE,DELETE')
     AND NOT pg_catalog.has_table_privilege('privacy_workflow_owner',relation.oid,'SELECT,INSERT,UPDATE,DELETE')
     AND (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint AS constraint_row WHERE constraint_row.conrelid=relation.oid AND constraint_row.contype='p')=1
     AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint AS constraint_row
      WHERE constraint_row.conrelid=relation.oid AND constraint_row.contype='p'
       AND pg_catalog.pg_get_constraintdef(constraint_row.oid,false)='PRIMARY KEY (result_id, claim_token)'
     )
     AND (SELECT pg_catalog.count(*) FROM pg_catalog.pg_policy AS policy WHERE policy.polrelid=relation.oid)=1
     AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy AS policy
      WHERE policy.polrelid=relation.oid
       AND policy.polname='receipt_credential_rejection_releases_owner_only'
       AND policy.polpermissive
       AND policy.polroles=ARRAY['postgres'::regrole::oid]
       AND pg_catalog.pg_get_expr(policy.polqual,policy.polrelid)='true'
       AND pg_catalog.pg_get_expr(policy.polwithcheck,policy.polrelid)='true'
     )
   )
   AND EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS relation
    WHERE relation.oid=pg_catalog.to_regclass('ocr_private.receipt_credential_release_catalog_contract')
     AND relation.relkind='r' AND relation.relowner='postgres'::regrole
     AND relation.relrowsecurity AND relation.relforcerowsecurity
     AND NOT pg_catalog.has_table_privilege('anon',relation.oid,'SELECT,INSERT,UPDATE,DELETE')
     AND NOT pg_catalog.has_table_privilege('authenticated',relation.oid,'SELECT,INSERT,UPDATE,DELETE')
     AND NOT pg_catalog.has_table_privilege('service_role',relation.oid,'SELECT,INSERT,UPDATE,DELETE')
     AND NOT pg_catalog.has_table_privilege('privacy_workflow_owner',relation.oid,'SELECT,INSERT,UPDATE,DELETE')
     AND (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint AS constraint_row WHERE constraint_row.conrelid=relation.oid AND constraint_row.contype='p')=1
     AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint AS constraint_row
      WHERE constraint_row.conrelid=relation.oid AND constraint_row.contype='p'
       AND pg_catalog.pg_get_constraintdef(constraint_row.oid,false)='PRIMARY KEY (capability_version)'
     )
     AND (SELECT pg_catalog.count(*) FROM pg_catalog.pg_policy AS policy WHERE policy.polrelid=relation.oid)=1
     AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy AS policy
      WHERE policy.polrelid=relation.oid
       AND policy.polname='receipt_credential_release_catalog_contract_owner_only'
       AND policy.polpermissive
       AND policy.polroles=ARRAY['postgres'::regrole::oid]
       AND pg_catalog.pg_get_expr(policy.polqual,policy.polrelid)='true'
       AND pg_catalog.pg_get_expr(policy.polwithcheck,policy.polrelid)='true'
     )
   )
   AND NOT EXISTS (
    SELECT 1 FROM (VALUES
     ('public.release_receipt_ocr_definitive_credential_rejection(uuid,uuid)','privacy_workflow_owner','sql','v',true),
     ('ocr_private.release_receipt_ocr_definitive_credential_rejection(uuid,uuid)','postgres','plpgsql','v',false),
     ('public.get_receipt_ocr_credential_release_capability()','privacy_workflow_owner','sql','s',true),
     ('ocr_private.get_receipt_ocr_credential_release_capability()','postgres','plpgsql','s',false)
    ) AS required(signature,owner_name,language_name,volatility,service_executable)
    LEFT JOIN pg_catalog.pg_proc AS procedure
     ON procedure.oid=pg_catalog.to_regprocedure(required.signature)
    WHERE procedure.oid IS NULL
     OR procedure.proowner<>required.owner_name::regrole
     OR NOT procedure.prosecdef
     OR procedure.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
     OR procedure.provolatile<>required.volatility::"char"
     OR procedure.prorettype<>'jsonb'::regtype
     OR procedure.proretset
     OR procedure.prolang<>(SELECT language.oid FROM pg_catalog.pg_language AS language WHERE language.lanname=required.language_name)
     OR pg_catalog.has_function_privilege('service_role',procedure.oid,'EXECUTE') IS DISTINCT FROM required.service_executable
     OR pg_catalog.has_function_privilege('anon',procedure.oid,'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated',procedure.oid,'EXECUTE')
   )
   AND EXISTS (SELECT 1 FROM privacy_retention.g014_public_rpc_allowlist WHERE source_signature='public.release_receipt_ocr_definitive_credential_rejection(uuid,uuid)' AND grantee='service_role')
   AND EXISTS (SELECT 1 FROM privacy_retention.g014_nested_helper_allowlist WHERE source_signature='ocr_private.release_receipt_ocr_definitive_credential_rejection(uuid,uuid)')
   AND EXISTS (SELECT 1 FROM privacy_retention.g014_public_rpc_allowlist WHERE source_signature='public.get_receipt_ocr_credential_release_capability()' AND grantee='service_role')
	   AND EXISTS (SELECT 1 FROM privacy_retention.g014_nested_helper_allowlist WHERE source_signature='ocr_private.get_receipt_ocr_credential_release_capability()')${capabilityGuard} AS ready
 ),
 stage AS (
  SELECT CASE
   WHEN target_scope.row_count=0 AND target_scope.identity_root=${quote(ledgerIdentityRoot([]))} THEN 0
   WHEN target_scope.row_count=1 AND target_scope.identity_root=${migrationRoot} THEN 1
   ELSE -1 END AS stage_index
  FROM target_scope
 )
 SELECT jsonb_build_object(
  'bundle',jsonb_build_object(
   'ledgerCount',ledger_scope.row_count,
   'prefixRoot',predecessor_scope.identity_root,
   'priorCount',predecessor_scope.row_count,
   'suffixRoot',CASE WHEN stage.stage_index=1 THEN ${suffixRoot} ELSE NULL END,
   'targetCount',target_scope.row_count
  ),
  'state',jsonb_build_object(
   'ledgerIdentityRoot',ledger_scope.identity_root,
   'predecessorIdentityRoot',predecessor_scope.identity_root,
   'predecessorReady',predecessor_scope.row_count=105 AND predecessor_scope.identity_root=${predecessorRoot},
   'runtimeObjectCount',runtime.object_count,
   'runtimeReady',runtime.ready,
   'targetIdentityRoot',target_scope.identity_root,
   'targetReady',stage.stage_index=1,
   'targetStageIndex',stage.stage_index,
   'terminalReady',ledger_scope.row_count=106 AND ledger_scope.identity_root=${targetRoot} AND runtime.ready
  )) AS state
 FROM runtime
 CROSS JOIN predecessor_scope
 CROSS JOIN target_scope
 CROSS JOIN ledger_scope
 CROSS JOIN stage
 ) AS receipt_ocr_post105_state`;
}

export function expectedPost105StageStates(record, { mode = 'operating' } = {}) {
  if (mode !== 'operating' && mode !== 'rehearsal') {
    fail('RECEIPT_OCR_POST105_MODE_INVALID');
  }
  const { manifest } = record;
  const emptyRoot = ledgerIdentityRoot([]);
  const predecessorRoot = mode === 'operating'
    ? manifest.predecessor.terminalIdentityRoot
    : manifest.rehearsalFixture.terminalIdentityRoot;
  const terminalRoot = mode === 'operating'
    ? manifest.operatingIdentity.targetIdentityRoot
    : manifest.rehearsalFixture.targetIdentityRoot;
  return Object.freeze([
    Object.freeze({
      bundle: Object.freeze({
        ledgerCount: 105,
        prefixRoot: predecessorRoot,
        priorCount: 105,
        suffixRoot: null,
        targetCount: 0,
      }),
      state: Object.freeze({
        ledgerIdentityRoot: predecessorRoot,
        predecessorIdentityRoot: predecessorRoot,
        predecessorReady: true,
        runtimeObjectCount: 0,
        runtimeReady: false,
        targetIdentityRoot: emptyRoot,
        targetReady: false,
        targetStageIndex: 0,
        terminalReady: false,
      }),
    }),
    Object.freeze({
      bundle: Object.freeze({
        ledgerCount: 106,
        prefixRoot: predecessorRoot,
        priorCount: 105,
        suffixRoot: manifest.operatingIdentity.suffixRoot,
        targetCount: 1,
      }),
      state: Object.freeze({
        ledgerIdentityRoot: terminalRoot,
        predecessorIdentityRoot: predecessorRoot,
        predecessorReady: true,
        runtimeObjectCount: 6,
        runtimeReady: true,
        targetIdentityRoot: manifest.operatingIdentity.migrationIdentityRoot,
        targetReady: true,
        targetStageIndex: 1,
        terminalReady: true,
      }),
    }),
  ]);
}

function validateStageShape(stage) {
  exactKeys(stage, EXPECTED_STAGE_KEYS, 'RECEIPT_OCR_POST105_STAGE_INVALID');
  exactKeys(stage.bundle, EXPECTED_BUNDLE_KEYS, 'RECEIPT_OCR_POST105_STAGE_INVALID');
  exactKeys(stage.state, EXPECTED_STATE_KEYS, 'RECEIPT_OCR_POST105_STAGE_INVALID');
}

export function validatePost105StageStates(stages, record, { mode = 'operating' } = {}) {
  if (!Array.isArray(stages) || stages.length !== 2) fail('RECEIPT_OCR_POST105_STAGE_INVALID');
  const expected = expectedPost105StageStates(record, { mode });
  stages.forEach(validateStageShape);
  if (!equal(stages, expected)) fail('RECEIPT_OCR_POST105_STAGE_INVALID');
  return Object.freeze({
    mode,
    prefixRoot: expected[0].bundle.prefixRoot,
    priorCount: 105,
    suffixRoot: record.manifest.operatingIdentity.suffixRoot,
  });
}

function compilePost105Plan(record, stages, { mode }) {
  validatePost105StageStates(stages, record, { mode });
  const priorStateQuery = buildPost105StateQuery(record, { mode, phase: 'prior' });
  const terminalStateQuery = buildPost105StateQuery(record, { mode, phase: 'terminal' });
  const migration = {
    expectedPriorState: { expected: stages[0], query: priorStateQuery },
    id: record.manifest.migration.id,
    path: record.manifest.migration.path,
    sha256: record.manifest.migration.sha256,
    statementVectorSha256: record.manifest.migration.statementVectorSha256,
    terminalReadback: { expected: stages[1], query: terminalStateQuery },
  };
  const sourcePlan = migrationEnvelope(
    record.material.bytes,
    migration,
    record.material.originalVector,
  );
  if (sourcePlan.vectorSha256 !== migration.statementVectorSha256) {
    fail('RECEIPT_OCR_POST105_VECTOR_DIGEST_MISMATCH');
  }
  const plan = Object.freeze({
    ...sourcePlan,
    execution: suppressAssertionSelectOutput(sourcePlan.execution),
  });
  const lockTag = `$receipt_ocr_post105_${sha256(String(record.manifest.advisoryLockKey)).slice(0, 16)}$`;
  const atomicSql = atomicMigrationSql(plan, migration);
  return Object.freeze({
    id: record.manifest.id,
    migration,
    plan,
    priorReadback: migration.expectedPriorState,
    finalReadback: migration.terminalReadback,
    sql: `SET LOCAL idle_in_transaction_session_timeout='30s';\nDO ${lockTag} BEGIN PERFORM pg_advisory_xact_lock(${record.manifest.advisoryLockKey}::bigint); END ${lockTag};\n${insertCatalogSealAfterLedger(atomicSql, buildCatalogSealSql(record, { mode }))}`,
    stateQuery: terminalStateQuery,
    transactionMode: 'single-outer-transaction',
  });
}

export function compilePost105RehearsalPlan(
  record,
  stages = expectedPost105StageStates(record, { mode: 'rehearsal' }),
) {
  return compilePost105Plan(record, stages, { mode: 'rehearsal' });
}

export function compilePost105OperatingPlan(
  record,
  stages = expectedPost105StageStates(record, { mode: 'operating' }),
) {
  return compilePost105Plan(record, stages, { mode: 'operating' });
}

export function assertPost105LaunchReady(record) {
  if (record.manifest.launchPolicy.state !== 'ready') fail(record.manifest.launchPolicy.code);
}

export function post105ContractSummary(record) {
  return Object.freeze({
    id: record.manifest.id,
    launchState: record.manifest.launchPolicy.state,
    manifestSha256: record.manifestSha256,
    migrationVersion: record.manifest.migration.version,
    operatingTransition: record.manifest.operatingTransition,
    predecessorIdentityRoot: record.manifest.predecessor.terminalIdentityRoot,
    rehearsalIdentityRoot: record.manifest.rehearsalFixture.terminalIdentityRoot,
    targetIdentityRoot: record.manifest.operatingIdentity.targetIdentityRoot,
  });
}

export function mainPost105Successor(argv = process.argv.slice(2)) {
  if (argv.length !== 1 || argv[0] !== '--check') fail('RECEIPT_OCR_POST105_ARGUMENT_INVALID');
  const record = loadPost105SuccessorManifest();
  process.stdout.write(`${JSON.stringify(canonical(post105ContractSummary(record)))}\n`);
}

if (import.meta.main) {
  try { mainPost105Successor(); } catch (error) {
    process.stderr.write(`${error?.code ?? 'RECEIPT_OCR_POST105_FAILURE'}\n`);
    process.exitCode = 1;
  }
}
