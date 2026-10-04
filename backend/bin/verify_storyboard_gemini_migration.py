#!/usr/bin/env python3
"""Run only against the task-owned Unix-socket PostgreSQL fixture cluster."""
import argparse
import hashlib
import json
from pathlib import Path
import uuid
import re
import os
from concurrent.futures import ThreadPoolExecutor
import psycopg2

ROOT = Path(__file__).resolve().parents[2]
SOCKET = os.environ.get('TZUDONG_FIXTURE_PG_SOCKET', '/Users/twoimo/.codex/runtime-cache/tzudong-postgresql-15.8/socket')
PORT = int(os.environ.get('TZUDONG_FIXTURE_PG_PORT', '18791'))
if not SOCKET.startswith('/Users/twoimo/.codex/runtime-cache/') or not Path(SOCKET).is_dir():
    raise SystemExit('owned_fixture_socket_required')
parser=argparse.ArgumentParser()
parser.add_argument('--chain',choices=['original','receipt'],default='original')
args=parser.parse_args()
database = 'storyboard_gemini_' + uuid.uuid4().hex
owner = '00000000-0000-4000-8000-111111111111'
admin = psycopg2.connect(host=SOCKET, port=PORT, user='postgres', dbname='postgres')
admin.autocommit = True
phase = 'create_database'
raw = {'kind': 'local-postgresql-storyboard-migration', 'operationalDatabaseChanges': False, 'migrations': [], 'assertions': {}}
try:
    with admin.cursor() as c:
        c.execute('CREATE DATABASE ' + database)
    with psycopg2.connect(host=SOCKET, port=PORT, user='postgres', dbname=database) as conn:
        with conn.cursor() as c:
            c.execute('SHOW server_version')
            raw['postgresVersion'] = c.fetchone()[0]
            phase = 'bootstrap'
            c.execute("SET lc_messages = 'C'")
            c.execute("""
            DO $$ BEGIN
              IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
              IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
              IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
              IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='privacy_workflow_owner') THEN CREATE ROLE privacy_workflow_owner; END IF;
            END $$;
            ALTER ROLE service_role BYPASSRLS;
            CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA privacy_retention;
            CREATE TABLE privacy_retention.g014_public_rpc_allowlist(function_schema name, function_name name, identity_arguments text, grantee name, source_signature text,
              UNIQUE(function_schema,function_name,identity_arguments,grantee), UNIQUE(source_signature,grantee));
            CREATE TABLE auth.users(id uuid PRIMARY KEY);
            CREATE TABLE public.user_roles(user_id uuid, role text);
            CREATE TABLE public.user_account_status(user_id uuid, account_status text);
            CREATE TABLE storage.buckets(id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
            GRANT USAGE ON SCHEMA public,auth,storage TO privacy_workflow_owner;
            GRANT SELECT ON public.user_roles,public.user_account_status,auth.users TO privacy_workflow_owner;
            """)
            c.execute('INSERT INTO auth.users VALUES (%s)', (owner,))
            c.execute("INSERT INTO public.user_roles VALUES (%s,'admin')", (owner,))
            c.execute("INSERT INTO public.user_account_status VALUES (%s,'active')", (owner,))
            conn.commit()
            names = (['20260918021531_storyboard_mlx_worker.sql', '20260920021531_storyboard_historical_restore.sql'] if args.chain=='original' else ['20261003000711_storyboard_production_foundation.sql', '20261003000811_storyboard_historical_restore.sql']) + ['20261003000812_storyboard_gemini_only.sql','20261003182338_storyboard_service_role_bridge.sql']
            for name in names:
                phase = name
                path = ROOT / ('backend/supabase/applied-receipts/storyboard-20261003' if name.startswith(('20261003000711','20261003000811')) else 'backend/supabase/migrations') / name
                content = path.read_bytes()
                c.execute(content.decode())
                conn.commit()
                raw['migrations'].append({'file': name, 'sha256': hashlib.sha256(content).hexdigest()})
            c.execute('GRANT USAGE ON SCHEMA public TO service_role')
            c.execute('SET ROLE service_role')
            phase = 'admission_and_restart'
            request = {'workflow': 'storyboard-mlx-v1', 'requestId': str(uuid.uuid4()), 'prompt': 'synthetic verification', 'sceneCount': 5,
                       'providers': {'externalAI': True, 'text': {'id': 'gemini-api', 'model': 'gemini-3.8-flash'}, 'image': {'id': 'gemini-api', 'model': 'gemini-3.1-flash-image'}}}
            c.execute("SELECT public.storyboard_production_admin(%s,'create',NULL,NULL,%s::jsonb)", (owner, json.dumps(request)))
            initial = c.fetchone()[0]
            assert initial['project']['status'] == 'waiting_worker'
            project = initial['project']['id']
            c.execute("SELECT public.storyboard_production_admin(%s,'create',NULL,NULL,%s::jsonb)", (owner, json.dumps(request)))
            assert c.fetchone()[0]['project']['id'] == project
            raw['assertions']['idempotent_create'] = True
            models = [{'id': 'gemini-3.8-flash', 'owned_by': 'gemini-api', 'capabilities': ['chat'], 'loaded': False, 'bytes_on_disk': 0, 'bytes_resident': 0},
                      {'id': 'gemini-3.1-flash-image', 'owned_by': 'gemini-api', 'capabilities': ['image'], 'loaded': False, 'bytes_on_disk': 0, 'bytes_resident': 0}]
            c.execute("INSERT INTO public.admin_storyboard_production_workers(owner_id,token_sha256,models) VALUES (%s,%s,%s::jsonb) RETURNING id", (owner, '0' * 64, json.dumps(models)))
            worker = str(c.fetchone()[0])
            c.execute("SELECT public.storyboard_production_worker(%s,'claim')", (worker,))
            claimed = c.fetchone()[0]['job']
            assert claimed and claimed['projectId'] == project
            raw['assertions']['remote_models_claim_without_fake_disk_bytes'] = True
            scenes = [{'sceneNo': i + 1, 'title': 'synthetic scene', 'durationSec': 10, 'description': 'fixture', 'visualDirection': 'fixture', 'narration': '', 'caption': '', 'productionNotes': ['fixture'], 'imagePrompt': 'fixture', 'sourceIds': []} for i in range(5)]
            proof = {'providerId': 'gemini-api', 'model': 'gemini-3.8-flash', 'verification': 'official-api', 'generatedAt': '2026-10-03T00:00:00Z', 'requestId': str(uuid.uuid4()), 'responseId': 'synthetic', 'responseModel': 'gemini-3.8-flash', 'modelEvidence': 'response'}
            payload = {'draft': {'title': 'fixture', 'logline': 'fixture', 'scenes': scenes}, 'provenance': proof}
            c.execute("SELECT public.storyboard_production_worker(%s,'draft',%s,%s,%s::jsonb)", (worker, claimed['id'], claimed['leaseToken'], json.dumps(payload)))
            assert c.fetchone()[0]['ok']
            c.execute("SELECT public.storyboard_production_admin(%s,'read',%s)", (owner, project))
            saved = c.fetchone()[0]
            assert len(saved['project']['document']['scenes']) == 5
            raw['assertions']['draft_checkpoint_readback'] = True
            def rejected(call, params, code):
                c.execute('SAVEPOINT expected_failure')
                try:
                    c.execute(call, params)
                except psycopg2.Error as error:
                    c.execute('ROLLBACK TO SAVEPOINT expected_failure')
                    assert code == error.diag.message_primary
                else:
                    raise AssertionError('expected_rejection_missing')
                finally:
                    c.execute('RELEASE SAVEPOINT expected_failure')

            denied = json.loads(json.dumps(request)); denied['requestId'] = str(uuid.uuid4())
            denied['providers']['text'] = {'id': 'local-mlx', 'model': 'legacy'}
            rejected("SELECT public.storyboard_production_admin(%s,'create',NULL,NULL,%s::jsonb)", (owner, json.dumps(denied)), 'provider_not_configured')
            raw['assertions']['non_gemini_create_denied'] = True
            rejected("SELECT public.storyboard_production_worker(%s,'draft',%s,%s,%s::jsonb)", (worker, claimed['id'], str(uuid.uuid4()), json.dumps(payload)), 'worker_lease_lost')
            raw['assertions']['stale_lease_rejected'] = True
            rejected("SELECT public.storyboard_production_worker(%s,'draft',%s,%s,%s::jsonb)", (worker, claimed['id'], claimed['leaseToken'], json.dumps(payload)), 'revision_conflict')
            raw['assertions']['duplicate_result_rejected_without_resend'] = True
            for n in range(1,6):
                asset_id = str(uuid.uuid4())
                image_proof = {**proof, 'model': 'gemini-3.1-flash-image', 'responseModel': 'gemini-3.1-flash-image', 'requestId': str(uuid.uuid4())}
                common = {'sha256':'a'*64, 'width':128,'height':72,'bytes':128}
                asset = {'id':asset_id,'trustPolicy':'storyboard-private-asset-v1',
                         'original':{**common,'path':f'{project}/{asset_id}/original.png','mime':'image/png'},
                         'web':[{**common,'path':f'{project}/{asset_id}/web-128.webp','mime':'image/webp'}], 'provenance':image_proof}
                c.execute("SELECT public.storyboard_production_worker(%s,'image',%s,%s,%s::jsonb)", (worker, claimed['id'], claimed['leaseToken'], json.dumps({'sceneNo':n,'sceneRevision':0,'asset':asset,'provenance':image_proof})))
                assert c.fetchone()[0]['ok']
            c.execute("SELECT public.storyboard_production_worker(%s,'finish',%s,%s)", (worker, claimed['id'], claimed['leaseToken']))
            assert c.fetchone()[0]['ok']
            c.execute("SELECT public.storyboard_production_admin(%s,'read',%s)", (owner, project))
            finished = c.fetchone()[0]
            assert finished['project']['status'] == 'ready' and finished['job']['status'] == 'succeeded'
            assert all(x['image']['provenance']['providerId']=='gemini-api' for x in finished['project']['document']['scenes'])
            raw['assertions']['five_images_checkpoint_and_finish_ready'] = True
            rev = finished['project']['revision']
            edit = {'sceneNo':1,'scene':{**scenes[0],'title':'edited'}}
            rejected("SELECT public.storyboard_production_admin(%s,'edit',%s,%s,%s::jsonb)", (owner, project, rev-1,json.dumps(edit)), 'revision_conflict')
            c.execute("SELECT public.storyboard_production_admin(%s,'edit',%s,%s,%s::jsonb)", (owner, project, rev,json.dumps(edit)))
            edited = c.fetchone()[0]
            assert edited['project']['document']['scenes'][0]['title']=='edited'
            restore = {'targetRevision':rev,'requestId':str(uuid.uuid4())}
            c.execute("SELECT public.storyboard_production_admin(%s,'restore',%s,%s,%s::jsonb)", (owner, project,edited['project']['revision'],json.dumps(restore)))
            restored = c.fetchone()[0]
            assert restored['project']['document']['scenes'][0]['title']=='synthetic scene'
            assert restored['project']['document']['scenes'][0]['image']==finished['project']['document']['scenes'][0]['image']
            c.execute("SELECT public.storyboard_production_admin(%s,'restore',%s,%s,%s::jsonb)", (owner, project,edited['project']['revision'],json.dumps(restore)))
            assert c.fetchone()[0]['project']['revision']==restored['project']['revision']
            raw['assertions']['cas_edit_and_restore_replay_preserve_assets'] = True
            next_request = {**request,'requestId':str(uuid.uuid4())}
            c.execute("SELECT public.storyboard_production_admin(%s,'create',NULL,NULL,%s::jsonb)", (owner, json.dumps(next_request)))
            next_project = c.fetchone()[0]['project']['id']
            c.execute("SELECT public.storyboard_production_worker(%s,'claim')", (worker,))
            next_claim = c.fetchone()[0]['job']; assert next_claim['projectId']==next_project
            c.execute("UPDATE public.admin_storyboard_production_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=%s", (next_claim['id'],))
            c.execute("SELECT public.storyboard_production_worker(%s,'claim')", (worker,))
            assert c.fetchone()[0]['job'] is None
            c.execute("UPDATE public.admin_storyboard_production_jobs SET available_at=clock_timestamp()-interval '1 second' WHERE id=%s", (next_claim['id'],))
            c.execute("SELECT public.storyboard_production_worker(%s,'claim')", (worker,))
            resumed = c.fetchone()[0]['job']; assert resumed['id']==next_claim['id'] and resumed['leaseToken']!=next_claim['leaseToken']
            raw['assertions']['expired_lease_backoff_and_restart'] = True
            c.execute("SELECT public.storyboard_production_admin(%s,'cancel',%s,%s,%s::jsonb)", (owner,next_project,resumed['revision'],json.dumps({'jobId':resumed['id']})))
            assert c.fetchone()[0]['project']['status']=='cancelled'
            raw['assertions']['active_cancel_readback'] = True
            concurrent_request = {**request,'requestId':str(uuid.uuid4())}
            c.execute("SELECT public.storyboard_production_admin(%s,'create',NULL,NULL,%s::jsonb)", (owner,json.dumps(concurrent_request)))
            concurrent_project = c.fetchone()[0]['project']['id']
            c.execute("INSERT INTO public.admin_storyboard_production_workers(owner_id,token_sha256,models) VALUES (%s,%s,%s::jsonb) RETURNING id", (owner, '1'*64,json.dumps(models)))
            second_worker = str(c.fetchone()[0]); conn.commit()
            def claim_once(worker_id):
                with psycopg2.connect(host=SOCKET,port=PORT,user='postgres',dbname=database) as other:
                    with other.cursor() as cursor:
                        cursor.execute("SET ROLE service_role")
                        cursor.execute("SELECT public.storyboard_production_worker(%s,'claim')", (worker_id,))
                        return cursor.fetchone()[0]['job']
            with ThreadPoolExecutor(max_workers=2) as pool:
                concurrent_claims = list(pool.map(claim_once,[worker,second_worker]))
            assert sum(x is not None for x in concurrent_claims)==1
            assert next(x for x in concurrent_claims if x)['projectId']==concurrent_project
            raw['assertions']['concurrent_workers_never_double_claim'] = True
            c.execute("SELECT has_function_privilege('anon','public.storyboard_production_admin(uuid,text,uuid,integer,jsonb)','EXECUTE'), has_function_privilege('authenticated','public.storyboard_production_worker(uuid,text,uuid,uuid,jsonb)','EXECUTE')")
            assert c.fetchone() == (False, False)
            raw['assertions']['browser_roles_denied'] = True
            c.execute("SELECT proconfig FROM pg_proc WHERE oid='public.storyboard_production_worker(uuid,text,uuid,uuid,jsonb)'::regprocedure")
            assert 'search_path=""' in c.fetchone()[0]
            raw['assertions']['empty_search_path_preserved'] = True
            c.execute("SELECT has_table_privilege('service_role','public.user_roles','SELECT'),has_table_privilege('service_role','public.user_account_status','SELECT')")
            assert c.fetchone()==(False,False)
            raw['assertions']['existing_auth_table_grants_unchanged'] = True
            c.execute('RESET ROLE')
            data_tables=['projects','workers','jobs','assets','events','revisions','restores']
            def row_state():
                values=[]
                for suffix in data_tables:
                    c.execute("SELECT coalesce(jsonb_agg(to_jsonb(item) ORDER BY to_jsonb(item)::text),'[]'::jsonb) FROM public.admin_storyboard_production_"+suffix+' item')
                    values.append(c.fetchone()[0])
                return hashlib.sha256(json.dumps(values,sort_keys=True).encode()).hexdigest()
            before_bridge=row_state()
            c.execute((ROOT/'backend/supabase/migrations/20261003182338_storyboard_service_role_bridge.sql').read_text())
            after_bridge=row_state()
            assert after_bridge==before_bridge
            raw['bridgeDataSha256']={'before':before_bridge,'after':after_bridge,'tables':len(data_tables)}
            raw['assertions']['bridge_reapply_preserves_all_seven_data_tables']=True
            c.execute("SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND prosecdef")
            assert c.fetchone()[0]==0
            raw['assertions']['legacy_public_definers_removed']=True
            c.execute("SELECT pg_get_functiondef('public.storyboard_production_auth_worker(text)'::regprocedure)")
            definition=c.fetchone()[0]
            phase='bridge_body_drift'
            assert 'RETURN jsonb_build_object' in definition
            c.execute(definition.replace('RETURN jsonb_build_object', '-- deliberate fixture drift\n  RETURN jsonb_build_object',1))
            catalog_before=raw['bridgeDataSha256']['after']
            try:
                c.execute((ROOT/'backend/supabase/migrations/20261003182338_storyboard_service_role_bridge.sql').read_text())
                raise AssertionError('unexpected_bridge_drift_admission')
            except psycopg2.Error as error:
                assert 'STORYBOARD_BRIDGE_BODY_DRIFT' in str(error)
                conn.rollback()
            assert row_state()==catalog_before
            raw['assertions']['unknown_installed_body_fails_and_rolls_back']=True
            phase='uncertain_lease_recovery'
            uncertainty=ROOT/'backend/supabase/migrations/20261003205335_storyboard_uncertain_lease_recovery.sql'
            c.execute(uncertainty.read_text())
            c.execute("INSERT INTO public.admin_storyboard_production_workers(owner_id,token_sha256,models) VALUES (%s,%s,%s::jsonb) RETURNING id",(owner,'2'*64,json.dumps(models)))
            uncertainty_worker=str(c.fetchone()[0])
            uncertain_request={**request,'requestId':str(uuid.uuid4())}
            c.execute("SELECT public.storyboard_production_admin(%s,'create',NULL,NULL,%s::jsonb)",(owner,json.dumps(uncertain_request)))
            uncertain_project=c.fetchone()[0]['project']['id']
            c.execute("SELECT public.storyboard_production_worker(%s,'claim')",(uncertainty_worker,))
            uncertain_claim=c.fetchone()[0]['job'];assert uncertain_claim['projectId']==uncertain_project
            c.execute("UPDATE public.admin_storyboard_production_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=%s",(uncertain_claim['id'],))
            for _ in range(3):
                c.execute("SELECT public.storyboard_production_worker(%s,'claim')",(uncertainty_worker,))
                assert c.fetchone()[0]['job'] is None
            c.execute('SELECT status,stage,attempts FROM public.admin_storyboard_production_jobs WHERE id=%s',(uncertain_claim['id'],))
            assert c.fetchone()==('failed','uncertain',1)
            raw['assertions']['expired_claim_never_requeues_paid_generation']=True
            c.execute("SELECT public.storyboard_production_admin(%s,'read',%s)",(owner,uncertain_project))
            uncertain_view=c.fetchone()[0]
            c.execute("SELECT public.storyboard_production_admin(%s,'retry',%s,%s,%s::jsonb)",(owner,uncertain_project,uncertain_view['project']['revision'],json.dumps({'requestId':str(uuid.uuid4())})))
            retried=c.fetchone()[0]
            assert retried['job']['id']!=uncertain_claim['id']
            c.execute("SELECT public.storyboard_production_worker(%s,'claim')",(uncertainty_worker,))
            assert c.fetchone()[0]['job']['id']==retried['job']['id']
            raw['assertions']['explicit_operator_retry_creates_one_fresh_job']=True
            raw['migrations'].append({'file':uncertainty.name,'sha256':hashlib.sha256(uncertainty.read_bytes()).hexdigest()})
            phase='compatible_claim_after_incompatible_queue'
            c.execute("INSERT INTO public.admin_storyboard_production_workers(owner_id,token_sha256,models) VALUES (%s,%s,%s::jsonb) RETURNING id",(owner,'3'*64,json.dumps(models)))
            capability_worker=str(c.fetchone()[0])
            incompatible={**request,'providers':{**request['providers'],'image':{'id':'gemini-api','model':'gemini-3-pro-image'}}}
            for _ in range(65):
                queued={**incompatible,'requestId':str(uuid.uuid4())}
                c.execute("SELECT public.storyboard_production_admin(%s,'create',NULL,NULL,%s::jsonb)",(owner,json.dumps(queued)))
                c.fetchone()
            compatible={**request,'requestId':str(uuid.uuid4())}
            c.execute("SELECT public.storyboard_production_admin(%s,'create',NULL,NULL,%s::jsonb)",(owner,json.dumps(compatible)))
            compatible_project=c.fetchone()[0]['project']['id']
            c.execute("SELECT public.storyboard_production_worker(%s,'claim')",(capability_worker,))
            assert c.fetchone()[0]['job'] is None
            c.execute("SELECT count(*) FROM public.admin_storyboard_production_jobs WHERE status='queued'")
            queue_before=c.fetchone()[0]
            c.execute("SELECT proowner,proacl,prosecdef,proconfig,provolatile,proparallel FROM pg_proc WHERE oid='public.storyboard_production_worker(uuid,text,uuid,uuid,jsonb)'::regprocedure")
            metadata_before=c.fetchone()
            capability=ROOT/'backend/supabase/migrations/20261004023841_storyboard_claim_capability_order.sql'
            c.execute(capability.read_text())
            c.execute("SELECT proowner,proacl,prosecdef,proconfig,provolatile,proparallel FROM pg_proc WHERE oid='public.storyboard_production_worker(uuid,text,uuid,uuid,jsonb)'::regprocedure")
            assert c.fetchone()==metadata_before
            c.execute("SELECT public.storyboard_production_worker(%s,'claim')",(capability_worker,))
            compatible_claim=c.fetchone()[0]['job']
            assert compatible_claim and compatible_claim['projectId']==compatible_project
            c.execute("SELECT count(*) FROM public.admin_storyboard_production_jobs WHERE status='queued'")
            assert c.fetchone()[0]==queue_before-1
            raw['assertions']['compatible_job_after_65_incompatible_jobs_is_claimed']=True
            raw['assertions']['capability_filter_preserves_rpc_metadata_and_incompatible_jobs']=True
            raw['migrations'].append({'file':capability.name,'sha256':hashlib.sha256(capability.read_bytes()).hexdigest()})
            raw['claimAdmission']={'incompatibleAhead':65,'compatibleJobs':1,'beforeClaimed':0,'afterClaimed':1,'realProviderCalls':0}
            raw['passed'] = True
            raw['limitations'] = ['Synthetic fixture database only.', 'Real Supabase Storage object upload/download and provider inference are separate tests; fixture asset metadata only.']
    out = ROOT / 'apps/web/performance/ui-renewal-20261003' / f'storyboard-claim-capability-{args.chain}-20261004.json'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(raw, indent=2) + '\n')
    print(json.dumps({'passed': True, 'assertions': list(raw['assertions']), 'operationalDatabaseChanges': False}))
except Exception as error:
    relation = re.search(r'relation "([a-z_.]+)" does not exist', str(error))
    print(json.dumps({'passed': False, 'phase': phase, 'sqlstate': getattr(error, 'pgcode', None), 'errorType': type(error).__name__, 'missingRelation': relation.group(1) if relation else None}))
    raise SystemExit(1)
finally:
    with admin.cursor() as c:
        c.execute('DROP DATABASE IF EXISTS ' + database + ' WITH (FORCE)')
    admin.close()
