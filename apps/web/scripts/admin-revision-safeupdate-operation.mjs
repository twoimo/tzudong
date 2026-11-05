import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicMigrationSql, migrationEnvelope, reconciliationSql, reconciliationOutcome } from './supabase-migration-transaction.mjs';
import { assertSuccessorDatabaseTarget } from './review-media-sql-successor.mjs';
import { createThumbnailPsqlRunner } from './thumbnail-production-successor.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const PATH = 'backend/supabase/migrations/20261011094346_admin_evaluation_revision_safeupdate.sql';
const DIGEST = 'b7061015ea07192dccfcf0774d5548a9c2a584c7daa140d77fccd7c75cb8bf88';
const OLD = 'ed16226885c03b05cb459381cc5ef7c8352506f7ea1f88ae526a6511e4cc1b20';
const NEW = '4a3bf9e7cc7d91fb1a2a5195d01f40de728539daad1a0a8132a7c10404dc7936';
const LEDGER = 'd942f4e14dc68ed37a49f2159ddc73d997ae2f7409e59ed18b2294f4d51061bc';
const VECTOR = '8cfd8d94d5419712b767b1360361ed905b151e45c8ba3d9cca8d7fe3f1adbd69';
const fail = code => { throw new Error(code); };
const stateQuery = `SELECT jsonb_build_object('ledgerCount',(SELECT count(*) FROM supabase_migrations.schema_migrations),
 'sourceSha',(SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='pipeline_control.bump_admin_evaluation_revision()'::regprocedure),
 'role',current_user,'session',session_user,'serverMajor',current_setting('server_version_num')::int/10000,
 'apiSafeupdate',EXISTS(SELECT 1 FROM pg_db_role_setting x JOIN pg_roles r ON r.oid=x.setrole CROSS JOIN LATERAL unnest(x.setconfig) s WHERE r.rolname='authenticator' AND s='session_preload_libraries=safeupdate'),
 'originalLedgerSha',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_object('version',version,'name',name,'statements',statements) ORDER BY version),'[]'::jsonb)::text,'UTF8')),'hex') FROM supabase_migrations.schema_migrations WHERE version<>'20261011094346')) AS state`;
const expected = (count, sourceSha) => ({ledgerCount:count,sourceSha,role:'postgres',session:'postgres',serverMajor:17,apiSafeupdate:true,originalLedgerSha:LEDGER});
const jsonLine = output => {
  const lines = output.trim().split(/\r?\n/).filter(line => line.trim().startsWith('{'));
  if (lines.length !== 1) fail('ADMIN_REVISION_READBACK_INVALID');
  return JSON.parse(lines[0]);
};

export function buildOperation(bytes = readFileSync(resolve(ROOT, PATH))) {
  if (createHash('sha256').update(bytes).digest('hex') !== DIGEST) fail('ADMIN_REVISION_FILE_DRIFT');
  const migration = {id:'admin_evaluation_revision_safeupdate',path:PATH,sha256:DIGEST,
    expectedPriorState:{query:stateQuery,expected:expected(92,OLD)},
    terminalReadback:{query:stateQuery,expected:expected(93,NEW)}};
  const record = JSON.parse(readFileSync(resolve(ROOT,'.github/review-media-sql-successor.v1.json'),'utf8'))
    .migrations.find(row => row.id===migration.id);
  if (record?.sha256!==DIGEST || record.path!==PATH || record.statementVectorSha256!==VECTOR
    || createHash('sha256').update(JSON.stringify(record.originalStatementVector)).digest('hex')!==VECTOR) fail('ADMIN_REVISION_VECTOR_DRIFT');
  const plan = migrationEnvelope(bytes, migration, record.originalStatementVector);
  return {plan,migration};
}

export function runOperation(mode, {databaseUrl = process.env.SUPABASE_DB_URL, runner, sourceSha = process.env.EXPECTED_SOURCE_SHA} = {}) {
  if (!['observe','apply'].includes(mode) || !/^[0-9a-f]{40}$/.test(sourceSha ?? '')) fail('ADMIN_REVISION_ARGUMENT_INVALID');
  assertSuccessorDatabaseTarget(databaseUrl,{projectRef:'aqlcofblfxdrjhhdmarw',databaseName:'postgres'});
  const run = runner ?? createThumbnailPsqlRunner(databaseUrl);
  const {plan,migration} = buildOperation();
  const reconcile = () => jsonLine(run(databaseUrl, reconciliationSql(plan,migration), true));
  const before = reconcile();
  const outcome = reconciliationOutcome(before,migration);
  if (outcome === 'committed') return {sourceSha,migrationSha256:DIGEST,state:'already_committed'};
  if (outcome !== 'not_applied') fail('ADMIN_REVISION_PREIMAGE_DRIFT');
  if (mode === 'observe') return {sourceSha,migrationSha256:DIGEST,state:'ready',before:before.prior};
  if (process.env.APPLY_CONFIRMATION !== `apply:${sourceSha}:${DIGEST}`) fail('ADMIN_REVISION_CONFIRMATION_INVALID');
  const atomic = atomicMigrationSql(plan,migration);
  // Same reviewed SQL and ledger vector; the whole rehearsal always rolls back.
  // The real API rejection and isolated safeupdate probe cover guard behavior.
  // Hosted postgres is not a superuser: preserve authenticator's preload and
  // exercise the patched statement trigger without loading libraries or roles.
  const exercise = 'UPDATE public.restaurants SET review_count=review_count WHERE false;';
  const rehearsal = `BEGIN;
${atomic}
${exercise}
ROLLBACK;`;
  const staged = jsonLine(run(databaseUrl,rehearsal,false));
  const canonical = value => JSON.stringify(Object.fromEntries(Object.keys(value).sort().map(k => [k,value[k]])));
  if (canonical(staged) !== canonical(migration.terminalReadback.expected)) fail('ADMIN_REVISION_REHEARSAL_INVALID');
  const afterRehearsal = reconcile();
  if (reconciliationOutcome(afterRehearsal,migration) !== 'not_applied') fail('ADMIN_REVISION_REHEARSAL_ROLLBACK_INVALID');
  let transport = 'returned';
  try { run(databaseUrl,atomic,true); } catch { transport = 'unconfirmed'; }
  // Never repeat the write after a lost acknowledgement.
  const after = reconcile();
  if (reconciliationOutcome(after,migration) !== 'committed') fail('ADMIN_REVISION_APPLY_UNCONFIRMED');
  return {sourceSha,migrationSha256:DIGEST,state:'committed',transport,rehearsal:'rolled_back',after:after.terminal};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(runOperation(process.argv[2]))); }
  catch (error) {
    const code = /^ADMIN_REVISION_[A-Z_]+$/.test(error?.message ?? '') ? error.message : 'ADMIN_REVISION_OPERATION_FAILED';
    console.error(code);process.exitCode=1;
  }
}
