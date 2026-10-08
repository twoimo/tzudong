import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const root = new URL('../../../../', import.meta.url);
const source = readFileSync(new URL('backend/supabase/migrations/20261008084856_public_profile_leaderboard_read_boundary.sql', root),'utf8');
const begin = source.indexOf('CREATE FUNCTION public.read_public_profile_leaderboard_page(');
const definition = source.slice(begin,source.indexOf('    $definition$;',begin)).replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION');
const rpcBody = definition.split('AS $profile_leaderboard_page$')[1].split('$profile_leaderboard_page$;')[0];
function run(sql, role='supabase_admin') {return spawnSync('/opt/homebrew/bin/docker',['--context','colima-tzudong-catalog-20261007','exec','-i','-e','PGPASSWORD=fixture-only','tzudong-ranking-clone-20261008','psql','-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-h','127.0.0.1','-U',role,'-d','ranking_clone'],{input:sql,encoding:'utf8',timeout:30000});}
const state = `SELECT jsonb_build_object('members',(SELECT md5(jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor)::text) FROM pg_auth_members m),'rpc',(SELECT md5(to_jsonb(p)::text) FROM pg_proc p WHERE oid='public.read_public_profile_leaderboard_page(text,integer,numeric,uuid)'::regprocedure));`;
const result={kind:'isolated-wrong-existing-contract',operatingWrites:false,userRowsCopied:0};
try {
 const wrong=run(definition.replace(rpcBody,'\nBEGIN\n RETURN;\nEND\n'));if(wrong.status)throw Error('FIXTURE_FAILED');
 const before=run(state).stdout;
 const denied=run(source,'postgres');result.denied=denied.status!==0&&denied.stderr.includes('public_profile_leaderboard_existing_contract_drift');
 result.statePreserved=before===run(state).stdout;
 if(!result.denied||!result.statePreserved)throw Error('CONFLICT_ADMITTED');
 result.wrongBodyDenied=result.denied;
 if(run(definition).status) throw Error('RESTORE_FAILED');
 if(run('ALTER FUNCTION public.read_public_profile_leaderboard_page(text,integer,numeric,uuid) STRICT;').status) throw Error('STRICT_FIXTURE_FAILED');
 const strictBefore=run(state).stdout;
 const strictDenied=run(source,'postgres');
 result.strictDenied=strictDenied.status!==0 && strictDenied.stderr.includes('public_profile_leaderboard_existing_contract_drift');
 result.strictStatePreserved=strictBefore===run(state).stdout;
 if(!result.strictDenied||!result.strictStatePreserved) throw Error('STRICT_DRIFT_ADMITTED');
 result.status='passed';
} catch(e) {result.status='failed';result.code=/^[A-Z_]+$/.test(e.message)?e.message:'LOCAL_UNCONFIRMED';process.exitCode=2;}
finally {result.originalDefinitionRestored=run(definition).status===0;}
writeFileSync(new URL('ranking-conflict-v2.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
