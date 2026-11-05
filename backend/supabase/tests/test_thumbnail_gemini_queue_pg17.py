"""Actual candidate SQL on owned PG17: concurrency, fencing, unknown and recovery.

No hosted writes, worker credential provisioning or product provider calls.
Storage manifests here are synthetic; this is not Storage/PostgREST/G014 verification.
"""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import uuid

try:
    import psycopg2
    from psycopg2.extras import Json
except ImportError:
    psycopg2 = None

ROOT = Path(__file__).resolve().parents[3]
PG = Path('/opt/homebrew/Cellar/postgresql@17/17.11_1/bin')
SQL = ROOT/'backend/supabase/candidates/20261023_thumbnail_gemini_queue.sql'
SELF = Path(__file__).resolve()
BRIDGE = ROOT/'backend/supabase/migrations/20261003182338_storyboard_service_role_bridge.sql'
KPI = ROOT/'backend/supabase/migrations/20260812000100_local_runtime_schema_convergence.sql'
TS = ROOT/'apps/web/tests-unit/fixtures/thumbnail-queue-pg17.ts'
CLIENT = ROOT/'apps/web/lib/admin/youtube-thumbnail-generator/gemini-worker-client.ts'
PRIVATE_TS = ROOT/'apps/web/tests-unit/fixtures/thumbnail-private-store-pg17.ts'
PRIVATE_LIB = ROOT/'apps/web/lib/admin/youtube-thumbnail-generator'
SOURCES = [SQL, SELF, BRIDGE, KPI, TS, CLIENT, PRIVATE_TS,
           *[PRIVATE_LIB/name for name in ['queue-contract.ts','private-store.ts','queue-api.ts','prompt.ts','safety.ts',
                                         'worker-outbox.ts','outbound-worker.ts','browser-queue.ts','chat-browser-queue.ts',
                                         'chat-contract.ts','chat-gemini-client.ts','execution-contract.ts','gemini-image-input.ts','gemini-chat-input.ts']],
           ROOT/'apps/web/scripts/thumbnail-gemini-worker.ts',ROOT/'apps/web/package.json']
MODEL = 'gemini-3.1-flash-image'
sha = lambda value: hashlib.sha256(value.encode()).hexdigest()


