from pathlib import Path
import argparse,subprocess,hashlib,json,re
p=argparse.ArgumentParser();p.add_argument('--repo',required=True);p.add_argument('--commit',required=True);p.add_argument('--root',required=True);p.add_argument('--map',required=True);p.add_argument('--expected-map-sha256',required=True);a=p.parse_args();repo=Path(a.repo).resolve();assert re.fullmatch(r'[a-f0-9]{40}',a.commit) and re.fullmatch(r'[a-f0-9]{64}',a.expected_map_sha256)
entries=subprocess.check_output(['git','ls-tree','-r','-z',a.commit,'--',a.root],cwd=repo).split(b'\0');objects={}
for row in entries:
    if not row:continue
    meta,path=row.split(b'\t',1);mode,kind,oid=meta.decode().split();assert kind=='blob' and mode in ['100644','100755'];objects[path.decode()]=oid
map_path=a.root+'/'+a.map;map_blob=subprocess.check_output(['git','cat-file','blob',objects[map_path]],cwd=repo);assert hashlib.sha256(map_blob).hexdigest()==a.expected_map_sha256;data=json.loads(map_blob)
expected={a.root+'/'+x for x in data['artifacts']}|{map_path};assert expected==set(objects)
process=subprocess.Popen(['git','cat-file','--batch'],cwd=repo,stdin=subprocess.PIPE,stdout=subprocess.PIPE);verified=0;total=0
for name,entry in data['artifacts'].items():
    process.stdin.write((objects[a.root+'/'+name]+'\n').encode());process.stdin.flush();header=process.stdout.readline().decode().strip().split();assert len(header)==3 and header[1]=='blob';length=int(header[2]);assert length==entry['size'];remaining=length;digest=hashlib.sha256()
    while remaining:
        chunk=process.stdout.read(min(262144,remaining));assert chunk;digest.update(chunk);remaining-=len(chunk)
    assert process.stdout.read(1)==b'\n' and digest.hexdigest()==entry['sha256'];verified+=1;total+=length
process.stdin.close();assert process.wait()==0
print(json.dumps({'verifiedCommit':a.commit,'mappedArtifacts':verified,'mappedBytes':total,'artifactMapSha256':a.expected_map_sha256,'allGitBlobBytesMatch':True,'rootFileSetComplete':True,'mapBlobVerifiedSeparately':True,'notGoalCompleteOrPerformanceAdmission':True}))
