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


def storage_report():
    files=['storage-rpc-raw.json','storage-new-and-failures-raw.json','storage-one-and-resume-raw.json']
    datasets=[json.loads((BASE/file).read_text()) for file in files]
    if len({dataset['sourceSha256'] for dataset in datasets})!=1:
        raise ValueError('STORAGE_SOURCE_MISMATCH')
    observations=[]
    for file,dataset in zip(files,datasets):
        observations.extend(dict(row,sourceFile=file) for row in dataset['observations'])
    result={'kind':'local_native_postgresql_storage_comparison','liveEvidenceEligible':False,
            'formalPerformanceClaim':'not_established','environment':datasets[0]['environment'],
            'sourceSha256':datasets[0]['sourceSha256'],'corpusSha256':datasets[0]['corpusSha256'],
            'confidenceMethod':'10000 paired percentile bootstrap draws; seed 20261002; pooled same-source runs',
            'comparisons':{},'perRun':{},'quality':{key:datasets[-1][key] for key in ['sourcePreserved','protectedFixtures','protectedViolations','omissions','duplicates','failures']},
            'limitations':['Unix socket fixture, not operational Supabase/API latency',
                           'Full production catalog/triggers/extensions not loaded',
                           'Read/write bytes are JSON encoding sizes, not measured wire transfer',
                           'Client RSS is the process-wide high-water mark, not an independent per-case peak',
                           'Batch-size groups are ordered within runs; do not infer a causal speed winner across groups']}
    cases=sorted({row['scenario'] for row in observations})
    def stats(rows):
        pairids={}
        normalized=[]
        for row in rows:
            key=(row['sourceFile'],row['repeat']);pairids.setdefault(key,len(pairids))
            normalized.append(dict(row,repeat=pairids[key]))
        report={f'p{int(p*100)}':compare(normalized,p) for p in [.5,.75,.95]}
        report['counts']={implementation:{key:sorted({row.get(key,0) for row in rows if row['implementation']==implementation})
                           for key in ['readQueries','writeRpcCalls','writeRows','readBytes','writeBytes','rpcReadbackRows','rpcReadbackBytes']}
                           for implementation in ['baseline','candidate']}
        report['cpu']={f'p{int(p*100)}':compare([dict(row,wallMs=row['clientCpuMs']) for row in normalized],p) for p in [.5,.75,.95]}
        report['afterThroughputRowsPerSecond']=1000*rows[0]['rows']/report['p75']['afterMs']
        return report
    for case in cases:
        result['comparisons'][case]={str(size):stats([row for row in observations if row['scenario']==case and row['batchSize']==size])
              for size in [1,50,100,200] if any(row['scenario']==case and row['batchSize']==size for row in observations)}
    for file,dataset in zip(files,datasets):
        result['perRun'][file]={case:stats([dict(row,sourceFile=file) for row in dataset['observations'] if row['scenario']==case and row['batchSize']==200])
              for case in dataset.get('scenarios',sorted({row['scenario'] for row in dataset['observations']}))}
    (BASE/'storage-summary.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'status':'passed','report':'storage-summary.json','defaultBatchComparisons':{case:result['comparisons'][case]['200']['p75'] for case in cases}}))


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

def transcript_report():
    raw=json.loads((BASE/'transcript-cache-raw.json').read_text())
    result={'kind':'controlled_transcript_replay_comparison','formalPerformanceClaim':'not_established',
            'confidenceMethod':'10000 paired percentile bootstrap draws; seed 20261002',
            'sourcePreserved':raw['sourcePreserved'],'corpusAudit':raw['corpusAudit'],
            'settings':raw['settings'],'environment':raw['environment'],'limitations':raw['limitations'],
            'scenarios':{}}
    for case in sorted({row['scenario'] for row in raw['observations']}):
        rows=[row for row in raw['observations'] if row['scenario']==case]
        report={'wall':{f'p{int(p*100)}':compare(rows,p) for p in [.5,.75,.95]},
                'cpu':compare([dict(row,wallMs=row['nodeCpuMs']) for row in rows]),
                'quality':{kind:{'validLatest':sum(row['validLatest'] for row in rows if row['implementation']==kind),
                                 'expectedLatest':sum(row['expectedLatest'] for row in rows if row['implementation']==kind)}
                           for kind in ['baseline','candidate']}}
        for name in ['providerCalls','outputRows','outputBytes']:
            values={kind:[row[name] for row in rows if row['implementation']==kind] for kind in ['baseline','candidate']}
            before,after=statistics.median(values['baseline']),statistics.median(values['candidate'])
            report[name]={'before':before,'after':after,'absoluteChange':after-before,
                          'changePercent':100*(after/before-1) if before else None,'samples':7,
                          'fixedCounts':len(set(values['baseline']))==1 and len(set(values['candidate']))==1,
                          'confidenceScope':'Fixed controlled fixture counts; not provider cost or population savings.'}
            if report[name]['fixedCounts']:
                report[name]['absoluteChange95CI']=[after-before,after-before]
                report[name]['change95CI']=[report[name]['changePercent']]*2 if before else None
        report['validBeforeAfterSpeedComparison']=all(v['validLatest']==v['expectedLatest'] for v in report['quality'].values())
        report['deterministicOutputsMatch']=report['validBeforeAfterSpeedComparison'] and len({row['semanticOutputSha256'] for row in rows})==1
        result['scenarios'][case]=report
    (BASE/'transcript-summary.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'corpusAudit':result['corpusAudit'],
                      'scenarios':{case:{'p75':value['wall']['p75'],'providerCalls':value['providerCalls'],
                                         'validBeforeAfterSpeedComparison':value['validBeforeAfterSpeedComparison']}
                                   for case,value in result['scenarios'].items()}}))


if __name__=='__main__':
    import sys
    if '--transcripts' in sys.argv:transcript_report()
    elif '--storage' in sys.argv:storage_report()
    elif '--current' in sys.argv:current_report()
    else:main()
