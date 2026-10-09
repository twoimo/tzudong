from pathlib import Path
import json,re,uuid,sys
exec((Path(__file__).resolve().parent/'fixture-lib.py').read_text())
sys.path.insert(0,str(repo))
from backend.supabase.tests.test_restaurant_review_identity import ReviewIdentityTests
factory=ReviewIdentityTests();good=factory.good();good.update(source_type='crawler',created_by=None,updated_by_admin_id=None,phone='02-777-0000')
db=json.loads((out/'three-migration-replay.json').read_text())['database']
role="SET LOCAL ROLE service_role;SELECT set_config('request.jwt.claim.role','',true);SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true);"
# Auth/operator only, retaining all real triggers and business indexes.
auth_seed=seed[:seed.index('for missing marker')] if False else seed[:seed.index('INSERT INTO public.restaurants')]
auth_seed=auth_seed.replace('BEGIN;','BEGIN;INSERT INTO pipeline_control.admin_evaluation_catalog_revision(singleton,revision) VALUES(true,0);',1)
def insert(row):
 cols=list(row);return 'INSERT INTO public.restaurants('+','.join(cols)+') SELECT '+','.join(cols)+' FROM jsonb_populate_record(NULL::public.restaurants,'+lit(json.dumps(row))+'::jsonb);'
r={'status':'unconfirmed','operatingWrites':False,'externalCalls':0,'principal':'service_role','cases':[]}
def fixture(name,s):
 (out/(name+'.sql')).write_text(s);run(db,s);r['cases'].append(name)
