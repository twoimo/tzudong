"""Owned disposable-template PG17 concurrency; no authority/fence changes."""
import hashlib,json,queue,re,subprocess,threading,time,uuid
from pathlib import Path
BASE=Path('/Users/twoimo/.codex/worktrees/pipeline-admin-integration-20261007/tzudong/apps/web/performance/phased-record-followthrough-20261009/concurrency')
DOCKER='/opt/homebrew/bin/docker';CONTEXT='colima-tzudong-catalog-20261007';NAME='tzudong-phased-record-20261009-64ce4d5f'
OWNER='01a0f860-10d0-71b0-bb2a-95c2b52e025e';SOURCE='tzudong_phase_full_bafbc1d2'
BODY_SHA='5140ad2948b1890b1bbdf212bb89385b34ebad90fe9db60177ac91e7f760b892'
DB='tzudong_concurrency_20261009_'+uuid.uuid4().hex[:12];OUT=BASE/'current-schema-concurrency-20261009.json'
ROWS=['auth.users','public.profiles','public.user_stats','public.user_roles','public.user_account_status','public.restaurants','public.restaurant_submissions','public.restaurant_submission_items','public.reviews','pipeline_control.admin_record_operations','pipeline_control.admin_record_audit','pipeline_control.admin_record_media_cleanup']
CID=None;owned=False;sessions=[];stage='admission';result={'schema':'current-schema-real-concurrency/v1','status':'unconfirmed','sourceDatabase':SOURCE,'disposableDatabase':DB,'cleanupMode':'drop owned disposable database, not per-table seed deletion','operatingWrites':False,'sourceDatabaseWrites':False,'functionRoleTriggerChanges':False,'externalCalls':0}
def lit(x):return "'"+str(x).replace("'","''")+"'"
def jlit(x):return lit(json.dumps(x,separators=(',',':')))+'::jsonb'
def sha(x):return hashlib.sha256(x.encode()).hexdigest()
class SqlError(RuntimeError):
 def __init__(self,stderr):
  self.code=(re.search(r'\bRECORD_ACTION_[A-Z_]+\b',stderr).group(0) if re.search(r'\bRECORD_ACTION_[A-Z_]+\b',stderr) else 'TEMPLATE_BUSY' if 'being accessed by other users' in stderr else 'LOCAL_SQL_FAILED')
  self.state=re.search(r'ERROR:\s+([A-Z0-9]{5})',stderr).group(1) if re.search(r'ERROR:\s+([A-Z0-9]{5})',stderr) else None
  super().__init__(self.code)
