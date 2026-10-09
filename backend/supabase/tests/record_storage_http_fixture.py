#!/usr/bin/env python3
"""Owned, pinned Storage HTTP + MinIO fixture. No hosted URL, credentials or user data.

Run with a task-owned Colima socket and a new output path. Only own labeled
containers/network/volumes are removed. Existing Docker selection is unchanged.
The repository SQL is installed up to its separate G014 registration boundary;
full canonical catalog replay is deliberately not claimed by this harness.
"""
import argparse,base64,hashlib,hmac,json,os,re,secrets,subprocess,time,urllib.request,urllib.error,urllib.parse,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
M=ROOT/'backend/supabase/migrations'
SQL=M/'20261004190259_admin_record_guarded_actions.sql'
STORAGE='supabase/storage-api@sha256:3e3742049427313d167578ba7af753069947972b64fcc5374cfb750f66a26177'
DB='supabase/postgres@sha256:af083ef64d0408c8f098ee6f5c364a59b26f36fbc0f3a334a62c5c1d57362e9b'
S3='cgr.dev/chainguard/minio@sha256:0d54f6c86e53138c6cfc242e21309a18941624d9034d9cdf598dbba61f69d872'
MC='cgr.dev/chainguard/minio-client@sha256:fce18c0d1a830273b51e422e6d8962f56c4e253d4858826ee5b5533deb7cbd6a'

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def literal(s):return "'"+str(s).replace("'","''")+"'"
class Fixture:
 def __init__(self,host,provider_patch=False):
  allowed='unix://'+str(Path.home()/'.colima/tzudong-record-storage-20261007/docker.sock')
  if host!=allowed:raise ValueError('OWNED_DOCKER_ENDPOINT_REQUIRED')
  self.host=host;self.prefix='record-http-'+uuid.uuid4().hex[:10];self.names=[];self.network=False;self.cases=[];self.selected=set();self.observations=[]
  self.provider_patch=provider_patch;self.patch_receipt=None
  self.password=secrets.token_hex(24);self.secret=secrets.token_hex(32);self.access='fixture'+secrets.token_hex(8);self.s3secret=secrets.token_hex(24)
  self.actor=str(uuid.uuid4());self.user=str(uuid.uuid4());self.jwt={r:self.token(r) for r in ['service_role','authenticated','anon']}
 def token(self,role):
  def b(v):return base64.urlsafe_b64encode(v).rstrip(b'=')
  p={'role':role,'exp':int(time.time())+7200,'iss':'record-storage-fixture'}
  if role=='authenticated':p.update(sub=self.user,aud='authenticated')
  value=b(b'{"alg":"HS256","typ":"JWT"}')+b'.'+b(json.dumps(p).encode());return (value+b'.'+b(hmac.new(self.secret.encode(),value,hashlib.sha256).digest())).decode()
 def docker(self,*args,input=None,env=None,check=True,timeout=60):
  r=subprocess.run(['docker','--host',self.host,*args],input=input,capture_output=True,text=True,env=env,timeout=timeout)
  if check and r.returncode:raise RuntimeError('FIXTURE_DOCKER_FAILED:'+str(args[0]))
  return r
 def start_container(self,kind,image,environment,args=(),publish=None,extra=()):
  patched=kind=='storage' and self.provider_patch
  name=self.prefix+'-'+kind;command=[*(['create'] if patched else ['run','-d']),'--name',name,'--label','tzudong.record-storage-owner='+self.prefix,'--network',self.prefix,'--network-alias',kind,*extra]
  if patched:
   environment={**environment,'TZUDONG_STORAGE_FIXTURE_PATCH':'1'}
   args=['sh','-c','node /app/record-storage-s3-patch.cjs && exec node dist/start/server.js']
  if publish:command+=['-p','127.0.0.1::'+str(publish)]
  for key in environment:command+=['-e',key]
  self.docker(*command,image,*args,env={**os.environ,**environment});self.names.append(name)
  if patched:
   self.docker('cp',str(Path(__file__).with_name('record_storage_s3_patch.cjs')),name+':/app/record-storage-s3-patch.cjs')
   self.docker('start',name)
  return name
 def sql(self,text,check=True):
  r=self.docker('exec','-i',self.prefix+'-db','psql','-X','-At','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres',input=text,check=check)
  if check and r.returncode:raise RuntimeError('FIXTURE_SQL_FAILED')
  return r.stdout.strip() if check else r
 def port(self,kind,port):
  query=self.docker('port',self.prefix+'-'+kind,str(port)+'/tcp',check=False)
  if query.returncode:
   raise RuntimeError('PORT_NOT_BOUND')
  value=query.stdout.strip()
  if not re.fullmatch(r'127\.0\.0\.1:\d+',value):raise RuntimeError('LOOPBACK_BINDING_REQUIRED')
  return int(value.split(':')[1])
 def request(self,method,path,data=None,role='service_role',headers=None):
  payload=json.dumps(data).encode() if isinstance(data,(dict,list)) else data
  hdr={'Authorization':'Bearer '+self.jwt[role],'Content-Type':'application/json' if isinstance(data,(dict,list)) else 'image/png',**(headers or {})}
  req=urllib.request.Request(self.url+path,data=payload,method=method,headers=hdr)
  try:
   with urllib.request.urlopen(req,timeout=15) as r:return r.status,r.read(),dict(r.headers)
  except urllib.error.HTTPError as r:return r.code,r.read(),dict(r.headers)
 def expect(self,name,test):
  if self.selected and name not in self.selected:return
  try:
   test();self.cases.append({'name':name,'passed':True});print('PASS '+name,flush=True)
  except AssertionError:
   self.cases.append({'name':name,'passed':False,'code':'COMPATIBILITY_ASSERTION_FAILED'});print('FAIL '+name,flush=True)
 def api_ok(self,*args,**kwargs):
  code,body,headers=self.request(*args,**kwargs)
  if code not in (200,201,204):
   # Return only bounded status/code, never provider error prose or the request.
   raise AssertionError('FIXTURE_HTTP_STATUS_'+str(code))
  return body,headers
 def s3(self,*args):
  return self.docker('run','--rm','--network',self.prefix,'--label','tzudong.record-storage-owner='+self.prefix,'-e','MC_HOST_fixture',MC,*args,env={**os.environ,'MC_HOST_fixture':f'http://{self.access}:{self.s3secret}@minio:9000'})
 def physical(self,path,incomplete=False):
  r=self.s3('ls',*(['--incomplete'] if incomplete else []),'--recursive','--json','fixture/record-fixture')
  return [json.loads(line) for line in r.stdout.splitlines() if line and json.loads(line).get('key','').startswith('stub/review-photos/'+path)]
 def setup(self):
  for image in [STORAGE,DB,S3,MC]:self.docker('image','inspect',image,'--format','{{.Id}}')
  self.docker('network','create','--label','tzudong.record-storage-owner='+self.prefix,self.prefix);self.network=True
  self.start_container('db',DB,{'POSTGRES_PASSWORD':self.password,'PGPASSWORD':self.password,'JWT_SECRET':self.secret,'JWT_EXP':'3600','POSTGRES_DB':'postgres'},extra=['--tmpfs','/var/lib/postgresql/data:rw,size=1g'])
  for _ in range(90):
   r=self.docker('exec',self.prefix+'-db','pg_isready','-U','supabase_admin',check=False)
   if r.returncode==0:
    ready=self.sql("SELECT to_regclass('storage.objects') IS NOT NULL",check=False)
    if ready.returncode==0 and ready.stdout.strip()=='t':break
   time.sleep(.3)
  else:raise RuntimeError('DB_NOT_READY')
  self.sql('ALTER ROLE supabase_storage_admin PASSWORD '+literal(self.password)+';')
  self.start_container('minio',S3,{'MINIO_ROOT_USER':self.access,'MINIO_ROOT_PASSWORD':self.s3secret},args=['server','/data'],extra=['--tmpfs','/data:rw,uid=65532,gid=65532,size=256m','--tmpfs','/tmp:rw,uid=65532,gid=65532,size=64m'])
  for _ in range(30):
   try:self.s3('mb','--ignore-existing','fixture/record-fixture');break
   except RuntimeError:time.sleep(.3)
  else:raise RuntimeError('S3_NOT_READY')
  self.start_container('s3proxy',STORAGE,{},args=['-e',Path(__file__).with_name('record_storage_s3_fault_proxy.cjs').read_text()],publish=9000,extra=['--entrypoint','node'])
  self.proxy_url='http://127.0.0.1:'+str(self.port('s3proxy',9000))
  self.start_container('storage',STORAGE,{'ANON_KEY':self.jwt['anon'],'SERVICE_KEY':self.jwt['service_role'],'PGRST_JWT_SECRET':self.secret,'DATABASE_URL':f'postgres://supabase_storage_admin:{self.password}@db:5432/postgres','DB_INSTALL_ROLES':'false','POSTGREST_URL':'http://storage:5000','STORAGE_BACKEND':'s3','GLOBAL_S3_BUCKET':'record-fixture','GLOBAL_S3_ENDPOINT':'http://s3proxy:9000','GLOBAL_S3_PROTOCOL':'http','GLOBAL_S3_FORCE_PATH_STYLE':'true','AWS_ACCESS_KEY_ID':self.access,'AWS_SECRET_ACCESS_KEY':self.s3secret,'AWS_DEFAULT_REGION':'us-east-1','REGION':'us-east-1','TENANT_ID':'stub','ENABLE_IMAGE_TRANSFORMATION':'false','FILE_SIZE_LIMIT':'10485760','TUS_URL_PATH':'/upload/resumable','TUS_PART_SIZE':'6291456','LOG_LEVEL':'fatal'},publish=5000)
  state=self.docker('inspect',self.prefix+'-storage','--format','{{.State.Running}}').stdout.strip()
  if state!='true':raise RuntimeError('STORAGE_EXITED')
  self.url='http://127.0.0.1:'+str(self.port('storage',5000))
  for _ in range(90):
   try:
    if self.request('GET','/status')[0]==200:break
   except (urllib.error.URLError,TimeoutError,ConnectionError):pass
   time.sleep(.3)
  else:raise RuntimeError('STORAGE_NOT_READY')
  if self.provider_patch:
   logs=self.docker('logs',self.prefix+'-storage').stdout.splitlines()
   receipts=[]
   for line in logs:
    try:value=json.loads(line)
    except json.JSONDecodeError:continue
    if isinstance(value,dict) and value.get('schema')=='record-storage-fixture-provider-patch-v1':receipts.append(value)
   if len(receipts)!=1:raise RuntimeError('FIXTURE_PATCH_RECEIPT_REQUIRED')
   self.patch_receipt=receipts[0]
   if self.patch_receipt.get('patchSha256')!=sha(Path(__file__).with_name('record_storage_s3_patch.cjs')):raise RuntimeError('FIXTURE_PATCH_HASH_MISMATCH')
  self.api_ok('POST','/bucket',{'id':'review-photos','name':'review-photos','public':False})
  self.install_domain()
 def install_domain(self):
  baseline=(ROOT/'backend/supabase/baselines/pre-20260214-public-schema.sql').read_text()
  src="SET ROLE postgres; CREATE SCHEMA pipeline_control; CREATE SCHEMA privacy_retention; GRANT USAGE ON SCHEMA pipeline_control,privacy_retention TO service_role; CREATE TABLE privacy_retention.g014_public_rpc_allowlist(function_schema name,function_name name,identity_arguments text,grantee name,source_signature text,UNIQUE(source_signature,grantee));\n"
  src+=(M/'20260124_create_restaurants.sql').read_text()
  src+="ALTER TABLE public.restaurants ADD COLUMN google_name text; CREATE TABLE public.user_roles(user_id uuid,role text); CREATE TABLE public.user_account_status(user_id uuid,account_status text); GRANT SELECT,UPDATE ON public.restaurants TO service_role;"
  identity=(M/'20260417_prevent_active_restaurant_identity_duplicates.sql').read_text()
  for name in ['extract_youtube_video_id','normalize_restaurant_identity_name','resolve_restaurant_identity_name']:
   src+=re.search(r'create or replace function public\.'+name+r'\(.*?\$\$;',identity,re.S).group()
  src+=(M/'20261003081915_restaurant_review_automation.sql').read_text()+(M/'20261004010334_restaurant_review_identity_evidence.sql').read_text()+(M/'20261004045404_restaurant_review_category_contract.sql').read_text()
  src+="CREATE TYPE public.submission_type AS ENUM('new','edit'); CREATE TYPE public.submission_status AS ENUM('pending','approved','partially_approved','rejected');"
  for table in ['reviews','restaurant_submissions','restaurant_submission_items','restaurant_requests']:
   src+=re.search(r'CREATE TABLE public\.'+table+r' \(.*?\n\);',baseline,re.S).group()+'ALTER TABLE public.'+table+' ADD PRIMARY KEY(id);'
  src+="CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA extensions; CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA extensions; CREATE FUNCTION public.is_user_admin(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=$1 AND role='admin') $$;"
  src+=re.search(r'CREATE FUNCTION public.generate_unique_id\(.*?\$\$;',baseline,re.S).group()
  src+=(M/'20260417_harden_submission_identity_duplicate_checks.sql').read_text()+(M/'20260702000100_restaurant_request_review_lifecycle.sql').read_text()
  src+='GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;'
  src+=SQL.read_text().split('DO $registration$')[0]+'COMMIT;'
  src+='ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY; GRANT SELECT,INSERT ON public.reviews TO authenticated;'
  for name in ['Users can insert own reviews','Reviews are viewable by everyone']:
   src+=re.search(r'CREATE POLICY "'+name+r'".*?;',baseline,re.S).group()
  policies=(M/'20260812000100_local_runtime_schema_convergence.sql').read_text()
  for name in ['tzudong_review_photo_insert_own','tzudong_review_photo_update_own','tzudong_review_photo_delete_own']:
   src+=re.search(r'CREATE POLICY '+name+r'.*?;',policies,re.S).group()
  src+="CREATE POLICY fixture_photo_read ON storage.objects FOR SELECT TO authenticated USING(bucket_id='review-photos');"
  src+='INSERT INTO public.user_roles VALUES('+literal(self.actor)+",'admin'); INSERT INTO public.user_account_status VALUES("+literal(self.actor)+",'active');"
  self.sql(src)
 def row(self):
  rid=str(uuid.uuid4());review=str(uuid.uuid4());path=f'{self.user}/reviews/{review}/verification/fixture.png'
  self.sql('INSERT INTO public.restaurants(id,approved_name,status) VALUES('+literal(rid)+",'synthetic fixture','pending');"+'INSERT INTO public.reviews(id,user_id,restaurant_id,title,content,visited_at,verification_photo) VALUES('+','.join(map(literal,[review,self.user,rid,'synthetic title','synthetic fixture content']))+',now(),'+literal(path)+');')
  return review,path
 def rpc(self,phase,op,action=None,ids=None,payload=None,preview=None):
  q='SET ROLE service_role; SELECT set_config(\'request.jwt.claims\',\'{"role":"service_role"}\',false); SELECT public.admin_record_action('+','.join([literal(self.actor)+'::uuid',literal(phase),literal(op)+'::uuid','NULL' if action is None else literal(action),literal('{'+','.join(ids or [])+'}')+'::uuid[]',literal(json.dumps(payload or {}))+'::jsonb','NULL' if preview is None else literal(preview)])+');'
  return json.loads(self.sql(q).splitlines()[-1])
 def deletion(self,review):
  op=str(uuid.uuid4());p=self.rpc('preview',op,'review.delete',[review],{'reason':'synthetic fixture'})
  self.rpc('apply',op,'review.delete',[review],{'reason':'synthetic fixture'},p['previewHash'])
  job=self.rpc('cleanup_read',op)['jobs'][0];return op,job
 def upload(self,path,body=b'synthetic fixture image v1',upsert=False):
  return self.api_ok('POST','/object/review-photos/'+path,body,role='authenticated',headers={'x-upsert':str(upsert).lower()})
 def claim(self,op,job):return self.rpc('cleanup_claim',op,payload={'jobId':job['id']})
 def close(self):
  for name in reversed(self.names):
   check=self.docker('inspect',name,'--format','{{index .Config.Labels "tzudong.record-storage-owner"}}',check=False)
   if check.returncode==0 and check.stdout.strip()==self.prefix:self.docker('rm','-fv',name,check=False)
  if self.network:self.docker('network','rm',self.prefix,check=False)

