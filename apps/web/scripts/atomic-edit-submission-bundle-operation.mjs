import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { atomicMigrationSql, migrationEnvelope, statementSpans } from './supabase-migration-transaction.mjs';
import { buildOperation as originalOperation } from './atomic-edit-submission-operation.mjs';
import { assertSuccessorDatabaseTarget } from './review-media-sql-successor.mjs';
import { createThumbnailPsqlRunner } from './thumbnail-production-successor.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CONTRACT_PATH = '.github/atomic-edit-submission-install.v2.json';
const CONTRACT_DIGEST = 'a3e6e14e5eb1518f53ec7359ce91b993fe50f1f7e2a3dfd16221ad74af521f4d';
const ORIGINAL_CONTRACT = 'fc7b5720016e59b96470cc1245a53fbfff35f6cab511d5de2bcdc5bcfa7b2b25';
const CORRECTION_PATH = 'backend/supabase/migrations/20261026130000_atomic_edit_public_business_phone.sql';
const SERIALIZER = "SET LOCAL lock_timeout='2s'; SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('tzudong:review-media-sql-successor:workflow:v1',0));\n";
const hash = value => createHash('sha256').update(value).digest('hex');
const quote = value => "'" + value.replaceAll("'", "''") + "'";
const fail = code => { throw Error('ATOMIC_EDIT_BUNDLE_' + code); };
const memberIdentity = m => ({ path: m.path, sha256: m.sha256, statementVectorSha256: m.statementVectorSha256 });
const rawQuery = value => value.trim().replace(/;\s*$/, '');

function jsonLine(output) {
  const lines = output.trim().split(/\r?\n/).filter(line => line.trim().startsWith('{'));
  if (lines.length !== 1) fail('READBACK_INVALID');
  try { return JSON.parse(lines[0]); } catch { fail('READBACK_INVALID'); }
}

export function buildOperation({ contractBytes = readFileSync(resolve(ROOT, CONTRACT_PATH)), sourceBytes } = {}) {
  if (hash(contractBytes) !== CONTRACT_DIGEST) fail('CONTRACT_DRIFT');
  const contract = JSON.parse(contractBytes);
  const original = originalOperation();
  if (contract.schemaVersion !== 2 || contract.kind !== 'atomic_edit_submission_bundle_installation'
    || contract.projectRef !== 'aqlcofblfxdrjhhdmarw' || contract.database !== 'postgres'
    || contract.originalContractSha256 !== ORIGINAL_CONTRACT || typeof contract.executionEnabled !== 'boolean'
    || !Array.isArray(contract.migrations) || contract.migrations.length !== 2) fail('CONTRACT_INVALID');
  const [first, second] = contract.migrations;
  const { originalStatementVector: firstVector, statementVectorSha256: firstVectorSha, ...firstMigration } = first;
  if (!isDeepStrictEqual(firstMigration, original.migration)
    || !isDeepStrictEqual(firstVector, original.contract.originalStatementVector)
    || firstVectorSha !== original.plan.vectorSha256 || firstVector.length !== 24
    || second.path !== CORRECTION_PATH || second.id !== 'atomic_edit_public_business_phone'
    || !isDeepStrictEqual(second.expectedPriorState, first.terminalReadback)
    || !isDeepStrictEqual(contract.expectedPriorState, first.expectedPriorState)
    || !isDeepStrictEqual(contract.terminalReadback, second.terminalReadback)
    || contract.expectedPriorState.expected.custodyOriginalTerminal.ledgerCount !== 94
    || first.terminalReadback.expected.legacy.ledgerCount !== 95
    || contract.terminalReadback.expected.legacy.ledgerCount !== 96) fail('MEMBER_CONTRACT_INVALID');
  const members = contract.migrations.map((migration, index) => {
    const bytes = sourceBytes?.[index] ?? readFileSync(resolve(ROOT, migration.path));
    if (hash(bytes) !== migration.sha256) fail('FILE_DRIFT');
    const plan = migrationEnvelope(bytes, migration, migration.originalStatementVector);
    // Both admitted sources are already caller-owned. No statement is removed,
    // and no intermediate BEGIN/COMMIT is accepted in this two-source bundle.
    if (plan.execution !== bytes.toString('utf8') || plan.vectorSha256 !== migration.statementVectorSha256
      || plan.version !== ['20261026120000', '20261026130000'][index]) fail('VECTOR_DRIFT');
    return { migration, plan };
  });
  if (contract.bundleSha256 !== hash(JSON.stringify(contract.migrations.map(memberIdentity)))
    || contract.combinedStatementVectorSha256 !== hash(JSON.stringify(contract.migrations.flatMap(m => m.originalStatementVector)))) fail('BUNDLE_IDENTITY_DRIFT');
  return { contract, members };
}

function ledgerEqual(plan) {
  return `EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version=${quote(plan.version)} AND name IS NOT DISTINCT FROM ${quote(plan.name)} AND statements IS NOT DISTINCT FROM ARRAY(SELECT jsonb_array_elements_text(${quote(JSON.stringify(plan.originalVector))}::jsonb)))`;
}

