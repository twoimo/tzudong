"""Execute real action SQL and existing approval RPCs against synthetic rows in a unique PG17 database.
The G014 registration is independently source-bound; full catalog admission belongs to canonical replay.
"""
import copy,json,os,re,unittest,uuid
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from backend.supabase.tests.test_restaurant_review_identity import ReviewIdentityTests,ROOT
from psycopg2.extras import Json
M=ROOT/'backend/supabase/migrations'
SOURCE=M/'20261004190259_admin_record_guarded_actions.sql'

@unittest.skipUnless(os.environ.get('TZUDONG_ADMIN_RECORD_LOCAL_PG')=='1','owned PG17 fixture opt-in required')
class AdminRecordActions(unittest.TestCase):
 cleanup=classmethod(ReviewIdentityTests.cleanup.__func__)
 scalar=ReviewIdentityTests.scalar
 good=ReviewIdentityTests.good
 @classmethod
 def setUpClass(cls):
  ReviewIdentityTests.setUpClass.__func__(cls)
  baseline=(ROOT/'backend/supabase/baselines/pre-20260214-public-schema.sql').read_text()
  with cls.conn.cursor() as c:
   c.execute("CREATE TYPE public.submission_type AS ENUM('new','edit'); CREATE TYPE public.submission_status AS ENUM('pending','approved','partially_approved','rejected');")
   for table in ['reviews','restaurant_submissions','restaurant_submission_items','restaurant_requests']:
    ddl=re.search(r'CREATE TABLE public\.'+table+r' \(.*?\n\);',baseline,re.S).group()
    c.execute(ddl);c.execute('ALTER TABLE public.'+table+' ADD PRIMARY KEY(id)')
   c.execute("CREATE SCHEMA extensions; CREATE FUNCTION extensions.similarity(text,text) RETURNS real LANGUAGE sql AS $$ SELECT CASE WHEN $1=$2 AND $1<>'' THEN 1::real ELSE 0::real END $$; CREATE FUNCTION extensions.digest(text,text) RETURNS bytea LANGUAGE sql AS $$ SELECT sha256(convert_to($1,'UTF8')) WHERE $2='sha256' $$; GRANT USAGE ON SCHEMA extensions TO service_role; CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$; CREATE FUNCTION public.is_user_admin(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=$1 AND role='admin') $$;")
   # Actual canonical resolver and ID function, not an implementation copied from this migration.
   c.execute("CREATE FUNCTION public.resolve_restaurant_identity_name(text,text,text,text) RETURNS text LANGUAGE sql AS $$ SELECT coalesce(nullif(btrim($1),''),nullif(btrim($2),''),nullif(btrim($3),''),nullif(btrim($4),'')) $$;")
   match=re.search(r'CREATE FUNCTION public.generate_unique_id\(.*?\$\$;',baseline,re.S)
   if not match: match=re.search(r'CREATE FUNCTION public.generate_unique_id\(.*?\$function\$;',baseline,re.S)
   c.execute(match.group())
   c.execute((M/'20260417_harden_submission_identity_duplicate_checks.sql').read_text())
   c.execute((M/'20260702000100_restaurant_request_review_lifecycle.sql').read_text())
   c.execute('GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role; GRANT USAGE ON SCHEMA auth TO service_role;')
   c.execute("CREATE SCHEMA storage; CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text,version text DEFAULT 'v1',metadata jsonb,updated_at timestamptz DEFAULT now(),last_accessed_at timestamptz,UNIQUE(bucket_id,name)); GRANT USAGE ON SCHEMA storage TO service_role; GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO service_role;")
   c.execute(SOURCE.read_text().split('DO $registration$')[0]+'COMMIT;')
 @classmethod
 def tearDownClass(cls): pass
 def setUp(self):
  self.actor=str(uuid.uuid4())
  with self.conn.cursor() as c:
   c.execute('TRUNCATE pipeline_control.admin_record_media_cleanup,pipeline_control.admin_record_audit,pipeline_control.admin_record_operations,public.restaurant_request_review_audit,public.restaurant_requests,public.restaurant_submission_items,public.restaurant_submissions,public.reviews,storage.objects,public.restaurants,public.user_roles,public.user_account_status CASCADE')
   c.execute("INSERT INTO public.user_roles VALUES(%s,'admin');INSERT INTO public.user_account_status VALUES(%s,'active')",(self.actor,self.actor))
 def insert(self,row=None):
  row=row or self.good()
  with self.conn.cursor() as c:c.execute('INSERT INTO public.restaurants SELECT * FROM jsonb_populate_record(NULL::public.restaurants,%s)',(Json(row),))
  return row
 def call(self,phase,action=None,ids=None,payload=None,op=None,preview=None,actor=None,conn=None,role='service_role'):
  con=conn or self.conn
  with con.cursor() as c:
   c.execute('SET ROLE '+role); c.execute("SET request.jwt.claim.role=''; SET request.jwt.claims='{\"role\":\"service_role\"}'")
   try:
    c.execute('SELECT public.admin_record_action(%s,%s,%s,%s,%s::uuid[],%s,%s)',(actor or self.actor,phase,op or str(uuid.uuid4()),action,ids or [],Json(payload or {}),preview))
    return c.fetchone()[0]
   finally:c.execute('RESET ROLE')
 def preview(self,action,row=None,payload=None,ids=None):
  return self.call('preview',action,ids if ids is not None else [row['id']],payload)
 def apply(self,ticket,payload=None):
  return self.call('apply',ticket['action'],ticket['targetIds'],payload,ticket['operationId'],ticket['previewHash'])
 def row(self,id):return self.scalar('SELECT to_jsonb(r) FROM public.restaurants r WHERE id=%s',(id,))
 def changes(self):
  return {k:v for k,v in self.good().items() if k in ['approved_name','categories','lat','lng','geocoding_success','jibun_address','youtube_link','tzuyang_review']}|{'youtube_meta':{'title':'synthetic public video'}}
 def test_approval_lost_ack_same_uuid_once_preserves_evidence_and_minimal_audit(self):
  row=self.insert();p=self.preview('restaurant.approve',row);r=self.apply(p)
  self.assertEqual(self.apply(p),r);self.assertEqual(self.call('readback',op=p['operationId']),r)
  self.assertEqual(self.row(row['id'])['evaluation_results'],row['evaluation_results'])
  self.assertEqual(self.row(row['id'])['updated_by_admin_id'],self.actor)
  self.assertEqual(self.scalar('SELECT count(*) FROM pipeline_control.admin_record_audit'),1)
  audit=self.scalar('SELECT to_jsonb(a) FROM pipeline_control.admin_record_audit a')
  for private in ['fixture evidence','fixture review','synthetic business address','evaluation_results','jibun_address']:
   self.assertNotIn(private,json.dumps(audit))
 def test_payload_actor_and_stale_fingerprint_rejected(self):
  row=self.insert();payload={'changes':{'approved_name':'changed'}};p=self.preview('restaurant.edit',row,payload)
  with self.assertRaisesRegex(self.driver.Error,'IDEMPOTENCY_CONFLICT'):self.apply(p,{'changes':{'approved_name':'different'}})
  other=str(uuid.uuid4())
  with self.conn.cursor() as c:c.execute("INSERT INTO public.user_roles VALUES(%s,'admin');INSERT INTO public.user_account_status VALUES(%s,'active');UPDATE public.restaurants SET updated_at=clock_timestamp() WHERE id=%s",(other,other,row['id']))
  with self.assertRaisesRegex(self.driver.Error,'FORBIDDEN'):self.call('readback',op=p['operationId'],actor=other)
  with self.assertRaisesRegex(self.driver.Error,'STALE'):self.apply(p,payload)
  self.assertEqual(self.scalar('SELECT count(*) FROM pipeline_control.admin_record_audit'),0)
 def test_manual_approval_missing_evidence_and_invalid_edit_do_not_mutate(self):
  row=self.good();row['evaluation_results']={};self.insert(row);p=self.preview('restaurant.approve',row)
  with self.assertRaisesRegex(self.driver.Error,'EVIDENCE_REQUIRED'):self.apply(p)
  for changed in [{'categories':['unknown']},{'lat':91},{'evaluation_results':{}},{'updated_by_admin_id':str(uuid.uuid4())}]:
   payload={'changes':changed};p=self.preview('restaurant.edit',row,payload)
   with self.assertRaises(self.driver.Error):self.apply(p,payload)
  self.assertEqual(self.row(row['id'])['status'],'pending')
 def test_deleted_incomplete_restoration_is_pending_not_approved(self):
  row=self.good();row.update(status='deleted',is_missing=True,lat=None,lng=None,categories=[]);self.insert(row)
  self.apply(self.preview('restaurant.restore',row));self.assertEqual(self.row(row['id'])['status'],'pending');self.assertTrue(self.row(row['id'])['is_missing'])
 def test_merge_multirow_cas_and_distinct_video_preserved(self):
  a=self.insert();b=self.good();b.update(youtube_link='https://www.youtube.com/watch?v=ZZZZZZZZZZZ',approved_name='target');self.insert(b)
  payload={'mergeTargetId':b['id']};p=self.preview('restaurant.merge',payload=payload,ids=[a['id'],b['id']])
  self.apply(p,payload)
  self.assertEqual(self.row(a['id'])['status'],'pending')
  self.assertEqual(self.row(a['id'])['youtube_link'],a['youtube_link'])
  self.assertEqual(self.row(a['id'])['approved_name'],b['approved_name'])
  with self.conn.cursor() as c:c.execute('UPDATE public.restaurants SET youtube_link=%s WHERE id=%s',(a['youtube_link'],b['id']))
  p=self.preview('restaurant.merge',payload=payload,ids=[a['id'],b['id']]);self.apply(p,payload)
  self.assertEqual(self.row(a['id'])['status'],'deleted');self.assertEqual(self.row(b['id'])['evaluation_results'],b['evaluation_results'])
 def submission(self,kind='new',targets=None):
  sid=str(uuid.uuid4());items=[]
  with self.conn.cursor() as c:
   c.execute("INSERT INTO public.restaurant_submissions(id,user_id,submission_type,restaurant_name) VALUES(%s,%s,%s,'fixture')",(sid,str(uuid.uuid4()),kind))
   for target in targets or [None,None]:
    iid=str(uuid.uuid4());items.append(iid)
    c.execute('INSERT INTO public.restaurant_submission_items(id,submission_id,youtube_link,target_restaurant_id) VALUES(%s,%s,%s,%s)',(iid,sid,'https://www.youtube.com/watch?v=ABCDEFGHIJK',target))
  return sid,sorted(items)
 def test_submission_partial_failure_rolls_back_all_and_restart_new_preview_succeeds(self):
  sid,items=self.submission();a=self.changes();b=copy.deepcopy(a);b['categories']=['invalid']
  payload={'items':[{'id':items[0],'decision':'approve','changes':a},{'id':items[1],'decision':'approve','changes':b}]}
  p=self.preview('submission.approve',payload=payload,ids=[sid])
  with self.assertRaises(self.driver.Error):self.apply(p,payload)
  self.assertEqual(self.scalar('SELECT count(*) FROM public.restaurants'),0)
  self.assertEqual(self.scalar("SELECT count(*) FROM public.restaurant_submission_items WHERE item_status='pending'"),2)
  payload['items'][1]={'id':items[1],'decision':'reject','reason':'unsupported'}
  p=self.preview('submission.approve',payload=payload,ids=[sid]);self.apply(p,payload)
  self.assertEqual(self.scalar('SELECT count(*) FROM public.restaurants'),1)
  self.assertEqual(self.scalar('SELECT status FROM public.restaurant_submissions'),'partially_approved')
 def test_submission_foreign_item_and_missing_decision_cannot_partially_commit(self):
  sid,items=self.submission();other,foreign=self.submission()
  for choices in [[items[0]],[items[0],foreign[0]],[items[0],items[0]]]:
   payload={'items':[{'id':i,'decision':'reject','reason':'unsupported'} for i in choices]};p=self.preview('submission.approve',payload=payload,ids=[sid])
   with self.assertRaisesRegex(self.driver.Error,'INVALID_PAYLOAD'):self.apply(p,payload)
  self.assertEqual(self.scalar("SELECT count(*) FROM public.restaurant_submission_items WHERE item_status='pending'"),4)
 def review(self,restaurant,legacy=False):
  rid=str(uuid.uuid4());uid=str(uuid.uuid4());photo=f'{uid}/reviews/{rid}/verification/fixture.jpg' if not legacy else f'{uid}/legacy.jpg'
  with self.conn.cursor() as c:c.execute("INSERT INTO public.reviews(id,user_id,restaurant_id,title,content,visited_at,verification_photo) VALUES(%s,%s,%s,'fixture','synthetic review content',now(),%s)",(rid,uid,restaurant['id'],photo))
  if not legacy:
   with self.conn.cursor() as c:c.execute("INSERT INTO storage.objects(bucket_id,name) VALUES('review-photos',%s)",(photo,))
  return rid,photo
 def test_review_counts_delete_commit_then_cleanup_uncertain_requires_readback(self):
  row=self.insert();rid,photo=self.review(row)
  p=self.preview('review.approve',payload={},ids=[rid]);self.apply(p)
  self.assertEqual(self.row(row['id'])['review_count'],1)
  p=self.preview('review.delete',payload={'reason':'fixture'},ids=[rid]);r=self.apply(p,{'reason':'fixture'})
  self.assertEqual(self.row(row['id'])['review_count'],0);self.assertTrue(r['mediaCleanupPending'])
  self.assertEqual(self.scalar('SELECT count(*) FROM public.reviews'),0)
  job=self.call('cleanup_read',op=p['operationId'])['jobs'][0];self.assertEqual(job['objectName'],photo)
  self.call('cleanup_claim',op=p['operationId'],payload={'jobId':job['id']});self.call('cleanup_uncertain',op=p['operationId'],payload={'jobId':job['id']})
  with self.assertRaisesRegex(self.driver.Error,'STATE_CONFLICT'):self.call('cleanup_claim',op=p['operationId'],payload={'jobId':job['id']})
  with self.conn.cursor() as c:c.execute("DELETE FROM storage.objects WHERE name=%s",(photo,))
  self.call('cleanup_absent',op=p['operationId'],payload={'jobId':job['id']});self.assertFalse(self.call('readback',op=p['operationId'])['mediaCleanupPending'])
 def test_legacy_photo_delete_does_not_authorize_unbound_storage_path(self):
  rid,_=self.review(self.insert(),legacy=True);p=self.preview('review.delete',payload={'reason':'fixture'},ids=[rid]);r=self.apply(p,{'reason':'fixture'})
  self.assertFalse(r['mediaCleanupPending']);self.assertTrue(r['mediaCleanupUnmanaged']);self.assertEqual(self.call('cleanup_read',op=p['operationId'])['jobs'],[])
 def test_service_only_acl_and_disabled_account(self):
  row=self.insert()
  for role in ['anon','authenticated']:
   with self.assertRaises(self.driver.Error):self.call('preview','restaurant.approve',[row['id']],role=role)
  with self.conn.cursor() as c:c.execute("UPDATE public.user_account_status SET account_status='suspended'")
  with self.assertRaisesRegex(self.driver.Error,'OPERATOR_INVALID'):self.preview('restaurant.approve',row)
 def test_group_edit_deletion_addition_is_atomic_and_foreign_rows_are_not_claimed(self):
  a=self.insert();b=self.good();b['youtube_link']='https://www.youtube.com/watch?v=ZZZZZZZZZZZ';self.insert(b)
  new=self.changes();new['youtube_link']='https://www.youtube.com/watch?v=YYYYYYYYYYY'
  payload={'changes':{'phone':'02-0000-0000'},'perTargetChanges':[{'id':a['id'],'changes':{'tzuyang_review':'new public review'}}], 'removeIds':[b['id']], 'additions':[new]}
  p=self.preview('restaurant.edit',payload=payload,ids=[a['id'],b['id']])
  with self.conn.cursor() as c:c.execute('UPDATE public.restaurants SET updated_at=clock_timestamp() WHERE id=%s',(b['id'],))
  with self.assertRaisesRegex(self.driver.Error,'STALE'):self.apply(p,payload)
  self.assertEqual(self.row(a['id'])['tzuyang_review'],a['tzuyang_review']);self.assertEqual(self.row(b['id'])['status'],'pending')
  p=self.preview('restaurant.edit',payload=payload,ids=[a['id'],b['id']]);r=self.apply(p,payload)
  self.assertEqual(len(r['targetIds']),3);self.assertEqual(self.row(a['id'])['tzuyang_review'],'new public review');self.assertEqual(self.row(b['id'])['status'],'deleted')
  self.assertEqual(self.scalar('SELECT count(*) FROM pipeline_control.admin_record_audit'),1)
 def test_create_missing_edit_delete_hold_and_restore_preserve_provenance(self):
  changes=self.changes();p=self.preview('restaurant.create',payload={'changes':changes},ids=[]);r=self.apply(p,{'changes':changes});created=r['targetIds'][0]
  self.assertEqual(self.row(created)['source_type'],'admin');self.assertEqual(self.row(created)['status'],'approved')
  row=self.good();row.update(approved_name='missing branch',origin_name='missing branch',is_missing=True,youtube_link='https://www.youtube.com/watch?v=ZZZZZZZZZZZ');self.insert(row)
  changes=self.changes();changes.update(approved_name='missing branch',youtube_link=row['youtube_link'])
  self.apply(self.preview('restaurant.register_missing',row,{'changes':changes}),{'changes':changes});self.assertFalse(self.row(row['id'])['is_missing'])
  payload={'changes':{'phone':'02-0000-0000'}};self.apply(self.preview('restaurant.edit',row,payload),payload)
  self.assertEqual(self.row(row['id'])['evaluation_results'],row['evaluation_results'])
  for action,status in [('restaurant.hold','hold'),('restaurant.delete','deleted')]:
   payload={'reason':'fixture'};self.apply(self.preview(action,row,payload),payload);self.assertEqual(self.row(row['id'])['status'],status)
  self.apply(self.preview('restaurant.restore',row));self.assertEqual(self.row(row['id'])['status'],'pending')
 def test_edit_submission_approval_preserves_real_evaluation_and_reject_lifecycle(self):
  row=self.insert();sid,items=self.submission('edit',[row['id']]);changes=self.changes();changes['approved_name']='new public name'
  payload={'items':[{'id':items[0],'decision':'approve','changes':changes}]};p=self.preview('submission.approve',payload=payload,ids=[sid]);self.apply(p,payload)
  updated=self.row(row['id']);self.assertEqual(updated['evaluation_results'],row['evaluation_results']);self.assertEqual(updated['updated_by_admin_id'],self.actor)
  for action in ['submission.reject','submission.delete']:
   sid,_=self.submission();payload={'reason':'fixture'};self.apply(self.preview(action,payload=payload,ids=[sid]),payload)
   self.assertEqual(self.scalar('SELECT status FROM public.restaurant_submissions WHERE id=%s',(sid,)),'rejected')
 def test_submission_edit_and_recommendation_lifecycle_have_atomic_receipts(self):
  sid,items=self.submission();payload={'changes':{'restaurant_name':'new name','restaurant_address':'business street','restaurant_categories':['한식']},'itemChanges':[{'id':items[0],'youtube_link':'https://www.youtube.com/watch?v=ZZZZZZZZZZZ'}]}
  self.apply(self.preview('submission.edit',payload=payload,ids=[sid]),payload)
  self.assertEqual(self.scalar('SELECT restaurant_name FROM public.restaurant_submissions WHERE id=%s',(sid,)),'new name')
  for action,status in [('recommendation.approve','approved'),('recommendation.reject','rejected')]:
   rid=str(uuid.uuid4());payload={'note':'domain note'} if status=='approved' else {'reason':'domain reason'}
   with self.conn.cursor() as c:c.execute("INSERT INTO public.restaurant_requests(id,user_id,restaurant_name,origin_address,recommendation_reason) VALUES(%s,%s,'fixture','synthetic street','synthetic recommendation')",(rid,str(uuid.uuid4())))
   receipt=self.apply(self.preview(action,payload=payload,ids=[rid]),payload)
   self.assertEqual(self.scalar('SELECT status FROM public.restaurant_requests WHERE id=%s',(rid,)),status)
   self.assertEqual(self.scalar('SELECT review_audit_id::text FROM public.restaurant_requests WHERE id=%s',(rid,)),receipt['auditId'])
   audit=self.scalar('SELECT to_jsonb(a) FROM public.restaurant_request_review_audit a WHERE id=%s',(receipt['auditId'],));self.assertIsNone(audit['admin_note']);self.assertIsNone(audit['rejection_reason'])
 def test_preview_expiry_and_late_duplicate_require_fresh_decision(self):
  row=self.insert();p=self.preview('restaurant.approve',row)
  with self.conn.cursor() as c:c.execute("UPDATE pipeline_control.admin_record_operations SET expires_at=now()-interval '1 second' WHERE id=%s",(p['operationId'],))
  with self.assertRaisesRegex(self.driver.Error,'PREVIEW_EXPIRED'):self.apply(p)
  p=self.preview('restaurant.approve',row);other=copy.deepcopy(row);other.update(id=str(uuid.uuid4()),trace_id=uuid.uuid4().hex);self.insert(other)
  with self.assertRaisesRegex(self.driver.Error,'EVIDENCE_REQUIRED'):self.apply(p)
  self.assertEqual(self.row(row['id'])['status'],'pending')
 def test_concurrent_same_uuid_has_single_audit(self):
  row=self.insert();p=self.preview('restaurant.approve',row)
  def run(_):
   conn=self.driver.connect(dbname=self.db,**self.params);conn.autocommit=True
   try:return self.call('apply',p['action'],p['targetIds'],{},p['operationId'],p['previewHash'],conn=conn)
   finally:conn.close()
  with ThreadPoolExecutor(max_workers=2) as ex:r=list(ex.map(run,[0,1]))
  self.assertEqual(r[0],r[1]);self.assertEqual(self.scalar('SELECT count(*) FROM pipeline_control.admin_record_audit'),1)


