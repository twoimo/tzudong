#!/usr/bin/env python3
"""Deterministic paired component summary; never extrapolates hosted savings."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import random
import statistics


def quantile(values,p):
    values=sorted(values);at=(len(values)-1)*p;a=int(at);b=min(a+1,len(values)-1)
    return values[a]+(values[b]-values[a])*(at-a)


def percentiles(values):return {'p50':quantile(values,.5),'p75':quantile(values,.75),'p95':quantile(values,.95)}


def compare(before,after):
    delta=[b-a for a,b in zip(before,after,strict=True)]
    relative=[100*(b/a-1) for a,b in zip(before,after,strict=True)]
    rng=random.Random(20261005)
    indices=[[rng.randrange(len(before)) for _ in before] for _ in range(20000)]
    def interval(values):
        means=sorted(statistics.fmean(values[i] for i in sample) for sample in indices)
        return [quantile(means,.025),quantile(means,.975)]
    return {'stream':percentiles(before),'adaptive':percentiles(after),'pairedAbsoluteMean':statistics.fmean(delta),
      'pairedAbsolute95CI':interval(delta),'pairedChangePercentMean':statistics.fmean(relative),'pairedChangePercent95CI':interval(relative),
      'medianChangePercent':100*(statistics.median(after)/statistics.median(before)-1),'regressedPairs':sum(b>a for a,b in zip(before,after,strict=True)),
      'pairs':len(before)}


def main():
    parser=argparse.ArgumentParser();parser.add_argument('source',type=Path);parser.add_argument('output',type=Path);args=parser.parse_args()
    if args.output.exists():raise RuntimeError('fresh_output_required')
    source=json.loads(args.source.read_text())
    if source['status']!='complete' or source['sourceBefore']!=source['sourceAfter']:raise RuntimeError('unadmitted_source')
    report={'sourceArtifact':str(args.source),'sourceArtifactSha256':hashlib.sha256(args.source.read_bytes()).hexdigest(),
      'scope':source['scope'],'cacheState':source['cacheState'],'environment':source['environment'],'postgres':source['postgres'],
      'uncertainty':'7 alternating pairs per condition; deterministic paired percentile bootstrap, 20000 draws seed 20261005, mean absolute/within-pair relative change. Empirical CI on this local shared host; not a guarantee or hosted population interval.',
      'conditions':[],'resourceCounts':{'pairedReads':0,'pairedRpcOrStreamCalls':0,'httpPageReadTrials':0,'httpGets':0,'httpRpcCalls':0,'fullReferenceMatchedReads':0}}
    for condition in source['conditions']:
        if condition['inputBefore']!=condition['inputAfter']:raise RuntimeError('input_drift')
        grouped={mode:sorted([v for v in condition['observations'] if v['mode']==mode],key=lambda v:v['pair']) for mode in ['stream','raw']}
        if len(grouped['stream'])!=7 or len(grouped['raw'])!=7:raise RuntimeError('seven_pairs_required')
        metrics={key:compare([v[key] for v in grouped['stream']],[v[key] for v in grouped['raw']]) for key in ['endToEndMs','dbReadMs','nodeWorkMs','nodeCpuMs','maxRssKiB','bytes','requests']}
        http=condition['httpDecoder'];observations=http['observations']
        for observed in condition['observations']+observations:
            if observed['digest']!=condition['oracleDigest']:raise RuntimeError('reference_mismatch')
        entry={key:condition[key] for key in ['name','rows','targets','groups','codec','oracleDigest','inputBefore','inputAfter','densityStageExecutedByRPC']}
        entry.update(metrics=metrics,http={'pageReadTrials':http['pageReadTrials'],'stats':http['stats'],
         'scope':http['scope'],'metrics':{key:percentiles([v[key] for v in observations]) for key in ['wallMs','cpuMs','decoderMs','decoderCpuMs','maxRssKiB','bytes','requests']},
         'maxBodyBytes':max(v['maxBatchBytes'] for v in observations)},
         sqlStages={key:{'executionMs':condition[key][0]['Execution Time'],'planningMs':condition[key][0]['Planning Time'],
                        'actualRows':condition[key][0]['Plan']['Actual Rows'],'rootTempWrittenBlocks':condition[key][0]['Plan'].get('Temp Written Blocks',0)}
                    for key in ['densityStageExplain','flatProjectionStageExplain']})
        # Density is recalculated on every first read. There is no cross-read
        # cache or one-time investment to amortize; report one-request break-even.
        saving=metrics['endToEndMs']['stream']['p50']-metrics['endToEndMs']['adaptive']['p50']
        entry['amortization']={'crossReadReuse':False,'readsToNetMeasuredSaving':1 if saving>0 else None,'reason':'Planning cost is paid on each read; negative savings do not amortize by repetition.'}
        report['conditions'].append(entry)
        counts=report['resourceCounts'];counts['pairedReads']+=len(condition['observations']);counts['pairedRpcOrStreamCalls']+=sum(v['requests'] for v in condition['observations'])
        counts['httpPageReadTrials']+=http['pageReadTrials'];counts['httpGets']+=http['stats']['httpGets'];counts['httpRpcCalls']+=http['stats']['rpcCalls'];counts['fullReferenceMatchedReads']+=len(condition['observations'])+len(observations)
    report['sourceSha256']=source['sourceAfter']
    args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'conditions':[{ 'name':c['name'],**{key:{'before':v['stream']['p50'],'after':v['adaptive']['p50'],'percent':v['pairedChangePercentMean'],'ci':v['pairedChangePercent95CI'],'worse':v['regressedPairs']} for key,v in c['metrics'].items() if key in ['endToEndMs','nodeCpuMs','maxRssKiB','bytes','requests']}} for c in report['conditions']],'counts':report['resourceCounts']},indent=2))


if __name__=='__main__':main()
