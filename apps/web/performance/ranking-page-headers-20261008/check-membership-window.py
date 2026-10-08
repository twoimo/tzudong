from pathlib import Path
import subprocess,json,re,hashlib
root=Path(__file__).resolve().parents[4]
source=(root/'backend/supabase/migrations/20261008084856_public_profile_leaderboard_read_boundary.sql').read_text()
a=source[source.index('DO $membership_acquire$'):source.index('SET LOCAL ROLE privacy_workflow_owner;')]
b=source[source.index('DO $membership_cleanup$'):source.index("NOTIFY pgrst")]
cmd=['/opt/homebrew/bin/docker','--context','colima-tzudong-catalog-20261007','exec','-i','-e','PGPASSWORD=fixture-only','tzudong-ranking-clone-20261008','psql','-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate','-h','127.0.0.1','-d','ranking_clone']
def run(sql,user='supabase_admin'):
 r=subprocess.run(cmd+['-U',user],input=sql,text=True,capture_output=True)
 if r.returncode:raise RuntimeError('LOCAL_MEMBERSHIP_WINDOW_FAILED:'+str(re.findall(r'ERROR:\s+([A-Z0-9]{5})',r.stderr)))
 return r.stdout.strip()
state="SELECT md5(jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor)::text) FROM pg_auth_members m;"
baseline=run(state);rows=[]
try:
 for admin,inherit in [(False,True)]:
  run(f"GRANT privacy_workflow_owner TO postgres WITH ADMIN {str(admin).upper()}, INHERIT {str(inherit).upper()}, SET FALSE GRANTED BY postgres;",'postgres')
  before=run(state)
  out=run("BEGIN;\n"+a+"SELECT pg_has_role(session_user,'privacy_workflow_owner','SET');\n"+b+"COMMIT;\n"+state,'postgres').splitlines()
  rows.append({'originalAdmin':admin,'originalInherit':inherit,'setEnabledInWindow':out[0]=='t','allMembershipRowsRestored':before==out[-1]})
  run('REVOKE privacy_workflow_owner FROM postgres GRANTED BY postgres;')
 finally_base=run(state)==baseline
 result={'scope':'actual PG17 membership-window blocks only; not whole canonical PG15/16 replay','sourceSha256':hashlib.sha256(source.encode()).hexdigest(),'cases':rows,'baselineRestored':finally_base,'operatingWrites':False,'status':'passed' if finally_base and all(x['setEnabledInWindow'] and x['allMembershipRowsRestored'] for x in rows) else 'failed'}
finally:
 # This row is created only by this isolated fixture. Other grantor rows stay intact.
 run('REVOKE privacy_workflow_owner FROM postgres GRANTED BY postgres;')
Path(__file__).with_name('membership-window-v1.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
