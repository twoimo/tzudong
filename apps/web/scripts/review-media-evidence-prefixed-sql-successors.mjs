#!/usr/bin/env node
/** Local contract compiler for evidence-prefixed review-media successors. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readOriginalStatementVector } from './apply-supabase-migration.mjs';
import {
  buildFeatureSuccessorStateQuery,
  loadFeatureSuccessorManifest,
  validateFeatureStageStates,
} from './review-media-feature-sql-successor.mjs';
import {
  buildSuccessorStateQuery,
  loadSuccessorManifest,
  validateSuccessorStageStates,
} from './review-media-sql-successor.mjs';
import {
  compileElevenMigrationBundle,
  compileFiveMigrationBundle,
  elevenMigrationBundleSuffixRoot,
  fiveMigrationBundleSuffixRoot,
} from './supabase-migration-bundle.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
export const REPOSITORY_ROOT = resolve(dirname(SCRIPT_PATH), '../../..');
export const EVIDENCE_PREFIXED_MANIFEST_PATHS = Object.freeze({
  predecessor: resolve(REPOSITORY_ROOT, '.github/review-media-evidence-prefixed-predecessor-successor.v1.json'),
  feature: resolve(REPOSITORY_ROOT, '.github/review-media-evidence-prefixed-feature-successor.v1.json'),
});

const HEX_SHA256 = /^[0-9a-f]{64}$/;
const PHASES = new Set(['predecessor', 'feature']);
const EXPECTED_TOP_LEVEL_KEYS = Object.freeze([
  'advisoryLockKey',
  'baseMapping',
  'databaseName',
  'evidenceMigrations',
  'executorRole',
  'historicalAppliedVariant',
  'id',
  'launchPolicy',
  'operatingIdentity',
  'operatingTransition',
  'phase',
  'projectRef',
  'protectedSource',
  'purpose',
  'requiredWriterFences',
  'schemaVersion',
  'serverMajor',
  'stateRootAlgorithm',
  'targetManifest',
  'toolchain',
]);
const EXPECTED_STATE_KEYS = Object.freeze([
  'baseIdentityRoot',
  'baseRowCount',
  'evidenceCount',
  'evidenceIdentityRoot',
  'evidenceReady',
  'featureCount',
  'featureIdentityRoot',
  'featureReady',
  'historicalAppliedVariantReady',
  'ledgerIdentityRoot',
  'legacyBundle',
  'legacyState',
  'operatingBaseReady',
  'predecessorCount',
  'predecessorIdentityRoot',
  'predecessorReady',
  'targetIdentityRoot',
  'targetStageIndex',
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

function exactKeys(value, keys, code = 'EVIDENCE_PREFIXED_CONTRACT_INVALID') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(code);
  }
}

function assertHex(value, code = 'EVIDENCE_PREFIXED_CONTRACT_INVALID') {
  if (typeof value !== 'string' || !HEX_SHA256.test(value)) fail(code);
}

function normalizeIdentity(row, code = 'EVIDENCE_PREFIXED_CONTRACT_INVALID') {
  exactKeys(row, ['name', 'statementCount', 'statementVectorSha256', 'version'], code);
  if (!/^\d{8,14}$/.test(row.version)
    || !/^[a-z0-9_]+$/.test(row.name)
    || !Number.isSafeInteger(row.statementCount)
    || row.statementCount < 0) fail(code);
  assertHex(row.statementVectorSha256, code);
  return Object.freeze({
    version: row.version,
    name: row.name,
    statementCount: row.statementCount,
    statementVectorSha256: row.statementVectorSha256,
  });
}

function identityMaterial(row) {
  const versionBytes = Buffer.byteLength(row.version, 'utf8');
  const name = row.name === null ? '-1:' : `${Buffer.byteLength(row.name, 'utf8')}:${row.name}`;
  return `${versionBytes}:${row.version}\x1f${name}\x1f${row.statementCount}\x1f${row.statementVectorSha256}`;
}

export function ledgerIdentityRoot(rows) {
  if (!Array.isArray(rows)) fail('EVIDENCE_PREFIXED_IDENTITY_INVALID');
  const normalized = rows.map(row => normalizeIdentity({
    version: row?.version,
    name: row?.name,
    statementCount: row?.statementCount,
    statementVectorSha256: row?.statementVectorSha256,
  }, 'EVIDENCE_PREFIXED_IDENTITY_INVALID'));
  const seen = new Set();
  for (const row of normalized) {
    if (seen.has(row.version)) fail('EVIDENCE_PREFIXED_IDENTITY_INVALID');
    seen.add(row.version);
  }
  return sha256([...normalized]
    .sort((left, right) => left.version.localeCompare(right.version)
      || left.name.localeCompare(right.name))
    .map(identityMaterial)
    .join('\x1e'));
}

function targetIdentities(record) {
  return record.manifest.migrations.map(migration => normalizeIdentity({
    version: migration.version,
    name: migration.name,
    statementCount: migration.statementCount,
    statementVectorSha256: migration.statementVectorSha256,
  }));
}

function targetStageRoots(rows) {
  return Array.from({ length: rows.length + 1 }, (_, index) => ledgerIdentityRoot(rows.slice(0, index)));
}

function ledgerStageRoots(prefix, targets) {
  return Array.from({ length: targets.length + 1 }, (_, index) => ledgerIdentityRoot([
    ...prefix,
    ...targets.slice(0, index),
  ]));
}

function readJsonBound(path, expectedSha256, code) {
  let bytes;
  try { bytes = readFileSync(path); } catch { fail(code); }
  if (sha256(bytes) !== expectedSha256) fail(code);
  try {
    const value = JSON.parse(bytes.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
    return { bytes, value };
  } catch { fail(code); }
}

function loadBaseRows(manifest) {
  exactKeys(manifest.baseMapping, [
    'baseIdentityRoot', 'path', 'rowCount', 'sha256',
  ]);
  assertHex(manifest.baseMapping.sha256);
  assertHex(manifest.baseMapping.baseIdentityRoot);
  if (manifest.baseMapping.rowCount !== 86) fail('EVIDENCE_PREFIXED_CONTRACT_INVALID');
  const path = resolve(REPOSITORY_ROOT, manifest.baseMapping.path);
  const { value } = readJsonBound(path, manifest.baseMapping.sha256, 'EVIDENCE_PREFIXED_BASE_MAPPING_INVALID');
  if (value?.result?.count !== 86 || !Array.isArray(value?.result?.rows)
    || value.result.rows.length !== 86) fail('EVIDENCE_PREFIXED_BASE_MAPPING_INVALID');
  const rows = value.result.rows.map(row => normalizeIdentity({
    version: row.version,
    name: row.name,
    statementCount: row.statement_count,
    statementVectorSha256: row.statement_vector_sha256,
  }, 'EVIDENCE_PREFIXED_BASE_MAPPING_INVALID'));
  if (ledgerIdentityRoot(rows) !== manifest.baseMapping.baseIdentityRoot) {
    fail('EVIDENCE_PREFIXED_BASE_MAPPING_INVALID');
  }
  return Object.freeze(rows);
}

function loadEvidenceRows(manifest) {
  if (!Array.isArray(manifest.evidenceMigrations) || manifest.evidenceMigrations.length !== 3) {
    fail('EVIDENCE_PREFIXED_CONTRACT_INVALID');
  }
  let previous = '';
  return Object.freeze(manifest.evidenceMigrations.map(entry => {
    exactKeys(entry, [
      'name', 'path', 'sha256', 'statementCount', 'statementVectorSha256', 'version',
    ]);
    const identity = normalizeIdentity({
      version: entry.version,
      name: entry.name,
      statementCount: entry.statementCount,
      statementVectorSha256: entry.statementVectorSha256,
    });
    if (identity.statementCount < 1) fail('EVIDENCE_PREFIXED_CONTRACT_INVALID');
    if (identity.version <= previous || entry.path !== `backend/supabase/migrations/${entry.version}_${entry.name}.sql`) {
      fail('EVIDENCE_PREFIXED_CONTRACT_INVALID');
    }
    previous = identity.version;
    assertHex(entry.sha256);
    let bytes;
    try { bytes = readFileSync(resolve(REPOSITORY_ROOT, entry.path)); } catch {
      fail('EVIDENCE_PREFIXED_SOURCE_DRIFT');
    }
    if (sha256(bytes) !== entry.sha256) fail('EVIDENCE_PREFIXED_SOURCE_DRIFT');
    let vector;
    try { vector = readOriginalStatementVector({ path: entry.path, sha256: entry.sha256 }, bytes); }
    catch { fail('EVIDENCE_PREFIXED_SOURCE_DRIFT'); }
    if (vector.length !== entry.statementCount
      || sha256(JSON.stringify(vector)) !== entry.statementVectorSha256) {
      fail('EVIDENCE_PREFIXED_SOURCE_DRIFT');
    }
    return Object.freeze({ ...identity, path: entry.path, sha256: entry.sha256, originalStatementVector: vector });
  }));
}

function validateToolchain(manifest) {
  if (!Array.isArray(manifest.toolchain) || manifest.toolchain.length < 2) {
    fail('EVIDENCE_PREFIXED_CONTRACT_INVALID');
  }
  const seen = new Set();
  for (const entry of manifest.toolchain) {
    exactKeys(entry, ['path', 'sha256']);
    if (typeof entry.path !== 'string' || entry.path.startsWith('/') || entry.path.split('/').includes('..')
      || seen.has(entry.path)) fail('EVIDENCE_PREFIXED_CONTRACT_INVALID');
    assertHex(entry.sha256);
    seen.add(entry.path);
    let bytes;
    try { bytes = readFileSync(resolve(REPOSITORY_ROOT, entry.path)); } catch {
      fail('EVIDENCE_PREFIXED_TOOLCHAIN_DRIFT');
    }
    if (sha256(bytes) !== entry.sha256) fail('EVIDENCE_PREFIXED_TOOLCHAIN_DRIFT');
  }
}

function validateManifestShape(manifest, phase) {
  exactKeys(manifest, EXPECTED_TOP_LEVEL_KEYS);
  if (manifest.schemaVersion !== 1
    || manifest.phase !== phase
    || manifest.stateRootAlgorithm !== 'review-media-ledger-identity/v1'
    || manifest.serverMajor !== 17
    || manifest.projectRef !== 'aqlcofblfxdrjhhdmarw'
    || manifest.databaseName !== 'postgres'
    || manifest.executorRole !== 'postgres'
    || !Number.isSafeInteger(manifest.advisoryLockKey)
    || manifest.launchPolicy?.state !== 'held') fail('EVIDENCE_PREFIXED_CONTRACT_INVALID');
  exactKeys(manifest.launchPolicy, ['code', 'reason', 'state']);
  exactKeys(manifest.operatingTransition, ['after', 'before']);
  const expectedBefore = phase === 'predecessor' ? 89 : 100;
  const expectedAfter = phase === 'predecessor' ? 100 : 105;
  if (manifest.operatingTransition.before !== expectedBefore
    || manifest.operatingTransition.after !== expectedAfter) fail('EVIDENCE_PREFIXED_CONTRACT_INVALID');
  exactKeys(manifest.historicalAppliedVariant, [
    'name', 'statementCount', 'statementVectorSha256', 'version',
  ]);
  normalizeIdentity(manifest.historicalAppliedVariant);
  exactKeys(manifest.targetManifest, [
    'id', 'manifestPath', 'manifestSha256', 'sourceRoot', 'targetCount',
  ]);
  assertHex(manifest.targetManifest.manifestSha256);
  assertHex(manifest.targetManifest.sourceRoot);
  exactKeys(manifest.operatingIdentity, [
    'evidenceIdentityRoot', 'ledgerStageRoots', 'prefixIdentityRoot', 'targetStageRoots', 'terminalIdentityRoot',
  ]);
  for (const key of ['evidenceIdentityRoot', 'prefixIdentityRoot', 'terminalIdentityRoot']) {
    assertHex(manifest.operatingIdentity[key]);
  }
  if (!Array.isArray(manifest.operatingIdentity.targetStageRoots)
    || !Array.isArray(manifest.operatingIdentity.ledgerStageRoots)) fail('EVIDENCE_PREFIXED_CONTRACT_INVALID');
  manifest.operatingIdentity.targetStageRoots.forEach(value => assertHex(value));
  manifest.operatingIdentity.ledgerStageRoots.forEach(value => assertHex(value));
}

function manifestPathForPhase(phase) {
  if (!PHASES.has(phase)) fail('EVIDENCE_PREFIXED_ARGUMENT_INVALID');
  return EVIDENCE_PREFIXED_MANIFEST_PATHS[phase];
}

export function loadEvidencePrefixedSuccessorManifest(phase, {
  manifestPath = manifestPathForPhase(phase),
} = {}) {
  let bytes;
  let manifest;
  try {
    bytes = readFileSync(manifestPath);
    manifest = JSON.parse(bytes.toString('utf8'));
  } catch { fail('EVIDENCE_PREFIXED_MANIFEST_INVALID'); }
  validateManifestShape(manifest, phase);
  const predecessorRecord = loadSuccessorManifest();
  const featureRecord = loadFeatureSuccessorManifest();
  const targetRecord = phase === 'predecessor' ? predecessorRecord : featureRecord;
  const targetManifestPath = phase === 'predecessor'
    ? '.github/review-media-sql-successor.v1.json'
    : '.github/review-media-feature-sql-successor.v1.json';
  if (manifest.targetManifest.id !== targetRecord.manifest.id
    || manifest.targetManifest.manifestPath !== targetManifestPath
    || manifest.targetManifest.manifestSha256 !== targetRecord.manifestSha256
    || manifest.targetManifest.sourceRoot !== targetRecord.manifest.sourceRoot
    || manifest.targetManifest.targetCount !== targetRecord.manifest.migrations.length) {
    fail('EVIDENCE_PREFIXED_TARGET_MANIFEST_DRIFT');
  }
  const baseRows = loadBaseRows(manifest);
  const evidenceRows = loadEvidenceRows(manifest);
  const predecessorRows = targetIdentities(predecessorRecord);
  const featureRows = targetIdentities(featureRecord);
  const targetRows = phase === 'predecessor' ? predecessorRows : featureRows;
  const prefixRows = phase === 'predecessor'
    ? [...baseRows, ...evidenceRows]
    : [...baseRows, ...evidenceRows, ...predecessorRows];
  const expectedTargetRoots = targetStageRoots(targetRows);
  const expectedLedgerRoots = ledgerStageRoots(prefixRows, targetRows);
  if (manifest.operatingIdentity.evidenceIdentityRoot !== ledgerIdentityRoot(evidenceRows)
    || manifest.operatingIdentity.prefixIdentityRoot !== ledgerIdentityRoot(prefixRows)
    || manifest.operatingIdentity.terminalIdentityRoot !== expectedLedgerRoots.at(-1)
    || !equal(manifest.operatingIdentity.targetStageRoots, expectedTargetRoots)
    || !equal(manifest.operatingIdentity.ledgerStageRoots, expectedLedgerRoots)
    || manifest.operatingIdentity.targetStageRoots.length !== targetRows.length + 1
    || manifest.operatingIdentity.ledgerStageRoots.length !== targetRows.length + 1) {
    fail('EVIDENCE_PREFIXED_IDENTITY_BINDING_INVALID');
  }
  const variant = baseRows.find(row => row.version === manifest.historicalAppliedVariant.version);
  if (!variant || !equal(variant, manifest.historicalAppliedVariant)) {
    fail('EVIDENCE_PREFIXED_HISTORICAL_VARIANT_INVALID');
  }
  validateToolchain(manifest);
  return Object.freeze({
    baseRows,
    bytes,
    evidenceRows,
    featureRecord,
    featureRows,
    manifest,
    manifestSha256: sha256(bytes),
    materials: targetRecord.materials,
    predecessorRecord,
    predecessorRows,
    targetRecord,
    targetRows,
  });
}

function sqlList(values) {
  return values.map(quote).join(',');
}

function identityScopeCte(name, predicate) {
  return `${name} AS (
  SELECT count(*)::int AS row_count,
    encode(sha256(convert_to(coalesce(string_agg(row_material,chr(30) ORDER BY version COLLATE "C",name COLLATE "C"),''),'UTF8')),'hex') AS identity_root
  FROM ledger_identities WHERE ${predicate}
 )`;
}

function stageCase(roots) {
  return roots.map((root, index) => `WHEN target_scope.row_count=${index} AND target_scope.identity_root=${quote(root)} THEN ${index}`).join(' ');
}

export function buildEvidencePrefixedSuccessorStateQuery(record) {
  const { manifest, targetRecord, predecessorRows, featureRows, evidenceRows } = record;
  const predecessorVersions = predecessorRows.map(row => row.version);
  const featureVersions = featureRows.map(row => row.version);
  const evidenceVersions = evidenceRows.map(row => row.version);
  const excludedFromBase = [...predecessorVersions, ...featureVersions, ...evidenceVersions];
  const targetVersions = record.targetRows.map(row => row.version);
  const legacyQuery = manifest.phase === 'predecessor'
    ? buildSuccessorStateQuery(targetRecord.manifest)
    : buildFeatureSuccessorStateQuery(targetRecord);
  const safeLegacyQuery = manifest.phase === 'feature'
    ? legacyQuery
      .replace(
        "'review_media_private.reject_verification_object_update()'::regprocedure",
        "to_regprocedure('review_media_private.reject_verification_object_update()')",
      )
      .replace(
        "'review_media_private.guard_verification_object_delete()'::regprocedure",
        "to_regprocedure('review_media_private.guard_verification_object_delete()')",
      )
    : legacyQuery;
  if (manifest.phase === 'feature' && (safeLegacyQuery === legacyQuery
    || safeLegacyQuery.includes("'review_media_private.reject_verification_object_update()'::regprocedure")
    || safeLegacyQuery.includes("'review_media_private.guard_verification_object_delete()'::regprocedure"))) {
    fail('EVIDENCE_PREFIXED_LEGACY_QUERY_INVALID');
  }
  const suffixRoot = manifest.phase === 'predecessor'
    ? elevenMigrationBundleSuffixRoot(targetRecord.manifest.migrations)
    : fiveMigrationBundleSuffixRoot(targetRecord.manifest.migrations);
  const finalTargetRoot = manifest.operatingIdentity.targetStageRoots.at(-1);
  const historical = manifest.historicalAppliedVariant;
  return `SELECT * FROM (WITH
 legacy AS (SELECT (${safeLegacyQuery})::jsonb AS value),
 ledger_identities AS (
  SELECT version,name,cardinality(statements)::int AS statement_count,
   encode(sha256(convert_to(array_to_json(statements)::text,'UTF8')),'hex') AS statement_vector_sha256,
   octet_length(convert_to(version,'UTF8'))::text||':'||version||chr(31)||
    CASE WHEN name IS NULL THEN '-1:' ELSE octet_length(convert_to(name,'UTF8'))::text||':'||name END||chr(31)||
    cardinality(statements)::text||chr(31)||
    encode(sha256(convert_to(array_to_json(statements)::text,'UTF8')),'hex') AS row_material
  FROM supabase_migrations.schema_migrations
 ),
 ${identityScopeCte('base_scope', `version<>ALL(ARRAY[${sqlList(excludedFromBase)}])`)},
 ${identityScopeCte('evidence_scope', `version=ANY(ARRAY[${sqlList(evidenceVersions)}])`)},
 ${identityScopeCte('predecessor_scope', `version=ANY(ARRAY[${sqlList(predecessorVersions)}])`)},
 ${identityScopeCte('feature_scope', `version=ANY(ARRAY[${sqlList(featureVersions)}])`)},
 ${identityScopeCte('prefix_scope', `version<>ALL(ARRAY[${sqlList(targetVersions)}])`)},
 ${identityScopeCte('target_scope', `version=ANY(ARRAY[${sqlList(targetVersions)}])`)},
 ${identityScopeCte('ledger_scope', 'true')},
 stage AS (SELECT CASE ${stageCase(manifest.operatingIdentity.targetStageRoots)} ELSE -1 END AS stage_index
  FROM target_scope)
 SELECT jsonb_build_object(
  'bundle',jsonb_build_object(
   'ledgerCount',ledger_scope.row_count,
   'prefixRoot',prefix_scope.identity_root,
   'priorCount',prefix_scope.row_count,
   'suffixRoot',CASE WHEN stage.stage_index=${record.targetRows.length} THEN ${quote(suffixRoot)} ELSE NULL END,
   'targetCount',target_scope.row_count
  ),
  'state',jsonb_build_object(
   'baseIdentityRoot',base_scope.identity_root,
   'baseRowCount',base_scope.row_count,
   'evidenceCount',evidence_scope.row_count,
   'evidenceIdentityRoot',evidence_scope.identity_root,
   'evidenceReady',evidence_scope.row_count=3 AND evidence_scope.identity_root=${quote(manifest.operatingIdentity.evidenceIdentityRoot)},
   'featureCount',feature_scope.row_count,
   'featureIdentityRoot',feature_scope.identity_root,
   'featureReady',feature_scope.row_count=5 AND feature_scope.identity_root=${quote(ledgerIdentityRoot(featureRows))},
   'historicalAppliedVariantReady',EXISTS(SELECT 1 FROM ledger_identities WHERE version=${quote(historical.version)} AND name=${quote(historical.name)} AND statement_count=${historical.statementCount} AND statement_vector_sha256=${quote(historical.statementVectorSha256)}),
   'ledgerIdentityRoot',ledger_scope.identity_root,
   'legacyBundle',legacy.value->'bundle',
   'legacyState',legacy.value->'state',
   'operatingBaseReady',base_scope.row_count=86 AND base_scope.identity_root=${quote(manifest.baseMapping.baseIdentityRoot)},
   'predecessorCount',predecessor_scope.row_count,
   'predecessorIdentityRoot',predecessor_scope.identity_root,
   'predecessorReady',predecessor_scope.row_count=11 AND predecessor_scope.identity_root=${quote(ledgerIdentityRoot(predecessorRows))},
   'targetIdentityRoot',target_scope.identity_root,
   'targetStageIndex',stage.stage_index
  )
 )::text AS state
 FROM legacy,base_scope,evidence_scope,predecessor_scope,feature_scope,prefix_scope,target_scope,ledger_scope,stage) AS evidence_prefixed_state`;
}

function validateStageShape(stage) {
  exactKeys(stage, ['bundle', 'state'], 'EVIDENCE_PREFIXED_STAGE_INVALID');
  exactKeys(stage.bundle, ['ledgerCount', 'prefixRoot', 'priorCount', 'suffixRoot', 'targetCount'], 'EVIDENCE_PREFIXED_STAGE_INVALID');
  exactKeys(stage.state, EXPECTED_STATE_KEYS, 'EVIDENCE_PREFIXED_STAGE_INVALID');
  for (const value of [
    stage.bundle.prefixRoot,
    stage.state.baseIdentityRoot,
    stage.state.evidenceIdentityRoot,
    stage.state.featureIdentityRoot,
    stage.state.ledgerIdentityRoot,
    stage.state.predecessorIdentityRoot,
    stage.state.targetIdentityRoot,
  ]) assertHex(value, 'EVIDENCE_PREFIXED_STAGE_INVALID');
}

function adjustedLegacyStages(stages) {
  return stages.map(stage => ({
    bundle: {
      ...stage.state.legacyBundle,
      ledgerCount: stage.state.legacyBundle.ledgerCount - 3,
      priorCount: stage.state.legacyBundle.priorCount - 3,
    },
    state: stage.state.legacyState,
  }));
}

export function validateEvidencePrefixedStageStates(stages, record, { mode = 'operating' } = {}) {
  if (!['operating', 'rehearsal'].includes(mode)
    || !Array.isArray(stages)
    || stages.length !== record.targetRows.length + 1) fail('EVIDENCE_PREFIXED_STAGE_INVALID');
  const { manifest } = record;
  const before = manifest.operatingTransition.before;
  const prefixRoot = stages[0]?.bundle?.prefixRoot;
  const baseRoot = stages[0]?.state?.baseIdentityRoot;
  const suffixRoot = manifest.phase === 'predecessor'
    ? elevenMigrationBundleSuffixRoot(record.targetRecord.manifest.migrations)
    : fiveMigrationBundleSuffixRoot(record.targetRecord.manifest.migrations);
  stages.forEach((stage, index) => {
    validateStageShape(stage);
    if (stage.bundle.ledgerCount !== before + index
      || stage.bundle.priorCount !== before
      || stage.bundle.prefixRoot !== prefixRoot
      || stage.bundle.targetCount !== index
      || stage.bundle.suffixRoot !== (index === record.targetRows.length ? suffixRoot : null)
      || stage.state.baseRowCount !== 86
      || stage.state.baseIdentityRoot !== baseRoot
      || stage.state.evidenceCount !== 3
      || stage.state.evidenceIdentityRoot !== manifest.operatingIdentity.evidenceIdentityRoot
      || stage.state.evidenceReady !== true
      || stage.state.targetStageIndex !== index
      || stage.state.targetIdentityRoot !== manifest.operatingIdentity.targetStageRoots[index]
      || stage.state.predecessorCount !== (manifest.phase === 'predecessor' ? index : 11)
      || stage.state.featureCount !== (manifest.phase === 'feature' ? index : 0)
      || (manifest.phase === 'predecessor' && stage.state.featureReady !== false)
      || (manifest.phase === 'feature' && stage.state.predecessorReady !== true)) {
      fail('EVIDENCE_PREFIXED_STAGE_INVALID');
    }
    if (mode === 'operating' && (prefixRoot !== manifest.operatingIdentity.prefixIdentityRoot
      || baseRoot !== manifest.baseMapping.baseIdentityRoot
      || stage.state.operatingBaseReady !== true
      || stage.state.historicalAppliedVariantReady !== true
      || stage.state.ledgerIdentityRoot !== manifest.operatingIdentity.ledgerStageRoots[index])) {
      fail('EVIDENCE_PREFIXED_STAGE_INVALID');
    }
  });
  try {
    const legacyStages = adjustedLegacyStages(stages);
    if (manifest.phase === 'predecessor') {
      validateSuccessorStageStates(legacyStages, record.targetRecord.manifest);
    } else {
      validateFeatureStageStates(legacyStages, record.targetRecord.manifest);
    }
  } catch { fail('EVIDENCE_PREFIXED_STAGE_INVALID'); }
  return Object.freeze({
    mode,
    prefixRoot,
    priorCount: before,
    suffixRoot,
  });
}

function compileEvidencePrefixedPlan(record, stageStates, mode) {
  const binding = validateEvidencePrefixedStageStates(stageStates, record, { mode });
  const stateQuery = buildEvidencePrefixedSuccessorStateQuery(record);
  const migrations = record.targetRecord.manifest.migrations.map((migration, index) => ({
    expectedPriorState: { expected: stageStates[index], query: stateQuery },
    id: migration.id,
    path: migration.path,
    sha256: migration.sha256,
    statementVectorSha256: migration.statementVectorSha256,
    terminalReadback: { expected: stageStates[index + 1], query: stateQuery },
  }));
  const bundle = {
    finalReadback: { expected: stageStates.at(-1), query: stateQuery },
    id: record.manifest.id,
    migrations,
    prefixRoot: binding.prefixRoot,
    priorCount: binding.priorCount,
    priorReadback: { expected: stageStates[0], query: stateQuery },
    schemaVersion: 1,
    suffixRoot: binding.suffixRoot,
  };
  const compiled = record.manifest.phase === 'predecessor'
    ? compileElevenMigrationBundle(bundle, record.materials)
    : compileFiveMigrationBundle(bundle, record.materials);
  const lockTag = `$evidence_prefixed_${sha256(String(record.manifest.advisoryLockKey)).slice(0, 18)}$`;
  return Object.freeze({
    ...compiled,
    identityMode: mode,
    sql: `SET LOCAL lock_timeout='2s';\nSET LOCAL statement_timeout='15s';\nSET LOCAL idle_in_transaction_session_timeout='30s';\nDO ${lockTag} BEGIN PERFORM pg_advisory_xact_lock(${record.manifest.advisoryLockKey}::bigint); END ${lockTag};\n${compiled.sql}`,
    stateQuery,
  });
}

export function compileEvidencePrefixedApplyPlan(record, admission) {
  exactKeys(admission, [
    'baseMappingSha256', 'kind', 'manifestSha256', 'phase', 'stageStates',
  ], 'EVIDENCE_PREFIXED_ADMISSION_INVALID');
  if (admission.kind !== 'evidence-prefixed-successor-local-admission'
    || admission.phase !== record.manifest.phase
    || admission.manifestSha256 !== record.manifestSha256
    || admission.baseMappingSha256 !== record.manifest.baseMapping.sha256) {
    fail('EVIDENCE_PREFIXED_ADMISSION_INVALID');
  }
  return compileEvidencePrefixedPlan(record, admission.stageStates, 'operating');
}

export function compileEvidencePrefixedRehearsalAggregatePlan(record, stageStates) {
  return compileEvidencePrefixedPlan(record, stageStates, 'rehearsal');
}

export function assertEvidencePrefixedLaunchReady(record) {
  if (record.manifest.launchPolicy.state !== 'ready') fail(record.manifest.launchPolicy.code);
}

export function evidencePrefixedContractSummary(record) {
  return Object.freeze({
    baseIdentityRoot: record.manifest.baseMapping.baseIdentityRoot,
    evidenceIdentityRoot: record.manifest.operatingIdentity.evidenceIdentityRoot,
    id: record.manifest.id,
    launchState: record.manifest.launchPolicy.state,
    manifestSha256: record.manifestSha256,
    operatingTransition: record.manifest.operatingTransition,
    phase: record.manifest.phase,
    prefixIdentityRoot: record.manifest.operatingIdentity.prefixIdentityRoot,
    targetCount: record.targetRows.length,
    terminalIdentityRoot: record.manifest.operatingIdentity.terminalIdentityRoot,
  });
}

export function mainEvidencePrefixedSuccessor(phase, argv = process.argv.slice(2)) {
  if (!PHASES.has(phase) || argv.length !== 1 || argv[0] !== '--check') {
    fail('EVIDENCE_PREFIXED_ARGUMENT_INVALID');
  }
  const record = loadEvidencePrefixedSuccessorManifest(phase);
  process.stdout.write(`${JSON.stringify(canonical(evidencePrefixedContractSummary(record)))}\n`);
}