try:
 current=repo/'backend/supabase/migrations/20261009022915_restaurant_review_manual_preview_eligibility.sql';assert digest(current.read_text())=='8acf6d1428764260ed57dac5fe09711868a82896f0a6d631d502128004c168a3';run(db,current.read_text(),'postgres');run(db,assertions)
 before=query(db,state_sql);sh=schema(db)
 body=query(db,"SELECT jsonb_build_object('classify',(SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='pipeline_control.restaurant_review_classify(jsonb)'::regprocedure),'tick',(SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='public.restaurant_review_automation_tick(uuid)'::regprocedure),'manual',(SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='public.restaurant_review_automation_manual(uuid,text,text,text,uuid)'::regprocedure));")
 assert body['tick']=='658473cae9137b04ddd810cb6ccf688b9ae998446880fa164e912eb8a1fbef6d';r['actualBodyHashes']=body
 invalid=[None,[],[None],[''],[' '],['unknown-value'],[3],[{}],[True],[['한식']],{},'한식',[' 한식 ']]
 for bad in [None,'',' ','unknown-value',3,{},True,['한식']]:
  invalid += [[bad,'한식'],['한식',bad],['한식',bad,'고기']]
 valid=['치킨','중식','돈까스·회','피자','패스트푸드','찜·탕','족발·보쌈','분식','카페·디저트','한식','고기','양식','아시안','야식','도시락']
 sql='BEGIN;'+role+"DO $test$ DECLARE base jsonb:="+lit(json.dumps(good))+"::jsonb;c jsonb;result text;BEGIN FOR c IN SELECT value FROM jsonb_array_elements("+lit(json.dumps(invalid))+"::jsonb) LOOP result:=pipeline_control.restaurant_review_classify(base||jsonb_build_object('categories',c));IF result<>'hold:source_incomplete' THEN RAISE EXCEPTION 'REVIEW_FIX_CATEGORY_ACCEPTED';END IF;END LOOP;FOR c IN SELECT value FROM jsonb_array_elements("+lit(json.dumps([[x] for x in valid]+[valid]))+"::jsonb) LOOP IF pipeline_control.restaurant_review_classify(base||jsonb_build_object('categories',c))<>'approve:all_checks_passed' THEN RAISE EXCEPTION 'REVIEW_FIX_VALID_CATEGORY_REJECTED';END IF;END LOOP;END $test$;ROLLBACK;"
 fixture('category_every_element_classifier',sql);r['categoryCases']={'malformed':len(invalid),'valid':len(valid)+1,'positions':'bad first/last/middle after a valid element; null, blank, whitespace, unknown, number, object, boolean, nested array; null/non-array/empty container'}
 # Real tick rejects a malformed typed text-array element and never queues it for model work.
 malformed=dict(good);malformed['categories']=['한식',None]
 policy="INSERT INTO pipeline_control.restaurant_review_policy(singleton,version,enabled,operator_id,batch_size,daily_limit) VALUES(true,7,true,"+L('actor')+",1,1);"
 sql=auth_seed+insert(malformed)+policy+role+"DO $test$ DECLARE a jsonb;b jsonb;BEGIN a:=public.restaurant_review_automation_tick(gen_random_uuid());IF (a->>'held')::int<>1 OR (a->>'recheck')::int<>0 OR (SELECT status FROM public.restaurants WHERE id="+lit(good['id'])+")<>'hold' THEN RAISE EXCEPTION 'REVIEW_FIX_CATEGORY_TICK';END IF;b:=public.restaurant_review_automation_tick(gen_random_uuid());IF (b->>'scanned')::int<>0 OR EXISTS(SELECT 1 FROM pipeline_control.restaurant_review_items WHERE state IN('queued','running')) THEN RAISE EXCEPTION 'REVIEW_FIX_CATEGORY_TICK_REPEAT';END IF;END $test$;ROLLBACK;"
 fixture('category_malformed_actual_tick',sql)
 # Exact deferred fingerprint remains unchanged; another real row changes duplicate-phone classification.
 other=dict(good);other.update(id=str(uuid.uuid4()),trace_id=uuid.uuid4().hex,origin_name='another fixture branch',approved_name='another fixture branch',naver_name='another fixture branch',youtube_link='https://www.youtube.com/watch?v=LMNOPQRSTUV',status='approved')
 defer="INSERT INTO pipeline_control.restaurant_review_runs(id,request_id,policy_version) VALUES('00000000-0000-4000-8000-000000000201',gen_random_uuid(),7);INSERT INTO pipeline_control.restaurant_review_items(id,run_id,restaurant_id,fingerprint,applied_fingerprint,decision,reason,state,input_sha256,gemini_decision) SELECT '00000000-0000-4000-8000-000000000202','00000000-0000-4000-8000-000000000201',id,'earlier-input-fingerprint',pipeline_control.restaurant_review_fingerprint(to_jsonb(t)),'approve','daily_limit','succeeded',repeat('a',64),'{\"outcome\":\"deferred\"}'::jsonb FROM public.restaurants t WHERE id="+lit(good['id'])+';'
 sql=auth_seed+insert(good)+policy+defer+"SELECT set_config('fixture.original_fp',pipeline_control.restaurant_review_fingerprint((SELECT to_jsonb(t) FROM public.restaurants t WHERE id="+lit(good['id'])+")),true);"+insert(other)+role+"DO $test$ DECLARE a jsonb;b jsonb;request uuid:=gen_random_uuid();BEGIN IF pipeline_control.restaurant_review_fingerprint((SELECT to_jsonb(t) FROM public.restaurants t WHERE id="+lit(good['id'])+"))<>current_setting('fixture.original_fp') OR pipeline_control.restaurant_review_decision((SELECT to_jsonb(t) FROM public.restaurants t WHERE id="+lit(good['id'])+"))<>'hold:duplicate_requires_review' THEN RAISE EXCEPTION 'REVIEW_FIX_DEFERRED_SETUP';END IF;a:=public.restaurant_review_automation_tick(request);IF (a->>'held')::int<>1 OR (a->>'scanned')::int<>1 OR (SELECT status FROM public.restaurants WHERE id="+lit(good['id'])+")<>'hold' OR NOT EXISTS(SELECT 1 FROM pipeline_control.restaurant_review_items WHERE id='00000000-0000-4000-8000-000000000202' AND state='applied' AND decision='hold' AND reason='duplicate_requires_review' AND gemini_decision->>'outcome'='hold' AND fingerprint<>applied_fingerprint) THEN RAISE EXCEPTION 'REVIEW_FIX_DEFERRED_NOT_APPLIED';END IF;b:=public.restaurant_review_automation_tick(request);IF a IS DISTINCT FROM b THEN RAISE EXCEPTION 'REVIEW_FIX_DEFERRED_REQUEST_CAS';END IF;b:=public.restaurant_review_automation_tick(gen_random_uuid());IF (b->>'scanned')::int<>0 OR EXISTS(SELECT 1 FROM pipeline_control.restaurant_review_items WHERE state IN('queued','running')) THEN RAISE EXCEPTION 'REVIEW_FIX_DEFERRED_ONE_BATCH';END IF;END $test$;ROLLBACK;"
 fixture('deferred_changed_classification_actual_tick',sql)
 assert query(db,state_sql)==before and schema(db)==sh;r['fullFixtureRollbackExact']=True;r['g014Passed']=4;r['status']='passed'
except Exception as e:r['failure']={'state':e.state,'fixedCode':e.fixedCode,'object':e.object} if isinstance(e,SqlFailure) else {'kind':type(e).__name__}
finally:
 (out/'runtime-cases.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r))
 if r['status']!='passed':raise SystemExit(1)