from backend.supabase.tests.test_service_invoker_contract import PostgreSQLContract as _InvokerFixture

@unittest.skipUnless(os.environ.get('TZUDONG_ADMIN_RECORD_LOCAL_PG')=='1','owned PG17 fixture opt-in required')
class AdminRecordRegistration(unittest.TestCase):
 # Reuse only isolated fixture helpers, never its cluster-role mutation setup.
 drop_owned_database=_InvokerFixture.drop_owned_database
 state=_InvokerFixture.state
 apply=_InvokerFixture.apply
 check=_InvokerFixture.check
 install_loop=_InvokerFixture.install_loop
 prepare_warning_extension=_InvokerFixture.prepare_warning_extension
 @classmethod
 def setUpClass(cls):
  import psycopg2
  cls.psycopg2=psycopg2
  cls.params=dict(host=os.environ['TZUDONG_TEST_PG_SOCKET'],port=int(os.environ['TZUDONG_TEST_PG_PORT']),user='postgres')
  cls.admin=psycopg2.connect(dbname='postgres',**cls.params);cls.admin.autocommit=True;cls.addClassCleanup(cls.admin.close)
  with cls.admin.cursor() as c:
   c.execute("SELECT count(*) FROM pg_roles WHERE rolname IN ('privacy_workflow_owner','privacy_auth_bridge')")
   if c.fetchone()[0]!=2:raise unittest.SkipTest('existing fixture roles required; no shared role creation')
 def setUp(self):
  _InvokerFixture.setUp(self)
  self.cursor.execute(self.prepare_warning_extension().decode())
  self.cursor.execute('ALTER TABLE privacy_retention.g014_public_rpc_allowlist ADD COLUMN function_schema name, ADD COLUMN function_name name, ADD COLUMN identity_arguments text; GRANT INSERT,DELETE ON privacy_retention.g014_public_rpc_allowlist TO privacy_workflow_owner;')
  self.cursor.execute("UPDATE privacy_retention.g014_public_rpc_allowlist a SET function_schema=n.nspname,function_name=p.proname,identity_arguments=p.proargtypes::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.oid=to_regprocedure(a.source_signature)")
  boundary=(M/'20260713002000_g014_public_api_private_boundary.sql').read_text()
  assertion=re.search(r'CREATE OR REPLACE FUNCTION privacy_retention.assert_g014_public_rpc_allowlist\(\).*?\$function\$;',boundary,re.S).group()
  self.cursor.execute(assertion+' ALTER FUNCTION privacy_retention.assert_g014_public_rpc_allowlist() OWNER TO privacy_workflow_owner; REVOKE ALL ON FUNCTION privacy_retention.assert_g014_public_rpc_allowlist() FROM PUBLIC,anon,authenticated,service_role;')
  self.signature='public.admin_record_action(uuid,text,uuid,text,uuid[],jsonb,text)'
  self.cursor.execute('CREATE FUNCTION '+self.signature+" RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT '{}'::jsonb $$; REVOKE ALL ON FUNCTION "+self.signature+' FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION '+self.signature+' TO service_role;')
  self.legacy=['public.approve_submission_item(uuid,uuid,jsonb)','public.approve_edit_submission_item(uuid,uuid,jsonb)','public.merge_restaurant_records_for_admin_review(uuid,uuid,uuid,timestamptz,text,jsonb,text,text)']
  for signature in self.legacy:
   self.cursor.execute('CREATE FUNCTION '+signature+" RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT true $$; ALTER FUNCTION "+signature+' OWNER TO privacy_workflow_owner; REVOKE ALL ON FUNCTION '+signature+' FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION '+signature+' TO authenticated,service_role;')
   self.cursor.execute("INSERT INTO privacy_retention.g014_public_rpc_allowlist(source_signature,grantee,function_schema,function_name,identity_arguments) SELECT %s,g,'public',p.proname,p.proargtypes::text FROM pg_proc p CROSS JOIN unnest(ARRAY['authenticated','service_role']::name[]) g WHERE p.oid=to_regprocedure(%s)",(signature,signature))
  self.registration='BEGIN; DO $registration$'+SOURCE.read_text().split('DO $registration$',1)[1]
 def memberships(self):
  self.cursor.execute('SELECT to_jsonb(m) FROM pg_auth_members m ORDER BY roleid,member,grantor');return self.cursor.fetchall()
 def test_registration_exact_source_acl_and_atomic_rollback(self):
  before=self.state();members=self.memberships()
  self.cursor.execute(self.registration.replace('COMMIT;','ROLLBACK;'))
  self.assertEqual(self.state(),before);self.assertEqual(self.memberships(),members)
  self.cursor.execute(self.registration);after=self.state()
  self.assertEqual([dict(x,prosrc='') for _,x in before],[dict(x,prosrc='') for _,x in after]);self.assertEqual(self.memberships(),members)
  self.install_loop();self.check();self.cursor.execute('SELECT privacy_retention.assert_g014_public_rpc_allowlist()')
  for legacy in self.legacy:
   self.cursor.execute("SELECT has_function_privilege('authenticated',to_regprocedure(%s),'EXECUTE'),has_function_privilege('service_role',to_regprocedure(%s),'EXECUTE')",(legacy,legacy));self.assertEqual(self.cursor.fetchone(),(False,True))
  self.cursor.execute("SELECT count(*) FROM pg_proc WHERE pronamespace=pg_my_temp_schema() AND proname='admin_record_registration'");self.assertEqual(self.cursor.fetchone()[0],0)
  for suffix in ['SECURITY DEFINER',"SET search_path=public",'OWNER TO privacy_workflow_owner']:
   self.cursor.execute('BEGIN; ALTER FUNCTION '+self.signature+' '+suffix)
   with self.assertRaisesRegex(self.psycopg2.Error,'SECURITY INVOKER contract mismatch'):self.check()
   self.cursor.execute('ROLLBACK')
  self.cursor.execute('BEGIN; GRANT EXECUTE ON FUNCTION '+self.signature+' TO authenticated')
  with self.assertRaisesRegex(self.psycopg2.Error,'SECURITY INVOKER contract mismatch'):self.check()
  self.cursor.execute('ROLLBACK')
  with self.assertRaisesRegex(self.psycopg2.Error,'SOURCE_DRIFT'):self.cursor.execute(self.registration)
  self.cursor.execute('ROLLBACK');self.assertEqual(self.state(),after)
 def test_second_assertion_drift_leaves_first_and_allowlist_unchanged(self):
  self.cursor.execute("SELECT pg_get_functiondef('privacy_retention.assert_g014_catalog_contract()'::regprocedure)")
  self.cursor.execute(self.cursor.fetchone()[0].replace('END;\n','END;\n\n'))
  before=self.state();members=self.memberships()
  with self.assertRaisesRegex(self.psycopg2.Error,'SOURCE_DRIFT'):self.cursor.execute(self.registration)
  self.cursor.execute('ROLLBACK');self.assertEqual(self.state(),before);self.assertEqual(self.memberships(),members)
  self.cursor.execute('SELECT count(*) FROM privacy_retention.g014_public_rpc_allowlist WHERE source_signature=%s',(self.signature,));self.assertEqual(self.cursor.fetchone()[0],0)

 def test_pg17_non_superuser_owner_helper_restores_memberships(self):
  if os.environ.get('TZUDONG_RECORD_OWNED_CLUSTER')!='1' or not self.params['host'].startswith(('/tmp/tzudong-admin-record-','/tmp/tz-rec-audit-fix-')):
   self.skipTest('task-owned cluster only; shared role changes forbidden')
  bootstrap=self.psycopg2.connect(dbname=self.db,**{**self.params,'user':'record_fixture_bootstrap'});bootstrap.autocommit=True
  try:
   with bootstrap.cursor() as c:
    c.execute('GRANT privacy_workflow_owner TO postgres WITH ADMIN TRUE, INHERIT FALSE, SET FALSE; ALTER ROLE postgres NOSUPERUSER CREATEROLE CREATEDB;')
   before=self.memberships();self.cursor.execute(self.registration);self.assertEqual(self.memberships(),before)
   self.cursor.execute("SELECT pg_has_role('postgres','privacy_workflow_owner','USAGE'),pg_has_role('postgres','privacy_workflow_owner','SET')");self.assertEqual(self.cursor.fetchone(),(False,False))
  finally:
   with bootstrap.cursor() as c:c.execute('ALTER ROLE postgres SUPERUSER; REVOKE privacy_workflow_owner FROM postgres;')
   bootstrap.close()

if __name__=='__main__':unittest.main()
