import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicMigrationSql, migrationEnvelope, reconciliationSql, reconciliationOutcome } from './supabase-migration-transaction.mjs';
import { assertSuccessorDatabaseTarget } from './review-media-sql-successor.mjs';
import { createThumbnailPsqlRunner } from './thumbnail-production-successor.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CONTRACT = '.github/hosted-pending-custody-install.v1.json';
const CONTRACT_DIGEST = '4e5c741526ba9cec547879c03b4bbf0a5b4598c593aa3f6397263d078334d926';
const PATH = 'backend/supabase/migrations/20261025063810_hosted_pending_atomic_delivery.sql';
const DIGEST = '02bc9c5dab0e16a46a28a7993e9c75524813d0bc713c60782881eb4d5ddd2165';
const VECTOR = '298dbf93c0bb13686b388a0eb73222aa02ca4a7a1998739e87f45eb7072853ec';
const ID = 'hosted_pending_atomic_delivery';
const SERIALIZER = "SET LOCAL lock_timeout='2s'; SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('tzudong:review-media-sql-successor:workflow:v1',0));\n";
const digest = value => createHash('sha256').update(value).digest('hex');
const fail = code => { throw new Error(code); };

function jsonLine(output) {
  const lines = output.trim().split(/\r?\n/).filter(line => line.trim().startsWith('{'));
  if (lines.length !== 1) fail('HOSTED_PENDING_READBACK_INVALID');
  try { return JSON.parse(lines[0]); }
  catch { fail('HOSTED_PENDING_READBACK_INVALID'); }
}

export function buildOperation({
  bytes = readFileSync(resolve(ROOT, PATH)),
  contractBytes = readFileSync(resolve(ROOT, CONTRACT)),
} = {}) {
  if (digest(bytes) !== DIGEST) fail('HOSTED_PENDING_FILE_DRIFT');
  if (digest(contractBytes) !== CONTRACT_DIGEST) fail('HOSTED_PENDING_CONTRACT_DRIFT');
  const contract = JSON.parse(contractBytes.toString('utf8'));
  const migration = contract.migration;
  if (contract.schemaVersion !== 1 || contract.kind !== 'hosted_pending_atomic_delivery_installation'
    || contract.projectRef !== 'aqlcofblfxdrjhhdmarw' || contract.database !== 'postgres'
    || typeof contract.executionEnabled !== 'boolean'
    || migration?.id !== ID || migration.path !== PATH || migration.sha256 !== DIGEST
    || contract.statementVectorSha256 !== VECTOR || !Array.isArray(contract.originalStatementVector)
    || digest(JSON.stringify(contract.originalStatementVector)) !== VECTOR) fail('HOSTED_PENDING_CONTRACT_INVALID');
  const plan = migrationEnvelope(bytes, migration, contract.originalStatementVector);
  if (plan.version !== '20261025063810' || plan.sourceSha256 !== DIGEST || plan.vectorSha256 !== VECTOR)
    fail('HOSTED_PENDING_VECTOR_DRIFT');
  return { contract, migration, plan };
}

export function runOperation(mode, {
  databaseUrl = process.env.SUPABASE_DB_URL,
  sourceSha = process.env.EXPECTED_SOURCE_SHA,
  confirmation = process.env.APPLY_CONFIRMATION,
  runner,
} = {}) {
  if (!['observe', 'apply'].includes(mode) || !/^[0-9a-f]{40}$/.test(sourceSha ?? ''))
    fail('HOSTED_PENDING_ARGUMENT_INVALID');
  assertSuccessorDatabaseTarget(databaseUrl, { projectRef: 'aqlcofblfxdrjhhdmarw', databaseName: 'postgres' });
  const { contract, migration, plan } = buildOperation();
  if (mode === 'apply' && !contract.executionEnabled) fail('HOSTED_PENDING_EXECUTION_DISABLED');
  const run = runner ?? createThumbnailPsqlRunner(databaseUrl);
  const reconcile = () => jsonLine(run(databaseUrl, "SET LOCAL search_path='';\n" + reconciliationSql(plan, migration), true));
  const before = reconcile();
  const disposition = reconciliationOutcome(before, migration);
  const identity = { sourceSha, migrationSha256: DIGEST, statementVectorSha256: VECTOR };
  if (disposition === 'committed') return { ...identity, state: 'already_committed' };
  if (disposition !== 'not_applied') fail('HOSTED_PENDING_PREIMAGE_DRIFT');
  if (mode === 'observe') return { ...identity, state: 'ready', before: before.prior };
  if (confirmation !== `apply:${sourceSha}:${DIGEST}`) fail('HOSTED_PENDING_CONFIRMATION_INVALID');

  const atomic = SERIALIZER + atomicMigrationSql(plan, migration);
  const rehearsal = `BEGIN;\n${atomic}\nROLLBACK;`;
  const staged = jsonLine(run(databaseUrl, rehearsal, false));
  if (reconciliationOutcome({ ledger_exists: true, ledger_equal: true, prior: null, terminal: staged }, migration) !== 'committed')
    fail('HOSTED_PENDING_REHEARSAL_INVALID');
  if (reconciliationOutcome(reconcile(), migration) !== 'not_applied') fail('HOSTED_PENDING_REHEARSAL_ROLLBACK_INVALID');

  let transport = 'returned';
  // One write transport per invocation. A lost acknowledgement is followed only
  // by readback; an original operation journal must prohibit another apply run.
  try { run(databaseUrl, atomic, true); }
  catch { transport = 'unconfirmed'; }
  const after = reconcile();
  if (reconciliationOutcome(after, migration) !== 'committed') fail('HOSTED_PENDING_APPLY_UNCONFIRMED');
  return { ...identity, state: 'committed', transport, rehearsal: 'rolled_back', after: after.terminal };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(runOperation(process.argv[2]))); }
  catch (error) {
    console.error(/^HOSTED_PENDING_[A-Z_]+$/.test(error?.message ?? '') ? error.message : 'HOSTED_PENDING_OPERATION_FAILED');
    process.exitCode = 1;
  }
}
