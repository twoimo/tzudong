"""Exact PG17 negative controls against the actual unapplied atomic SQL."""
from pathlib import Path
import subprocess,json,hashlib,re
HERE=Path(__file__).resolve().parent
bundle=(HERE/'atomic-media-migration-v3.sql').read_text()
prefix=['docker','--context','colima-tzudong-catalog-20261007','exec','-i','-e','PGPASSWORD=fixture-only','tzudong-ranking-clone-20261008','psql','-XAtq','-v','ON_ERROR_STOP=1','-h','127.0.0.1']
def run(db,sql,role='supabase_admin'):
    return subprocess.run(prefix+['-U',role,'-d',db],input=sql,text=True,capture_output=True)
marker='  RESET ROLE;\n  IF v_major=15 THEN'
if bundle.count(marker)!=1:raise RuntimeError('INJECTION_BINDING_DENIED')
mutations={
 'defaults':"""  SELECT pg_get_functiondef('public.mutate_review_with_media(uuid,uuid,text,timestamp with time zone,text,text[],text[])'::regprocedure) INTO v_definition;
  IF strpos(v_definition,'p_content text DEFAULT NULL::text')=0 THEN RAISE EXCEPTION 'FIXTURE_DEFAULT_FORM_DENIED'; END IF;
  EXECUTE replace(v_definition,'p_content text DEFAULT NULL::text','p_content text DEFAULT ''fixture-rejected-default''::text');
""",
 'parallel':"  ALTER FUNCTION public.mutate_review_with_media(uuid,uuid,text,timestamp with time zone,text,text[],text[]) PARALLEL SAFE;\n",
}
results=[]
for kind,mutation in mutations.items():
    db='readiness_negative_'+kind+'_20261009'
    p=run('postgres',f"SELECT count(*) FROM pg_database WHERE datname='{db}';")
    if p.returncode or p.stdout.strip()!='0':raise RuntimeError('OWNED_TARGET_ALREADY_EXISTS')
    p=run('postgres',f'CREATE DATABASE {db} TEMPLATE ranking_clone OWNER postgres;')
    if p.returncode:raise RuntimeError('OWNED_CLONE_FAILED')
    injected=bundle.replace(marker,mutation+marker)
    p=run(db,injected,'postgres')
    message=re.search(r'^ERROR:\s+(.+)$',p.stderr,re.M)
    detail=re.search(r'^DETAIL:\s+(\{.+\})$',p.stderr,re.M)
    if p.returncode==0 or not message or message[1]!='review_media_catalog_preservation_drift' or not detail:raise RuntimeError('NEGATIVE_GUARD_FAILED:'+kind)
    data=json.loads(detail[1]);expected='proargdefaults' if kind=='defaults' else 'proparallel'
    if data['changedMetadataFields']!=[expected] or data['functionMetadataPreserved'] is not False or not all(data[k] for k in ['membershipPreserved','assertionsPreserved','publicNamespacePreserved']):raise RuntimeError('NEGATIVE_CLASSIFICATION_FAILED')
    rolled=run(db,"SELECT to_regnamespace('review_media_private') IS NULL;")
    if rolled.returncode or rolled.stdout.strip()!='t':raise RuntimeError('NEGATIVE_ROLLBACK_FAILED')
    results.append({'case':kind,'rejected':True,'code':message[1],'boundedDiagnostics':data,'transactionRolledBack':True})
r={'canonicalAtomicSourceSha256':hashlib.sha256(bundle.encode()).hexdigest(),'engine':'Supabase PostgreSQL17.6','actor':'postgres','cases':results,'realUserRows':0,'operatingWrites':False}
with (HERE/'default-metadata-adversarial-v1.json').open('x') as f:json.dump(r,f,indent=2);f.write('\n')
print(json.dumps({'passed':len(results),'actualSQLNegativeControls':True,'rollbackPassed':True}))
