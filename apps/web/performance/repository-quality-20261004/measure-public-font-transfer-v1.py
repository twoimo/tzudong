from pathlib import Path
import argparse,urllib.request,json,hashlib,time,datetime,re
p=argparse.ArgumentParser();p.add_argument('--label',required=True);p.add_argument('--requests',type=int,default=2);a=p.parse_args();assert re.fullmatch(r'[a-z0-9-]+',a.label) and 1<=a.requests<=5
root=Path(__file__).resolve().parent;output=root/('font-transfer-'+a.label+'.json');assert not output.exists()
asset='https://assets.tzudong.app/sha256-8c2eeb55898708b108032eb0baddabfbf7c98a78c3411a2f2601c7bdeff1cfb7--ChosunCentennial_otf.otf';rows=[]
for index in range(a.requests):
    start=time.perf_counter()
    with urllib.request.urlopen(urllib.request.Request(asset,headers={'User-Agent':'Mozilla/5.0 TzudongPublicFontEvidence'}),timeout=45) as response:
        ttfb=(time.perf_counter()-start)*1000;hash_value=hashlib.sha256();size=0
        while True:
            chunk=response.read(262144)
            if not chunk:break
            size+=len(chunk);assert size<=12000000;hash_value.update(chunk)
        rows.append({'trial':index,'status':response.status,'receivedBytes':size,'sha256MatchesName':hash_value.hexdigest()=='8c2eeb55898708b108032eb0baddabfbf7c98a78c3411a2f2601c7bdeff1cfb7','cacheStatus':response.headers.get('CF-Cache-Status'),'cacheControl':response.headers.get('Cache-Control'),'age':response.headers.get('Age'),'ttfbWallMs':ttfb,'completeWallMs':(time.perf_counter()-start)*1000,'bodyStored':False})
result={'capturedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'independentDriverRuns':1,'requestsInDriver':a.requests,'clientCache':'no browser cache; edge not purged','notUIOrFieldSpeedProof':True,'rows':rows}
with output.open('x') as file:json.dump(result,file,indent=2);file.write('\n')
print(json.dumps({'path':output.name,'byteIdentity':all(x['sha256MatchesName'] for x in rows),'timingGainClaimed':False}))
