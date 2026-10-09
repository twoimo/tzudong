"""Existing-only CLI authentication; response bodies/headers stay in memory."""
import subprocess,os,json,re
from pathlib import Path
from urllib.parse import urlsplit
root=Path('performance/vercel-preview-diagnosis-20261009')
api=subprocess.run(['vercel','api','/v9/projects/prj_sau35J5uUtShIQ9OKofRtOVVnTSl?teamId=team_OUj64KeLxJI3PkEbOaFZnorA','--method','GET','--non-interactive'],capture_output=True,text=True,timeout=40)
assert api.returncode==0
project=json.loads(api.stdout);assert project['id']=='prj_sau35J5uUtShIQ9OKofRtOVVnTSl' and project['accountId']=='team_OUj64KeLxJI3PkEbOaFZnorA'
existing=[key for key,scope in (project.get('protectionBypass') or {}).items() if scope.get('scope')=='automation-bypass'];assert existing,'Existing-only credential unavailable'
env=dict(os.environ,VERCEL_AUTOMATION_BYPASS_SECRET=existing[0]);origin='https://tzudong-76i12vmwe-twoimos-projects.vercel.app'
matrix=json.loads(Path('performance/public-cms-followthrough-20261009/accepted-route-matrix.json').read_text())
paths=[row['routePattern'].replace('[code]','invalid-public-cms-check').replace('[userId]','public-cms-check-not-real') for row in matrix]
paths+=['/admin','/api/admin/knowledge-graph','/api/admin/users','/api/admin/pipeline','/api/admin/restaurant-refresh-history']
records=[]
for path in paths:
 response=subprocess.run(['vercel','curl',origin+path,'--','--silent','--show-error','--max-time','30','--request','GET','--dump-header','-'],env=env,capture_output=True,text=True,timeout=45)
 raw=response.stdout.replace('\r\n','\n');matches=list(re.finditer(r'(?m)^HTTP/\S+ (\d+)[^\n]*\n',raw));status=int(matches[-1].group(1)) if matches else None
 headers={};body=''
 if matches:
  start=matches[-1].start();end=raw.find('\n\n',start);head=raw[start:end];body=raw[end+2:]
  for line in head.splitlines()[1:]:
   if ':' in line:key,value=line.split(':',1);headers[key.lower()]=value.strip()
 record={'path':path,'method':'GET','cliExit':response.returncode,'httpStatus':status,'contentType':headers.get('content-type'),'cacheControl':headers.get('cache-control'),'vercelErrorCode':headers.get('x-vercel-error'),'bodyBytes':len(body.encode()),'platformProtectionPage':bool(re.search(r'Authentication Required|Vercel Authentication|Log in to Vercel',body)),'locationPath':urlsplit(headers['location']).path if 'location' in headers else None}
 if path.startswith('/api/admin/'):
  try:
   value=json.loads(body);code=value.get('code') or value.get('error') if isinstance(value,dict) else None
   record['boundedErrorCode']=code if code in ['Unauthorized','Forbidden','UNAUTHORIZED','FORBIDDEN'] else 'unclassified'
  except:record['jsonResponse']=False
 records.append(record)
 if path.startswith('/api/admin/') and status not in [401,403]:break
report={'deploymentId':'dpl_He2HgNHEkNsdbQg556dGJsreTEgr','gitSha':'614b249175c35636a7062bf05cb01ebad538b10d','origin':origin,'officialClient':'vercel curl56.5.0 fullURL','existingCredentialOnly':True,'newTokensSettingsOrDeploymentWrites':0,'cookiesRawHeadersBodiesOrKeysExported':False,'operatingMutationRequests':0,'records':records}
(root/'merge-preview-http-routes.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'routes':len(records),'httpStatuses':{str(status):sum(r['httpStatus']==status for r in records) for status in set(r['httpStatus'] for r in records)},'adminAnonymous':[{k:r[k] for k in ['path','httpStatus','boundedErrorCode']} for r in records if r['path'].startswith('/api/admin/')]}))
