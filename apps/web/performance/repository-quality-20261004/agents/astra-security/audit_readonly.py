#!/usr/bin/env python3
"""GET-only GitHub audit. Persist only projected, bounded metadata; no logs/secrets/bodies."""
import concurrent.futures, datetime, json, pathlib, re, subprocess, urllib.parse
BASE='repos/twoimo/tzudong'
OUT=pathlib.Path(__file__).resolve().parent
SOURCE='/Users/twoimo/.codex/worktrees/readiness-core-20261004/tzudong'
HEADERS=('x-oauth-scopes','x-accepted-oauth-scopes','x-accepted-github-permissions','x-ratelimit-remaining','x-github-api-version-selected')
SC='map({number,state,dismissed_reason,created_at,updated_at,fixed_at,rule:{id:.rule.id,severity:.rule.severity,security_severity_level:.rule.security_severity_level},tool:{name:.tool.name,version:.tool.version},most_recent_instance:{ref:.most_recent_instance.ref,state:.most_recent_instance.state,commit_sha:.most_recent_instance.commit_sha,analysis_key:.most_recent_instance.analysis_key,category:.most_recent_instance.category,location:.most_recent_instance.location}})'
QUAL='map({number,state,created_at,rule:{id:.rule.id,title:.rule.title,severity:.rule.severity,category:.rule.category},location})'
SECRET='map({number,state,secret_type,validity,resolution,publicly_leaked,multi_repo,is_base64_encoded,created_at,updated_at})'
DEP='map({number,state,created_at,updated_at,dependency:{package:.dependency.package,manifest_path:.dependency.manifest_path,scope:.dependency.scope,relationship:.dependency.relationship},security_advisory:{ghsa_id:.security_advisory.ghsa_id,cve_id:.security_advisory.cve_id,severity:.security_advisory.severity},security_vulnerability:{package:.security_vulnerability.package,severity:.security_vulnerability.severity,vulnerable_version_range:.security_vulnerability.vulnerable_version_range,first_patched_version:.security_vulnerability.first_patched_version}})'
RUNS='.workflow_runs|map({id,path,head_branch,head_sha,event,status,conclusion,run_attempt,created_at,updated_at,workflow_id,check_suite_id})'
CHECKS='.check_runs|map({id,name,status,conclusion,head_sha,started_at,completed_at,app:{slug:.app.slug},output:{annotations_count:.output.annotations_count}})'