CASES={
 'standard_upload_claim_delete_physical_absence',
 'upsert_before_claim_protects_replacement',
 'claimed_path_rejects_user_and_service_upsert',
 'copy_rejects_retired_destination_allows_fresh_path',
 'resumable_upload_started_before_claim_cannot_replace_after_claim',
 'confirmed_delete_prevents_recreation_of_retired_path',
}
ADJACENT_CASES={'forged_tus_probe_cannot_commit_or_add_live_reference','partial_s3_delete_never_reports_physical_success'}
def main():
 p=argparse.ArgumentParser();p.add_argument('--docker-host',required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--case',action='append',default=[]);p.add_argument('--experimental-provider-patch',action='store_true');args=p.parse_args()
 if args.output.exists():raise SystemExit('OUTPUT_MUST_BE_NEW')
 if set(args.case)-(CASES|ADJACENT_CASES):raise SystemExit('UNKNOWN_CASE')
 fixture=Fixture(args.docker_host,args.experimental_provider_patch);fixture.selected=set(args.case);before=sha(SQL);failure=None
 try:
  fixture.setup();run_cases(fixture)
 except Exception as error:
  code=str(error)
  failure=code if re.fullmatch(r'(?:FIXTURE_[A-Z_]+(?::[a-z]+)?|[A-Z_]+_NOT_READY|STORAGE_EXITED)',code) else 'FIXTURE_EXECUTION_FAILED'
 finally:fixture.close()
 passed=bool(fixture.cases) and all(t['passed'] for t in fixture.cases) and not failure and before==sha(SQL)
 result={'schema':'record-media-storage-compatibility-v1','status':'passed' if passed else 'failed','storageImage':STORAGE,'databaseImage':DB,'s3Image':S3,'recordSqlSha256':before,'recordSqlUnchanged':before==sha(SQL),'harnessSha256':sha(Path(__file__)),'tests':fixture.cases,'observations':fixture.observations,'physicalBackend':'s3','syntheticOnly':True,'hostedOperations':0,'canonicalReplay':False,'completeCaseSet':CASES.issubset(t['name'] for t in fixture.cases),'sixCaseSetPassed':all(any(t['name']==name and t['passed'] for t in fixture.cases) for name in CASES),'faultProxySha256':sha(Path(__file__).with_name('record_storage_s3_fault_proxy.cjs'))}
 if args.experimental_provider_patch:
  result.update(schema='record-media-storage-provider-patch-experiment-v1',providerModified=True,admissionEligible=False,providerPatch=fixture.patch_receipt,baseStorageImage=STORAGE)
  del result['storageImage']
 if failure:result['code']=failure
 args.output.write_text(json.dumps(result,indent=2)+'\n');print('PROOF '+str(args.output))
 if not passed:raise SystemExit(1)

def run_cases(f):
 def normal():
  rid,path=f.row();f.upload(path);assert len(f.physical(path))==1
  op,job=f.deletion(rid);assert f.claim(op,job)['claimed']
  f.api_ok('DELETE','/object/review-photos',{'prefixes':[path]});assert f.physical(path)==[]
  assert f.request('GET','/object/authenticated/review-photos/'+path,role='authenticated')[0]>=400
  f.rpc('cleanup_absent',op,payload={'jobId':job['id']});assert not f.rpc('readback',op)['mediaCleanupPending']
 f.expect('standard_upload_claim_delete_physical_absence',normal)
 def upsert_before():
  rid,path=f.row();f.upload(path);op,job=f.deletion(rid);f.upload(path,b'synthetic replacement',True)
  assert not f.claim(op,job)['claimed'];assert f.api_ok('GET','/object/authenticated/review-photos/'+path,role='authenticated')[0]==b'synthetic replacement'
 f.expect('upsert_before_claim_protects_replacement',upsert_before)
 def fence():
  rid,path=f.row();f.upload(path);op,job=f.deletion(rid);assert f.claim(op,job)['claimed']
  for role in ['authenticated','service_role']:
   assert f.request('POST','/object/review-photos/'+path,b'synthetic forbidden replacement',role=role,headers={'x-upsert':'true'})[0]>=400
  assert f.api_ok('GET','/object/authenticated/review-photos/'+path,role='authenticated')[0]==b'synthetic fixture image v1'
  assert len(f.physical(path))==1
 f.expect('claimed_path_rejects_user_and_service_upsert',fence)
 def copy():
  _,source=f.row();f.upload(source);rid,target=f.row();f.upload(target);op,job=f.deletion(rid);f.claim(op,job)
  assert f.request('POST','/object/copy',{'bucketId':'review-photos','sourceKey':source,'destinationKey':target},role='authenticated',headers={'x-upsert':'true'})[0]>=400
  destination=source.replace('fixture.png','allowed.png');f.api_ok('POST','/object/copy',{'bucketId':'review-photos','sourceKey':source,'destinationKey':destination},role='authenticated')
  assert len(f.physical(target))==1;assert len(f.physical(destination))==1
 f.expect('copy_rejects_retired_destination_allows_fresh_path',copy)

 def tus_create(path,size):
  meta={"bucketName":"review-photos","objectName":path,"contentType":"image/png"}
  header=','.join(k+' '+base64.b64encode(v.encode()).decode() for k,v in meta.items())
  _,h=f.api_ok('POST','/upload/resumable',b'',role='authenticated',headers={'Tus-Resumable':'1.0.0','Upload-Length':str(size),'Upload-Metadata':header,'x-upsert':'true'})
  location=next(v for k,v in h.items() if k.lower()=='location')
  return urllib.parse.urlsplit(location).path
 def tus_patch(location,data,offset):
  return f.request('PATCH',location,data,role='authenticated',headers={'Tus-Resumable':'1.0.0','Upload-Offset':str(offset),'Content-Type':'application/offset+octet-stream','x-upsert':'true'})
 def tus():
  _,fresh=f.row();body=b'synthetic resumable upload';location=tus_create(fresh,len(body));assert tus_patch(location,body,0)[0]==204
  assert f.api_ok('GET','/object/authenticated/review-photos/'+fresh,role='authenticated')[0]==body
  rid,path=f.row();f.upload(path);location=tus_create(path,6291456+64)
  assert tus_patch(location,b'x'*6291456,0)[0]==204
  op,job=f.deletion(rid);assert f.claim(op,job)['claimed']
  assert tus_patch(location,b'x'*64,6291456)[0]>=400
  assert f.api_ok('GET','/object/authenticated/review-photos/'+path,role='authenticated')[0]==b'synthetic fixture image v1'
  termination_status=f.request('DELETE',location,role='authenticated',headers={'Tus-Resumable':'1.0.0','x-upsert':'true'})[0]
  physical=f.physical(path);incomplete=f.physical(path,incomplete=True)
  # Only counts/bytes/status are retained; no synthetic URLs, JWTs, object names or TUS metadata.
  f.observations.append({'case':'resumable_upload_started_before_claim_cannot_replace_after_claim','terminationStatus':termination_status,'oldPhotoPreserved':True,'physicalObjects':len(physical),'infoObjects':sum(x.get('key','').endswith('.info') for x in physical),'incompleteUploads':len(incomplete),'incompleteBytes':sum(x.get('size',0) for x in incomplete)})
  assert termination_status==204 and len(physical)==1 and not incomplete
 f.expect('resumable_upload_started_before_claim_cannot_replace_after_claim',tus)
 def delete_recreate():
  rid,path=f.row();f.upload(path);op,job=f.deletion(rid);f.claim(op,job)
  f.api_ok('DELETE','/object/review-photos',{'prefixes':[path]})
  f.rpc('cleanup_absent',op,payload={'jobId':job['id']})
  assert f.request('POST','/object/review-photos/'+path,b'synthetic new bytes',role='authenticated')[0]>=400
  assert f.physical(path)==[]
 f.expect('confirmed_delete_prevents_recreation_of_retired_path',delete_recreate)

 def forged_probe():
  rid,path=f.row();f.upload(path)
  restaurant=f.sql('SELECT restaurant_id FROM public.reviews WHERE id='+literal(rid))
  op,job=f.deletion(rid);assert f.claim(op,job)['claimed']
  snapshot=f.sql('SELECT pipeline_control.admin_record_storage_snapshot('+literal(path)+')')
  scope="SET LOCAL request.method='DELETE'; SET LOCAL storage.operation='storage.tus.upload.delete'; SET LOCAL request.path='/upload/resumable/synthetic';"
  for mode in ['', 'SET CONSTRAINTS ALL IMMEDIATE;']:
   r=f.sql('BEGIN; SET LOCAL ROLE service_role;'+scope+mode+"UPDATE storage.objects SET version='1' WHERE bucket_id='review-photos' AND name="+literal(path)+'; COMMIT;',check=False)
   assert r.returncode!=0 and 'RECORD_ACTION_MEDIA_RETIRED' in r.stderr
   assert f.sql('SELECT pipeline_control.admin_record_storage_snapshot('+literal(path)+')')==snapshot
  claims=literal(json.dumps({'role':'authenticated','sub':f.user}))
  r=f.sql("BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims',"+claims+",true); INSERT INTO public.reviews(id,user_id,restaurant_id,title,content,visited_at,verification_photo) VALUES("+','.join(map(literal,[str(uuid.uuid4()),f.user,restaurant,'synthetic title','synthetic content']))+',now(),'+literal(path)+'); COMMIT;',check=False)
  assert r.returncode!=0 and 'RECORD_ACTION_MEDIA_RETIRED' in r.stderr
  f.rpc('cleanup_uncertain',op,payload={'jobId':job['id']})
  # Uncertain cleanup remains ineligible for another claim, even with the probe exception.
  try:f.claim(op,job)
  except RuntimeError:pass
  else:raise AssertionError('UNCERTAIN_CLAIM_REPLAYED')
  assert f.api_ok('GET','/object/authenticated/review-photos/'+path,role='authenticated')[0]==b'synthetic fixture image v1'
 f.expect('forged_tus_probe_cannot_commit_or_add_live_reference',forged_probe)

 def partial_s3_delete():
  rid,path=f.row();f.upload(path);assert len(f.physical(path))==1
  op,job=f.deletion(rid);assert f.claim(op,job)['claimed']
  with urllib.request.urlopen(urllib.request.Request(f.proxy_url+'/__fixture/arm',method='POST'),timeout=5) as response:assert response.status==200
  status,_,_=f.request('DELETE','/object/review-photos',{'prefixes':[path]})
  present=f.sql("SELECT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='review-photos' AND name="+literal(path)+')')=='t'
  physical=f.physical(path)
  # Reproduce the current service's metadata-only readback, without resending any deletion.
  if not present:f.rpc('cleanup_absent',op,payload={'jobId':job['id']})
  receipt=f.rpc('readback',op)
  with urllib.request.urlopen(f.proxy_url+'/__fixture/status',timeout=5) as response:proxy=json.load(response)
  f.observations.append({'case':'partial_s3_delete_never_reports_physical_success','storageStatus':status,'metadataPresent':present,'physicalObjects':len(physical),'cleanupPending':receipt['mediaCleanupPending'],'injectedPartialFailures':proxy['injected']})
  assert proxy['injected']==1
  assert status>=400 and present and len(physical)==1 and receipt['mediaCleanupPending']
 f.expect('partial_s3_delete_never_reports_physical_success',partial_s3_delete)

if __name__=='__main__':main()
