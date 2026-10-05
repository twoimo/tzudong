import subprocess,json,re,pathlib,concurrent.futures
OUT=pathlib.Path(__file__).resolve().parent
BASE='repos/twoimo/tzudong'
def inspect_log(job):
 p=subprocess.run(['gh','api','--allow-escape-sequences','--method','GET',BASE+'/actions/jobs/'+str(job)+'/logs'],capture_output=True,text=True,timeout=60)
 s=p.stdout if p.returncode==0 else ''
 lines=[re.sub(r'^\d{4}-\d\d-\d\dT\S+\s*','',l) for l in s.splitlines()]
 package_ranges=[]
 for i,line in enumerate(lines):
  if re.match(r'Severity: (?:low|moderate|high|critical)$',line.strip()) and i:
   prev=lines[i-1].strip()
   if re.fullmatch(r'[@a-zA-Z0-9_./-]+\s+[0-9.*<>=~^| -]+',prev):package_ranges.append({'package_range':prev,'severity':line.strip().split(': ')[1]})
 pip=[]
 for line in lines:
  m=re.match(r'^([a-zA-Z][a-zA-Z0-9_.-]+)\s+([0-9][0-9.a-z-]*)\s+((?:GHSA|PYSEC|CVE)-[A-Za-z0-9-]+)\s*(.*)',line.strip())
  if m:pip.append({'package':m[1],'version':m[2],'advisory':m[3],'fixed_versions':m[4] if re.fullmatch(r'[0-9a-z., -]*',m[4]) else None})
 r={'job_id':job,'retrieved':p.returncode==0,'advisories':sorted(set(re.findall(r'\b(?:GHSA-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}|CVE-\d{4}-\d{4,}|PYSEC-\d{4}-\d+)\b',s))),'npm_package_ranges':package_ranges,'pip_vulnerabilities':pip,'audit_finding_count':re.findall(r'\b\d+ vulnerabilities? \([0-9, a-z]+\)',s),'network_error':bool(re.search(r'ECONNRESET|ENOTFOUND|EAI_AGAIN|CERT_HAS_EXPIRED',s))}
 (OUT/('dependency-job-'+str(job)+'.json')).write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r))
def inspect_check(check):
 p=subprocess.run(['gh','api','--method','GET',BASE+'/check-runs/'+str(check),'--jq','{output:{summary:.output.summary,text:.output.text}}'],capture_output=True,text=True,timeout=40)
 if p.returncode: print(json.dumps({'check':check,'retrieved':False}));return
 d=json.loads(p.stdout);s='\n'.join(v for v in d['output'].values() if isinstance(v,str))
 paths=sorted(set(re.findall(r'\b((?:apps|backend|scripts|\.github)/[A-Za-z0-9_./-]+\.(?:py|ts|tsx|js|mjs|json|yml|yaml|txt))\b',s)))
 r={'check_id':check,'retrieved':True,'referenced_source_paths':paths,'code_scanning_alert_ids':sorted(set(re.findall(r'/code-scanning/(\d+)',s))),'categories_present':{k:bool(re.search(v,s,re.I)) for k,v in {'secret_detected':'(?:secret|incident).{0,35}(?:detected|found)|(?:detected|found).{0,35}(?:secret|incident)','generic_high_entropy':'generic high entropy|generic_high_entropy','quota_limit':'quota|rate.limit|premium request','permission_denied':'not authorized|permission denied|access denied|resource not accessible','scan_failure':'scan.{0,20}fail|analysis.{0,20}fail','no_new_alerts':'no new alerts|no new vulnerabilities'}.items()},'summary_present':bool(s)}
 (OUT/('check-'+str(check)+'-sanitized-output.json')).write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r))
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
 fs=[pool.submit(inspect_log,j) for j in [103781384164,103781384047,101547198170]]+[pool.submit(inspect_check,j) for j in [111356762340,104335906269,111356878685]]
 for f in fs:f.result()
