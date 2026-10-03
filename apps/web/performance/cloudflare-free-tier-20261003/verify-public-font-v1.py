"""Credentialless public object, CORS, cache, range and byte-integrity readback."""
import datetime, hashlib, json
from pathlib import Path
import urllib.request, urllib.error

root=Path(__file__).resolve().parent
url='https://assets.tzudong.app/sha256-8c2eeb55898708b108032eb0baddabfbf7c98a78c3411a2f2601c7bdeff1cfb7--ChosunCentennial_otf.otf'
expected='8c2eeb55898708b108032eb0baddabfbf7c98a78c3411a2f2601c7bdeff1cfb7'
allowed={'content-type','content-length','cache-control','cf-cache-status','access-control-allow-origin','access-control-expose-headers','access-control-allow-methods','access-control-allow-headers','access-control-max-age','content-range','etag','vary','cf-mitigated'}
results=[]
for origin in ['https://www.tzudong.app','https://tzudong.app']:
    for repeat in range(2):
        req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0','Origin':origin})
        try:r=urllib.request.urlopen(req,timeout=30)
        except urllib.error.HTTPError as e:r=e
        with r:
            digest=hashlib.sha256();size=0
            for chunk in iter(lambda:r.read(1048576),b''):digest.update(chunk);size+=len(chunk)
            results.append({'origin':origin,'repeat':repeat,'method':'GET','status':r.status,'bytes':size,'sha256':digest.hexdigest(),'pop':r.headers.get('cf-ray','').split('-')[-1],'headers':{k.lower():v for k,v in r.headers.items() if k.lower() in allowed}})
for method,headers in [('GET',{'Origin':'https://www.tzudong.app','Range':'bytes=0-1023'}),('OPTIONS',{'Origin':'https://www.tzudong.app','Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'Range'}),('HEAD',{'Origin':'https://unapproved.example'})]:
    req=urllib.request.Request(url,method=method,headers={'User-Agent':'Mozilla/5.0',**headers})
    try:r=urllib.request.urlopen(req,timeout=30)
    except urllib.error.HTTPError as e:r=e
    with r:
        size=len(r.read(2048)) if method=='GET' else 0
        results.append({'method':method,'origin':headers['Origin'],'rangeRequested':headers.get('Range'),'status':r.status,'observedBodyBytes':size,'headers':{k.lower():v for k,v in r.headers.items() if k.lower() in allowed}})
result={'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'url':url,'credentialless':True,'publicBodyPersisted':False,'samples':results,'integrityPassed':all(x['status']==200 and x['bytes']==11420784 and x['sha256']==expected for x in results if x['method']=='GET' and 'repeat' in x),'corsPassed':all(x['headers'].get('access-control-allow-origin')==x['origin'] for x in results if x['method']=='GET' and 'repeat' in x),'unauthorizedOriginNotAllowed':'access-control-allow-origin' not in results[-1]['headers'],'fieldPerformanceClaim':False}
with (root/'public-font-cache-cors-readback-v2.json').open('x') as f:json.dump(result,f,indent=2);f.write('\n')
print(json.dumps(result))
