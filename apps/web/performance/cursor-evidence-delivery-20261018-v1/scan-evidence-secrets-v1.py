from pathlib import Path
import re,json,sys
root=Path(sys.argv[1]).resolve();out=Path(sys.argv[2]).resolve()
patterns={
 'supabase-secret':rb'sb_secret_[A-Za-z0-9_-]{16,}',
 'provider-key':rb'(?:sk-proj-|sk-ant-|ghp_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{20,}',
 'aws-access-id':rb'AKIA[A-Z0-9]{16}',
 'private-key':rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
 'jwt':rb'eyJ[A-Za-z0-9_-]{16,}\.eyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}'
}
hits=[];count=0;size=0
for p in sorted(root.rglob('*')):
 if p==out or not p.is_file():continue
 if p.is_symlink():raise SystemExit('SYMLINK_NOT_ADMITTED')
 b=p.read_bytes();count+=1;size+=len(b)
 for kind,pattern in patterns.items():
  n=len(re.findall(pattern,b))
  if n:hits.append({'path':str(p.relative_to(root)),'kind':kind,'count':n})
r={'scope':'bounded credential pattern scan; not a proof of absence of all secrets or personal data','files':count,'bytes':size,'patternNames':list(patterns),'hits':hits,'passed':not hits}
with out.open('x') as f:json.dump(r,f,indent=2);f.write('\n')
print(json.dumps(r))
if hits:raise SystemExit(1)