export function bundleReconciliationSql({ contract, members }) {
  const [first, second] = members;
  // psql conditionals avoid evaluating an absent installation's terminal
  // projection. A single original row is drift, never permission to resume.
  return `SET LOCAL search_path='';\nSET TRANSACTION READ ONLY;
SELECT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261026120000') AS bundle_first,
       EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261026130000') AS bundle_second \\gset
\\if :bundle_first
 \\if :bundle_second
 SELECT jsonb_build_object('state','installed','originalLedgerEqual',${ledgerEqual(first.plan)},'correctionLedgerEqual',${ledgerEqual(second.plan)},'prior',NULL,'terminal',(SELECT state FROM (${rawQuery(contract.terminalReadback.query)}) final_state));
 \\else
 SELECT jsonb_build_object('state','partial');
 \\endif
\\else
 \\if :bundle_second
 SELECT jsonb_build_object('state','partial');
 \\else
 SELECT jsonb_build_object('state','absent','prior',(SELECT state FROM (${rawQuery(contract.expectedPriorState.query)}) prior_state),'terminal',NULL);
 \\endif
\\endif
`;
}

export function bundleDisposition(value, contract) {
  if (isDeepStrictEqual(value, { state: 'absent', prior: contract.expectedPriorState.expected, terminal: null })) return 'not_applied';
  if (isDeepStrictEqual(value, { state: 'installed', originalLedgerEqual: true, correctionLedgerEqual: true,
    prior: null, terminal: contract.terminalReadback.expected })) return 'committed';
  return 'drift';
}

export function atomicBundleSql({ members }) {
  const [first, second] = members;
  const initial = atomicMigrationSql(first.plan, first.migration);
  const last = statementSpans(initial).at(-1);
  if (!last || last.token !== statementSpans(first.migration.terminalReadback.query)[0].token) fail('COMPILER_READBACK_DRIFT');
  // Suppress only the compiler's final printing SELECT for the intermediate
  // state. Its terminal guard remains, as do every original source statement
  // and both exact ledger INSERTs. The runner supplies the sole outer xact.
  return SERIALIZER + initial.slice(0, last.start) + atomicMigrationSql(second.plan, second.migration);
}

export function runOperation(mode, {
  databaseUrl = process.env.SUPABASE_DB_URL, sourceSha = process.env.EXPECTED_SOURCE_SHA,
  confirmation = process.env.APPLY_CONFIRMATION, runner,
} = {}) {
  if (!['observe', 'apply'].includes(mode) || !/^[0-9a-f]{40}$/.test(sourceSha ?? '')) fail('ARGUMENT_INVALID');
  assertSuccessorDatabaseTarget(databaseUrl, { projectRef: 'aqlcofblfxdrjhhdmarw', databaseName: 'postgres' });
  const operation = buildOperation(); const { contract } = operation;
  if (mode === 'apply' && !contract.executionEnabled) fail('EXECUTION_DISABLED');
  const run = runner ?? createThumbnailPsqlRunner(databaseUrl);
  const reconcile = () => jsonLine(run(databaseUrl, bundleReconciliationSql(operation), true));
  const before = bundleDisposition(reconcile(), contract);
  const identity = { sourceSha, bundleSha256: contract.bundleSha256,
    combinedStatementVectorSha256: contract.combinedStatementVectorSha256,
    migrations: contract.migrations.map(memberIdentity) };
  if (before === 'committed') return { ...identity, state: 'already_committed' };
  if (before !== 'not_applied') fail('PREIMAGE_DRIFT');
  if (mode === 'observe') return { ...identity, state: 'ready' };
  if (confirmation !== `apply:${sourceSha}:${contract.bundleSha256}`) fail('CONFIRMATION_INVALID');
  const atomic = atomicBundleSql(operation);
  const rehearsal = jsonLine(run(databaseUrl, `BEGIN;\n${atomic}\nROLLBACK;`, false));
  if (!isDeepStrictEqual(rehearsal, contract.terminalReadback.expected)) fail('REHEARSAL_INVALID');
  if (bundleDisposition(reconcile(), contract) !== 'not_applied') fail('REHEARSAL_ROLLBACK_INVALID');
  let transport = 'returned';
  // One send per invocation; the parent's original durable journal owns the
  // cross-invocation no-retry rule. Reconcile an uncertain send, never replay it.
  try { run(databaseUrl, atomic, true); } catch { transport = 'unconfirmed'; }
  let after;
  try { after = reconcile(); } catch { fail('APPLY_UNCONFIRMED'); }
  if (bundleDisposition(after, contract) !== 'committed') fail('APPLY_UNCONFIRMED');
  return { ...identity, state: 'committed', transport, rehearsal: 'rolled_back', after: after.terminal };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(runOperation(process.argv[2]))); }
  catch (error) {
    console.error(/^ATOMIC_EDIT_BUNDLE_[A-Z_]+$/.test(error?.message ?? '') ? error.message : 'ATOMIC_EDIT_BUNDLE_OPERATION_FAILED');
    process.exitCode = 1;
  }
}