def args(db):return [DOCKER,'--context',CONTEXT,'exec','-i','-e','PGPASSWORD=fixture-only',CID,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-h','127.0.0.1','-U','supabase_admin','-d',db]
def run(db,sql,readonly=False):
 r=subprocess.run(args(db),input=('BEGIN READ ONLY; SET LOCAL statement_timeout=\'15s\'; '+sql+' ROLLBACK;') if readonly else sql,text=True,capture_output=True,timeout=60000)
 if r.returncode:raise SqlError(r.stderr)
 return r.stdout

def json_query(db,sql):return json.loads(next(l for l in run(db,sql,True).splitlines() if l.startswith('{')))
def counts(db):return json_query(db,"SELECT jsonb_build_object("+','.join(lit(t)+',(SELECT count(*) FROM '+t+')' for t in ROWS)+");")
def fingerprints(db):return json_query(db,"""SELECT jsonb_build_object(
 'functions',(SELECT encode(sha256(convert_to(jsonb_agg(to_jsonb(p) ORDER BY p.oid)::text,'UTF8')),'hex') FROM pg_proc p),
 'roles',(SELECT encode(sha256(convert_to(jsonb_agg(to_jsonb(r) ORDER BY oid)::text,'UTF8')),'hex') FROM pg_roles r),
 'membership',(SELECT encode(sha256(convert_to(jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor)::text,'UTF8')),'hex') FROM pg_auth_members m),
 'triggers',(SELECT encode(sha256(convert_to(jsonb_agg(to_jsonb(t) ORDER BY oid)::text,'UTF8')),'hex') FROM pg_trigger t));""")
def schema_hash(db):
 r=subprocess.run([DOCKER,'--context',CONTEXT,'exec','-e','PGPASSWORD=fixture-only',CID,'pg_dump','-h','127.0.0.1','-U','supabase_admin','-d',db,'--schema-only','--no-comments','--no-publications','--no-subscriptions','--restrict-key=TZUDONGCONCURRENCY20261009'],text=True,capture_output=True,timeout=60000)
 if r.returncode:raise SqlError(r.stderr)
 return sha(r.stdout)
class Session:
 def __init__(self):
  self.p=subprocess.Popen(args(DB),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
  self.q=queue.Queue();self.err=[]
  def out():
   for line in self.p.stdout:self.q.put(line.rstrip('\n'))
   self.q.put(None)
  def err():
   for line in self.p.stderr:self.err.append(line)
  self.read_thread=threading.Thread(target=out,daemon=True);self.error_thread=threading.Thread(target=err,daemon=True)
  self.read_thread.start();self.error_thread.start();sessions.append(self)
  self.pid=self.query('BEGIN READ ONLY; SELECT jsonb_build_object(\'pid\',pg_backend_pid()); ROLLBACK;')[0]['pid']
 def query(self,sql):
  marker=uuid.uuid4().hex;self.p.stdin.write(sql+"\nSELECT jsonb_build_object('_marker',"+lit(marker)+");\n");self.p.stdin.flush();rows=[]
  while True:
   line=self.q.get(timeout=30)
   if line is None:
    self.p.wait(timeout=5);self.error_thread.join(5);raise SqlError(''.join(self.err))
   if not line or not line.startswith('{'):continue
   value=json.loads(line)
   if value.get('_marker')==marker:return rows
   rows.append(value)
 def close(self):
  if self.p.poll() is None:
   try:self.query('ROLLBACK;')
   except Exception:pass
   try:self.p.stdin.close()
   except Exception:pass
   try:self.p.wait(timeout=5)
   except subprocess.TimeoutExpired:self.p.terminate();self.p.wait(timeout=5)
 def begin(self):self.query("BEGIN; SET LOCAL ROLE service_role; SELECT set_config('request.jwt.claim.role','',true); SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true);")
 def commit(self):self.query('COMMIT;')
 def receipt(self,sql):return next(v for v in self.query(sql) if 'state' in v)
def call(actor,phase,op,sid,payload,preview=None):return 'SELECT public.admin_record_action('+','.join([lit(actor),lit(phase),lit(op),"'submission.approve'",'ARRAY['+lit(sid)+'::uuid]',jlit(payload),lit(preview) if preview else 'NULL'])+');'
def observed_block(pid,blocker):
 deadline=time.monotonic()+1.6
 while time.monotonic()<deadline:
  v=json_query(DB,'SELECT jsonb_build_object(\'blocked\','+str(blocker)+'=ANY(pg_blocking_pids('+str(pid)+')));')
  if v['blocked']:return True
  time.sleep(.02)
 return False

def contended(a,b,sql_a,sql_b,expected_b_error=None):
 a.begin();ra=a.receipt(sql_a);box={}
 def worker():
  try:b.begin();box['receipt']=b.receipt(sql_b)
  except Exception as e:box['error']=e
 thread=threading.Thread(target=worker);thread.start();block=observed_block(b.pid,a.pid)
 a.commit();thread.join(15)
 if thread.is_alive():raise RuntimeError('CONCURRENT_RESPONSE_UNCONFIRMED')
 if not block:raise RuntimeError('ACTUAL_BLOCKING_NOT_OBSERVED')
 if expected_b_error:
  if not isinstance(box.get('error'),SqlError) or box['error'].code!=expected_b_error:raise RuntimeError('CONCURRENT_EXPECTED_CONFLICT_MISSING')
  return ra,{'fixedCode':box['error'].code,'sqlState':box['error'].state,'blockingObserved':True}
 if 'error' in box:raise box['error']
 b.commit()
 return ra,{'receipt':box['receipt'],'blockingObserved':True}
try:
 ins=subprocess.run([DOCKER,'--context',CONTEXT,'inspect',NAME],text=True,capture_output=True,timeout=10000);assert ins.returncode==0
 c=json.loads(ins.stdout)[0];assert c['State']['Running'] and c['Config']['Labels'].get('tzudong.record-owner')==OWNER and c['HostConfig']['NetworkMode']=='none' and not c['HostConfig']['PortBindings'];CID=c['Id'];result['container']={'name':NAME,'id':CID,'image':c['Image'],'owner':OWNER,'network':'none','ports':0}
 result['sourceRowsBefore']=counts(SOURCE);assert all(v==0 for v in result['sourceRowsBefore'].values())
 result['sourceFingerprintsBefore']=fingerprints(SOURCE);result['sourceSchemaBefore']=schema_hash(SOURCE)
 source_guard=json_query(SOURCE,"SELECT jsonb_build_object('body',encode(sha256(convert_to(prosrc,'UTF8')),'hex'),'owner',pg_get_userbyid(proowner),'definer',prosecdef,'legacyOwnerGrant',has_function_privilege('privacy_workflow_owner','public.is_user_admin(uuid)'::regprocedure,'EXECUTE')) FROM pg_proc WHERE oid='public.admin_record_action(uuid,text,uuid,text,uuid[],jsonb,text)'::regprocedure;")
 assert source_guard['body']==BODY_SHA and source_guard['owner']=='postgres' and not source_guard['definer'] and not source_guard['legacyOwnerGrant']
 assert re.fullmatch(r'tzudong_concurrency_20261009_[a-f0-9]{12}',DB) and DB!=SOURCE
 assert not json_query('postgres','SELECT jsonb_build_object(\'exists\',EXISTS(SELECT 1 FROM pg_database WHERE datname='+lit(DB)+'));')['exists']
 stage='create-owned-template-copy';run('postgres','CREATE DATABASE '+DB+' TEMPLATE '+SOURCE+' OWNER postgres;');owned=True
 admission=json_query('postgres','SELECT jsonb_build_object(\'owner\',pg_get_userbyid(datdba)) FROM pg_database WHERE datname='+lit(DB)+';');assert admission['owner']=='postgres'
 result['copyRowsBefore']=counts(DB);assert result['copyRowsBefore']==result['sourceRowsBefore']
 result['copyFingerprintsBefore']=fingerprints(DB);assert result['copyFingerprintsBefore']==result['sourceFingerprintsBefore']
 result['copySchemaBefore']=schema_hash(DB);assert result['copySchemaBefore']==result['sourceSchemaBefore']
 actor,author,target,s1,s2,s3,i1,i2,i3,op1,op2,op3=[str(uuid.uuid4()) for _ in range(12)]
 video='https://www.youtube.com/watch?v='+target.replace('-','')[:11];newvideo='https://www.youtube.com/watch?v='+i3.replace('-','')[:11]
 seed="BEGIN;\nINSERT INTO auth.users(id,aud,role,email,raw_user_meta_data,created_at,updated_at) VALUES("+lit(actor)+",'authenticated','authenticated',"+lit(actor+'@example.invalid')+",'{\"nickname\":\"cc_admin\"}',now(),now()),("+lit(author)+",'authenticated','authenticated',"+lit(author+'@example.invalid')+",'{\"nickname\":\"cc_author\"}',now(),now());\nINSERT INTO public.user_roles(user_id,role) VALUES("+lit(actor)+",'admin');\nINSERT INTO public.user_account_status(user_id,account_status,disabled_at) VALUES("+lit(actor)+",'active',NULL),("+lit(author)+",'active',NULL);\nINSERT INTO public.restaurants(id,approved_name,origin_name,source_type,status,is_missing,created_by,lat,lng,jibun_address,road_address,categories,youtube_link,tzuyang_review,youtube_meta,evaluation_results,geocoding_success) VALUES("+','.join([lit(target),lit('CC_'+target),lit('CC_'+target),"'crawler'","'pending'",'true',lit(author),'37.5','127',lit('A_'+target),lit('R_'+target),"ARRAY['한식']",lit(video),"'synthetic preserved review'","'{\"title\":\"stored\",\"operator_marker\":\"preserve\"}'::jsonb","'{\"fixture_evidence\":true}'::jsonb",'false'])+");\n"
 for sid,kind,iid,v,targetid in [(s1,'edit',i1,video,target),(s2,'edit',i2,video,target),(s3,'new',i3,newvideo,None)]:
  seed+='INSERT INTO public.restaurant_submissions(id,user_id,submission_type,restaurant_name) VALUES('+','.join([lit(sid),lit(author),lit(kind),lit('CC_'+sid)])+');\n'
  seed+='INSERT INTO public.restaurant_submission_items(id,submission_id,youtube_link,tzuyang_review,target_restaurant_id) VALUES('+','.join([lit(iid),lit(sid),lit(v),"'synthetic item review'",lit(targetid) if targetid else 'NULL'])+');\n'
 seed+='COMMIT;\n';(BASE/'current-schema-concurrency-fixture.sql').write_text('-- Disposable database only: '+DB+'\n'+seed)
 stage='commit-synthetic-seed';run(DB,seed);result['seedSqlSha256']=sha(seed);result['syntheticRowsAfterSeed']=counts(DB)
 pa={'items':[{'id':i1,'decision':'approve','changes':{'phone':'02-1111-2222'}}]};pb={'items':[{'id':i2,'decision':'approve','changes':{'phone':'02-3333-4444'}}]}
 stage='different-operation-preview';a=Session();b=Session();a.begin();p1=a.receipt(call(actor,'preview',op1,s1,pa));a.commit();b.begin();p2=b.receipt(call(actor,'preview',op2,s2,pb));b.commit()
 stage='different-operation-apply-race';r1,r2=contended(a,b,call(actor,'apply',op1,s1,pa,p1['previewHash']),call(actor,'apply',op2,s2,pb,p2['previewHash']),'RECORD_ACTION_STALE')
 proof1=json_query(DB,"SELECT jsonb_build_object('winnerAudit',(SELECT count(*) FROM pipeline_control.admin_record_audit WHERE operation_id="+lit(op1)+"),'loserAudit',(SELECT count(*) FROM pipeline_control.admin_record_audit WHERE operation_id="+lit(op2)+"),'winnerState',(SELECT state FROM pipeline_control.admin_record_operations WHERE id="+lit(op1)+"),'loserState',(SELECT state FROM pipeline_control.admin_record_operations WHERE id="+lit(op2)+"),'winnerSubmission',(SELECT status FROM public.restaurant_submissions WHERE id="+lit(s1)+"),'loserSubmission',(SELECT status FROM public.restaurant_submissions WHERE id="+lit(s2)+"),'phone',(SELECT phone FROM public.restaurants WHERE id="+lit(target)+"),'restaurants',(SELECT count(*) FROM public.restaurants));")
 assert proof1=={'winnerAudit':1,'loserAudit':0,'winnerState':'applied','loserState':'preview','winnerSubmission':'approved','loserSubmission':'pending','phone':'02-1111-2222','restaurants':1}
 result['differentOperation']={'blockingObserved':r2['blockingObserved'],'winnerApplied':r1['state']=='applied','loserFixedCode':r2['fixedCode'],'winnerAudit':1,'loserAudit':0,'restaurantCount':1,'loserState':'preview','resultVerifiedBeforeAnyResend':True}
 a.close();b.close()
 stage='same-operation-preview-race';a=Session();b=Session()
 payload={'items':[{'id':i3,'decision':'approve','changes':{'approved_name':'CC_'+i3,'categories':['한식'],'lat':37.5,'lng':127,'geocoding_success':True,'jibun_address':'B_'+i3,'road_address':'Q_'+i3,'youtube_link':newvideo,'tzuyang_review':'synthetic new review | 한글','youtube_meta':{'title':'synthetic video','duration':42}}}]}
 p3,p4=contended(a,b,call(actor,'preview',op3,s3,payload),call(actor,'preview',op3,s3,payload));assert p4['receipt']==p3
 stage='same-operation-apply-race';r3,r4=contended(a,b,call(actor,'apply',op3,s3,payload,p3['previewHash']),call(actor,'apply',op3,s3,payload,p3['previewHash']));assert r4['receipt']==r3 and r3['state']=='applied'
 proof2=json_query(DB,"SELECT jsonb_build_object('auditCount',(SELECT count(*) FROM pipeline_control.admin_record_audit WHERE operation_id="+lit(op3)+"),'createdRestaurantCount',(SELECT count(*) FROM public.restaurants WHERE source_type='user_submission_new' AND created_by="+lit(author)+"),'restaurantsTotal',(SELECT count(*) FROM public.restaurants),'operationState',(SELECT state FROM pipeline_control.admin_record_operations WHERE id="+lit(op3)+"),'linkedRestaurantPresent',EXISTS(SELECT 1 FROM public.restaurants r JOIN public.restaurant_submission_items i ON i.target_restaurant_id=r.id WHERE i.id="+lit(i3)+" AND r.source_type='user_submission_new'));")
 assert proof2=={'auditCount':1,'createdRestaurantCount':1,'restaurantsTotal':2,'operationState':'applied','linkedRestaurantPresent':True}
 result['sameOperation']={'previewBlockingObserved':p4['blockingObserved'],'applyBlockingObserved':r4['blockingObserved'],'previewReceiptEqual':True,'applyReceiptEqual':True,'receiptSha256':sha(json.dumps(r3,sort_keys=True,separators=(',',':'))),'auditCount':1,'createdRestaurantCount':1,'restaurantsTotalIncludingExistingTarget':2}
 for session in sessions:session.close()
 stage='disposable-source-invariants';result['copyFingerprintsAfter']=fingerprints(DB);result['copySchemaAfter']=schema_hash(DB)
 assert result['copyFingerprintsAfter']==result['copyFingerprintsBefore'] and result['copySchemaAfter']==result['copySchemaBefore']
 result['disposableRowsBeforeDrop']=counts(DB);result['status']='passed_pending_disposal'
except Exception as e:
 result.update(status='failed',failureStage=stage,fixedCode=e.code if isinstance(e,SqlError) else str(e) if re.fullmatch('[A-Z_]+',str(e)) else 'CONCURRENCY_UNCONFIRMED',sqlState=getattr(e,'state',None))
finally:
 for session in sessions:session.close()
 if owned:
  try:
   verified=json_query('postgres','SELECT jsonb_build_object(\'owner\',pg_get_userbyid(datdba)) FROM pg_database WHERE datname='+lit(DB)+';');assert verified['owner']=='postgres' and re.fullmatch(r'tzudong_concurrency_20261009_[a-f0-9]{12}',DB) and DB!=SOURCE
   run('postgres','DROP DATABASE '+DB+';')
   absent=not json_query('postgres','SELECT jsonb_build_object(\'exists\',EXISTS(SELECT 1 FROM pg_database WHERE datname='+lit(DB)+'));')['exists'];assert absent
   result['disposableDatabaseAbsentReadback']=True;result['zeroResidualByDatabaseRemoval']=True;result['perTableZeroRowsQueriedInDisposableAfterCleanup']=False
  except Exception as e:result.update(status='cleanup_failed',cleanupFixedCode=e.code if isinstance(e,SqlError) else 'OWNED_DATABASE_DISPOSAL_UNCONFIRMED')
 try:
  result['sourceRowsAfter']=counts(SOURCE);result['sourceFingerprintsAfter']=fingerprints(SOURCE);result['sourceSchemaAfter']=schema_hash(SOURCE)
  result['sourceRowsExact']=result['sourceRowsAfter']==result.get('sourceRowsBefore');result['sourceSchemaExact']=result['sourceSchemaAfter']==result.get('sourceSchemaBefore');result['sourceFunctionsRolesMembershipTriggersExact']=result['sourceFingerprintsAfter']==result.get('sourceFingerprintsBefore')
  if not(result['sourceRowsExact'] and result['sourceSchemaExact'] and result['sourceFunctionsRolesMembershipTriggersExact']):result['status']='source_invariant_failed'
  elif result['status']=='passed_pending_disposal' and result.get('disposableDatabaseAbsentReadback'):result['status']='passed'
 except Exception:result['status']='source_readback_unconfirmed'
 result['limitations']=['Disposed committed synthetic rows by dropping only the owned disposable database; did not bypass last-admin fence or query its tables as zero after drop.','Actual two service-role connections and observed blocking; not provider/UI/hosted performance evidence.','No automatic resend after uncertain or failed apply; results read back first.']
 OUT.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'status':result['status'],'failureStage':result.get('failureStage'),'fixedCode':result.get('fixedCode'),'differentOperation':result.get('differentOperation'),'sameOperation':result.get('sameOperation'),'sourceRowsExact':result.get('sourceRowsExact'),'sourceSchemaExact':result.get('sourceSchemaExact'),'sourceFunctionsRolesMembershipTriggersExact':result.get('sourceFunctionsRolesMembershipTriggersExact'),'disposableDatabaseAbsentReadback':result.get('disposableDatabaseAbsentReadback'),'resultPath':str(OUT)}))
