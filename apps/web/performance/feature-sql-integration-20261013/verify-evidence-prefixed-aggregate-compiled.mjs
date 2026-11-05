#!/usr/bin/env node

import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  linkSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
  buildEvidencePrefixedSuccessorStateQuery,
  compileEvidencePrefixedRehearsalAggregatePlan,
  loadEvidencePrefixedSuccessorManifest,
  validateEvidencePrefixedStageStates,
} from '../../scripts/review-media-evidence-prefixed-sql-successors.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../..');
const DOCKER_CONTEXT = 'colima-tzudong-catalog-20261007';
const SOURCE_CONTAINER = 'tzudong-ranking-clone-20261008';
const IMAGE = 'supabase/postgres@sha256:fbe6c858a2ea9616aead3c39e132afcc0660decc5cb7dc656208ed145f5331ab';
const OWNER_LABEL = 'tzudong.review-aggregate-rehearsal.owner';
const OWNER_TOKEN = randomBytes(16).toString('hex');
const CONTAINER = `tzudong-evidence-aggregate-${process.pid}-${OWNER_TOKEN.slice(0, 12)}`;
const PASSWORD = randomBytes(24).toString('hex');
const HARNESS_PATH = 'apps/web/performance/feature-sql-integration-20261013/verify-evidence-prefixed-aggregate-compiled.mjs';
const OUTPUT_NAME = (() => {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--output'
    || !/^pg17-evidence-prefixed-aggregate-compiled-[a-z0-9-]+\.json$/.test(args[1])) {
    throw new Error('EVIDENCE_AGGREGATE_OUTPUT_ARGUMENT_INVALID');
  }
  return args[1];
})();
const PREDECESSOR_PATHS = Object.freeze([
  'backend/supabase/migrations/20261004190259_admin_record_guarded_actions.sql',
  'backend/supabase/migrations/20261004192657_admin_evaluation_raw_warning_groups.sql',
  'backend/supabase/migrations/20261004194715_admin_evaluation_raw_warning_invoker_contract.sql',
  'backend/supabase/migrations/20261009022915_restaurant_review_manual_preview_eligibility.sql',
  'backend/supabase/migrations/20261009091342_admin_record_private_verification_cleanup.sql',
  'backend/supabase/migrations/20261009101645_admin_user_management_rpc_forward.sql',
]);
const REQUIRED_ROLES = Object.freeze([
  'cli_login_postgres',
  'privacy_auth_bridge',
  'privacy_retention_activation_operator',
  'privacy_retention_legal_approver',
  'privacy_retention_operator_approver',
  'privacy_workflow_owner',
  'supabase_privileged_role',
  'supabase_realtime_admin',
  'tzudong_g037_readonly',
]);

const sha256 = value => createHash('sha256').update(value).digest('hex');
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const canonical = value => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
    : value;
const equal = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));

function fail(code, detail = '') {
  throw new Error(detail ? `${code}:${detail}` : code);
}

function writeImmutable(path, bytes) {
  const temporary = resolve(dirname(path), `.${basename(path)}.${process.pid}.${OWNER_TOKEN}.tmp`);
  let descriptor;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    linkSync(temporary, path);
    const directory = openSync(dirname(path), 'r');
    try { fsyncSync(directory); } finally { closeSync(directory); }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    try { unlinkSync(temporary); } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

function docker(args, { input, allowFailure = false } = {}) {
  const result = spawnSync('docker', ['--context', DOCKER_CONTEXT, ...args], {
    encoding: 'utf8',
    input,
    maxBuffer: 128 * 1024 * 1024,
  });
  if (!allowFailure && (result.error || result.status !== 0)) {
    const diagnostic = (result.stderr || '').split(/\r?\n/)
      .find(line => /(?:ERROR|FATAL):/.test(line))
      ?.replace(/\s+/g, ' ').slice(0, 240) || '';
    fail('EVIDENCE_AGGREGATE_COMMAND_FAILED', `${result.status}:${diagnostic}`);
  }
  return result;
}

function psql(sql, {
  actor = 'postgres',
  database = 'postgres',
  singleTransaction = false,
} = {}) {
  const args = [
    'exec', '-i', '-e', `PGPASSWORD=${PASSWORD}`, CONTAINER,
    'psql', '-XAtq', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=terse',
  ];
  if (singleTransaction) args.push('--single-transaction');
  args.push('-h', '127.0.0.1', '-U', actor, '-d', database, '--file=-');
  return docker(args, { input: sql });
}

function scalar(sql) {
  return psql(`${sql}\n`).stdout.trim();
}

function json(sql) {
  const lines = scalar(sql).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length !== 1) fail('EVIDENCE_AGGREGATE_JSON_SHAPE_INVALID', String(lines.length));
  try { return JSON.parse(lines[0]); } catch { fail('EVIDENCE_AGGREGATE_JSON_INVALID'); }
}

