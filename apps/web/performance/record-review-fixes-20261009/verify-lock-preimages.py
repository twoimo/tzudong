from pathlib import Path
import json,re
exec((Path(__file__).resolve().parent/'fixture-lib-lock.py').read_text())
db=json.loads((out/'lock-three-migration-replay.json').read_text())['database'];path=repo/'backend/supabase/migrations/20261009022915_restaurant_review_manual_preview_eligibility.sql';sql=path.read_text();wrapped=re.sub(r'^COMMIT;$','',re.sub(r'^BEGIN;$','',sql,count=1,flags=re.M),count=1,flags=re.M)
r={'status':'unconfirmed','operatingWrites':False,'migrationSha256':digest(sql),'cases':[]}
try:
 before=query(db,state_sql);sh=schema(db)
 for sig,code in [('public.restaurant_review_automation_manual(uuid,text,text,text,uuid)','REVIEW_MANUAL_LOCK_SOURCE_DRIFT'),('pipeline_control.lock_restaurant_review_catalog_revision()','REVIEW_MANUAL_LOCK_HELPER_DRIFT')]:
  drift="DO $drift$ DECLARE t oid:="+lit(sig)+"::regprocedure;s text;BEGIN SELECT prosrc INTO s FROM pg_proc WHERE oid=t;EXECUTE replace(pg_get_functiondef(t),s,s||E'\\n-- synthetic byte drift');END $drift$;"
  try:run(db,'BEGIN;'+drift+wrapped+'ROLLBACK;','postgres');raise AssertionError('DRIFT_ACCEPTED')
  except SqlFailure as e:assert e.state=='P0001' and e.fixedCode==code
  assert schema(db)==sh and query(db,state_sql)==before;r['cases'].append({'target':sig,'fixedCode':code,'exactRollback':True})
 run(db,assertions);r['g014Passed']=4;r['status']='passed'
except Exception as e:r['failure']={'state':e.state,'fixedCode':e.fixedCode} if isinstance(e,SqlFailure) else {'kind':type(e).__name__}
finally:
 (out/'fixed-lock-preimage-negatives.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r))
 if r['status']!='passed':raise SystemExit(1)
