from pathlib import Path
import json,uuid,time,subprocess
exec((Path(__file__).resolve().parent/'fixture-lib.py').read_text())
db='tzudong_response_'+uuid.uuid4().hex[:10];app='fixture_response_'+uuid.uuid4().hex;owned=False;p=None;pid=None;r={'status':'unconfirmed','operatingWrites':False,'sourceEdits':False,'scope':'own disposable DB/session only','automaticResend':False}
try:
 run('postgres','CREATE DATABASE '+db+' TEMPLATE '+source+' OWNER postgres;');owned=True
 run(db,'CREATE SCHEMA fixture_executor;CREATE TABLE fixture_executor.journal(version text PRIMARY KEY,source_sha text NOT NULL);','postgres')
 args=docker+['exec','-i','-e','PGPASSWORD=fixture-only',cid,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-U','postgres','-d',db]
 p=subprocess.Popen(args,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 p.stdin.write('SET application_name='+lit(app)+";SELECT jsonb_build_object('pid',pg_backend_pid());\n");p.stdin.flush()
 while pid is None:
  line=p.stdout.readline()
  if line.startswith('{'):pid=json.loads(line)['pid']
 assert query(db,"SELECT jsonb_build_object('admitted',EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid="+str(pid)+" AND datname="+lit(db)+" AND usename='postgres' AND application_name="+lit(app)+'));')['admitted']
 p.stdin.write("BEGIN;CREATE TABLE fixture_executor.committed(id int);INSERT INTO fixture_executor.journal VALUES('response-fixture',repeat('a',64));COMMIT;SELECT pg_sleep(20);\n");p.stdin.flush()
 for _ in range(50):
  a=query(db,"SELECT jsonb_build_object('tablePresent',to_regclass('fixture_executor.committed') IS NOT NULL,'journalPresent',EXISTS(SELECT 1 FROM fixture_executor.journal WHERE version='response-fixture' AND source_sha=repeat('a',64))); ")
  if a=={'tablePresent':True,'journalPresent':True}:break
  time.sleep(.05)
 assert a=={'tablePresent':True,'journalPresent':True}
 # Commit is visible, but the client does not consume a final response. Cut only this fixture client/session.
 assert p.poll() is None
 active=query(db,"SELECT jsonb_build_object('active',EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid="+str(pid)+" AND datname="+lit(db)+" AND application_name="+lit(app)+" AND state='active' AND query LIKE '%pg_sleep(20)%'));")
 assert active['active'];r['clientRunningAndOwnedBackendActiveBeforeCut']=True
 p.terminate();p.wait(timeout=5)
 run(db,'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid='+str(pid)+' AND datname='+lit(db)+' AND usename=\'postgres\' AND application_name='+lit(app)+';','postgres')
 after=query(db,"SELECT jsonb_build_object('tablePresent',to_regclass('fixture_executor.committed') IS NOT NULL,'source',(SELECT source_sha FROM fixture_executor.journal WHERE version='response-fixture')); ");assert after=={'tablePresent':True,'source':'a'*64}
 r.update(status='passed',actualClientCutAfterVisibleCommit=True,clientExit=p.returncode,outcome='response_uncertain_then_fresh_readback_committed',freshConnectionReconciliationExact=True,ownedSessionIdentityChecked=True)
except Exception as e:r['failure']={'kind':type(e).__name__}
finally:
 if p is not None and p.poll() is None:p.terminate();p.wait(timeout=5)
 if owned:run('postgres','DROP DATABASE '+db+';');r['ownedDbDropped']=True
 (out/'response-loss-runtime.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r))
 if r['status']!='passed':raise SystemExit(1)