function parseCompiledOutput(output) {
  const lines = String(output).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length !== 1) fail('EVIDENCE_AGGREGATE_OUTPUT_SHAPE_INVALID', String(lines.length));
  try { return JSON.parse(lines[0]); } catch { fail('EVIDENCE_AGGREGATE_OUTPUT_INVALID'); }
}

function deterministicDump(bytes) {
  return bytes.replace(/^\\(?:un)?restrict [^\n]*\n/gm, '');
}

function sourceDump() {
  return docker(['exec', SOURCE_CONTAINER, 'pg_dump', '-U', 'postgres', '-d', 'ranking_clone']).stdout;
}

function targetDump() {
  return docker(['exec', CONTAINER, 'pg_dump', '-U', 'postgres', '-d', 'postgres']).stdout;
}

function inspectOwnedContainer() {
  const result = docker(['container', 'inspect', CONTAINER], { allowFailure: true });
  if (result.status !== 0) return null;
  let values;
  try { values = JSON.parse(result.stdout); } catch { fail('EVIDENCE_AGGREGATE_CONTAINER_INVALID'); }
  if (!Array.isArray(values) || values.length !== 1) fail('EVIDENCE_AGGREGATE_CONTAINER_INVALID');
  const value = values[0];
  if (value.Name?.replace(/^\//, '') !== CONTAINER
    || value.Config?.Labels?.[OWNER_LABEL] !== OWNER_TOKEN
    || !/^[0-9a-f]{12,64}$/.test(value.Id || '')) fail('EVIDENCE_AGGREGATE_CONTAINER_INVALID');
  return value.Id;
}

function waitForReady() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const ready = docker([
      'exec', '-e', `PGPASSWORD=${PASSWORD}`, CONTAINER,
      'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'postgres',
    ], { allowFailure: true });
    if (ready.status === 0) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }
  fail('EVIDENCE_AGGREGATE_CONTAINER_NOT_READY');
}

function createRequiredRoles() {
  const roleArray = `ARRAY[${REQUIRED_ROLES.map(quote).join(',')}]`;
  psql(`DO $roles$
DECLARE role_name text;
BEGIN
 FOREACH role_name IN ARRAY ${roleArray} LOOP
  IF to_regrole(role_name) IS NULL THEN
   EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', role_name);
  END IF;
 END LOOP;
 ALTER ROLE privacy_auth_bridge INHERIT;
 ALTER ROLE privacy_retention_activation_operator NOINHERIT;
 ALTER ROLE privacy_retention_legal_approver NOINHERIT;
 ALTER ROLE privacy_retention_operator_approver NOINHERIT;
 ALTER ROLE privacy_workflow_owner NOINHERIT;
END $roles$;`);
  psql(`GRANT privacy_auth_bridge TO postgres WITH ADMIN TRUE,INHERIT FALSE,SET FALSE GRANTED BY supabase_admin;
GRANT privacy_retention_activation_operator TO postgres WITH ADMIN TRUE,INHERIT FALSE,SET FALSE GRANTED BY supabase_admin;
GRANT privacy_retention_legal_approver TO postgres WITH ADMIN TRUE,INHERIT FALSE,SET FALSE GRANTED BY supabase_admin;
GRANT privacy_retention_operator_approver TO postgres WITH ADMIN TRUE,INHERIT FALSE,SET FALSE GRANTED BY supabase_admin;
GRANT privacy_workflow_owner TO postgres WITH ADMIN TRUE,INHERIT FALSE,SET FALSE GRANTED BY supabase_admin;`, {
    actor: 'supabase_admin',
  });
  psql('GRANT privacy_workflow_owner TO privacy_auth_bridge WITH ADMIN FALSE,INHERIT TRUE,SET TRUE GRANTED BY postgres;');
}

