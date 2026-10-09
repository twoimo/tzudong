from pathlib import Path
import json
out=Path(__file__).resolve().parent
ns={'__file__':str(out/'fixture-lib-final.py')};exec((out/'fixture-lib-final.py').read_text(),ns)
seed=ns['seed'].replace('BEGIN;','BEGIN;',1).rsplit('',1) if False else ns['seed']
actor=ns['ids']['actor'];changes=dict(ns['payload']);changes.pop('name');changes['geocoding_success']=True
exec((out/'concurrency-final.py').read_text().split('\ntry:\n ins=')[0])
r={'status':'unconfirmed','operatingWrites':False,'schemaFixture':'actual composite video/name index'}
try:
 c=json.loads(subprocess.check_output([DOCKER,'--context',CONTEXT,'inspect',NAME],text=True))[0];assert c['Config']['Labels']['tzudong.phased-run']==NAME;CID=c['Id']
 initial=fingerprints(SOURCE);run('postgres','CREATE DATABASE '+DB+' TEMPLATE '+SOURCE+' OWNER postgres;');owned=True
 run(DB,seed+'COMMIT;');index=json_query(DB,"SELECT jsonb_build_object('name',relname,'definition',pg_get_indexdef(oid)) FROM pg_class WHERE oid='public.idx_restaurants_active_video_identity'::regclass;");r['indexName']=index['name'];r['indexDefinitionSha256']=sha(index['definition'])
 def create(phase,op,h=None):return 'SELECT public.admin_record_action('+','.join([lit(actor),lit(phase),lit(op),"'restaurant.create'",'ARRAY[]::uuid[]',jlit({'changes':changes}),lit(h) if h else 'NULL'])+');'
 a=Session();b=Session();op1=str(uuid.uuid4());op2=str(uuid.uuid4());a.begin();p1=a.receipt(create('preview',op1));a.commit();b.begin();p2=b.receipt(create('preview',op2));b.commit()
 winner,loser=contended(a,b,create('apply',op1,p1['previewHash']),create('apply',op2,p2['previewHash']),'RECORD_ACTION_DUPLICATE');assert loser['sqlState']=='P0001'
 r['actualUniqueRace']=loser;r['winnerApplied']=winner['state']=='applied';a.close();b.close()
 proof=json_query(DB,"SELECT jsonb_build_object('winnerAudit',(SELECT count(*) FROM pipeline_control.admin_record_audit WHERE operation_id="+lit(op1)+"),'loserAudit',(SELECT count(*) FROM pipeline_control.admin_record_audit WHERE operation_id="+lit(op2)+"),'created',(SELECT count(*) FROM public.restaurants WHERE approved_name='Phase Submitted'),'loserState',(SELECT state FROM pipeline_control.admin_record_operations WHERE id="+lit(op2)+"));")
 assert proof=={'winnerAudit':1,'loserAudit':0,'created':1,'loserState':'preview'};r['boundedConflictNoPartialCommit']=proof;assert fingerprints(SOURCE)==initial;r['sourceMetadataPreserved']=True;r['status']='passed'
except Exception as e:r['failure']={'fixedCode':getattr(e,'code',None),'state':getattr(e,'state',None),'kind':type(e).__name__}
finally:
 for session in sessions:session.close()
 if owned:run('postgres','DROP DATABASE '+DB+';');r['ownedDatabaseDropped']=True
 (out/'composite-race-runtime-final.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r))
 if r['status']!='passed':raise SystemExit(1)
