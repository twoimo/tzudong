import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const root = new URL('../../../../', import.meta.url);
const migration = new URL('backend/supabase/migrations/20261008084856_public_profile_leaderboard_read_boundary.sql', root);
const fixture = new URL('backend/supabase/tests/public_profile_leaderboard_hosted.sql', root);
const context = 'colima-tzudong-catalog-20261007';
const container = 'tzudong-ranking-clone-20261008';
const database = 'ranking_clone';
const receipts = [];
const sha = b => createHash('sha256').update(b).digest('hex');
function run(stage, sql, role = 'supabase_admin', expectedFailure = false) {
  const r = spawnSync('/opt/homebrew/bin/docker', ['--context', context, 'exec', '-i', '-e', 'PGPASSWORD=fixture-only', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-h', '127.0.0.1', '-U', role, '-d', database], { input: sql, encoding: 'utf8', timeout: 60000, maxBuffer: 4000000 });
  receipts.push({ stage, status: r.status === 0 ? 'passed' : 'failed', expectedFailure, sqlState: r.stderr?.match(/ERROR:\s+([A-Z0-9]{5})/)?.[1] ?? null, fixedCode: (r.stderr??'').match(/(?:(?:public_profile_leaderboard|local_profile_page)_[a-z_]+|G014 [A-Za-z -]+(?=:|\n))/)?.[0]??null, assertion: ['assert_g014_public_rpc_allowlist','assert_g014_definer_contract','assert_g014_catalog_contract'].find(n=>(r.stderr??'').includes(n))??null });
  if (r.error || (r.status !== 0 && !expectedFailure)) throw Error('LOCAL_STAGE_FAILED');
  if (expectedFailure && r.status === 0) throw Error('DUPLICATE_MIGRATION_ADMITTED');
  return r.stdout;
}
const stateSQL = `SELECT jsonb_build_object('memberHash',(SELECT encode(sha256(convert_to(jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor)::text,'UTF8')),'hex') FROM pg_auth_members m),'manifestHash',(SELECT encode(sha256(convert_to(jsonb_agg(to_jsonb(m) ORDER BY manifest_kind,manifest_key)::text,'UTF8')),'hex') FROM privacy_retention.g014_catalog_contract_manifest m),'functionHash',(SELECT encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') FROM pg_proc p WHERE p.oid=to_regprocedure('public.read_public_profile_leaderboard_page(text,integer,numeric,uuid)')),'present',to_regprocedure('public.read_public_profile_leaderboard_page(text,integer,numeric,uuid)') IS NOT NULL,'postgresSuperuser',(SELECT rolsuper FROM pg_roles WHERE rolname='postgres'),'ownerSet',pg_has_role('postgres','privacy_workflow_owner','SET'));`;
const result = { kind: 'isolated-ranking-rpc', observedAt: new Date().toISOString(), operatingWrites: false, userRowsCopied: 0, receipts };
try {
  const source = readFileSync(migration, 'utf8');
  result.sourceSha256 = sha(source);
  result.fixtureSha256 = sha(readFileSync(fixture));
  result.serverVersion = run('version', "SELECT current_setting('server_version');").trim();
  const before = JSON.parse(run('before', stateSQL));
  if (before.postgresSuperuser || before.ownerSet) throw Error('BASELINE_DENIED');
  const rollback = JSON.parse(run('transaction-rollback', 'BEGIN;\n' + source.replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, '') + '\nROLLBACK;\n' + stateSQL, 'postgres').trim().split('\n').at(-1));
  if (JSON.stringify(before) !== JSON.stringify(rollback)) throw Error('ROLLBACK_DRIFT');
  result.rollbackExact = true;
  const after = JSON.parse(run('apply', source + '\n' + stateSQL, 'postgres').trim().split('\n').at(-1));
  if (!after.present || before.memberHash !== after.memberHash || before.manifestHash !== after.manifestHash || after.postgresSuperuser || after.ownerSet) throw Error('APPLY_STATE_DRIFT');
  if (before.present && before.functionHash !== after.functionHash) throw Error('EXISTING_RPC_CHANGED');
  result.existingRpcPreserved = !before.present || before.functionHash === after.functionHash;
  result.membershipRestored = true;
  result.immutableManifestPreserved = true;
  run('full-g014-contracts', 'BEGIN READ ONLY; SET LOCAL row_security=on; SELECT privacy_retention.assert_g014_workflow_owner_contract(); SELECT privacy_retention.assert_g014_public_rpc_allowlist(); SELECT privacy_retention.assert_g014_definer_contract(); SELECT privacy_retention.assert_g014_catalog_contract(); ROLLBACK;');
  run('synthetic-role-cursor-period-fixture', readFileSync(fixture, 'utf8'));
  run('compatible-existing-idempotence', source, 'postgres');
  const repeated = JSON.parse(run('repeat-readback', stateSQL));
  if (JSON.stringify(after) !== JSON.stringify(repeated)) throw Error('REPEAT_STATE_DRIFT');
  result.status = 'passed';
} catch (e) { result.status = 'failed'; result.code = /^[A-Z_]+$/.test(e.message) ? e.message : 'LOCAL_UNCONFIRMED'; process.exitCode = 2; }
writeFileSync(new URL('ranking-sql-v10-missing-final.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