function initializeBaseline(source, sourceBytes, predecessorRecord) {
  psql('ALTER ROLE postgres SUPERUSER;\nDROP DATABASE postgres WITH (FORCE);\nCREATE DATABASE postgres OWNER postgres TEMPLATE template0;', {
    actor: 'supabase_admin',
    database: 'template1',
  });
  createRequiredRoles();
  psql(source);
  psql(`UPDATE privacy_retention.g014_public_rpc_allowlist allowed
SET identity_arguments=procedure.proargtypes::text
FROM pg_proc procedure
WHERE procedure.oid=to_regprocedure(allowed.source_signature)
  AND allowed.identity_arguments IS DISTINCT FROM procedure.proargtypes::text;`);
  psql('ALTER ROLE postgres NOSUPERUSER;', { actor: 'supabase_admin' });
  seedBaseline(sourceBytes, predecessorRecord);
}

function insertLedger(path, statements) {
  const file = basename(path);
  const version = file.slice(0, 14);
  const name = file.slice(15, -4);
  if (!Array.isArray(statements) || statements.length < 1) fail('EVIDENCE_AGGREGATE_VECTOR_INVALID');
  psql(`INSERT INTO supabase_migrations.schema_migrations(version,statements,name)
VALUES(${quote(version)},ARRAY(SELECT jsonb_array_elements_text(${quote(JSON.stringify(statements))}::jsonb)),${quote(name)});`);
}

function applyMaterial(material) {
  psql(material.bytes.toString('utf8'));
}

function seedBaseline(sourceBytes, predecessorRecord) {
  for (const path of PREDECESSOR_PATHS) psql(sourceBytes.get(path).toString('utf8'));
  psql(`INSERT INTO supabase_migrations.schema_migrations(version,statements,name)
SELECT lpad(value::text,14,'0'),ARRAY['local schema-only predecessor fixture'],format('local_predecessor_%s',value)
FROM generate_series(1,86) value;
INSERT INTO pipeline_control.restaurant_review_policy(singleton,enabled)
VALUES(true,false) ON CONFLICT(singleton) DO UPDATE SET enabled=false,operator_id=NULL,last_run_at=NULL;
INSERT INTO pipeline_control.admin_evaluation_catalog_revision(singleton,revision)
VALUES(true,1) ON CONFLICT(singleton) DO NOTHING;`);
  for (const evidence of predecessorRecord.evidenceRows) {
    psql(sourceBytes.get(evidence.path).toString('utf8'));
    insertLedger(evidence.path, evidence.originalStatementVector);
  }
  if (Number(scalar('SELECT count(*) FROM supabase_migrations.schema_migrations;')) !== 89) {
    fail('EVIDENCE_AGGREGATE_BASELINE_LEDGER_INVALID');
  }
}

function collectConstituentStages(record) {
  const query = buildEvidencePrefixedSuccessorStateQuery(record);
  const stages = [json(query)];
  record.targetRecord.manifest.migrations.forEach((migration, index) => {
    applyMaterial(record.materials[index]);
    insertLedger(migration.path, record.materials[index].originalVector);
    stages.push(json(query));
  });
  validateEvidencePrefixedStageStates(stages, record, { mode: 'rehearsal' });
  return Object.freeze(stages);
}

function executeAggregate(record, stages) {
  const baseline = json(buildEvidencePrefixedSuccessorStateQuery(record));
  if (!equal(baseline, stages[0])) fail('EVIDENCE_AGGREGATE_BASELINE_MISMATCH');
  const plan = compileEvidencePrefixedRehearsalAggregatePlan(record, stages);
  const result = psql(plan.sql, { singleTransaction: true });
  const output = parseCompiledOutput(result.stdout);
  if (!equal(output, stages.at(-1))) fail('EVIDENCE_AGGREGATE_TERMINAL_OUTPUT_MISMATCH');
  const terminal = json(buildEvidencePrefixedSuccessorStateQuery(record));
  if (!equal(terminal, stages.at(-1))) fail('EVIDENCE_AGGREGATE_TERMINAL_READBACK_MISMATCH');
  return Object.freeze({
    aggregateSqlBytes: Buffer.byteLength(plan.sql),
    aggregateSqlSha256: sha256(plan.sql),
    baselineStateSha256: sha256(JSON.stringify(canonical(stages[0]))),
    outputSha256: sha256(result.stdout),
    planCount: plan.plans.length,
    terminalIdentityRoot: terminal.state.ledgerIdentityRoot,
    terminalStateSha256: sha256(JSON.stringify(canonical(terminal))),
  });
}

