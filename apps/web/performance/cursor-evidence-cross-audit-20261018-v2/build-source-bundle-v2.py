"""Hash-bound public source closure for antithesis; no local env/runtime/private data."""
import hashlib,json,subprocess
from pathlib import Path
root=Path(__file__).resolve().parent
repo=root.parents[3]
revision='9228c1454393560bcd37240f793065e450f85683'
main='b4eb780c532c9ba02a1af456b17459debc59a757'
old=root.parent/'cursor-evidence-delivery-20261018-v1/cross-audit-v1/source-index.json'
seed=json.loads(old.read_text())['entries']
paths=[x['path'] for x in seed]+[
 'apps/web/lib/site-config.ts',
 'apps/web/lib/evidence-engineering/badge-viewer-session.ts',
 'apps/web/tests-unit/evidence-badge-viewer-session.test.ts',
 'apps/web/app/home-client.tsx',
 'apps/web/lib/device-location-map.ts',
 'apps/web/lib/privacy/location-readiness.ts',
 'apps/web/app/api/privacy/location-readiness/route.ts',
 'apps/web/package.json',
 'apps/web/components/map/NaverMapView.tsx',
]
out=root/'source_bundle_v2.txt';index=root/'source-index-v2.json'
if out.exists() or index.exists():raise ValueError('PRESERVE_EXISTING_BUNDLE')
text='Tzudong public committed source closure. Revision '+revision+'; equivalent delivered code '+main+'.\n'
text+='NaverMapView is explicitly scoped line excerpts, not full SDK/application certification. No secrets/private runtime/account/location data.\n'
entries=[]
for path in paths:
 b=subprocess.check_output(['git','show',revision+':'+path],cwd=repo)
 assert b==subprocess.check_output(['git','show',main+':'+path],cwd=repo)
 digest=hashlib.sha256(b).hexdigest()
 entry={'path':path,'wholeFileBytes':len(b),'wholeFileSha256':digest}
 text+='\n===== '+path+' | whole-file SHA256 '+digest+' =====\n'
 if path.endswith('/NaverMapView.tsx'):
  lines=b.decode().splitlines(keepends=True);chunks=[]
  for start,end in [(1,80),(400,450),(740,835),(1135,1220)]:
   content=''.join(lines[start-1:end]);text+='\n--- exact lines '+str(start)+'..'+str(end)+' ---\n'+content
   chunks.append({'startLine':start,'endLine':end,'bytes':len(content.encode()),'sha256':hashlib.sha256(content.encode()).hexdigest()})
  entry.update({'completeFile':False,'ranges':chunks,'selectionReason':'Imports, location prop validation, component refs and exact Naver location effect/cleanup; unrelated marker/UI implementation omitted.'})
 else:
  text+=b.decode()+'\n';entry['completeFile']=True
 entries.append(entry)
out.write_text(text)
manifest={'sourceRevision':revision,'equivalentDeliveredMain':main,'codeBytesEqualAcrossCommits':True,'priorNineSourceBundleSha256':'9420e4c1a47230c305c98e9f739571f9a3c188919fac750ee0fd45635902a6ee','entries':entries,'bundleBytes':len(text.encode()),'bundleSha256':hashlib.sha256(text.encode()).hexdigest(),'scope':'18 selected paths including one explicitly partial Naver renderer; not whole dependency/application graph.'}
index.write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'files':len(entries),'bytes':manifest['bundleBytes'],'sha256':manifest['bundleSha256']}))
