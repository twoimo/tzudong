#!/usr/bin/env python3
"""Isolated PostgreSQL verification. Synthetic rows; no hosted access."""
from pathlib import Path
import copy
import hashlib
import json
import os
import argparse
import platform
import random
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
import psycopg2
from psycopg2.extras import Json

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / 'backend/supabase/migrations/20261003081915_restaurant_review_automation.sql'
MANUAL_MIGRATION = ROOT / 'backend/supabase/migrations/20261003171449_restaurant_review_manual_guards.sql'
CLAIM_MIGRATION = ROOT / 'backend/supabase/migrations/20261003193717_restaurant_review_claim_progress.sql'


def main(argv=None):
    parser=argparse.ArgumentParser()
    parser.add_argument('--benchmark',action='store_true')
    parser.add_argument('--manual-guards',action='store_true')
    args=parser.parse_args(argv)
    params = dict(host=os.environ.get('TZUDONG_TEST_PG_SOCKET', str(Path.home()/'.codex/runtime-cache/tzudong-postgresql-17.6/socket')),
                  port=int(os.environ.get('TZUDONG_TEST_PG_PORT', '18797')), user='postgres')
    database = 'review_auto_' + uuid.uuid4().hex
    admin = psycopg2.connect(dbname='postgres', **params)
    admin.autocommit = True
    checks = {}
    connection = None
    try:
        with admin.cursor() as cursor:
            cursor.execute('CREATE DATABASE ' + database + " ENCODING 'UTF8' TEMPLATE template0")
        connection = psycopg2.connect(dbname=database, **params)
        connection.autocommit = True
        connection.set_client_encoding('UTF8')
        cursor = connection.cursor()
        cursor.execute('SHOW server_version')
        version = cursor.fetchone()[0]
        cursor.execute("CREATE SCHEMA pipeline_control; CREATE SCHEMA privacy_retention; GRANT USAGE ON SCHEMA pipeline_control,privacy_retention TO service_role;")
        cursor.execute("CREATE TABLE privacy_retention.g014_public_rpc_allowlist(function_schema name,function_name name,identity_arguments text,grantee name,source_signature text,UNIQUE(source_signature,grantee));")
        cursor.execute((ROOT/'backend/supabase/migrations/20260124_create_restaurants.sql').read_text())
        cursor.execute("ALTER TABLE public.restaurants ADD COLUMN google_name text; CREATE TABLE public.user_roles(user_id uuid,role text); CREATE TABLE public.user_account_status(user_id uuid,account_status text);")
        cursor.execute("CREATE TABLE pipeline_control.admin_evaluation_catalog_revision(singleton boolean PRIMARY KEY,revision bigint); INSERT INTO pipeline_control.admin_evaluation_catalog_revision VALUES(true,1); GRANT SELECT,UPDATE ON pipeline_control.admin_evaluation_catalog_revision TO service_role; GRANT SELECT,UPDATE ON public.restaurants TO service_role;")
        cursor.execute("CREATE FUNCTION public.admin_evaluation_revision() RETURNS text LANGUAGE sql AS 'SELECT revision::text FROM pipeline_control.admin_evaluation_catalog_revision'; CREATE FUNCTION public.extract_youtube_video_id(text) RETURNS text LANGUAGE sql IMMUTABLE AS 'SELECT nullif(split_part($1,''v='',2),'''')'; CREATE FUNCTION public.normalize_restaurant_identity_name(text) RETURNS text LANGUAGE sql IMMUTABLE AS 'SELECT lower(btrim($1))';")
        cursor.execute(MIGRATION.read_text())
        if args.manual_guards:
            cursor.execute(MANUAL_MIGRATION.read_text())
            cursor.execute(CLAIM_MIGRATION.read_text())
        actor = str(uuid.uuid4())
        cursor.execute('INSERT INTO public.user_roles VALUES(%s,\'admin\'); INSERT INTO public.user_account_status VALUES(%s,\'active\')', (actor,actor))
        row = dict(id=str(uuid.uuid4()),status='pending',origin_name='합성 식당',approved_name='합성 식당',naver_name='합성 식당',trace_id='fixture-1',youtube_link='https://www.youtube.com/watch?v=ABCDEFGHIJK',
                   lat=37.5,lng=127,geocoding_success=True,jibun_address='합성 지번 주소',categories=['한식'],tzuyang_review='합성 리뷰',evaluation_results={
            **{key:dict(eval_value=1,eval_basis='합성 검증 근거') for key in ['visit_authenticity','rb_inference_score','review_faithfulness_score']},
            'rb_grounding_TF':dict(eval_value=True,eval_basis='합성 검증 근거'),'category_validity_TF':dict(eval_value=True),'category_TF':dict(eval_value=True),
            'location_match_TF':dict(eval_value=True,match_status='matched',evidence_families=['source_geo','provider_candidate'])})
        def scalar(query, params=()):
            cursor.execute(query,params); return cursor.fetchone()[0]
        def classify(value): return scalar('SELECT pipeline_control.restaurant_review_classify(%s)',(Json(value),))
        def changed(path,value):
            result=copy.deepcopy(row); target=result
            for key in path[:-1]:target=target[key]
            target[path[-1]]=value; return result
        checks['strict_valid_approval']=classify(row)=='approve:all_checks_passed'
        for key in ['visit_authenticity','rb_inference_score','review_faithfulness_score','rb_grounding_TF','category_validity_TF','category_TF']:
            checks['missing_'+key]=classify(changed(['evaluation_results',key,'eval_value'],None)).startswith('recheck:')
            checks['failed_'+key]=classify(changed(['evaluation_results',key,'eval_value'],False if key in ['rb_grounding_TF','category_validity_TF','category_TF'] else 2)).startswith('hold:')
        for key in ['visit_authenticity','rb_inference_score','review_faithfulness_score','rb_grounding_TF']:
            checks['basis_'+key]=classify(changed(['evaluation_results',key,'eval_basis'],'-'))=='recheck:missing_basis'
        for key,value in [('updated_by_admin_id',actor),('created_by',actor),('status','hold'),('status','approved'),('status','deleted')]:
            checks['protected_'+key+'_'+str(value)]=classify(changed([key],value)).startswith('protected:')
        checks['location_ambiguous']=classify(changed(['evaluation_results','location_match_TF','pending_reason'],'ambiguous_chain')).startswith('hold:')
        checks['one_independent_family']=classify(changed(['evaluation_results','location_match_TF','evidence_families'],['source_geo','llm_verification'])).startswith('hold:')
        checks['string_coordinate_denied']=classify(changed(['lat'],'37.5')).startswith('hold:')
        checks['invalid_coordinate_denied']=classify(changed(['lat'],91)).startswith('hold:')
        checks['summary_projection_denied']=classify(dict(row,evaluation_results=None,read_summary=dict(evaluation_issues=[]))).startswith('hold:')
        cursor.execute('INSERT INTO public.restaurants SELECT * FROM jsonb_populate_record(NULL::public.restaurants,%s)',(Json(row),))
        cursor.execute('SET ROLE service_role')
        preview=scalar('SELECT public.restaurant_review_automation_preview(%s,50,50)',(actor,))
        snapshot=scalar('SELECT public.restaurant_review_automation_configure(%s,\'start\',%s,%s,50,50)',(actor,preview['version'],preview['previewHash']))
        checks['policy_persisted_readback']=snapshot['policy']['enabled'] is True
        request_id=str(uuid.uuid4())
        run=scalar('SELECT public.restaurant_review_automation_tick(%s)',(request_id,))
        checks['one_approval']=run['approved']==1 and run['scanned']==1
        checks['same_request_replay']=scalar('SELECT public.restaurant_review_automation_tick(%s)',(request_id,))==run
        checks['unchanged_second_tick']=scalar('SELECT public.restaurant_review_automation_tick(%s)',(str(uuid.uuid4()),))['approved']==0
        after=scalar('SELECT to_jsonb(restaurant) FROM public.restaurants restaurant WHERE id=%s',(row['id'],))
        checks['admin_and_trace_preserved']=after['trace_id']==row['trace_id'] and after['origin_name']==row['origin_name'] and after['evaluation_results']==row['evaluation_results'] and after['updated_by_admin_id']==actor
        checks['audit_contains_no_row_payload']=all('evaluation_results' not in item and 'origin_address' not in item for item in scalar('SELECT public.restaurant_review_automation_status()')['items'])
        def denied(query,params=()):
            try: scalar(query,params); return False
            except psycopg2.Error: return True
        checks['stale_preview_denied']=denied('SELECT public.restaurant_review_automation_configure(%s,\'start\',%s,%s,50,50)',(actor,preview['version'],preview['previewHash']))
        def insert(index, modify=None):
            value=copy.deepcopy(row)
            value.update(id=str(uuid.uuid4()),trace_id='fixture-'+str(index),origin_name='합성 식당 '+str(index),approved_name='합성 식당 '+str(index),naver_name='합성 식당 '+str(index),
                         youtube_link='https://www.youtube.com/watch?v='+str(index).zfill(11),jibun_address='합성 지번 '+str(index),lat=37+index/1000,lng=127+index/1000)
            if modify: modify(value)
            cursor.execute('RESET ROLE')
            cursor.execute('INSERT INTO public.restaurants SELECT * FROM jsonb_populate_record(NULL::public.restaurants,%s)',(Json(value),))
            cursor.execute('SET ROLE service_role')
            return value
        def tick(): return scalar('SELECT public.restaurant_review_automation_tick(%s)',(str(uuid.uuid4()),))
        def worker(action,item=None,token=None,result=None):
            return scalar('SELECT public.restaurant_review_automation_worker(%s,%s,%s,%s)',(action,item,token,Json(result or {})))
        held=insert(2,lambda value:value['evaluation_results']['visit_authenticity'].update(eval_value=2))
        checks['hold_persisted']=tick()['held']==1 and scalar('SELECT status FROM public.restaurants WHERE id=%s',(held['id'],))=='hold'
        dup=insert(3)
        cursor.execute('RESET ROLE')
        other=copy.deepcopy(dup); other.update(id=str(uuid.uuid4()),trace_id='duplicate-fixture')
        cursor.execute('INSERT INTO public.restaurants SELECT * FROM jsonb_populate_record(NULL::public.restaurants,%s)',(Json(other),))
        cursor.execute('SET ROLE service_role')
        duplicate_run=tick()
        checks['duplicate_approval_zero']=duplicate_run['approved']==0 and duplicate_run['held']==2
        recheck=insert(4,lambda value:value['evaluation_results']['visit_authenticity'].update(eval_basis=''))
        checks['incomplete_queued']=tick()['recheck']==1
        token=str(uuid.uuid4()); claim=worker('claim',token=token)
        checks['claim_has_original_trace']=claim['restaurant']['trace_id']==recheck['trace_id']
        checks['second_worker_blocked']=worker('claim',token=str(uuid.uuid4())) is None
        checks['wrong_worker_token_denied']=denied('SELECT public.restaurant_review_automation_worker(\'complete\',%s,%s,%s)',(claim['id'],str(uuid.uuid4()),Json({'evaluation_results':row['evaluation_results']})))
        checks['extra_write_fields_denied']=denied('SELECT public.restaurant_review_automation_worker(\'complete\',%s,%s,%s)',(claim['id'],token,Json({'status':'approved','evaluation_results':row['evaluation_results']})))
        complete=worker('complete',claim['id'],token,{'evaluation_results':row['evaluation_results']})
        checks['recheck_readback_success']=complete['state']=='succeeded'
        checks['completion_replay_idempotent']=worker('complete',claim['id'],token,{'evaluation_results':row['evaluation_results']})==complete
        checks['recheck_then_auto_approve']=tick()['approved']==1
        edited=insert(5,lambda value:value['evaluation_results']['visit_authenticity'].update(eval_basis=''))
        tick(); token2=str(uuid.uuid4()); claim2=worker('claim',token=token2)
        cursor.execute('RESET ROLE')
        cursor.execute('UPDATE public.restaurants SET updated_by_admin_id=%s,approved_name=\'관리자 확정명\' WHERE id=%s',(actor,edited['id']))
        cursor.execute('SET ROLE service_role')
        checks['edit_during_recheck_cancelled']=worker('complete',claim2['id'],token2,{'evaluation_results':row['evaluation_results']})['state']=='cancelled'
        checks['admin_edit_and_old_evidence_preserved']=scalar('SELECT approved_name FROM public.restaurants WHERE id=%s',(edited['id'],))=='관리자 확정명' and scalar('SELECT evaluation_results FROM public.restaurants WHERE id=%s',(edited['id'],))==edited['evaluation_results']
        expired=insert(6,lambda value:value['evaluation_results']['visit_authenticity'].update(eval_basis=''))
        tick(); token3=str(uuid.uuid4()); claim3=worker('claim',token=token3)
        cursor.execute('RESET ROLE');cursor.execute("UPDATE pipeline_control.restaurant_review_items SET lease_until=now()-interval '1 second' WHERE id=%s",(claim3['id'],));cursor.execute('SET ROLE service_role')
        checks['expired_not_redispatched']=worker('claim',token=str(uuid.uuid4())) is None
        checks['expired_marked_failed']=scalar('SELECT state FROM pipeline_control.restaurant_review_items WHERE id=%s',(claim3['id'],))=='failed'
        waiting=insert(7,lambda value:value['evaluation_results']['visit_authenticity'].update(eval_basis=''))
        tick(); token4=str(uuid.uuid4()); claim4=worker('claim',token=token4)
        current=scalar('SELECT public.restaurant_review_automation_status()')
        stopped=scalar('SELECT public.restaurant_review_automation_configure(%s,\'stop\',%s,\'\',50,50)',(actor,str(current['policy']['version'])))
        checks['stop_cancels_running_and_queued']=stopped['queue']['running']==0 and stopped['queue']['queued']==0
        checks['stop_denies_late_completion']=worker('complete',claim4['id'],token4,{'evaluation_results':row['evaluation_results']}).get('disabled') is True
        checks['disabled_tick_no_writes']=tick().get('disabled') is True
        preview2=scalar('SELECT public.restaurant_review_automation_preview(%s,50,1)',(actor,))
        scalar('SELECT public.restaurant_review_automation_configure(%s,\'start\',%s,%s,50,1)',(actor,preview2['version'],preview2['previewHash']))
        limited=insert(8)
        checks['daily_limit_enforced']=tick()['approved']==0 and scalar('SELECT status FROM public.restaurants WHERE id=%s',(limited['id'],))=='pending'
        cursor.execute('RESET ROLE');cursor.execute("UPDATE pipeline_control.restaurant_review_runs SET started_at=now()-interval '2 days'");cursor.execute('SET ROLE service_role')
        checks['next_day_budget_reset']=tick()['approved']==1
        cursor.execute('RESET ROLE')
        cursor.execute("UPDATE public.user_account_status SET account_status='disabled' WHERE user_id=%s",(actor,))
        cursor.execute('SET ROLE service_role')
        checks['disabled_operator_denied']=denied('SELECT public.restaurant_review_automation_tick(%s)',(str(uuid.uuid4()),))
        cursor.execute('RESET ROLE');cursor.execute("UPDATE public.user_account_status SET account_status='active' WHERE user_id=%s",(actor,));cursor.execute('SET ROLE service_role')
        preview3=scalar('SELECT public.restaurant_review_automation_preview(%s,3,50)',(actor,))
        scalar('SELECT public.restaurant_review_automation_configure(%s,\'start\',%s,%s,3,50)',(actor,preview3['version'],preview3['previewHash']))
        for index in range(20,24): insert(index)
        simultaneous_id=str(uuid.uuid4())
        def concurrent_tick(_):
            other_connection=psycopg2.connect(dbname=database,**params);other_connection.autocommit=True
            try:
                with other_connection.cursor() as other_cursor:
                    other_cursor.execute('SET ROLE service_role');other_cursor.execute('SELECT public.restaurant_review_automation_tick(%s)',(simultaneous_id,));return other_cursor.fetchone()[0]
            finally:other_connection.close()
        with ThreadPoolExecutor(max_workers=2) as executor: concurrent=list(executor.map(concurrent_tick,range(2)))
        checks['concurrent_same_id_single_run']=concurrent[0]==concurrent[1]
        checks['batch_bound_three']=concurrent[0]['scanned']==3 and concurrent[0]['approved']==3
        remaining_run=tick()
        checks['batch_resume_without_omission']=remaining_run['approved']==1
        rollback_row=insert(24)
        cursor.execute('RESET ROLE')
        cursor.execute("CREATE FUNCTION pipeline_control.fixture_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture'; END; $$; CREATE TRIGGER fixture_failure BEFORE UPDATE ON public.restaurants FOR EACH ROW EXECUTE FUNCTION pipeline_control.fixture_fail();")
        cursor.execute('SET ROLE service_role')
        before=scalar('SELECT count(*) FROM pipeline_control.restaurant_review_runs')
        checks['failed_mutation_rollback']=denied('SELECT public.restaurant_review_automation_tick(%s)',(str(uuid.uuid4()),)) and scalar('SELECT count(*) FROM pipeline_control.restaurant_review_runs')==before and scalar('SELECT status FROM public.restaurants WHERE id=%s',(rollback_row['id'],))=='pending'
        cursor.execute('RESET ROLE');cursor.execute('DROP TRIGGER fixture_failure ON public.restaurants');cursor.execute('SET ROLE service_role')
        checks['rollback_resume_approves_once']=tick()['approved']==1
        cursor.execute('RESET ROLE')
        for role in ['anon','authenticated']:
            cursor.execute('SET ROLE '+role)
            checks[role+'_rpc_denied']=denied('SELECT public.restaurant_review_automation_status()')
            checks[role+'_private_table_denied']=denied('SELECT count(*) FROM pipeline_control.restaurant_review_policy')
            cursor.execute('RESET ROLE')
        checks['public_security_definers_zero']=scalar("SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND prosecdef")==0
        if args.manual_guards:
            cursor.execute('TRUNCATE pipeline_control.restaurant_review_items,pipeline_control.restaurant_review_runs,public.restaurants CASCADE')
            cursor.execute('UPDATE pipeline_control.restaurant_review_policy SET enabled=true,operator_id=%s,version=version+1,batch_size=2,daily_limit=1',(actor,))
            first=insert(100); second=insert(101); third=insert(102)
            late_hold=insert(103,lambda value:value['evaluation_results']['visit_authenticity'].update(eval_value=2))
            late_recheck=insert(104,lambda value:value['evaluation_results']['visit_authenticity'].update(eval_basis=''))
            cursor.execute('RESET ROLE')
            for index,value in enumerate([first,second,third,late_hold,late_recheck]):
                cursor.execute("UPDATE public.restaurants SET created_at=now()-interval '1 day'+%s*interval '1 second' WHERE id=%s",(index,value['id']))
            cursor.execute('SET ROLE service_role')
            checks['manual_daily_limit_one']=tick()['approved']==1
            capped=tick()
            checks['daily_cap_does_not_starve_later_work']=capped['approved']==0 and capped['held']==1 and capped['recheck']==1
            def manual(action,preview=None,request=None):
                return scalar('SELECT public.restaurant_review_automation_manual(%s,%s,%s,%s,%s)',
                              (actor,action,(preview or {}).get('version',''),(preview or {}).get('previewHash',''),request))
            capped_preview=manual('preview-run')
            checks['preview_respects_daily_cap']=capped_preview['remainingApprovals']==0 and capped_preview['counts'].get('approve',0)==0
            cursor.execute('RESET ROLE')
            cursor.execute('UPDATE pipeline_control.restaurant_review_policy SET daily_limit=200,version=version+1')
            cursor.execute('SET ROLE service_role')
            preview=manual('preview-run'); runs_before=scalar('SELECT count(*) FROM pipeline_control.restaurant_review_runs')
            checks['manual_preview_is_read_only']=scalar('SELECT count(*) FROM pipeline_control.restaurant_review_runs')==runs_before
            cursor.execute('UPDATE pipeline_control.admin_evaluation_catalog_revision SET revision=revision+1')
            checks['manual_changed_source_denied']=denied('SELECT public.restaurant_review_automation_manual(%s,\'run\',%s,%s,%s)',(actor,preview['version'],preview['previewHash'],str(uuid.uuid4())))
            checks['stale_manual_has_no_run']=scalar('SELECT count(*) FROM pipeline_control.restaurant_review_runs')==runs_before
            preview=manual('preview-run'); request_id=str(uuid.uuid4())
            manual_result=manual('run',preview,request_id)
            checks['manual_run_readback']=manual_result['run']['approved']==2 and manual_result['policy']['enabled'] is True
            cursor.execute('UPDATE pipeline_control.admin_evaluation_catalog_revision SET revision=revision+1')
            replay=manual('run',preview,request_id)
            checks['lost_manual_response_replays_original_run']=replay['run']==manual_result['run'] and scalar('SELECT count(*) FROM pipeline_control.restaurant_review_runs')==runs_before+1
            stop_preview=manual('preview-stop')
            checks['stop_preview_reports_queue']=stop_preview['queue']['queued']==1
            cursor.execute("UPDATE pipeline_control.restaurant_review_items SET state='running' WHERE state='queued'")
            checks['stop_queue_change_invalidates_preview']=denied('SELECT public.restaurant_review_automation_manual(%s,\'stop\',%s,%s,NULL)',(actor,stop_preview['version'],stop_preview['previewHash']))
            stop_preview=manual('preview-stop'); stopped=manual('stop',stop_preview)
            checks['confirmed_stop_cancels_exact_current_queue']=stopped['policy']['enabled'] is False and stopped['queue']['queued']==0 and stopped['queue']['running']==0
            cursor.execute('RESET ROLE')
            for role in ['anon','authenticated']:
                cursor.execute('SET ROLE '+role)
                checks[role+'_manual_rpc_denied']=denied('SELECT public.restaurant_review_automation_manual(%s,\'preview-run\',\'\',\'\',NULL)',(actor,))
                cursor.execute('RESET ROLE')
            checks['tick_keeps_lock_timeout']=scalar("SELECT proconfig @> ARRAY['lock_timeout=2s'] FROM pg_proc WHERE oid='public.restaurant_review_automation_tick(uuid)'::regprocedure")
            cursor.execute('UPDATE pipeline_control.restaurant_review_policy SET enabled=true,version=version+1')
            valid=insert(200,lambda value:value['evaluation_results']['visit_authenticity'].update(eval_basis=''))
            tick()
            cursor.execute('RESET ROLE')
            cursor.execute("INSERT INTO pipeline_control.restaurant_review_items(restaurant_id,fingerprint,decision,reason,state,created_at) SELECT gen_random_uuid(),md5(value::text),'recheck','missing_evaluation','queued',now()-interval '1 day' FROM generate_series(1,250) value")
            cursor.execute('SET ROLE service_role')
            valid_token=str(uuid.uuid4()); valid_claim=worker('claim',token=valid_token)
            checks['valid_claim_passes_250_stale_items']=valid_claim is not None and valid_claim['restaurant']['id']==valid['id']
            checks['stale_cleanup_bounded_at_200']=scalar("SELECT count(*) FROM pipeline_control.restaurant_review_items WHERE reason='source_changed' AND state='cancelled' AND created_at<now()-interval '1 hour'")==200
            lease_seconds=scalar('SELECT extract(epoch FROM lease_until-now()) FROM pipeline_control.restaurant_review_items WHERE id=%s',(valid_claim['id'],))
            checks['lease_covers_six_480s_commands_and_control_calls']=lease_seconds>6*480+2*20
            cursor.execute('RESET ROLE');cursor.execute("UPDATE pipeline_control.restaurant_review_items SET lease_until=lease_until-interval '48 minutes' WHERE id=%s",(valid_claim['id'],));cursor.execute('SET ROLE service_role')
            # At the end of a 48-minute run, the 60-minute lease remains valid.
            checks['long_run_completion_stays_valid']=worker('complete',valid_claim['id'],valid_token,{'evaluation_results':row['evaluation_results']})['state']=='succeeded'
            checks['worker_keeps_lock_timeout']=scalar("SELECT proconfig @> ARRAY['lock_timeout=2s'] FROM pg_proc WHERE oid='public.restaurant_review_automation_worker(text,uuid,uuid,jsonb)'::regprocedure")
        result=dict(kind='synthetic-restaurant-review-automation',postgresVersion=version,hostedMutation=False,
                    migrationSha256=hashlib.sha256(MIGRATION.read_bytes()).hexdigest(),assertions=checks,passed=sum(checks.values()),total=len(checks),success=all(checks.values()))
        if args.manual_guards:
            result['manualMigrationSha256']=hashlib.sha256(MANUAL_MIGRATION.read_bytes()).hexdigest()
            result['claimMigrationSha256']=hashlib.sha256(CLAIM_MIGRATION.read_bytes()).hexdigest()
        output=ROOT/'apps/web/performance/ui-renewal-20261003'/('restaurant-automation-claim-local.json' if args.manual_guards else 'restaurant-automation-local.json')
        output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
        print(json.dumps(result,ensure_ascii=False))
        if not result['success']: return 1
        if args.benchmark:
            observations=[]; digests=set(); dataset=[]
            for index in range(200):
                value=copy.deepcopy(row)
                value.update(id=str(uuid.uuid5(uuid.NAMESPACE_URL,'tzudong-review-benchmark:'+str(index))),trace_id='benchmark-'+str(index),
                             origin_name='합성 식당 '+str(index),approved_name='합성 식당 '+str(index),naver_name='합성 식당 '+str(index),
                             youtube_link='https://www.youtube.com/watch?v='+str(index).zfill(11),jibun_address='합성 지번 '+str(index),lat=37+index/1000,lng=127+index/1000)
                dataset.append(value)
            rng=random.Random(20261003)
            for repeat in range(7):
                order=[1,25,50,100,200];rng.shuffle(order)
                for batch in order:
                    cursor.execute('RESET ROLE')
                    cursor.execute('TRUNCATE pipeline_control.restaurant_review_items,pipeline_control.restaurant_review_runs,public.restaurants CASCADE')
                    cursor.execute('UPDATE pipeline_control.restaurant_review_policy SET enabled=true,operator_id=%s,batch_size=%s,daily_limit=200',(actor,batch))
                    cursor.execute('INSERT INTO public.restaurants SELECT * FROM jsonb_populate_recordset(NULL::public.restaurants,%s)',(Json(dataset),))
                    cursor.execute('SET ROLE service_role')
                    started=time.perf_counter();approved=0;requests=0
                    while approved<200:
                        run=tick();requests+=1;approved+=run['approved']
                        if not run['approved']:raise AssertionError('benchmark_approval_stalled')
                    elapsed=(time.perf_counter()-started)*1000
                    rows=scalar("SELECT jsonb_agg(to_jsonb(restaurant)-'updated_at' ORDER BY id) FROM public.restaurants restaurant")
                    digest=hashlib.sha256(json.dumps(rows,sort_keys=True,ensure_ascii=False).encode()).hexdigest();digests.add(digest)
                    observations.append(dict(repeat=repeat,batchSize=batch,wallMs=elapsed,requests=requests,approved=approved,outputDigest=digest))
            import sys
            sys.path.insert(0,str(ROOT))
            from backend.bin.analyze_pipeline_performance import compare
            comparisons={str(batch):compare([dict(item,implementation='baseline' if item['batchSize']==1 else 'candidate') for item in observations if item['batchSize'] in [1,batch]]) for batch in [25,50,100,200]}
            measurement=dict(kind='local-review-batch-size-experiment',formalG003Evidence=False,postgresVersion=version,environment=dict(platform=platform.platform(),machine=platform.machine(),cpuCount=os.cpu_count(),transport='Unix socket, persistent connection'),
                datasetRows=200,datasetSha256=hashlib.sha256(json.dumps(dataset,sort_keys=True,ensure_ascii=False).encode()).hexdigest(),repeats=7,orderSeed=20261003,
                migrationSha256=result['migrationSha256'],deterministicOutputMatch=len(digests)==1,observations=observations,comparisons=comparisons,
                limitations=['Batch-size comparison uses the same new guarded approval function, not the previous unguarded production screen.','Synthetic rows and Unix socket; no provider, browser, hosted DB or network timing.','No actual token, cost, accuracy or whole-pipeline claim.'])
            (output.parent/'restaurant-automation-batch-raw.json').write_text(json.dumps(measurement,ensure_ascii=False,indent=2)+'\n')
            print(json.dumps(dict(deterministicOutputMatch=len(digests)==1,comparisons=comparisons)))
            if len(digests)!=1:return 1
        return 0
    finally:
        if connection: connection.close()
        with admin.cursor() as cursor: cursor.execute('DROP DATABASE IF EXISTS '+database+' WITH(FORCE)')
        admin.close()

if __name__=='__main__': raise SystemExit(main())