def api(endpoint, projection):
 assert endpoint.startswith(BASE+'/') or endpoint==BASE or endpoint.startswith('repositories/1080324661/'), 'unexpected_repository_endpoint'
 cp=subprocess.run(['gh','api','--method','GET','--include','-H','Accept: application/vnd.github+json','-H','X-GitHub-Api-Version: 2026-03-10',endpoint,'--jq',projection],cwd=SOURCE,capture_output=True,text=True,timeout=90)
 header,_,body=cp.stdout.partition('\n\n')
 hs={}
 status=0
 for line in header.splitlines():
  if line.startswith('HTTP/'):
   m=re.search(r'\s(\d{3})\b',line);status=int(m[1]) if m else 0
  elif ':' in line:
   k,v=line.split(':',1);hs[k.lower()]=v.strip()
 meta={'endpoint':endpoint,'http_status':status,'headers':{k:hs[k] for k in HEADERS if k in hs},'exit_code':cp.returncode,'observed_at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
 if status!=200 or cp.returncode:
  # Known categories only; do not retain provider diagnostic strings.
  t=(body+' '+cp.stderr).lower()
  meta['limitation']='not_enabled' if 'not enabled' in t else 'access_denied' if status==403 else 'not_found_or_not_exposed' if status==404 else 'request_failed'
  return None,meta,None
 try: data=json.loads(body)
 except json.JSONDecodeError:
  meta['limitation']='projection_parse_failed';return None,meta,None
 nxt=None
 for chunk in hs.get('link','').split(','):
  if 'rel="next"' in chunk:
   url=re.search('<([^>]+)>',chunk)[1]
   u=urllib.parse.urlsplit(url)
   assert u.netloc=='api.github.com'
   nxt=u.path.lstrip('/')+('?' + u.query if u.query else '')
 meta['next_page']=bool(nxt)
 return data,meta,nxt

def inventory(name,endpoint,projection,listed=True,quiet=False):
 rows=[];pages=[];seen=set()
 while endpoint:
  assert endpoint not in seen;seen.add(endpoint)
  data,meta,nxt=api(endpoint,projection);pages.append(meta)
  if data is None:break
  if listed:rows.extend(data)
  else:rows=data
  endpoint=nxt if listed else None
 result={'name':name,'complete':all(p['http_status']==200 and p['exit_code']==0 and 'limitation' not in p for p in pages) and not pages[-1].get('next_page',False),'pages':pages,'count':len(rows) if listed else None,'items':rows}
 (OUT/(name+'.json')).write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
 if not quiet or not result['complete'] or result['count']:
  print(json.dumps({'name':name,'complete':result['complete'],'count':result['count'],'pages':len(pages),'statuses':[p['http_status'] for p in pages]},ensure_ascii=False),flush=True)
 return result

def main():
 tasks=[
 ('repository',BASE,'{id,full_name,default_branch,permissions,security_and_analysis,archived,visibility}',False),
 ('code-scanning-open',BASE+'/code-scanning/alerts?state=open&per_page=100',SC,True),
 ('code-scanning-open-main',BASE+'/code-scanning/alerts?state=open&ref=refs%2Fheads%2Fmain&per_page=100',SC,True),
 ('secret-scanning-open',BASE+'/secret-scanning/alerts?state=open&per_page=100',SECRET,True),
 ('dependabot-open',BASE+'/dependabot/alerts?state=open&per_page=100',DEP,True),
 ('code-quality-open',BASE+'/code-quality/findings?state=open&per_page=100',QUAL,True),
 ('code-quality-setup',BASE+'/code-quality/setup','{state,languages,runner_type,updated_at,schedule,ai_findings_option}',False),
 ('code-scanning-setup',BASE+'/code-scanning/default-setup','{state,languages,query_suite,updated_at,schedule,runner_type}',False),
 ('workflows',BASE+'/actions/workflows?per_page=100','.workflows|map({id,name,path,state})',True),
 ]
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
  fs=[pool.submit(inventory,*t) for t in tasks]
  for f in fs:f.result()
 for n in range(80,85):inventory('code-scanning-'+str(n),BASE+'/code-scanning/alerts/'+str(n),'[.]|'+SC,True)
 runs=inventory('failed-runs-30days',BASE+'/actions/runs?status=failure&created=%3E%3D2026-09-04&per_page=100',RUNS,True)
 for branch in ['main','data','develop']:
  ref=inventory('branch-'+branch,BASE+'/branches/'+branch,'{name,protected,commit:{sha:.commit.sha}}',False)
  sha=ref['items'].get('commit',{}).get('sha') if ref['complete'] else None
  if sha:
   inventory('checks-'+branch,BASE+'/commits/'+sha+'/check-runs?filter=latest&per_page=100',CHECKS,True)
   inventory('statuses-'+branch,BASE+'/commits/'+sha+'/statuses?per_page=100','map({id,state,context,created_at,updated_at})',True)
 pr=inventory('pr3111',BASE+'/pulls/3111','{number,state,draft,head:{ref:.head.ref,sha:.head.sha},base:{ref:.base.ref,sha:.base.sha}}',False)
 if pr['complete']:inventory('checks-pr3111',BASE+'/commits/'+pr['items']['head']['sha']+'/check-runs?filter=latest&per_page=100',CHECKS,True)

if __name__=='__main__':main()