class ThumbnailQueuePg17(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if psycopg2 is None or sys.platform != 'darwin' or not all((PG/name).is_file() for name in ['initdb','pg_ctl','postgres']):
            raise unittest.SkipTest('installed PG17 and project psycopg2 required; no installation')
        cls.root = Path(tempfile.mkdtemp(prefix='thumbnail-queue-pg17-', dir='/private/tmp'))
        cls.data = cls.root/'data'; cls.sock = cls.root/'socket'; cls.sock.mkdir(mode=0o700)
        cls.home = cls.root/'home'; cls.home.mkdir(mode=0o700)
        cls.env = {'PATH':'/opt/homebrew/bin:/usr/bin:/bin','HOME':str(cls.home),'LANG':'C','LC_ALL':'C'}
        cls.version = subprocess.check_output([str(PG/'postgres'),'--version'],text=True).strip()
        if cls.version != 'postgres (PostgreSQL) 17.11 (Homebrew)': raise unittest.SkipTest('PG17 pin mismatch')
        with socket.socket() as listener:
            listener.bind(('127.0.0.1',0)); cls.port=listener.getsockname()[1]
        cls.before = {str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in SOURCES}
        cls.observations = {}; cls.owner_hash = None
        with (cls.root/'init.log').open('w') as log:
            subprocess.run([str(PG/'initdb'),'-D',str(cls.data),'-U','postgres','--no-locale','--encoding=UTF8',
                            '--auth-local=trust','--auth-host=trust'],env=cls.env,stdout=log,stderr=subprocess.STDOUT,check=True)
        subprocess.run([str(PG/'pg_ctl'),'-D',str(cls.data),'-l',str(cls.root/'postgres.log'),'-o',
                        f'-h 127.0.0.1 -p {cls.port} -k {cls.sock}','-w','start'],env=cls.env,stdout=subprocess.DEVNULL,check=True)
        cls.pid=int((cls.data/'postmaster.pid').read_text().splitlines()[0]);cls.addClassCleanup(cls.cleanup)
        with cls.connection(admin=True) as connection, connection.cursor() as cursor:
            cursor.execute('CREATE ROLE service_role BYPASSRLS; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE privacy_workflow_owner;'
                           'CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);'
                           'CREATE TABLE public.user_roles(user_id uuid,role text);'
                           'CREATE TABLE public.user_account_status(user_id uuid,account_status text);'
                           'CREATE SCHEMA storyboard_control; GRANT USAGE ON SCHEMA storyboard_control TO service_role;')
            bridge=BRIDGE.read_text();start=bridge.index('CREATE OR REPLACE FUNCTION storyboard_control.assert_owner')
            end=bridge.index('DO $bridge$\n',start)
            owner_source=bridge[start:end];cls.owner_hash=hashlib.sha256(owner_source.encode()).hexdigest()
            # Execute the real KPI table/index/RLS definitions, not a permissive mock.
            kpi=KPI.read_text(); cursor.execute(kpi[:kpi.index('CREATE TABLE IF NOT EXISTS public.youtube_thumbnail_releases')])
            cursor.execute(owner_source)
            # Reproduce hosted-style inherited defaults, including grant options.
            # These objects and defaults belong only to this isolated cluster.
            cursor.execute('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role WITH GRANT OPTION;'
                           'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role WITH GRANT OPTION;'
                           'CREATE TABLE public.acl_existing_table(value integer); INSERT INTO public.acl_existing_table VALUES(7);'
                           'CREATE SEQUENCE public.acl_existing_sequence; SELECT nextval(\'public.acl_existing_sequence\');')
            cls.acl_baseline_before=cls.acl_baseline(cursor)
            cursor.execute(SQL.read_text())
        print('THUMBNAIL_QUEUE_PG17_EVIDENCE='+str(cls.root),flush=True)

    @staticmethod
    def acl_baseline(cursor):
        cursor.execute("""SELECT jsonb_build_object(
          'defaults',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.oid) FROM pg_default_acl a),
          'existingObjects',(SELECT jsonb_agg(jsonb_build_object('oid',c.oid,'owner',c.relowner,'acl',c.relacl) ORDER BY c.oid)
            FROM pg_class c WHERE c.oid IN ('public.acl_existing_table'::regclass,'public.acl_existing_sequence'::regclass)),
          'tableValues',(SELECT jsonb_agg(value) FROM public.acl_existing_table),
          'sequenceValue',(SELECT last_value FROM public.acl_existing_sequence))""")
        return cursor.fetchone()[0]

    @classmethod
    def connection(cls,admin=False):
        connection=psycopg2.connect(host='127.0.0.1',port=cls.port,user='postgres',dbname='postgres',connect_timeout=3)
        connection.autocommit=False
        if not admin:
            with connection.cursor() as cursor: cursor.execute('SET ROLE service_role; SET statement_timeout=8000; SET lock_timeout=5000;')
        return connection

    @classmethod
    def cleanup(cls):
        pidfile=cls.data/'postmaster.pid'
        if not pidfile.exists() or int(pidfile.read_text().splitlines()[0])!=cls.pid: raise RuntimeError('OWNED_PG_PID_MISMATCH')
        subprocess.run([str(PG/'pg_ctl'),'-D',str(cls.data),'-m','fast','-w','stop'],env=cls.env,stdout=subprocess.DEVNULL,check=True)
        status=subprocess.run([str(PG/'pg_ctl'),'-D',str(cls.data),'status'],env=cls.env,capture_output=True).returncode
        with socket.socket() as probe: closed=probe.connect_ex(('127.0.0.1',cls.port))!=0
        cleanup={'ownedPid':cls.pid,'statusExit':status,'pidFileAbsent':not pidfile.exists(),
                 'socketAbsent':not (cls.sock/f'.s.PGSQL.{cls.port}').exists(),'tcpClosed':closed}
        after={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in SOURCES}
        receipt={'version':cls.version,'sourceBefore':cls.before,'sourceAfter':after,'sourceStable':cls.before==after,
                 'ownerCheckSourceSha256':cls.owner_hash,'cases':cls.observations,'cleanup':cleanup,
                 'hostedWrites':0,'providerCalls':0,'scope':__doc__}
        (cls.root/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
        if status!=3 or not all(cleanup[k] for k in ['pidFileAbsent','socketAbsent','tcpClosed']): raise RuntimeError('OWNED_PG_CLEANUP_FAILED')
        if cls.before!=after: raise RuntimeError('SOURCE_CHANGED_DURING_CHECK')

    def setUp(self):
        self.owner=str(uuid.uuid4());self.other=str(uuid.uuid4())
        self.workers=[sha('synthetic-worker-'+str(uuid.uuid4())) for _ in range(3)]
        with self.connection(admin=True) as connection,connection.cursor() as cursor:
            cursor.execute('TRUNCATE public.admin_thumbnail_events,public.admin_thumbnail_jobs,public.admin_thumbnail_workers,public.youtube_channel_kpi_snapshots,public.youtube_video_kpi_snapshots;')
            for owner in [self.owner,self.other]:
                cursor.execute("INSERT INTO auth.users VALUES(%s); INSERT INTO public.user_roles VALUES(%s,'admin'); INSERT INTO public.user_account_status VALUES(%s,'active')",(owner,owner,owner))
            for index,token in enumerate(self.workers):
                cursor.execute('INSERT INTO public.admin_thumbnail_workers(owner_id,token_sha256,models) VALUES(%s,%s,%s)',
                               (self.other if index==2 else self.owner,token,[MODEL]))

    def admin(self,action,job=None,request=None,digest=None,payload=None,owner=None,model=MODEL):
        with self.connection() as connection,connection.cursor() as cursor:
            cursor.execute('SELECT public.thumbnail_production_admin(%s,%s,%s,%s,%s,%s,%s)',
                           (owner or self.owner,action,job,request,digest,model,Json(payload) if payload is not None else None))
            return cursor.fetchone()[0]

    def enqueue(self,request=None,digest=None,prompt='synthetic food',owner=None):
        return self.admin('enqueue',request=request or str(uuid.uuid4()),digest=digest or sha(prompt),owner=owner,
                          payload={'contract':'thumbnail-gemini-image-v1','model':MODEL,'prompt':prompt,'references':[]})

    def worker(self,action,job=None,index=0,payload=None,connection=None):
        own=connection is None;connection=connection or self.connection()
        try:
            with connection.cursor() as cursor:
                cursor.execute('SELECT public.thumbnail_production_worker(%s,%s,%s,%s,%s,%s,%s)',
                               (self.workers[index],action,job['id'] if job else None,job['attemptId'] if job else None,
                                job['fence'] if job else None,job['inputSha256'] if job else None,Json(payload or {})))
                result=cursor.fetchone()[0]
            if own:connection.commit()
            return result
        except BaseException:
            if own:connection.rollback()
            raise
        finally:
            if own:connection.close()

    def expire(self,job):
        with self.connection(admin=True) as connection,connection.cursor() as cursor:
            cursor.execute("UPDATE public.admin_thumbnail_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=%s",(job['id'],))

    def manifest(self,job):
        prefix=f"{job['ownerId']}/{job['id']}/{job['attemptId']}/"
        def image(name): return {'path':prefix+name+'.png','sha256':sha(name),'mimeType':'image/png','bytes':1234,'width':1280,'height':720}
        return {'original':image('original'),'normalized':image('normalized'),'provenance':{
            'providerId':'gemini-api','model':MODEL,'responseModel':MODEL,'responseId':'synthetic-response',
            'verification':'official-api','modelEvidence':'response','generatedAt':'2026-10-23T12:00:00.000Z',
            'attemptId':job['attemptId'],'inputSha256':job['inputSha256']}}

    def assert_rpc_error(self,code,work):
        with self.assertRaises(psycopg2.Error) as caught:work()
        self.assertEqual(code,caught.exception.diag.message_primary)

    def test_collected_references_are_channel_source_bucket_scoped_and_bounded(self):
        channel='UCfpaSruWW3S4dibonKXENjA'; bucket='2026-10-23T12:00:00Z'
        self.assertFalse(self.admin('reference_candidates')['channelVerified'])
        with self.connection(admin=True) as connection,connection.cursor() as cursor:
            cursor.execute('INSERT INTO public.youtube_channel_kpi_snapshots(channel_id,channel_handle,bucket_started_at) VALUES(%s,%s,%s)',(channel,'@tzuyang6145',bucket))
            for index in range(40):
                cursor.execute('INSERT INTO public.youtube_video_kpi_snapshots(video_id,channel_id,title,view_count,bucket_started_at) VALUES(%s,%s,%s,%s,%s)',
                               (f'video{index:06d}',channel,'가'*240,index,bucket))
            for video_id,source,other_channel,other_bucket in [('other000001','youtube-data-api','foreign',bucket),
                    ('source00001','untrusted',channel,bucket),('old00000001','youtube-data-api',channel,'2026-10-22T12:00:00Z'),
                    ('invalid/id','youtube-data-api',channel,bucket)]:
                cursor.execute('INSERT INTO public.youtube_video_kpi_snapshots(video_id,channel_id,view_count,bucket_started_at,source) VALUES(%s,%s,999999,%s,%s)',
                               (video_id,other_channel,other_bucket,source))
        result=self.admin('reference_candidates')
        self.assertTrue(result['channelVerified']); self.assertEqual(32,len(result['candidates']))
        self.assertEqual([f'video{index:06d}' for index in range(39,7,-1)], [row['videoId'] for row in result['candidates']])
        self.assertTrue(all(len(row['title'])==200 for row in result['candidates']))
        with self.connection(admin=True) as connection,connection.cursor() as cursor:
            cursor.execute("UPDATE public.user_account_status SET account_status='suspended' WHERE user_id=%s",(self.owner,))
        self.assert_rpc_error('owner_forbidden',lambda:self.admin('reference_candidates'))
        self.observations['collected_references']={'responseRows':32,'titleCharacters':200,'channelSourceBucketFiltered':True,'queryCpuBoundProven':False}

    def test_request_idempotency_and_changed_input_conflict(self):
        request=str(uuid.uuid4());first=self.enqueue(request=request)
        self.assertEqual(first['id'],self.enqueue(request=request)['id'])
        self.assert_rpc_error('request_conflict',lambda:self.enqueue(request=request,prompt='changed'))
        self.observations['request_idempotency']={'sameJob':True,'changedInputRejected':True}

    def chat(self,request=None,**changes):
        request=request or str(uuid.uuid4()); model='gemini-3.8-flash'
        document={'path':f'{self.owner}/{request}/input/chat.json','sha256':sha('typed chat context'),
                  'bytes':512,'mimeType':'application/json'}
        document.update(changes)
        return self.admin('enqueue',request=request,digest=sha('chat '+request),model=model,
                          payload={'contract':'thumbnail-gemini-chat-v1','model':model,'document':document})

    def chat_result(self,job):
        proof=self.manifest(job)['provenance']; proof['model']=job['model']; proof['responseModel']=job['model']
        return {'content':{'path':f"{job['ownerId']}/{job['id']}/{job['attemptId']}/response.json",
                           'sha256':sha('typed chat result'),'bytes':512,'mimeType':'application/json'},'provenance':proof}

    def test_chat_and_image_reads_cannot_substitute_jobs_or_history(self):
        chat=self.chat(); image=self.enqueue();
        self.assertIsNone(self.admin('request',request=chat['requestId']))
        self.assertIsNone(self.admin('chat_request',request=image['requestId']))
        self.assertEqual(chat,self.admin('chat_request',request=chat['requestId']))
        self.assertEqual([image['id']],[row['id'] for row in self.admin('list')])
        self.assertEqual([chat['id']],[row['id'] for row in self.admin('chat_list')])
        self.assert_rpc_error('job_not_found',lambda:self.admin('cancel',job=chat['id']))
        self.assert_rpc_error('job_not_found',lambda:self.admin('chat_cancel',job=image['id']))
        self.assertEqual('cancelled',self.admin('chat_cancel',job=chat['id'])['state'])
        self.assertEqual('queued',self.admin('snapshot',job=image['id'])['state'])

    def test_chat_fresh_start_and_recovery_share_the_global_unknown_slot(self):
        self.worker('models',payload={'models':[MODEL,'gemini-3.8-flash']})
        enqueued=self.chat(); self.enqueue(); claimed=self.worker('claim')
        self.assertEqual(enqueued['id'],claimed['id']); receipt=self.worker('start',claimed)
        self.assertEqual('gemini-3.8-flash',receipt['model']); self.assertEqual('fresh-commit',receipt['permission'])
        self.assert_rpc_error('start_not_confirmed',lambda:self.worker('start',claimed))
        self.worker('unknown',claimed); self.assertIsNone(self.worker('claim',index=1))
        self.assertNotIn('permission',self.admin('chat_snapshot',job=claimed['id']))
        self.assert_rpc_error('invalid_result',lambda:self.worker('complete',claimed,payload=self.manifest(claimed)))
        complete=self.worker('complete',claimed,payload=self.chat_result(claimed))
        self.assertEqual('succeeded',complete['state']); self.assertEqual(complete,self.admin('chat_request',request=claimed['requestId']))
        self.assertEqual(MODEL,self.worker('claim',index=1)['model'])
        self.observations['chat_shared_slot']={'freshStarts':1,'snapshotPermissions':0,'unknownBlocksImages':True,'originalAttemptRecovery':True}

    def test_chat_document_and_result_bounds_and_identity_are_strict(self):
        for change in [{'bytes':65537},{'bytes':15},{'bytes':1.5},{'bytes':'512'}, {'path':'../chat.json'},
                       {'mimeType':'text/plain'},{'sha256':'invalid'},{'unexpected':True}]:
            self.assert_rpc_error('invalid_input',lambda:self.chat(**change))
        self.worker('models',payload={'models':['gemini-3.8-flash']}); self.chat(); job=self.worker('claim');self.worker('start',job)
        for field,value in [('bytes',48001),('path','../response.json'),('mimeType','image/png'),('sha256','invalid')]:
            result=self.chat_result(job);result['content'][field]=value
            self.assert_rpc_error('invalid_result',lambda:self.worker('complete',job,payload=result))
        result=self.chat_result(job);result['provenance']['inputSha256']=sha('different')
        self.assert_rpc_error('invalid_result',lambda:self.worker('complete',job,payload=result))
        self.assertEqual('succeeded',self.worker('complete',job,payload=self.chat_result(job))['state'])

    def test_request_readback_recovers_generated_id_and_current_states(self):
        request=str(uuid.uuid4());enqueued=self.enqueue(request=request)
        self.assertEqual(enqueued,self.admin('request',request=request))
        claimed=self.worker('claim');self.assertEqual(claimed,self.admin('request',request=request))
        self.worker('start',claimed)
        started=self.admin('request',request=request)
        self.assertEqual('provider_started',started['state']);self.assertNotIn('permission',started)
        self.assertEqual(self.admin('snapshot',job=enqueued['id']),started)
        unknown=self.worker('unknown',claimed);self.assertEqual(unknown,self.admin('request',request=request))
        cancelled=self.admin('cancel',job=enqueued['id'])
        self.assertTrue(cancelled['cancelRequested']);self.assertEqual(cancelled,self.admin('request',request=request))
        ready=self.worker('complete',claimed,payload=self.manifest(claimed))
        self.assertEqual(ready,self.admin('request',request=request));self.assertEqual(enqueued['id'],ready['id'])
        self.observations['request_readback']={'generatedIdRecovered':True,'currentStatesPreserved':True,'freshPermissions':0}

    def test_request_readback_is_owner_scoped_and_missing_is_null(self):
        request=str(uuid.uuid4());first=self.enqueue(request=request)
        self.assertIsNone(self.admin('request',request=request,owner=self.other))
        self.assertIsNone(self.admin('request',request=str(uuid.uuid4())))
        second=self.enqueue(request=request,owner=self.other)
        self.assertNotEqual(first['id'],second['id'])
        self.assertEqual(first,self.admin('request',request=request))
        self.assertEqual(second,self.admin('request',request=request,owner=self.other))
        self.observations['request_owner_scope']={'sameRequestDifferentOwners':True,'missingReturnsNull':True}

    def test_request_readback_validates_request_id_and_active_owner(self):
        self.assert_rpc_error('invalid_input',lambda:self.admin('request'))
        with self.assertRaises(psycopg2.errors.InvalidTextRepresentation):self.admin('request',request='not-a-uuid')
        job=self.enqueue()
        with self.connection(admin=True) as connection,connection.cursor() as cursor:
            cursor.execute("UPDATE public.user_account_status SET account_status='suspended' WHERE user_id=%s",(self.owner,))
        for request in [job['requestId'],str(uuid.uuid4())]:
            self.assert_rpc_error('owner_forbidden',lambda:self.admin('request',request=request))

    def test_request_readback_observes_late_enqueue_commit_without_reinserting(self):
        request=str(uuid.uuid4());connection=self.connection()
        try:
            with connection.cursor() as cursor:
                cursor.execute('SELECT public.thumbnail_production_admin(%s,%s,NULL,%s,%s,%s,%s)',
                               (self.owner,'enqueue',request,sha('late enqueue'),MODEL,Json({
                                   'contract':'thumbnail-gemini-image-v1','model':MODEL,'prompt':'late enqueue','references':[]})))
                enqueued=cursor.fetchone()[0]
            self.assertIsNone(self.admin('request',request=request))
            connection.commit()
        finally:connection.rollback();connection.close()
        self.assertEqual(enqueued,self.admin('request',request=request))
        self.assertEqual(1,len(self.admin('list')))
        self.observations['request_late_commit']={'uncommittedReturnsNull':True,'lateCommitRecovered':True,'jobs':1}

    def test_same_digest_new_request_or_upload_path_cannot_bypass_unknown(self):
        self.enqueue();job=self.worker('claim');self.worker('start',job);self.worker('unknown',job)
        self.assert_rpc_error('input_already_active',lambda:self.enqueue())
        self.assertIsNone(self.worker('claim',index=1))
        self.assertEqual('unknown',self.admin('snapshot',job=job['id'])['state'])

    def test_concurrent_same_request_is_exactly_one_job(self):
        request=str(uuid.uuid4());barrier=threading.Barrier(2)
        def work(_):barrier.wait();return self.enqueue(request=request)['id']
        with ThreadPoolExecutor(max_workers=2) as pool:ids=list(pool.map(work,range(2)))
        self.assertEqual(1,len(set(ids)))
        self.assertEqual(1,len(self.admin('list')))

    def test_two_workers_claim_only_one_generation(self):
        self.enqueue();self.enqueue(prompt='another input');barrier=threading.Barrier(2)
        def work(index):barrier.wait();return self.worker('claim',index=index)
        with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(work,[0,1]))
        self.assertEqual(1,sum(value is not None for value in results))
        self.observations['concurrent_claim']={'workers':2,'claims':1}

    def test_prestart_reclaim_fences_old_worker(self):
        self.enqueue();old=self.worker('claim');self.expire(old);new=self.worker('claim',index=1)
        self.assertNotEqual(old['attemptId'],new['attemptId']);self.assertEqual(old['fence']+1,new['fence'])
        self.assert_rpc_error('attempt_conflict',lambda:self.worker('start',old))
        self.assertEqual('fresh-commit',self.worker('start',new,index=1)['permission'])

    def test_start_permission_is_not_reissued_after_ack_loss(self):
        self.enqueue();job=self.worker('claim');receipt=self.worker('start',job)
        self.assertEqual('fresh-commit',receipt['permission'])
        self.assert_rpc_error('start_not_confirmed',lambda:self.worker('start',job))
        snapshot=self.admin('snapshot',job=job['id']);self.assertNotIn('permission',snapshot)
        self.observations['start_ack_loss']={'freshPermissions':1,'readbackPermissions':0}

    def test_start_rechecks_deadline_after_waiting_for_real_row_lock(self):
        self.enqueue();job=self.worker('claim');holder=self.connection(admin=True)
        started=threading.Event();backend=[]
        def blocked_start():
            connection=self.connection();backend.append(connection.get_backend_pid());started.set()
            try:return self.worker('start',job,connection=connection)
            finally:connection.rollback();connection.close()
        try:
            with holder.cursor() as cursor:
                cursor.execute("UPDATE public.admin_thumbnail_jobs SET lease_expires_at=clock_timestamp()+interval '400 milliseconds' WHERE id=%s",(job['id'],))
            with ThreadPoolExecutor(max_workers=1) as pool:
                future=pool.submit(blocked_start);self.assertTrue(started.wait(2));waiting=False;deadline=time.monotonic()+3
                while time.monotonic()<deadline:
                    with self.connection(admin=True) as observer,observer.cursor() as cursor:
                        cursor.execute('SELECT wait_event_type FROM pg_stat_activity WHERE pid=%s',(backend[0],));row=cursor.fetchone()
                    if row and row[0]=='Lock':waiting=True;break
                    time.sleep(.01)
                self.assertTrue(waiting,'start must actually block on the owned row lock')
                deadline=time.monotonic()+3;expired=False
                with holder.cursor() as cursor:
                    while time.monotonic()<deadline:
                        cursor.execute('SELECT clock_timestamp()>lease_expires_at FROM public.admin_thumbnail_jobs WHERE id=%s',(job['id'],))
                        if cursor.fetchone()[0]:expired=True;break
                        time.sleep(.01)
                self.assertTrue(expired,'owned lease deadline must pass within the bounded probe')
                holder.commit()
                self.assert_rpc_error('start_not_confirmed',future.result)
        finally:holder.rollback();holder.close()
        self.observations['deadline_after_row_lock']={'observedLockWait':True,'expiredStartRejected':True}

    def test_started_expiry_keeps_original_attempt_and_accepts_result_recovery(self):
        self.enqueue();job=self.worker('claim');self.worker('start',job);self.expire(job)
        self.assertIsNone(self.worker('claim',index=1));unknown=self.admin('snapshot',job=job['id'])
        self.assertEqual('unknown',unknown['state']);self.assertEqual(job['attemptId'],unknown['attemptId'])
        ready=self.worker('complete',job,payload=self.manifest(job));self.assertEqual('succeeded',ready['state'])

    def test_unknown_keeps_the_generation_slot_until_the_original_result_is_recovered(self):
        self.enqueue();job=self.worker('claim');self.worker('start',job)
        self.enqueue(prompt='different queued input');self.expire(job)
        self.assertIsNone(self.worker('claim',index=1),'unknown is not evidence that the old provider cannot still start or run')
        self.worker('complete',job,payload=self.manifest(job))
        self.assertIsNotNone(self.worker('claim',index=1))
        self.observations['unknown_slot']={'blockedDifferentInput':True,'releasedAfterOriginalResult':True}

    def test_owner_is_rechecked_after_the_job_lock_wait(self):
        self.enqueue();job=self.worker('claim');holder=self.connection(admin=True);started=threading.Event();backend=[]
        def blocked_start():
            connection=self.connection();backend.append(connection.get_backend_pid());started.set()
            try:
                result=self.worker('start',job,connection=connection);connection.commit();return result
            except BaseException:connection.rollback();raise
            finally:connection.close()
        try:
            with holder.cursor() as cursor:cursor.execute('SELECT id FROM public.admin_thumbnail_jobs WHERE id=%s FOR UPDATE',(job['id'],))
            with ThreadPoolExecutor(max_workers=1) as pool:
                future=pool.submit(blocked_start);self.assertTrue(started.wait(2));waiting=False;deadline=time.monotonic()+3
                while time.monotonic()<deadline:
                    with self.connection(admin=True) as observer,observer.cursor() as cursor:
                        cursor.execute('SELECT wait_event_type FROM pg_stat_activity WHERE pid=%s',(backend[0],));row=cursor.fetchone()
                    if row and row[0]=='Lock':waiting=True;break
                    time.sleep(.01)
                self.assertTrue(waiting)
                with self.connection(admin=True) as revoker,revoker.cursor() as cursor:
                    cursor.execute("UPDATE public.user_account_status SET account_status='suspended' WHERE user_id=%s",(self.owner,))
                holder.commit();self.assert_rpc_error('owner_forbidden',future.result)
        finally:holder.rollback();holder.close()
        self.observations['owner_after_row_lock']={'observedLockWait':True,'revokedStartRejected':True}

    def test_cancel_before_start_prevents_permission_and_after_start_preserves_output(self):
        self.enqueue();job=self.worker('claim');self.admin('cancel',job=job['id'])
        self.assert_rpc_error('attempt_conflict',lambda:self.worker('start',job))
        self.enqueue(prompt='second input');job=self.worker('claim');self.worker('start',job)
        cancelled=self.admin('cancel',job=job['id']);self.assertEqual('provider_started',cancelled['state'])
        ready=self.worker('complete',job,payload=self.manifest(job));self.assertTrue(ready['cancelRequested']);self.assertEqual('succeeded',ready['state'])

    def test_checkpoint_ack_loss_is_idempotent_and_changed_manifest_conflicts(self):
        self.enqueue();job=self.worker('claim');self.worker('start',job);result=self.manifest(job)
        first=self.worker('complete',job,payload=result);again=self.worker('complete',job,payload=result)
        self.assertEqual(first,again);result['original']['sha256']=sha('changed')
        self.assert_rpc_error('result_conflict',lambda:self.worker('complete',job,payload=result))

    def test_uncommitted_checkpoint_is_not_visible_but_late_commit_is_retained(self):
        self.enqueue();job=self.worker('claim');self.worker('start',job);connection=self.connection()
        try:
            self.worker('complete',job,payload=self.manifest(job),connection=connection)
            with self.connection() as other,other.cursor() as cursor:
                cursor.execute('SELECT state FROM public.admin_thumbnail_jobs WHERE id=%s',(job['id'],))
                self.assertEqual('provider_started',cursor.fetchone()[0])
            connection.commit()
        finally:connection.close()
        self.assertEqual('succeeded',self.admin('snapshot',job=job['id'])['state'])

    def test_foreign_owner_revoked_worker_and_inactive_owner_are_rejected(self):
        self.enqueue();job=self.worker('claim')
        self.assert_rpc_error('job_not_found',lambda:self.worker('start',job,index=2))
        self.assert_rpc_error('job_not_found',lambda:self.admin('snapshot',job=job['id'],owner=self.other))
        with self.connection(admin=True) as connection,connection.cursor() as cursor:
            cursor.execute('UPDATE public.admin_thumbnail_workers SET disabled=true WHERE token_sha256=%s',(self.workers[0],))
        self.assert_rpc_error('worker_unauthorized',lambda:self.worker('start',job))
        with self.connection(admin=True) as connection,connection.cursor() as cursor:
            cursor.execute("UPDATE public.user_account_status SET account_status='suspended' WHERE user_id=%s",(self.owner,))
        self.assert_rpc_error('owner_forbidden',lambda:self.worker('claim',index=1))

    def test_browser_roles_have_no_table_or_rpc_access_and_owner_is_rechecked(self):
        for role in ['anon','authenticated','privacy_workflow_owner']:
            for statement in ["SELECT * FROM public.admin_thumbnail_jobs", "SELECT public.thumbnail_production_auth_worker('marker')",
                              f"SELECT public.thumbnail_production_admin('{self.owner}','request',NULL,'{uuid.uuid4()}')"]:
                connection=self.connection(admin=True)
                try:
                    with connection.cursor() as cursor:
                        cursor.execute('SET ROLE '+role)
                        with self.assertRaises(psycopg2.Error):cursor.execute(statement)
                finally:connection.rollback();connection.close()

    def test_default_all_privileges_are_removed_only_from_new_queue_objects(self):
        tables={'public.admin_thumbnail_workers':['SELECT','UPDATE'],
                'public.admin_thumbnail_jobs':['INSERT','SELECT','UPDATE'],
                'public.admin_thumbnail_events':['INSERT','SELECT']}
        sequence='public.admin_thumbnail_events_id_seq'
        observed={}; effective={}; grant_options={}
        with self.connection(admin=True) as connection,connection.cursor() as cursor:
            baseline_after=self.acl_baseline(cursor)
            for relation in [*tables,sequence]:
                cursor.execute("""SELECT acl.privilege_type,acl.is_grantable FROM pg_class c,
                  LATERAL aclexplode(coalesce(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 'S'::\"char\" ELSE 'r'::\"char\" END,c.relowner))) acl
                  WHERE c.oid=%s::regclass AND acl.grantee='service_role'::regrole ORDER BY acl.privilege_type""",(relation,))
                entries=cursor.fetchall();observed[relation]=[entry[0] for entry in entries]
                grant_options[relation]=[entry[0] for entry in entries if entry[1]]
                privileges=['SELECT','USAGE','UPDATE'] if relation==sequence else ['DELETE','INSERT','MAINTAIN','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE']
                check='has_sequence_privilege' if relation==sequence else 'has_table_privilege'
                effective[relation]={}
                for privilege in privileges:
                    cursor.execute('SELECT '+check+"('service_role',%s,%s),"+check+"('service_role',%s,%s)",
                                   (relation,privilege,relation,privilege+' WITH GRANT OPTION'))
                    effective[relation][privilege]=list(cursor.fetchone())

        # Exercise actual denied writes as well as catalog ACLs; every probe rolls back.
        forbidden={f'{relation}:{operation}':f'{operation} {"FROM " if operation=="DELETE" else ""}{relation}'
                   for relation in tables for operation in ['DELETE','TRUNCATE']}
        forbidden.update({'workers:INSERT':"INSERT INTO public.admin_thumbnail_workers(owner_id,token_sha256) VALUES('"+self.owner+"','"+sha('unprivileged-worker')+"')",
                          'events:UPDATE':'UPDATE public.admin_thumbnail_events SET operation=operation',
                          'sequence:UPDATE':"SELECT setval('public.admin_thumbnail_events_id_seq',999)"})
        attempts={}
        for name,statement in forbidden.items():
            connection=self.connection()
            try:
                with connection.cursor() as cursor:cursor.execute(statement)
                attempts[name]={'allowed':True,'sqlstate':None}
            except psycopg2.Error as error:attempts[name]={'allowed':False,'sqlstate':error.pgcode}
            finally:connection.rollback();connection.close()
        connection=self.connection()
        try:
            with connection.cursor() as cursor:
                cursor.execute('GRANT SELECT ON public.admin_thumbnail_jobs TO anon')
                cursor.execute("SELECT has_table_privilege('anon','public.admin_thumbnail_jobs','SELECT')")
                browser_grant=cursor.fetchone()[0]
        finally:connection.rollback();connection.close()
        self.observations['default_acl_minimum']={'inheritedDefaults':'ALL WITH GRANT OPTION on public tables and sequences',
            'explicitServiceAcl':observed,'effectivePrivilegesAndGrantOptions':effective,'grantOptions':grant_options,
            'writeProbes':attempts,'serviceCanGrantBrowserSelect':browser_grant,
            'existingObjectsAndDefaultsUnchanged':baseline_after==self.acl_baseline_before}
        expected={**tables,sequence:['SELECT','USAGE']}
        self.assertEqual(expected,observed)
        self.assertTrue(all(not grants for grants in grant_options.values()))
        for relation,privileges in effective.items():
            for privilege,values in privileges.items():self.assertEqual([privilege in expected[relation],False],values)
        self.assertTrue(all(not value['allowed'] and value['sqlstate']=='42501' for value in attempts.values()))
        self.assertFalse(browser_grant)
        self.assertEqual(self.acl_baseline_before,baseline_after)
        # Necessary sequence use still works; existing queue/RPC suites exercise INSERT and UPDATE.
        with self.connection() as connection,connection.cursor() as cursor:
            cursor.execute("SELECT nextval('public.admin_thumbnail_events_id_seq')")
            value=cursor.fetchone()[0]
            cursor.execute('SELECT last_value FROM public.admin_thumbnail_events_id_seq')
            self.assertEqual(value,cursor.fetchone()[0])

    def test_model_registration_and_invalid_manifest_are_fail_closed(self):
        self.assert_rpc_error('invalid_models',lambda:self.worker('models',payload={'models':['gpt-image-2']}))
        self.assertEqual([MODEL],self.worker('models',payload={'models':[MODEL]})['models'])
        self.enqueue();job=self.worker('claim');self.worker('start',job)
        for mutate in [lambda r:r['normalized'].update(path='../public.png'),lambda r:r['provenance'].update(model='gpt-image-2'),
                       lambda r:r['provenance'].update(generatedAt='x'*24),lambda r:r['normalized'].update(width=720)]:
            result=self.manifest(job);mutate(result)
            self.assert_rpc_error('invalid_result',lambda:self.worker('complete',job,payload=result))

    def test_malformed_input_and_unsupported_isolation_are_rejected(self):
        for payload in [{'contract':'thumbnail-gemini-image-v1','model':MODEL,'prompt':'synthetic','references':None},
                        {'contract':'thumbnail-gemini-image-v1','model':MODEL,'prompt':'synthetic','references':{}},
                        {'contract':'thumbnail-gemini-image-v1','model':MODEL,'prompt':42,'references':[]},
                        {'contract':'thumbnail-gemini-image-v1','model':MODEL,'prompt':'synthetic','references':[{}]}]:
            self.assert_rpc_error('invalid_input',lambda:self.admin('enqueue',request=str(uuid.uuid4()),digest=sha('malformed'),payload=payload))
        connection=self.connection()
        try:
            with connection.cursor() as cursor:cursor.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
            self.assert_rpc_error('unsupported_isolation',lambda:self.worker('claim',connection=connection))
        finally:connection.rollback();connection.close()

    def test_history_paginates_without_returning_prompt_or_manifest(self):
        for index in range(35):self.enqueue(prompt='history '+str(index))
        first=self.admin('list');self.assertEqual(32,len(first));self.assertTrue(all('input' not in row and 'result' not in row for row in first))
        cursor={'beforeCreatedAt':first[-1]['createdAt'],'beforeId':first[-1]['id']}
        second=self.admin('list',payload=cursor);self.assertEqual(3,len(second))
        self.assertEqual(35,len({row['id'] for row in first+second}))
        self.assertEqual([],self.admin('list',payload={'beforeCreatedAt':second[-1]['createdAt'],'beforeId':second[-1]['id']}))
        self.assert_rpc_error('invalid_input',lambda:self.admin('list',payload={'beforeId':str(uuid.uuid4())}))

    def test_started_identity_and_terminal_result_cannot_be_reset_by_table_update(self):
        self.enqueue();job=self.worker('claim');self.worker('start',job);self.worker('unknown',job)
        def mutate(statement):
            with self.connection(admin=True) as connection,connection.cursor() as cursor:cursor.execute(statement,(job['id'],))
        self.assert_rpc_error('thumbnail_no_restart',lambda:mutate("UPDATE public.admin_thumbnail_jobs SET state='provider_started',lease_expires_at=clock_timestamp()+interval '1 minute' WHERE id=%s"))
        self.assert_rpc_error('thumbnail_started_identity_immutable',lambda:mutate("UPDATE public.admin_thumbnail_jobs SET attempt_id=gen_random_uuid() WHERE id=%s"))
        self.worker('complete',job,payload=self.manifest(job))
        self.assert_rpc_error('thumbnail_terminal_immutable',lambda:mutate("UPDATE public.admin_thumbnail_jobs SET result=jsonb_set(result,'{original,bytes}','2048') WHERE id=%s"))

    def test_existing_namespace_is_not_silently_adopted_or_rewritten(self):
        job=self.enqueue();connection=self.connection(admin=True)
        try:
            with connection.cursor() as cursor:
                with self.assertRaises(psycopg2.errors.DuplicateSchema):cursor.execute(SQL.read_text())
        finally:connection.rollback();connection.close()
        self.assertEqual(job['id'],self.admin('list')[0]['id'])

    def test_actual_typescript_client_uses_real_sql_start_and_completion(self):
        executable=Path('/Users/twoimo/.bun/bin/bun')
        if not executable.is_file():self.skipTest('installed Bun required; no installation')
        observations=[]
        for mode in ['success','stale-fence','start-ack-lost','response-lost','cancel-after-start']:
            with self.subTest(mode=mode):
                # Only synthetic fixture records in this owned PG cluster are reset between independent journeys.
                with self.connection(admin=True) as connection,connection.cursor() as cursor:
                    cursor.execute('TRUNCATE public.admin_thumbnail_events,public.admin_thumbnail_jobs;')
                env={**self.env,'FIXTURE_PSQL':str(PG/'psql'),'FIXTURE_PG_PORT':str(self.port),'FIXTURE_OWNER_ID':self.owner,
                     'FIXTURE_TOKEN_0':self.workers[0],'FIXTURE_TOKEN_1':self.workers[1]}
                policy='(version 1)(allow default)(deny network*)(allow network-outbound (remote ip "localhost:*"))'
                result=subprocess.run(['/usr/bin/sandbox-exec','-p',policy,str(executable),'--no-env-file','run',str(TS),mode],
                                      cwd=ROOT/'apps/web',env=env,text=True,capture_output=True,timeout=20)
                (self.root/(mode+'.log')).write_text(result.stdout+'\n'+result.stderr)
                self.assertEqual(0,result.returncode,result.stderr)
                observed=json.loads(result.stdout);observations.append(observed)
                self.assertEqual('1.4.0',observed['bunVersion'])
                self.assertTrue(observed['inputBound']);self.assertTrue(observed['realPostgres'])
                self.assertEqual(0 if mode=='start-ack-lost' else 1,observed['sdkCalls'])
        self.observations['actual_typescript_client']=observations

    def test_actual_private_api_store_and_client_use_committed_pg_contract(self):
        executable=Path('/Users/twoimo/.bun/bin/bun')
        if not executable.is_file():self.skipTest('installed Bun required; no installation')
        observations=[]
        for mode in ['normal','checkpoint-ack-lost','normalize-recovery','start-ack-lost',
                     'outbound-normal','outbound-delivery-lost','outbound-start-ack-lost',
                     'outbound-response-lost','outbound-stop-received','outbound-concurrent-observer','outbound-priority-recovery',
                     'browser-normal','browser-ack-lost','browser-cancel-lost',
                     'chat-normal','chat-delivery-lost','chat-start-ack-lost','chat-stop-received']:
            with self.subTest(mode=mode):
                with self.connection(admin=True) as connection,connection.cursor() as cursor:
                    cursor.execute('TRUNCATE public.admin_thumbnail_events,public.admin_thumbnail_jobs;')
                    # Reset only this test's synthetic worker identity, never an operating credential.
                    cursor.execute('UPDATE public.admin_thumbnail_workers SET token_sha256=%s WHERE id=(SELECT id FROM public.admin_thumbnail_workers WHERE owner_id=%s ORDER BY created_at,id LIMIT 1)',(self.workers[0],self.owner))
                env={**self.env,'FIXTURE_PSQL':str(PG/'psql'),'FIXTURE_PG_PORT':str(self.port),
                     'FIXTURE_OWNER_ID':self.owner,'FIXTURE_TOKEN_0':self.workers[0]}
                policy=('(version 1)(allow default)(deny network*)(allow network-outbound (remote ip "localhost:*"))'
                        '(allow network-bind (local ip "localhost:*"))(allow network-inbound (local ip "localhost:*"))')
                result=subprocess.run(['/usr/bin/sandbox-exec','-p',policy,str(executable),'--no-env-file','run',str(PRIVATE_TS),mode],
                                      cwd=ROOT/'apps/web',env=env,text=True,capture_output=True,timeout=25)
                (self.root/('private-'+mode+'.log')).write_text(result.stdout+'\n'+result.stderr)
                self.assertEqual(0,result.returncode,result.stderr)
                observed=json.loads(result.stdout);observations.append(observed)
                self.assertTrue(observed['actualApiHandlers']);self.assertTrue(observed['inputBound'])
                self.assertEqual(0 if mode in ['start-ack-lost','outbound-start-ack-lost','browser-cancel-lost','chat-start-ack-lost'] else 1,observed['sdkCalls'])
                self.assertEqual(0,observed['externalProviderCalls'])
        self.observations['actual_private_api_store_client']=observations


if __name__=='__main__':unittest.main()
