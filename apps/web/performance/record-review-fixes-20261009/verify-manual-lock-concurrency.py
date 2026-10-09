from pathlib import Path
import json
out=Path(__file__).resolve().parent;ns={'__file__':str(out/'fixture-lib-lock.py')};exec((out/'fixture-lib-lock.py').read_text(),ns)
seed=ns['seed'].replace('BEGIN;','BEGIN;INSERT INTO pipeline_control.admin_evaluation_catalog_revision(singleton,revision) VALUES(true,0);',1);actor=ns['ids']['actor'];target=ns['ids']['target']
exec((out/'concurrency-final.py').read_text().split('\ntry:\n ins=')[0].replace(r'\bRECORD_ACTION_[A-Z_]+\b',r'\b(?:RECORD_ACTION|REVIEW_AUTOMATION)_[A-Z_]+\b'))
SOURCE=json.loads((out/'lock-three-migration-replay.json').read_text())['database'];NAME='tzudong-manual-lock-20261009';r={'status':'unconfirmed','operatingWrites':False,'serverPrincipal':'service_role','blockerPrincipal':'service_role for policy/data; existing fixture owner for revision lock only'}
def manual(phase,p=None):return 'SELECT public.restaurant_review_automation_manual('+','.join([lit(actor),lit(phase),lit(p['version']) if p else 'NULL',lit(p['previewHash']) if p else 'NULL','gen_random_uuid()' if phase=='run' else 'NULL'])+');'
try:
 c=json.loads(subprocess.check_output([DOCKER,'--context',CONTEXT,'inspect',NAME],text=True))[0];assert c['Config']['Labels']['tzudong.phased-run']==NAME and c['HostConfig']['NetworkMode']=='none';CID=c['Id']
 before=fingerprints(SOURCE);run('postgres','CREATE DATABASE '+DB+' TEMPLATE '+SOURCE+' OWNER postgres;');owned=True
 run(DB,seed+"INSERT INTO pipeline_control.restaurant_review_policy(singleton,version,enabled,operator_id,batch_size,daily_limit) VALUES(true,7,true,"+lit(actor)+",50,50);COMMIT;")
 r['cases']=[]
 for kind in ['policy','data','revision_timeout']:
  a=Session();b=Session();b.begin();p=b.query(manual('preview-run'))[0];assert isinstance(p.get('previewHash'),str) and len(p['previewHash'])==32;b.commit()
  if kind=='revision_timeout':a.query('BEGIN;SELECT 1 FROM pipeline_control.admin_evaluation_catalog_revision WHERE singleton FOR UPDATE;')
  else:
   a.begin();a.query("UPDATE pipeline_control.restaurant_review_policy SET version=version+1 WHERE singleton;" if kind=='policy' else "UPDATE public.restaurants SET phone='concurrent synthetic change' WHERE id="+lit(target)+';')
  box={}
  def worker():
   try:b.begin();box['value']=b.query(manual('run',p))
   except Exception as e:box['error']=e
  thread=threading.Thread(target=worker);start=time.monotonic();thread.start();blocked=observed_block(b.pid,a.pid);assert blocked
  if kind!='revision_timeout':a.commit()
  thread.join(7);assert not thread.is_alive() and isinstance(box.get('error'),SqlError)
  e=box['error']
  if kind=='revision_timeout':assert e.state=='55P03';a.query('ROLLBACK;')
  else:assert e.state=='P0001' and e.code=='REVIEW_AUTOMATION_STALE'
  a.close();b.close();proof=json_query(DB,"SELECT jsonb_build_object('runs',(SELECT count(*) FROM pipeline_control.restaurant_review_runs),'items',(SELECT count(*) FROM pipeline_control.restaurant_review_items),'policyEvents',(SELECT count(*) FROM pipeline_control.restaurant_review_policy_events));");assert proof=={'runs':0,'items':0,'policyEvents':0}
  r['cases'].append({'kind':kind,'actualBlockingObserved':True,'sqlState':e.state,'fixedCode':e.code if e.code!='LOCAL_SQL_FAILED' else None,'noPartialMutation':proof,'revisionTimeoutSeconds':round(time.monotonic()-start,3) if kind=='revision_timeout' else None})
 assert fingerprints(SOURCE)==before;r['sourceFunctionsRolesMembersTriggersExact']=True;r['status']='passed'
except Exception as e:r['failure']={'state':getattr(e,'state',None),'fixedCode':getattr(e,'code',None),'kind':type(e).__name__}
finally:
 for session in sessions:session.close()
 if owned:run('postgres','DROP DATABASE '+DB+';');r['ownedDatabaseDropped']=True
 (out/'manual-lock-concurrency-runtime.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r))
 if r['status']!='passed':raise SystemExit(1)
