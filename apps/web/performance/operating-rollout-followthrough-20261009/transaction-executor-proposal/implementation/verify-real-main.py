from pathlib import Path
import json,subprocess,uuid,os
exec((Path(__file__).resolve().parent/'fixture-lib.py').read_text())
db='atomic_main_'+uuid.uuid4().hex[:10];owned=False;r={'status':'unconfirmed','operatingWrites':False,'actualCliMain':True,'approvedManifestUnchanged':True}
try:
 run('postgres','CREATE DATABASE '+db+' TEMPLATE '+source+' OWNER postgres;');owned=True
 run(db,'DROP TABLE public.restaurant_refresh_candidates CASCADE;DROP TABLE public.restaurant_refresh_runs CASCADE;','postgres')
 shim=out/'psql-shim';shim.mkdir(exist_ok=True)
 text=r'''#!/opt/homebrew/bin/python3
import os,sys,subprocess,json,re
args=['/opt/homebrew/bin/docker','--context','colima-tzudong-catalog-20261007','exec','-i',CID,'psql']+sys.argv[1:]
r=subprocess.run(args,input=sys.stdin.buffer.read(),capture_output=True);state=re.search(rb'ERROR:\s+([A-Z0-9]{5})',r.stderr);fixed=re.search(rb'\bMIGRATION_[A-Z0-9_]+\b',r.stderr);open(DIAG,'ab').write((json.dumps({'status':r.returncode,'state':state[1].decode() if state else None,'fixed':fixed[0].decode() if fixed else None,'connectionFailure':b'connection' in r.stderr,'syntaxMetaFailure':b'invalid command' in r.stderr})+'\n').encode());sys.stdout.buffer.write(r.stdout);sys.stderr.buffer.write(r.stderr);sys.exit(r.returncode)
'''.replace('CID',repr(cid)).replace('DIAG',repr(str(out/'main-driver-diagnostic.jsonl')));(shim/'psql').write_text(text);(shim/'psql').chmod(0o700)
 env=os.environ.copy();env.update(PATH=str(shim)+':/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:'+env['PATH'],SUPABASE_DB_URL='postgresql://postgres:fixture-only@127.0.0.1:5432/'+db,RELEASE_MIGRATION_MANIFEST_SHA256='515743d094b4b431a29df772a363837bdad8f7541aa3acf4a923efb79f460c0d')
 for k in ['SUPABASE_ACCESS_TOKEN','SUPABASE_PROJECT_REF','SUPABASE_URL','NEXT_PUBLIC_SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY']:env.pop(k,None)
 a=subprocess.run(['/opt/homebrew/opt/node@24/bin/node',str(repo/'apps/web/scripts/apply-supabase-migration.mjs'),'--migration-id','restaurant_refresh_history','--json'],env=env,capture_output=True,text=True,timeout=60)
 if a.returncode:
  import re
  r['failure']={'exit':a.returncode,'fixedCode':re.search(r'code=([A-Z0-9_]+)',a.stderr)[1] if re.search(r'code=([A-Z0-9_]+)',a.stderr) else None}
 else:
  response=json.loads(a.stdout);assert response['migration_applied'] and response['terminal_readback']=={'restaurant_refresh_history_terminal_state':True};r.update(status='passed',terminalReadback=response['terminal_readback'],ledgerVersion='20260531105250',existingUriContractPreserved=True)
  actual=query(db,"SELECT jsonb_build_object('ledger',(SELECT name FROM supabase_migrations.schema_migrations WHERE version='20260531105250'),'statements',(SELECT statements FROM supabase_migrations.schema_migrations WHERE version='20260531105250')); ");assert actual['ledger']=='restaurant_refresh_history' and actual['statements'];r['managedLedgerRecorded']=True
finally:
 if owned:run('postgres','DROP DATABASE '+db+';');r['ownedDbDropped']=True
 (out/'real-main-runtime.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r))
 if r['status']!='passed':raise SystemExit(1)
