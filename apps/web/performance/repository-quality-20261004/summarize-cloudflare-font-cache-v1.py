from pathlib import Path
import json
root=Path(__file__).resolve().parent
before=json.loads((root/'cloudflare-font-get-baseline-v1.json').read_text())
after=json.loads((root/'cloudflare-font-get-after-v1.json').read_text())
assert all(x['sha256MatchesName'] and x['receivedBytes']==11420784 for x in before['rows']+after['rows'])
assert all(x['cacheStatus']=='HIT' and x['cacheControl']=='max-age=31536000' for x in after['rows'])
print(json.dumps({'byteIdentityVerified':True,'beforeBrowserMaxAgeSeconds':14400,'afterBrowserMaxAgeSeconds':31536000,'afterCacheHits':2,'afterRequests':2,'independentDriversPerPeriod':1,'speedImprovementClaimed':False,'actualCostSavingClaimed':False,'beforeCacheStatesDiffer':['REVALIDATED','HIT']}))