let containerId = null;
const containerIds = [];
let removedCount = 0;
let proof;
function startOwnedContainer() {
  const create = docker([
    'run', '-d', '--rm', '--name', CONTAINER, '--label', `${OWNER_LABEL}=${OWNER_TOKEN}`,
    '-e', `POSTGRES_PASSWORD=${PASSWORD}`, IMAGE,
  ], { allowFailure: true });
  containerId = inspectOwnedContainer();
  if (!containerId) fail('EVIDENCE_AGGREGATE_CONTAINER_CREATION_UNCONFIRMED');
  containerIds.push(containerId);
  if (create.status === 0 && create.stdout.trim() && create.stdout.trim() !== containerId) {
    fail('EVIDENCE_AGGREGATE_CONTAINER_ACK_MISMATCH');
  }
  waitForReady();
}

function removeOwnedContainer() {
  const observed = inspectOwnedContainer();
  if (observed && observed !== containerId) fail('EVIDENCE_AGGREGATE_CONTAINER_ID_DRIFT');
  if (observed) docker(['container', 'rm', '--force', observed]);
  if (inspectOwnedContainer()) fail('EVIDENCE_AGGREGATE_CONTAINER_REMOVAL_UNCONFIRMED');
  if (containerId) removedCount += 1;
  containerId = null;
}

