"""Local-only reference contract. Fresh prefixed DBs; no hosted discovery."""
from pathlib import Path
import subprocess, json, hashlib, uuid, re
P=Path(__file__).resolve().parents[1]; ROOT=P.parents[3]
CTX='colima-tzudong-catalog-20261007'; CON='tzudong-ranking-clone-20261008'
PREFIX=['docker','--context',CTX,'exec','-i','-e','PGPASSWORD=fixture-only',CON]

def run(db,sql,actor='postgres'):
    p=subprocess.run(PREFIX+['psql','-XAtq','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate','-h','127.0.0.1','-U',actor,'-d',db],input=sql,capture_output=True,text=True,timeout=40)
    if p.returncode: raise RuntimeError('LOCAL_SQL_FAILED:'+','.join(re.findall(r'(?:ERROR|FATAL):\s+([0-9A-Z]{5})',p.stderr)))
    return p.stdout.strip()

def check():
    v=json.loads(subprocess.check_output(['docker','--context',CTX,'inspect',CON]))[0]
    assert v['HostConfig']['NetworkMode']=='none' and not v['NetworkSettings']['Ports']
    assert run('ranking_clone',"SELECT current_setting('server_version');")=='17.6'
    assert run('ranking_clone',"SELECT (SELECT count(*) FROM auth.users)+(SELECT count(*) FROM public.reviews);")=='0'

def fresh(name,template):
    assert re.fullmatch(r'rrel_[0-9a-f]{12}_[a-z_]+',name)
    assert run('postgres',f"SELECT count(*) FROM pg_database WHERE datname='{name}';",'supabase_admin')=='0'
    run('postgres',f'CREATE DATABASE {name} TEMPLATE {template} OWNER postgres;','supabase_admin')

def template_fingerprint():
    scope={ '__file__':str(ROOT/'apps/web/performance/readiness-delivery-20261011/verify_admin_media_forward_v1.py'),'__name__':'fixture_read_only'}
    exec(compile(Path(scope['__file__']).read_text(),scope['__file__'],'exec'),scope)
    sql=scope['FP'].replace('(SELECT count(*) FROM review_media_private.cleanup)',"(to_regnamespace('review_media_private') IS NOT NULL)").replace("'pipeline_control'","'pipeline_control','storage'")
    return json.loads(run('ranking_clone',sql,'supabase_admin'))

def main():
    check(); assert not (P/'reports/fixture.json').exists()
    before=template_fingerprint(); prefix='rrel_'+uuid.uuid4().hex[:12]
    base,final=prefix+'_base',prefix+'_reference'
    fresh(base,'ranking_clone')
    binding=json.loads((ROOT/'apps/web/performance/readiness-operating-20261012/fixture-foundation-binding-v1.json').read_text())
    for row in binding['sources']:
        raw=(ROOT/'backend/supabase/migrations'/row['source']).read_bytes()
        assert len(raw)==row['bytes'] and hashlib.sha256(raw).hexdigest()==row['sha256']
        run(base,raw.decode())
    run(base,'INSERT INTO pipeline_control.admin_evaluation_catalog_revision(singleton) VALUES(true);')
    query=(P/'reports/snapshot.sql').read_text()
    prior=json.loads(run(base,query))
    fresh(final,base)
    bundle=(P/'candidate/backend/supabase/release-bundles/readiness11-v1.sql').read_bytes()
    assert hashlib.sha256(bundle).hexdigest()=='77b34753c68047d3b479484f156e44044d015c53b8e5d459da4b8d1d97f0d1d3'
    run(final,bundle.decode())
    terminal=json.loads(run(final,query))
    assert prior['g041BodySha256']==terminal['g041BodySha256']=='43f3ff2ed914944802555c4ffe3ff8ecece213e82288e2c1c47ae22efdf81585'
    assert prior['adminBodySha256']=='a18fad1f748d736371a9ab549a1ca483a5b2f321674fabe71b2411b7e58b3fc9'
    assert prior['immutableManifestSha256']==terminal['immutableManifestSha256']
    assert prior['membershipSha256']==terminal['membershipSha256']
    prefix_state=json.loads(run(base,"SELECT jsonb_build_object('prefixCount',count(*),'prefixSha256',encode(sha256(convert_to(coalesce(string_agg(row_to_json(m)::text,E'\\n' ORDER BY m.version),''),'UTF8')),'hex')) FROM supabase_migrations.schema_migrations m;"))
    assert template_fingerprint()==before
    doc={'context':CTX,'container':CON,'prefix':prefix,'base':base,'reference':final,'prior':prior,'final':terminal,'ledger':prefix_state,'originalTemplateFingerprint':before,'foundationUnits':6,'localOnly':True}
    (P/'reports/fixture.json').write_text(json.dumps(doc,indent=2)+'\n')
    print(json.dumps({'status':'passed','engine':'17.6','nonsuper':not prior['superuser'],'foundationUnits':6,'readinessUnits':11,'originalTemplateUnchanged':True}))
if __name__=='__main__': main()
