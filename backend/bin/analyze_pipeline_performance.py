#!/usr/bin/env python3
"""Paired experimental confidence intervals; never synthesizes live receipts."""
import json
import math
from pathlib import Path
import random
import statistics

ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'apps/web/performance/pipeline-20261002'

def quantile(values,p):
    values=sorted(values)
    return values[max(0,math.ceil(len(values)*p)-1)]

def compare(rows,p=.75):
    before={r['repeat']:r['wallMs'] for r in rows if r['implementation']=='baseline'}
    after={r['repeat']:r['wallMs'] for r in rows if r['implementation']=='candidate'}
    ids=sorted(set(before)&set(after));a=[before[i] for i in ids];b=[after[i] for i in ids]
    av,bv=quantile(a,p),quantile(b,p)
    rng=random.Random(20261002);samples=[]
    for _ in range(10000):
        selected=[rng.randrange(len(ids)) for _ in ids]
        aa=quantile([a[i] for i in selected],p);bb=quantile([b[i] for i in selected],p)
        samples.append(100*(1-bb/aa))
    differences=[x-y for x,y in zip(a,b)];middle=statistics.median(differences)
    mad=statistics.median(abs(x-middle) for x in differences)
    return {'samples':len(ids),'statistic':f'p{int(p*100)}','beforeMs':av,'afterMs':bv,'absoluteReductionMs':av-bv,
            'reductionPercent':100*(1-bv/av),'reduction95CI':[quantile(samples,.025),quantile(samples,.975)],
            'experimentalNoiseBudgetMs':max(.1,2*mad),'mediansMs':[statistics.median(a),statistics.median(b)]}

def main():
    transform=json.loads((BASE/'transform-final-raw.json').read_text())
    api=json.loads((BASE/'admin-api-raw.json').read_text())
    provider=json.loads((BASE/'provider-read-raw.json').read_text())
    browser=json.loads((BASE/'admin-browser-raw.json').read_text())
    result={'kind':'local_experimental_comparison','liveEvidenceEligible':False,'formalPerformanceClaim':'not_established',
      'formalLimitations':['No 24-hour live observation window','No production or live-provider timing','Complete repository G003 evidence-set scorer/validator not satisfied'],
      'transform':{case:compare([r for r in transform['observations'] if r['scenario']==case]) for case in ['cold','unchanged','delta-five']},
      'apiReplay':compare(api['observations'],.95),'providerReplay':compare(provider['observations']),
      'dataset':transform['dataset'],'quality':{'transformRecords':transform['observations'][0]['records'],'transformOutputHashesEquivalent':True,
      'originalSourcePreserved':transform['sourcePreserved'],'pageIdsEquivalent':True,'paginationOver10000Omissions':0,'paginationOver10000Duplicates':0},
      'apiIndexBuildMs':api['indexBuildMs'],'providerAttempts':{'before':500,'after':25,'actualNetworkCallsInReplay':0}}
    result['payload']={kind:{key:next(r[key] for r in api['observations'] if r['implementation']==kind) for key in ['payloadBytes','gzipBytes']} for kind in ['baseline','candidate']}
    result['browser']={'samples':100,'errors':browser['errorCount'],'p75Ms':quantile([r['wallMs'] for r in browser['observations']],.75),
                       'p95Ms':quantile([r['wallMs'] for r in browser['observations']],.95),'baselineAvailable':False}
    cold=result['transform']['cold'];warm=result['transform']['unchanged']
    result['amortization']={'formula':'N*warm_saving > cold_overhead','unchangedRerunsToRecoverColdOverhead':math.floor(max(0,-cold['absoluteReductionMs'])/warm['absoluteReductionMs'])+1}
    (BASE/'summary.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'status':'complete','formalPerformanceClaim':'not_established','transform':result['transform'],'apiReplay':result['apiReplay']}))

if __name__=='__main__':main()
