#!/usr/bin/env python3
"""Independent readback/scoring of retained offline media replay evidence."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import statistics


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('directory',type=Path)
    args=parser.parse_args();root=args.directory.resolve()
    read=lambda name:json.loads((root/name).read_text())
    raw=read('raw.json');config=read('configuration.json');manifest=read('artifact-map.json')
    if (root/'artifact-map.json.sha256').read_text().strip()!=digest(root/'artifact-map.json'):
        raise ValueError('ARTIFACT_MAP_HASH_MISMATCH')
    if not all(digest(root/name)==expected for name,expected in manifest.items()):
        raise ValueError('ARTIFACT_HASH_MISMATCH')
    frozen=root/'benchmark-source.py'
    spec=importlib.util.spec_from_file_location('frozen_benchmark',frozen)
    benchmark=importlib.util.module_from_spec(spec);spec.loader.exec_module(benchmark)
    checks={
        'sevenAlternatingPairs':len(raw)==28 and all(len([r for r in raw if r['pair']==i])==4 for i in range(7)),
        'corpusBeforeAfterExact':read('corpus-before.json')==read('corpus-after.json'),
        'allFrameCounts48':all(r['outputs']['frames']==48 and r['outputs']['failedSegments']==0 for r in raw),
        'allOutputsExactAndNoDuplicates':all(r['exactOutputEquivalent'] and r['outputs']['duplicates']==0 for r in raw),
        'allThreeProtectedRowsUnchanged':all(r['adminProtectedRowsUnchanged'] for r in raw),
        'frozenSourceHashes':all(digest(root/'frozen-source'/implementation/path)==expected for implementation,paths in config['sourceHashes'].items() for path,expected in paths.items()),
    }
    expected=[]
    original=Path('/Users/twoimo/Documents/projects/tzudong')
    for row in config['selectedCorpus']:
        expected.append([row['video']+'.jsonl',benchmark.sha(benchmark.canonical(benchmark.last(original/row['archivedEvaluation'])))])
    checks['allArchivedEvaluationValuesExact']=all(row['outputs']['evaluations']==expected for row in raw)
    checks['evaluationPromptsExact']=True
    checks['eventCountsExact']=True
    for pair in range(7):
        by_implementation={}
        for implementation in ['baseline','candidate']:
            events=read(f'traces/pair-{pair}-{implementation}-cold.json')
            by_implementation[implementation]=sorted((e['video'],e['promptSha256']) for e in events if e['kind']=='provider-start' and e.get('video'))
            recorded=next(row for row in raw if row['pair']==pair and row['implementation']==implementation and row['phase']=='cold')
            checks['eventCountsExact'] &= all(recorded[key]==value for key,value in benchmark.event_summary(events).items())
        checks['evaluationPromptsExact'] &= by_implementation['baseline']==by_implementation['candidate']
    # These are real regressions/limits, not rejected samples to omit.
    score={}
    for phase in ['cold','restart']:
        rows=[r for r in raw if r['phase']==phase]
        score[phase]={}
        for name in ['wallMs','cpuMs','peakTreeRssMiB','mediaMs','laajMs','transformMs']:
            values=[{**r,'value':r[name] if name in r else r[name[:-2]]['wallMs']} for r in rows]
            summary=benchmark.paired_summary(values,'value')
            b,a=summary['baselineMean'],summary['candidateMean']
            summary['relativeReductionRatioOfMeansPercent']=(b-a)/b*100 if b else None
            cv=[summary['baselineCvPercent'],summary['candidateCvPercent']]
            summary['within20PercentCvNoiseBudget']=all(x is not None and x<=20 for x in cv)
            summary['admittedForLivePerformanceClaim']=False
            score[phase][name]=summary
    checks['candidateOneProcessCap4']=max(r['exactPeakFfmpegCommands'] for r in raw if r['implementation']=='candidate')==4
    if not all(checks.values()):
        raise ValueError('INDEPENDENT_VALIDATION_FAILED '+','.join(k for k,v in checks.items() if not v))
    result={'checks':checks,'allPassed':True,'scores':score,
            'paidCalls':0,'liveEvidenceEligible':False,'fullEndToEndGoalComplete':False,
            'criticalInterpretation':'Provider CLI replay bypasses Node SDK and its real project admission/pacing. Baseline retains unconditional 2 seconds per video while candidate delegates pacing to the bypassed adapter. Summed wall-time difference must not be claimed as live or admitted-budget speedup.',
            'resourceInterpretation':'The deterministic ffmpeg command peak is process-local: 12 to 4 for three videos in one Node process. Two concurrent Node processes reached 8; there is no host-wide media cap of 4.',
            'adminInterpretation':'Three synthetic admin-owned transform rows were preserved. This does not establish database CAS or rendered admin preservation.',
            'statistics':'N=7 same-host alternating pairs. Absolute intervals use paired t(df=6), plus seeded 10000-resample paired percentile bootstrap. Wall is the sum of three separate subprocess measurements, not a timed full-worker graph.'}
    benchmark.write_json(root/'independent-score-validation.json',result)
    print(json.dumps({'allPassed':True,'checks':checks,'liveEvidenceEligible':False},indent=2))


if __name__=='__main__':main()