try {
  const predecessorRecord = loadEvidencePrefixedSuccessorManifest('predecessor');
  const featureRecord = loadEvidencePrefixedSuccessorManifest('feature');
  const sourcePaths = [
    HARNESS_PATH,
    '.github/review-media-evidence-prefixed-predecessor-successor.v1.json',
    '.github/review-media-evidence-prefixed-feature-successor.v1.json',
    'apps/web/scripts/review-media-evidence-prefixed-sql-successors.mjs',
    'apps/web/scripts/supabase-migration-bundle.mjs',
    'apps/web/scripts/supabase-migration-transaction.mjs',
    'apps/web/scripts/apply-supabase-migration.mjs',
    'apps/web/performance/cross-audit-20261018/hosted-ledger-mapping-20261018.json',
    ...PREDECESSOR_PATHS,
    ...predecessorRecord.evidenceRows.map(row => row.path),
    ...predecessorRecord.targetRecord.manifest.migrations.map(row => row.path),
    ...featureRecord.targetRecord.manifest.migrations.map(row => row.path),
  ];
  if (new Set(sourcePaths).size !== sourcePaths.length) fail('EVIDENCE_AGGREGATE_SOURCE_DUPLICATE');
  const sourceBytes = new Map(sourcePaths.map(path => [path, readFileSync(resolve(ROOT, path))]));
  const sourceEntries = sourcePaths.map(path => ({
    path,
    bytes: sourceBytes.get(path).byteLength,
    sha256: sha256(sourceBytes.get(path)),
  }));
  const sourceSnapshotSha256 = sha256(JSON.stringify(canonical(sourceEntries)));
  const sourceBefore = deterministicDump(sourceDump());
  const sourceCatalogSha256 = sha256(sourceBefore);
  startOwnedContainer();
  initializeBaseline(sourceBefore, sourceBytes, predecessorRecord);

  const predecessorStages = collectConstituentStages(predecessorRecord);
  const featureStages = collectConstituentStages(featureRecord);
  if (Number(scalar('SELECT count(*) FROM supabase_migrations.schema_migrations;')) !== 105) {
    fail('EVIDENCE_AGGREGATE_CONSTITUENT_TERMINAL_INVALID');
  }

  removeOwnedContainer();
  startOwnedContainer();
  initializeBaseline(sourceBefore, sourceBytes, predecessorRecord);
  const baselineDumpSha256 = sha256(deterministicDump(targetDump()));
  const predecessorAggregate = executeAggregate(predecessorRecord, predecessorStages);
  if (Number(scalar('SELECT count(*) FROM supabase_migrations.schema_migrations;')) !== 100) {
    fail('EVIDENCE_AGGREGATE_PREDECESSOR_TERMINAL_INVALID');
  }
  const featureAggregate = executeAggregate(featureRecord, featureStages);
  if (Number(scalar('SELECT count(*) FROM supabase_migrations.schema_migrations;')) !== 105) {
    fail('EVIDENCE_AGGREGATE_FEATURE_TERMINAL_INVALID');
  }

  const sourceAfter = deterministicDump(sourceDump());
  if (sha256(sourceAfter) !== sourceCatalogSha256) fail('EVIDENCE_AGGREGATE_SOURCE_DRIFT');
  for (const entry of sourceEntries) {
    if (sha256(readFileSync(resolve(ROOT, entry.path))) !== entry.sha256) {
      fail('EVIDENCE_AGGREGATE_FROZEN_SOURCE_DRIFT', entry.path);
    }
  }
  proof = {
    schemaVersion: 1,
    kind: 'evidence-prefixed-aggregate-compiled-pg17-replay',
    status: 'passed',
    environment: {
      dockerContext: DOCKER_CONTEXT,
      engine: scalar('SHOW server_version;'),
      image: IMAGE,
      sourceContainer: SOURCE_CONTAINER,
      sourceDatabase: 'ranking_clone',
      targetOwnershipLabel: OWNER_LABEL,
    },
    sources: {
      frozenSourceCount: sourceEntries.length,
      frozenSourceSnapshotSha256: sourceSnapshotSha256,
      harness: sourceEntries.find(entry => entry.path === HARNESS_PATH),
      predecessorManifestSha256: predecessorRecord.manifestSha256,
      featureManifestSha256: featureRecord.manifestSha256,
      controller: sourceEntries.find(entry => entry.path === 'apps/web/scripts/review-media-evidence-prefixed-sql-successors.mjs'),
      hostedBaseMappingSha256: predecessorRecord.manifest.baseMapping.sha256,
    },
    constituentReplay: {
      purpose: 'derive and validate exact local rehearsal stage states by executing constituent sources',
      predecessorStageCount: predecessorStages.length,
      predecessorStageStatesSha256: sha256(JSON.stringify(canonical(predecessorStages))),
      featureStageCount: featureStages.length,
      featureStageStatesSha256: sha256(JSON.stringify(canonical(featureStages))),
      terminalLedger: 105,
    },
    aggregateExecution: {
      purpose: 'execute each compiler-produced aggregate SQL string in one outer transaction against the restored ledger-89 baseline',
      baselineDumpSha256,
      predecessor: predecessorAggregate,
      feature: featureAggregate,
      terminalLedger: 105,
    },
    sourceCatalog: {
      bytes: Buffer.byteLength(sourceBefore),
      sha256Before: sourceCatalogSha256,
      sha256After: sha256(sourceAfter),
      unchanged: true,
    },
    findings: [],
    limitations: [
      'Local exact-version PG17 clone only; no hosted query, DDL, deployment or operating apply was executed.',
      'The constituent path exists only to derive exact stage readbacks; aggregateExecution is the separate compiler-output execution evidence.',
      'The ledger-86 fixture is synthetic, while the held operating contract separately pins the sanitized hosted86 identity projection.',
    ],
  };
} finally {
  if (containerId || inspectOwnedContainer()) removeOwnedContainer();
}

if (!proof) fail('EVIDENCE_AGGREGATE_PROOF_MISSING');
proof.cleanup = {
  allOwnedContainersRemoved: removedCount === containerIds.length,
  ownedContainerCount: containerIds.length,
  ownedContainerIdsRecorded: containerIds.length === 2,
};
const proofBytes = `${JSON.stringify(canonical(proof))}\n`;
const outputPath = resolve(HERE, OUTPUT_NAME);
if (dirname(outputPath) !== HERE) fail('EVIDENCE_AGGREGATE_OUTPUT_PATH_INVALID');
writeImmutable(outputPath, proofBytes);
writeImmutable(`${outputPath}.sha256`, `${sha256(proofBytes)}  ${basename(outputPath)}\n`);
process.stdout.write(proofBytes);
