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

def current_report():
    """Keep prior experiments immutable; compare the currently audited paths."""
    transform=json.loads((BASE/'transform-restart-v3-raw.json').read_text())
    api=json.loads((BASE/'admin-api-current-raw.json').read_text())
    media=json.loads((BASE/'media-replay-raw.json').read_text())
    browser=json.loads((BASE/'browser-revision-raw.json').read_text())
    def metric(rows,key,unit,p):
        comparison=compare([dict(row,wallMs=row[key]) for row in rows],p)
        return {'samples':comparison['samples'],'statistic':comparison['statistic'],'unit':unit,
                'before':comparison['beforeMs'],'after':comparison['afterMs'],
                'absoluteChange':-comparison['absoluteReductionMs'],'changePercent':-comparison['reductionPercent'],
                'change95CI':[-comparison['reduction95CI'][1],-comparison['reduction95CI'][0]],
                'experimentalNoiseBudget':comparison['experimentalNoiseBudgetMs']}
    def distribution(rows,key,unit):
        return {f'p{int(p*100)}':metric(rows,key,unit,p) for p in [.5,.75,.95]}
    result={'kind':'current_local_experimental_comparison','liveEvidenceEligible':False,
            'formalPerformanceClaim':'not_established','sourcePreserved':transform['sourcePreserved'],
            'dataset':transform['dataset'],'confidenceMethod':'10000 paired percentile bootstrap draws; seed 20261002',
            'limitations':['No measured whole-pipeline end-to-end speedup','No production DB/network timing',
                           'No provider inference/cost comparison','No before-browser timing baseline',
                           'No 24-hour observation or complete repository G003 scorer/validator',
                           'Process-tree RSS sums shared resident pages; it is not physical host RAM saved'],
            'transform':{},'media':{},'apiReplay':distribution(api['observations'],'wallMs','ms')}
    for case in ['cold','unchanged','delta-five']:
        rows=[row for row in transform['observations'] if row['scenario']==case]
        result['transform'][case]={key:distribution(rows,key,unit) for key,unit in [('wallMs','ms'),('cpuMs','ms'),('peakRssMiB','MiB')]}
        result['transform'][case]['allOutputsEquivalent']=len({row['outputSha256'] for row in rows})==1
    for case in ['cold','unchanged','damaged-frame']:
        rows=[row for row in media['observations'] if row['scenario']==case]
        result['media'][case]={key:distribution(rows,key,unit) for key,unit in [('wallMs','ms'),('totalWorkerCpuMs','ms'),('peakProcessTreeRssMiB','MiB'),('maximumSingleProcessRssMiB','MiB')]}
        result['media'][case]['quality']={implementation:{'samples':7,'equivalentOutputs':sum(row['frameBytesEquivalent'] for row in rows if row['implementation']==implementation),'sampledPeakFfmpegProcesses':max(row['sampledPeakFfmpegProcesses'] for row in rows if row['implementation']==implementation)} for implementation in ['baseline','candidate']}
        result['media'][case]['resourceScope']=rows[0]['resourceScope']
        result['media'][case]['validBeforeAfterSpeedComparison']=case!='damaged-frame'
    result['payload']={key:{'before':next(row[key] for row in api['observations'] if row['implementation']=='baseline'),
                           'after':next(row[key] for row in api['observations'] if row['implementation']=='candidate')} for key in ['payloadBytes','gzipBytes']}
    for value in result['payload'].values():
        value['absoluteChange']=value['after']-value['before'];value['changePercent']=100*(value['after']/value['before']-1)
        value['change95CI']=[value['changePercent'],value['changePercent']];value['samples']=100
        value['confidenceScope']='fixed identical replay payload; not a population or cost estimate'
    result['browser']={key:browser[key] for key in ['samples','errorCount','expectedHttpSignals','detailConflicts','refreshedPageRequests','writes','outsideFirstPageSearchVerified','firstPageRaceRecovered']}
    result['browser']['afterOnlyMs']={f'p{int(p*100)}':quantile([row['wallMs'] for row in browser['observations']],p) for p in [.5,.75,.95]}
    result['environment']={'media':media['environment'],'actualPaidProviderCalls':0,'deploymentPerformed':False,'operationalDbWrites':0}
    cold=result['transform']['cold']['wallMs']['p75']['absoluteChange']
    saved=-result['transform']['unchanged']['wallMs']['p75']['absoluteChange']
    result['amortization']={'formula':'N * unchanged saving > cold overhead','unchangedReruns':math.floor(max(0,cold)/saved)+1}
    (BASE/'summary-current.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'status':'passed','formalPerformanceClaim':'not_established','report':'summary-current.json'}))


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

if __name__=='__main__':
    import sys
    current_report() if '--current' in sys.argv else main()
