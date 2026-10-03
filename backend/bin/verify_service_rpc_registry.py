from pathlib import Path
import json,uuid,hashlib
import psycopg2
root=Path(__file__).resolve().parents[2]
file=root/'backend/supabase/migrations/20261003065736_g014_current_service_rpc_registry.sql'
sql=file.read_text();db='registry_'+uuid.uuid4().hex
params=dict(host='/Users/twoimo/.codex/runtime-cache/tzudong-postgresql-17.6/socket',port=18797,user='postgres')
admin=psycopg2.connect(dbname='postgres',**params);admin.autocommit=True
signatures=['confirm_privacy_onboarding(uuid,text,uuid,text,uuid,text)','extract_youtube_video_id(text)','normalize_restaurant_identity_name(text)','record_app_web_vitals(text,text,text,text,smallint)','record_app_web_vitals_bounded(text,text,text,text,smallint)','resolve_restaurant_identity_name(text,text,text,text)']
checks={}
try:
 with admin.cursor() as c:c.execute('CREATE DATABASE '+db)
 conn=psycopg2.connect(dbname=db,**params)
 conn.autocommit=True
 with conn.cursor() as c:
  c.execute('SHOW server_version');version=c.fetchone()[0]
  c.execute('CREATE SCHEMA privacy_retention; CREATE TABLE privacy_retention.g014_public_rpc_allowlist(function_schema name,function_name name,identity_arguments text,grantee name,source_signature text,UNIQUE(source_signature,grantee));')
  for sig in signatures:
   c.execute('CREATE FUNCTION public.'+sig+" RETURNS boolean LANGUAGE sql AS 'SELECT true'; REVOKE ALL ON FUNCTION public."+sig+' FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.'+sig+' TO service_role;')
  def acl():
   c.execute("SELECT proname,proacl::text FROM pg_proc WHERE pronamespace='public'::regnamespace ORDER BY proname");return c.fetchall()
  before=acl()
  c.execute('REVOKE EXECUTE ON FUNCTION public.extract_youtube_video_id(text) FROM service_role')
  try:c.execute(sql);raise AssertionError('missing-grant-admitted')
  except psycopg2.Error as e:checks['missing_existing_grant_denied']='G014_SERVICE_REGISTRY_PREREQUISITE_UNAVAILABLE' in str(e)
  c.execute('ROLLBACK');c.execute('SELECT count(*) FROM privacy_retention.g014_public_rpc_allowlist');checks['failed_transaction_writes_zero']=c.fetchone()[0]==0
  c.execute('GRANT EXECUTE ON FUNCTION public.extract_youtube_video_id(text) TO service_role');c.execute(sql)
  c.execute('SELECT count(*) FROM privacy_retention.g014_public_rpc_allowlist');checks['six_exact_entries']=c.fetchone()[0]==6
  checks['execute_acl_unchanged']=acl()==before
  c.execute(sql);c.execute('SELECT count(*) FROM privacy_retention.g014_public_rpc_allowlist');checks['idempotent_rows']=c.fetchone()[0]==6
  c.execute('DROP FUNCTION public.resolve_restaurant_identity_name(text,text,text,text)')
  try:c.execute(sql);raise AssertionError('missing-function-admitted')
  except psycopg2.Error as e:checks['missing_signature_denied']='G014_SERVICE_REGISTRY_PREREQUISITE_UNAVAILABLE' in str(e)
  c.execute('ROLLBACK')
 report={'kind':'local-service-rpc-registry-verification','postgresVersion':version,'operationalDatabaseChanges':False,'migrationSha256':hashlib.sha256(file.read_bytes()).hexdigest(),'assertions':checks,'pass':all(checks.values())}
 (root/'apps/web/performance/ui-renewal-20261003/service-registry-local.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report));assert report['pass']
finally:
 if 'conn' in locals():conn.close()
 with admin.cursor() as c:c.execute('DROP DATABASE IF EXISTS '+db+' WITH (FORCE)')
 admin.close()
